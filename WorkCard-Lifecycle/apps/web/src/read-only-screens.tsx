import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  BatchLifecycleStatus,
  CommandName,
  DemoUser,
  ProductionBatchDetail,
  ProductionPassportDetail,
  Role,
  WorkCard,
  WorkCardPurpose,
  WorkCardSetDetail,
  WorkCardStatus,
} from '@work-card/contracts';

import { ApiClientError } from './api-client.js';
import { AppLink } from './AppLink.js';
import {
  releasedBatchIntegrityIssue,
  type BatchCommandClient,
  type ConfirmedBatchCommand,
} from './batch-commands.js';
import { MAX_BATCH_QUANTITY, validateBatchQuantity } from './batch-form.js';
import {
  commandRecoveryDescription,
  recoverAssignmentCommand,
  recoverBatchCommand,
  recoverCreateBatchCommand,
  recoverWorkCardCommand,
} from './command-recovery.js';
import { Icon } from './Icon.js';
import {
  MasterCommandIntegrityError,
  type ConfirmedAssignmentCommand,
  type ConfirmedWorkCardCommand,
  type MasterCommandClient,
} from './master-commands.js';
import { confirmedAssignmentEquation, selectAvailableWorkCards } from './master-selection.js';
import { commandGuardFor, type CommandGuard } from './permission-guards.js';
import {
  QualityCommandIntegrityError,
  finalAcceptanceReadinessIssues,
  type ConfirmedFinalBatchAcceptance,
  type ConfirmedFirstArticleAcceptance,
  type ConfirmedQualityCard,
  type QualityCommandClient,
} from './quality-commands.js';
import type { ScreenRoute } from './app-routing.js';
import {
  batchStatusLabels,
  closureTypeLabels,
  emptyWorkCardsCopy,
  formatCardCount,
  formatCount,
  formatDateTime,
  formatHours,
  formatProductCount,
  formatReleasePreview,
  formatSetCount,
  gateStatusLabels,
  statusTone,
  workCardPurposeLabels,
  workCardStatusLabels,
} from './read-presenters.js';
import { technicalErrorEntries, type TechnicalEntry } from './read-errors.js';
import type { ReadModelClient } from './read-model.js';
import {
  ContentCard,
  PageHeading,
  ReadErrorPanel,
  RefreshButton,
  StatePanel,
  TechnicalDetails,
  type Navigate,
} from './screen-ui.js';

type ReadOnlyScreenProps = Readonly<{
  batchCommands: BatchCommandClient;
  masterCommands: MasterCommandClient;
  navigate: Navigate;
  onAnnounce: (message: string) => void;
  onFormDirtyChange?: (dirty: boolean) => void;
  onRefresh: () => void;
  permissions: readonly CommandName[];
  qualityCommands: QualityCommandClient;
  readModel: ReadModelClient;
  role: Role;
  route: ScreenRoute;
  workers: readonly DemoUser[];
}>;

type ResourceState<T> =
  | Readonly<{ phase: 'error'; error: unknown }>
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ phase: 'ready'; data: T }>;

type CursorPage<T> = Readonly<{
  items: T[];
  nextCursor: string | null;
}>;

function useFormDirtyState(dirty: boolean, onFormDirtyChange?: (dirty: boolean) => void) {
  useEffect(() => {
    onFormDirtyChange?.(dirty);
  }, [dirty, onFormDirtyChange]);

  useEffect(() => () => onFormDirtyChange?.(false), [onFormDirtyChange]);
}

type CursorState<T> = Readonly<{
  error: unknown | null;
  items: T[];
  loadingInitial: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
}>;

function isAbort(error: unknown): boolean {
  return error instanceof ApiClientError && error.kind === 'abort';
}

function useReadResource<T>(loader: (signal: AbortSignal) => Promise<T>): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    void loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, phase: 'ready' });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbort(error)) setState({ error, phase: 'error' });
      });

    return () => controller.abort();
  }, [loader]);

  return state;
}

function useCursorPage<T>(
  loader: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>,
): CursorState<T> & Readonly<{ loadMore: () => void }> {
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<CursorState<T>>({
    error: null,
    items: [],
    loadingInitial: true,
    loadingMore: false,
    nextCursor: null,
  });

  useEffect(() => {
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    setState({
      error: null,
      items: [],
      loadingInitial: true,
      loadingMore: false,
      nextCursor: null,
    });

    void loader(undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState({
          error: null,
          items: page.items,
          loadingInitial: false,
          loadingMore: false,
          nextCursor: page.nextCursor,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setState({
          error,
          items: [],
          loadingInitial: false,
          loadingMore: false,
          nextCursor: null,
        });
      });

    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, [loader]);

  const loadMore = useCallback(() => {
    if (!state.nextCursor || state.loadingInitial || state.loadingMore) return;

    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setState((current) => ({ ...current, error: null, loadingMore: true }));

    void loader(state.nextCursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          error: null,
          items: [...current.items, ...page.items],
          loadingMore: false,
          nextCursor: page.nextCursor,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setState((current) => ({ ...current, error, loadingMore: false }));
      });
  }, [loader, state.loadingInitial, state.loadingMore, state.nextCursor]);

  return { ...state, loadMore };
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'neutral' | 'progress' | 'success' | 'warning';
}) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="fact-grid">{children}</dl>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fact-grid__item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PaginationFooter({
  count,
  hasMore,
  loading,
  noun,
  onLoadMore,
}: {
  count: number;
  hasMore: boolean;
  loading: boolean;
  noun: string;
  onLoadMore: () => void;
}) {
  return (
    <div className="pagination-footer">
      <p>
        Загружено {noun}: {formatCount(count)}
      </p>
      {hasMore ? (
        <button
          className="button button--secondary"
          disabled={loading}
          onClick={onLoadMore}
          type="button"
        >
          <Icon className="button__icon" name="refresh" />
          {loading ? 'Загружаем следующую страницу' : 'Загрузить ещё'}
        </button>
      ) : (
        <span className="pagination-footer__complete">Все доступные страницы загружены</span>
      )}
    </div>
  );
}

function ReadLoadingPanel({ description }: { description: string }) {
  return (
    <StatePanel description={description} icon="clock" title="Загружаем данные" tone="loading" />
  );
}

function BackToBatches({ navigate }: { navigate: Navigate }) {
  return (
    <AppLink className="button button--secondary" navigate={navigate} to="/batches">
      <Icon className="button__icon" name="arrow-left" />К партиям
    </AppLink>
  );
}

function commandErrorMessage(error: unknown, action: 'create' | 'release'): string {
  if (error instanceof ApiClientError) {
    if (error.kind === 'missing-csrf') {
      return 'Серверная сессия больше не подтверждена. Смените роль или войдите повторно; действие не будет повторено автоматически.';
    }
    if (error.kind === 'transport') {
      return action === 'create'
        ? 'Связь прервалась, поэтому результат создания неизвестен. Успех не показан; проверьте список партий перед новым решением.'
        : 'Связь прервалась, поэтому результат команды не подтверждён. Действие не повторяется автоматически.';
    }
    if (error.kind === 'invalid-response') {
      return 'Ответ сервера не прошёл проверку. Успех не зафиксирован; перечитайте данные перед новым решением.';
    }
    if (error.problem?.detail) return error.problem.detail;
    return 'Сервер не подтвердил действие. Данные формы сохранены, автоматического повтора не будет.';
  }

  return 'Контрольное чтение не подтвердило целостный результат. Успех не зафиксирован.';
}

function ReleasePreview({
  cardCount,
  quantity,
  setCount,
}: {
  cardCount: number;
  quantity: number;
  setCount: number;
}) {
  return (
    <div className="release-preview" aria-label="Предварительный результат выпуска">
      <div>
        <span>Партия</span>
        <strong>{formatProductCount(quantity)}</strong>
      </div>
      <span className="release-preview__arrow" aria-hidden="true">
        →
      </span>
      <div>
        <span>Состав</span>
        <strong>{formatSetCount(setCount)}</strong>
      </div>
      <span className="release-preview__arrow" aria-hidden="true">
        →
      </span>
      <div>
        <span>Результат</span>
        <strong>{formatCardCount(cardCount)}</strong>
      </div>
      <p className="sr-only">{formatReleasePreview(quantity, setCount, cardCount)}</p>
    </div>
  );
}

export function ConfirmationDialog({
  boundaryText,
  busy,
  busyLabel,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  preview,
  title,
}: {
  boundaryText: string;
  busy: boolean;
  busyLabel: string;
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  preview: ReactNode;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="confirmation-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      ref={dialogRef}
    >
      <div className="confirmation-dialog__body">
        <p className="confirmation-dialog__eyebrow">Требуется подтверждение</p>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {preview}
        <div className="notice notice--boundary confirmation-dialog__notice">
          <Icon name="shield" />
          <p>{boundaryText}</p>
        </div>
      </div>
      <div className="confirmation-dialog__actions">
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button
          autoFocus
          className="button button--primary"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function BatchesScreen({
  navigate,
  onRefresh,
  permissions,
  readModel,
  role,
  route,
}: ReadOnlyScreenProps) {
  const [passportQuery, setPassportQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BatchLifecycleStatus>('ALL');
  const loadPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      readModel.listBatches({ limit: 20, signal, ...(cursor ? { cursor } : {}) }),
    [readModel],
  );
  const page = useCursorPage(loadPage);
  const isPlanner = role === 'PLANNER';
  const createGuard = commandGuardFor({
    command: 'CreateProductionBatch',
    permissions,
    role,
  });
  const createReasonId = useId();
  const normalizedQuery = passportQuery.trim().toLocaleLowerCase('ru-RU');
  const visibleBatches = useMemo(
    () =>
      page.items.filter((batch) => {
        const statusMatches = statusFilter === 'ALL' || batch.lifecycleStatus === statusFilter;
        const passportMatches =
          !normalizedQuery ||
          `${batch.passportSnapshot.code} ${batch.passportSnapshot.revision} ${batch.passportSnapshot.productName}`
            .toLocaleLowerCase('ru-RU')
            .includes(normalizedQuery);
        return statusMatches && passportMatches;
      }),
    [normalizedQuery, page.items, statusFilter],
  );
  const filtersActive = Boolean(normalizedQuery) || statusFilter !== 'ALL';
  const technicalEntries: TechnicalEntry[] = page.items.flatMap((batch) => [
    { label: 'ProductionBatch ID', value: batch.id },
    { label: 'Batch version', value: batch.version },
    { label: 'Lifecycle status', value: batch.lifecycleStatus },
  ]);

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            {createGuard.state === 'enabled' ? (
              <AppLink className="button button--primary" navigate={navigate} to="/batches/new">
                <Icon className="button__icon" name="plus" />
                Создать партию
              </AppLink>
            ) : isPlanner && createGuard.state === 'disabled' ? (
              <span>
                <button
                  aria-describedby={createReasonId}
                  className="button button--primary"
                  disabled
                  type="button"
                >
                  <Icon className="button__icon" name="plus" />
                  Создать партию
                </button>
                <span className="sr-only" id={createReasonId}>
                  {createGuard.reason}
                </span>
              </span>
            ) : null}
          </>
        }
        description="Серверный список производственных партий, снимки паспортов и подтверждённые количества комплектов и карточек."
        eyebrow="Обзор производства"
        title="Производственные партии"
      />

      <ContentCard
        status={page.loadingInitial ? 'Загрузка данных' : 'Данные сервера'}
        title="Список партий"
      >
        {!page.loadingInitial && !page.error && page.items.length > 0 ? (
          <div className="filter-bar" aria-label="Фильтры списка партий">
            <label className="filter-field filter-field--wide">
              <span>Паспорт или изделие</span>
              <span className="filter-field__control">
                <Icon name="search" />
                <input
                  onChange={(event) => setPassportQuery(event.target.value)}
                  placeholder="Например, DEMO-250"
                  type="search"
                  value={passportQuery}
                />
              </span>
            </label>
            <label className="filter-field">
              <span>Состояние партии</span>
              <select
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'ALL' | BatchLifecycleStatus)
                }
                value={statusFilter}
              >
                <option value="ALL">Все состояния</option>
                <option value="CREATED">Не выпущена</option>
                <option value="RELEASED">Выпущена</option>
                <option value="FINAL_ACCEPTED">Финальная приёмка выполнена</option>
              </select>
            </label>
            {filtersActive ? (
              <button
                className="button button--quiet"
                onClick={() => {
                  setPassportQuery('');
                  setStatusFilter('ALL');
                }}
                type="button"
              >
                Сбросить фильтры
              </button>
            ) : null}
          </div>
        ) : null}

        {page.loadingInitial ? (
          <ReadLoadingPanel description="Получаем первую страницу партий с сервера." />
        ) : page.error && page.items.length === 0 ? (
          <ReadErrorPanel error={page.error} navigate={navigate} onRetry={onRefresh} />
        ) : page.items.length === 0 ? (
          <StatePanel
            action={
              isPlanner ? (
                <AppLink className="text-link" navigate={navigate} to="/batches/new">
                  Перейти к подготовленным паспортам
                  <Icon name="arrow-right" />
                </AppLink>
              ) : undefined
            }
            description={
              isPlanner
                ? 'Создайте первую партию по подготовленному производственному паспорту.'
                : 'Партии появятся здесь после создания специалистом ПДБ.'
            }
            icon="batch"
            title="Партий пока нет"
          />
        ) : visibleBatches.length === 0 ? (
          <StatePanel
            action={
              <button
                className="button button--secondary"
                onClick={() => {
                  setPassportQuery('');
                  setStatusFilter('ALL');
                }}
                type="button"
              >
                Сбросить фильтры
              </button>
            }
            description="Среди загруженных страниц нет партий с такими условиями. Сбросьте фильтры или загрузите следующую страницу."
            icon="search"
            title="Подходящих партий не найдено"
          />
        ) : (
          <div className="entity-list entity-list--batches">
            {visibleBatches.map((batch) => (
              <article className="entity-row" key={batch.id}>
                <div className="entity-row__heading">
                  <div>
                    <p className="entity-row__eyebrow">Производственный паспорт</p>
                    <h3>
                      {batch.passportSnapshot.code} · версия {batch.passportSnapshot.revision}
                    </h3>
                    <p>{batch.passportSnapshot.productName}</p>
                  </div>
                  <StatusBadge tone={statusTone(batch.lifecycleStatus)}>
                    {batchStatusLabels[batch.lifecycleStatus]}
                  </StatusBadge>
                </div>
                <FactGrid>
                  <Fact label="Изделий в партии" value={formatCount(batch.quantity)} />
                  <Fact label="Комплектов" value={formatCount(batch.counts.setCount)} />
                  <Fact
                    label="Карточек выпущено"
                    value={`${formatCount(batch.counts.actualCardCount)} из ${formatCount(batch.counts.plannedCardCount)}`}
                  />
                  <Fact
                    label="Карточек закрыто"
                    value={formatCount(batch.counts.closedCardCount)}
                  />
                  <Fact label="Создана" value={formatDateTime(batch.createdAt)} />
                </FactGrid>
                <div className="entity-row__footer">
                  <AppLink
                    className="text-link"
                    navigate={navigate}
                    to={`/batches/${encodeURIComponent(batch.id)}`}
                  >
                    Открыть состав партии
                    <Icon name="arrow-right" />
                  </AppLink>
                </div>
              </article>
            ))}
          </div>
        )}

        {!page.loadingInitial && page.items.length > 0 ? (
          <PaginationFooter
            count={page.items.length}
            hasMore={Boolean(page.nextCursor)}
            loading={page.loadingMore}
            noun="партий"
            onLoadMore={page.loadMore}
          />
        ) : null}
        {page.error && page.items.length > 0 ? (
          <div className="inline-error" role="alert">
            Следующую страницу загрузить не удалось. Уже загруженные партии сохранены.
          </div>
        ) : null}
      </ContentCard>
      <TechnicalDetails
        entries={[...technicalEntries, ...technicalErrorEntries(page.error)]}
        route={route}
      />
    </>
  );
}

export function NewBatchScreen({
  batchCommands,
  navigate,
  onAnnounce,
  onFormDirtyChange,
  onRefresh,
  permissions,
  readModel,
  role,
  route,
}: ReadOnlyScreenProps) {
  const createControllerRef = useRef<AbortController | null>(null);
  const [selectedPassportId, setSelectedPassportId] = useState('');
  const [quantityInput, setQuantityInput] = useState('112');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<unknown | null>(null);
  const [createRecovery, setCreateRecovery] = useState<
    'idle' | 'recovering' | 'recovered' | 'error'
  >('idle');
  const [submitting, setSubmitting] = useState(false);
  const quantityHelpId = useId();
  const quantityErrorId = useId();
  const validationErrorId = useId();
  const createPermissionReasonId = useId();
  const createGuard = commandGuardFor({
    command: 'CreateProductionBatch',
    permissions,
    role,
  });
  const loadPassports = useCallback(
    (signal: AbortSignal) => readModel.listPassports(signal),
    [readModel],
  );
  const catalog = useReadResource(loadPassports);
  const effectivePassportId =
    selectedPassportId || (catalog.phase === 'ready' ? (catalog.data.items[0]?.id ?? '') : '');
  const loadPassport = useCallback(
    (signal: AbortSignal): Promise<ProductionPassportDetail | null> =>
      effectivePassportId
        ? readModel.getPassport(effectivePassportId, signal)
        : Promise.resolve(null),
    [effectivePassportId, readModel],
  );
  const passport = useReadResource(loadPassport);
  const currentPassport =
    passport.phase === 'ready' && passport.data?.id === effectivePassportId ? passport.data : null;
  const quantityValidation = validateBatchQuantity(quantityInput);
  const defaultPassportId = catalog.phase === 'ready' ? catalog.data.items[0]?.id : undefined;
  useFormDirtyState(
    quantityInput !== '112' ||
      Boolean(selectedPassportId && selectedPassportId !== defaultPassportId) ||
      submitting ||
      validationError !== null,
    onFormDirtyChange,
  );

  useEffect(
    () => () => {
      createControllerRef.current?.abort();
    },
    [],
  );

  function submitBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createControllerRef.current || createError || createGuard.state !== 'enabled') return;

    const validation = quantityValidation;
    setQuantityError(validation.error);
    setValidationError(null);
    setCreateError(null);
    setCreateRecovery('idle');
    if (validation.value === null) return;
    if (!currentPassport) {
      setCreateError(new Error('Паспорт не готов к созданию партии.'));
      return;
    }

    const controller = new AbortController();
    createControllerRef.current = controller;
    setSubmitting(true);

    void batchCommands
      .createBatch({
        productionPassportId: currentPassport.id,
        quantity: validation.value,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        onAnnounce(
          `Партия из ${formatProductCount(result.batch.quantity)} создана и подтверждена контрольным чтением.`,
        );
        navigate(`/batches/${encodeURIComponent(result.batch.id)}`);
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        if (
          error instanceof ApiClientError &&
          error.kind === 'http-problem' &&
          (error.status === 422 ||
            (error.status === 400 && error.problem?.code === 'INVALID_REQUEST'))
        ) {
          setValidationError(error.message);
          onAnnounce('Сервер отклонил данные формы. Исправьте поля и подтвердите новое решение.');
          return;
        }
        setSelectedPassportId('');
        setQuantityInput('112');
        setQuantityError(null);
        setCreateError(error);
        setCreateRecovery('recovering');
        try {
          await recoverCreateBatchCommand(readModel, controller.signal);
          if (controller.signal.aborted) return;
          setCreateRecovery('recovered');
          onAnnounce(
            'Результат создания партии не подтверждён. Списки партий и паспортов перечитаны; форма очищена и не будет отправлена повторно.',
          );
        } catch (recoveryError: unknown) {
          if (controller.signal.aborted || isAbort(recoveryError)) return;
          setCreateRecovery('error');
          onAnnounce(
            'Результат создания партии не подтверждён, а безопасное перечитывание не завершилось. Автоматического повтора нет.',
          );
        }
      })
      .finally(() => {
        if (createControllerRef.current !== controller) return;
        createControllerRef.current = null;
        if (!controller.signal.aborted) setSubmitting(false);
      });
  }
  const technicalEntries: TechnicalEntry[] = [];
  if (catalog.phase === 'ready') {
    for (const item of catalog.data.items) {
      technicalEntries.push({ label: 'ProductionPassport ID', value: item.id });
    }
  }
  if (currentPassport) {
    technicalEntries.push({ label: 'Selected passport ID', value: currentPassport.id });
    for (const operation of currentPassport.operations) {
      technicalEntries.push({ label: 'OperationPlan ID', value: operation.id });
    }
  }

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            <BackToBatches navigate={navigate} />
          </>
        }
        description="Выберите подготовленный паспорт и проверьте состав групп операций. Маршрут и нормы доступны только для просмотра."
        eyebrow="Планирование"
        title="Новая производственная партия"
      />

      <ContentCard status="Подготовленные данные" title="Производственный паспорт">
        {catalog.phase === 'loading' ? (
          <ReadLoadingPanel description="Получаем подготовленные паспорта с сервера." />
        ) : catalog.phase === 'error' ? (
          <ReadErrorPanel error={catalog.error} navigate={navigate} onRetry={onRefresh} />
        ) : catalog.data.items.length === 0 ? (
          <StatePanel
            action={<RefreshButton onRefresh={onRefresh} />}
            description="Обновите данные или обратитесь к ответственному за подготовку демонстрационного контура. Маршрут и нормы здесь не редактируются."
            icon="document"
            title="Нет доступного подготовленного паспорта"
          />
        ) : (
          <div className="passport-reader">
            <label className="filter-field passport-reader__selector">
              <span>Подготовленный паспорт</span>
              <select
                aria-describedby={validationError ? validationErrorId : undefined}
                aria-invalid={validationError ? 'true' : undefined}
                disabled={submitting || createError !== null}
                onChange={(event) => {
                  setSelectedPassportId(event.target.value);
                  setValidationError(null);
                  setCreateError(null);
                  setCreateRecovery('idle');
                }}
                value={effectivePassportId}
              >
                {catalog.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · версия {item.revision} · {item.productName}
                  </option>
                ))}
              </select>
            </label>

            {passport.phase === 'loading' || (passport.phase === 'ready' && !currentPassport) ? (
              <ReadLoadingPanel description="Загружаем группы операций и нормы выбранного паспорта." />
            ) : passport.phase === 'error' ? (
              <ReadErrorPanel error={passport.error} navigate={navigate} onRetry={onRefresh} />
            ) : currentPassport ? (
              <>
                <div className="summary-strip">
                  <div>
                    <span>Изделие</span>
                    <strong>{currentPassport.productName}</strong>
                  </div>
                  <div>
                    <span>Групп операций</span>
                    <strong>{formatCount(currentPassport.operationCount)}</strong>
                  </div>
                  <div>
                    <span>Карточек по плану</span>
                    <strong>{formatCount(currentPassport.plannedCardCount)}</strong>
                  </div>
                </div>

                <div className="operation-list" aria-label="Группы операций выбранного паспорта">
                  {currentPassport.operations.map((operation) => (
                    <article className="operation-row" key={operation.id}>
                      <div>
                        <span className="operation-row__code">{operation.scopeCode}</span>
                        <h3>{operation.scopeName}</h3>
                      </div>
                      <FactGrid>
                        <Fact
                          label="Норма группы операций"
                          value={formatHours(operation.normHours)}
                        />
                        <Fact
                          label="Карточек по плану"
                          value={formatCount(operation.plannedCardCount)}
                        />
                      </FactGrid>
                    </article>
                  ))}
                </div>
                <div className="notice notice--boundary passport-reader__notice">
                  <Icon name="shield" />
                  <p>
                    Паспорт, группы операций и нормы подготовлены технологом и БТБ. На этом экране
                    они не изменяются.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}
      </ContentCard>

      {currentPassport ? (
        <ContentCard status="Действие ПДБ" title="Создание партии">
          <form
            aria-busy={submitting}
            className="batch-creation-form"
            noValidate
            onSubmit={submitBatch}
          >
            <div className="batch-creation-form__main">
              <div>
                <p className="batch-creation-form__eyebrow">Предварительный результат</p>
                <h3>Партия по выбранному паспорту</h3>
                <p>
                  Количество относится к изделиям в партии. Число карточек задаётся неизменяемым
                  планом групп операций выбранного паспорта.
                </p>
              </div>
              <label className="command-field" htmlFor="batch-quantity">
                <span>Количество изделий в партии</span>
                <input
                  aria-describedby={`${quantityHelpId}${quantityError ? ` ${quantityErrorId}` : ''}${validationError ? ` ${validationErrorId}` : ''}`}
                  aria-invalid={quantityError || validationError ? 'true' : undefined}
                  disabled={submitting || createError !== null}
                  id="batch-quantity"
                  inputMode="numeric"
                  max={MAX_BATCH_QUANTITY}
                  min="1"
                  onChange={(event) => {
                    setQuantityInput(event.target.value);
                    setQuantityError(null);
                    setValidationError(null);
                    if (!createError) setCreateRecovery('idle');
                  }}
                  required
                  step="1"
                  type="number"
                  value={quantityInput}
                />
                <small id={quantityHelpId}>Положительное целое число без единиц измерения.</small>
                {quantityError ? (
                  <span className="command-field__error" id={quantityErrorId} role="alert">
                    {quantityError}
                  </span>
                ) : null}
              </label>
            </div>

            {quantityValidation.value !== null ? (
              <ReleasePreview
                cardCount={currentPassport.plannedCardCount}
                quantity={quantityValidation.value}
                setCount={currentPassport.operationCount}
              />
            ) : null}

            {validationError ? (
              <p className="command-field__error" id={validationErrorId} role="alert">
                {validationError}
              </p>
            ) : null}

            {createError ? (
              <div className="notice notice--error command-notice" role="alert">
                <Icon name="shield" />
                <div>
                  <strong>Результат создания не подтверждён</strong>
                  <p>
                    {commandErrorMessage(createError, 'create')}{' '}
                    {createRecovery === 'recovering'
                      ? 'Перечитываем список партий и паспорта; форма уже очищена.'
                      : createRecovery === 'recovered'
                        ? 'Списки перечитаны. Откройте партии, проверьте текущее состояние и только затем принимайте новое решение.'
                        : createRecovery === 'error'
                          ? 'Полное перечитывание не завершилось; создание остаётся заблокированным.'
                          : null}
                  </p>
                  {createRecovery === 'recovered' ? (
                    <button
                      className="button button--secondary"
                      onClick={() => navigate('/batches')}
                      type="button"
                    >
                      <Icon className="button__icon" name="arrow-right" />
                      Открыть перечитанный список партий
                    </button>
                  ) : createRecovery === 'error' ? (
                    <button
                      className="button button--secondary"
                      onClick={() => navigate('/batches')}
                      type="button"
                    >
                      <Icon className="button__icon" name="arrow-right" />
                      Перейти к проверке списка партий
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="batch-creation-form__actions">
              <BackToBatches navigate={navigate} />
              <button
                aria-describedby={
                  createGuard.state === 'disabled' ? createPermissionReasonId : undefined
                }
                className="button button--primary"
                disabled={submitting || createError !== null || createGuard.state !== 'enabled'}
                type="submit"
              >
                <Icon className="button__icon" name="plus" />
                {submitting ? 'Создаём и перечитываем…' : 'Создать партию'}
              </button>
            </div>
            {createGuard.state === 'disabled' ? (
              <p className="release-command-panel__reason" id={createPermissionReasonId}>
                {createGuard.reason}
              </p>
            ) : null}
          </form>
        </ContentCard>
      ) : null}
      <TechnicalDetails
        entries={[
          ...technicalEntries,
          ...(catalog.phase === 'error' ? technicalErrorEntries(catalog.error) : []),
          ...(passport.phase === 'error' ? technicalErrorEntries(passport.error) : []),
          ...technicalErrorEntries(createError),
        ]}
        route={route}
      />
    </>
  );
}

function batchTechnicalEntries(batch: ProductionBatchDetail): TechnicalEntry[] {
  const entries: TechnicalEntry[] = [
    { label: 'ProductionBatch ID', value: batch.id },
    { label: 'Batch version', value: batch.version },
    { label: 'Lifecycle status', value: batch.lifecycleStatus },
    { label: 'Available actions', value: batch.availableActions.join(', ') },
  ];
  for (const operation of batch.operationPlan) {
    entries.push({ label: 'BatchOperationPlanSnapshot ID', value: operation.id });
  }
  for (const cardSet of batch.sets) {
    entries.push(
      { label: 'WorkCardSet ID', value: cardSet.id },
      { label: 'Set version', value: cardSet.version },
      { label: 'Gate status', value: cardSet.gateStatus },
    );
  }
  if (batch.finalAcceptance) {
    entries.push(
      { label: 'FinalBatchAcceptance ID', value: batch.finalAcceptance.id },
      { label: 'Acceptance command ID', value: batch.finalAcceptance.commandId },
      { label: 'Controller ID', value: batch.finalAcceptance.controller.id },
    );
  }
  return entries;
}

function releaseUnavailableReason(
  batch: ProductionBatchDetail,
  integrityIssue: string | null,
): string | null {
  if (integrityIssue) {
    return batch.lifecycleStatus === 'CREATED'
      ? 'Выпуск заблокирован: серверный план не прошёл проверку целостности. Обновите партию.'
      : 'Сервер сообщает о выпуске, но состав не прошёл контрольную сверку. Успех не подтверждён; обновите партию.';
  }
  if (batch.lifecycleStatus !== 'CREATED') {
    return 'Партия уже выпущена; повторный выпуск недоступен.';
  }
  if (!batch.availableActions.includes('ReleaseWorkCards')) {
    return 'Сервер не разрешил выпуск для текущего состояния или версии партии. Обновите данные.';
  }
  return null;
}

type ReleaseRecovery = 'current-not-released' | 'current-released' | 'unavailable';

type ReleaseCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting' }>
  | Readonly<{ phase: 'success'; result: ConfirmedBatchCommand }>
  | Readonly<{ error: unknown; phase: 'recovering' }>
  | Readonly<{
      error: unknown;
      phase: 'error';
      recovery: ReleaseRecovery;
      recoveryError: unknown | null;
    }>;

type FinalAcceptanceCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting' }>
  | Readonly<{ phase: 'success'; result: ConfirmedFinalBatchAcceptance }>
  | Readonly<{ error: unknown; phase: 'recovering' }>
  | Readonly<{
      error: unknown;
      phase: 'error';
      recovery: 'current-accepted' | 'current-not-accepted' | 'unavailable';
      recoveryError: unknown | null;
    }>;

function qualityCommandMessage(error: unknown, target: 'batch' | 'card'): string {
  if (error instanceof QualityCommandIntegrityError) {
    return `${error.message} Успех не подтверждён; локальное состояние не изменено.`;
  }
  if (error instanceof ApiClientError) {
    if (error.kind === 'transport' || error.kind === 'abort') {
      return `Исход команды не подтверждён. Автоматического повтора нет; сначала перечитайте ${target === 'batch' ? 'партию' : 'карточку'}.`;
    }
    if (error.status === 409) {
      return `Данные изменились. Команда не повторится автоматически; перечитайте ${target === 'batch' ? 'партию' : 'карточку'} перед новым решением.`;
    }
    return `${error.message} Успех не подтверждён.`;
  }
  return `Контрольное чтение не подтвердило результат. Перечитайте ${target === 'batch' ? 'партию' : 'карточку'} перед новым решением.`;
}

function qualityTechnicalEntries(
  state: FinalAcceptanceCommandState | QualityCardCommandState,
): TechnicalEntry[] {
  if (state.phase === 'success') {
    const readBackContexts =
      'readBackContexts' in state.result
        ? state.result.readBackContexts
        : [state.result.readBackContext];
    return [
      { label: 'Correlation ID', value: state.result.correlationId },
      { label: 'Command request ID', value: state.result.commandContext.requestId ?? null },
      ...readBackContexts.map((context, index) => ({
        label: `Read-back request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
    ];
  }
  if (state.phase !== 'error' && state.phase !== 'recovering' && state.phase !== 'recovered') {
    return [];
  }
  const recoveryEntries = state.phase === 'error' ? technicalErrorEntries(state.recoveryError) : [];
  if (state.error instanceof QualityCommandIntegrityError) {
    return [
      ...technicalErrorEntries(state.error),
      { label: 'Correlation ID', value: state.error.correlationId },
      { label: 'Command request ID', value: state.error.commandContext?.requestId ?? null },
      ...state.error.readBackContexts.map((context, index) => ({
        label: `Read-back request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
      ...recoveryEntries,
    ];
  }
  return [...technicalErrorEntries(state.error), ...recoveryEntries];
}

function planIntegrityIssue(batch: ProductionBatchDetail): string | null {
  const plannedCards = batch.operationPlan.reduce(
    (total, operation) => total + operation.plannedCardCount,
    0,
  );
  if (batch.operationPlan.length === 0) return 'Снимок плана партии пуст.';
  if (plannedCards !== batch.counts.plannedCardCount) {
    return 'Итог карточек не совпадает со снимком плана партии.';
  }
  if (
    batch.lifecycleStatus === 'CREATED' &&
    (batch.sets.length !== 0 || batch.counts.setCount !== 0 || batch.counts.actualCardCount !== 0)
  ) {
    return 'До выпуска у партии обнаружен частичный состав.';
  }
  return null;
}

function commandTechnicalEntries(result: ConfirmedBatchCommand): TechnicalEntry[] {
  return [
    { label: 'Correlation ID', value: result.correlationId },
    { label: 'Command request ID', value: result.commandContext.requestId ?? null },
    { label: 'Read-back request ID', value: result.readBackContext.requestId ?? null },
  ];
}

export function BatchReadyContent({
  batchCommands,
  initialBatch,
  navigate,
  onAnnounce,
  onRefresh,
  permissions,
  qualityCommands,
  readModel,
  role,
  route,
}: {
  batchCommands: BatchCommandClient;
  initialBatch: ProductionBatchDetail;
  navigate: Navigate;
  onAnnounce: (message: string) => void;
  onRefresh: () => void;
  permissions: readonly CommandName[];
  qualityCommands: QualityCommandClient;
  readModel: ReadModelClient;
  role: Role;
  route: ScreenRoute;
}) {
  const commandControllerRef = useRef<AbortController | null>(null);
  const acceptanceControllerRef = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState(initialBatch);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [acceptanceConfirmationOpen, setAcceptanceConfirmationOpen] = useState(false);
  const [releaseState, setReleaseState] = useState<ReleaseCommandState>({ phase: 'idle' });
  const [finalAcceptanceState, setFinalAcceptanceState] = useState<FinalAcceptanceCommandState>({
    phase: 'idle',
  });
  const releaseReasonId = useId();
  const finalAcceptanceReasonId = useId();
  const gatesAllowed = batch.sets.filter(
    (cardSet) => cardSet.gateStatus === 'SERIAL_ALLOWED',
  ).length;
  const planIssue = planIntegrityIssue(batch);
  const releaseIssue =
    batch.lifecycleStatus === 'CREATED' ? null : releasedBatchIntegrityIssue(batch);
  const integrityIssue = planIssue ?? releaseIssue;
  const finalReadinessIssues = finalAcceptanceReadinessIssues(batch);
  const readyForFinalAcceptance =
    !integrityIssue && !batch.finalAcceptance && finalReadinessIssues.length === 0;
  const releaseGuard = commandGuardFor({
    command: 'ReleaseWorkCards',
    permissions,
    role,
    unavailableReason: releaseUnavailableReason(batch, integrityIssue),
  });
  const releaseBlocked =
    releaseState.phase === 'recovering' ||
    (releaseState.phase === 'error' && releaseState.recovery === 'unavailable');
  const canRelease = releaseGuard.state === 'enabled' && !releaseBlocked;
  const submitting = releaseState.phase === 'submitting';
  const releaseBusy = submitting || releaseState.phase === 'recovering';
  const accepting = finalAcceptanceState.phase === 'submitting';
  const acceptanceBusy = accepting || finalAcceptanceState.phase === 'recovering';
  const acceptanceBlocked =
    finalAcceptanceState.phase === 'recovering' ||
    (finalAcceptanceState.phase === 'error' && finalAcceptanceState.recovery === 'unavailable');
  const finalAcceptanceUnavailableReason =
    finalReadinessIssues.length > 0
      ? finalReadinessIssues.join(' ')
      : !batch.availableActions.includes('RecordFinalBatchAcceptance')
        ? 'Сервер не разрешил финальную приёмку для текущего состояния или версии партии. Обновите данные.'
        : acceptanceBlocked
          ? 'Предыдущее решение не подтверждено. Перечитайте партию перед новой попыткой.'
          : null;
  const finalAcceptanceGuard = commandGuardFor({
    command: 'RecordFinalBatchAcceptance',
    permissions,
    role,
    unavailableReason: finalAcceptanceUnavailableReason,
  });
  const canAcceptBatch = finalAcceptanceGuard.state === 'enabled';

  useEffect(
    () => () => {
      commandControllerRef.current?.abort();
      acceptanceControllerRef.current?.abort();
    },
    [],
  );

  function confirmFinalAcceptance() {
    if (!canAcceptBatch || acceptanceControllerRef.current) return;

    const controller = new AbortController();
    acceptanceControllerRef.current = controller;
    setFinalAcceptanceState({ phase: 'submitting' });

    void qualityCommands
      .recordFinalBatchAcceptance({ batch, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setBatch(result.batch);
        setFinalAcceptanceState({ phase: 'success', result });
        setAcceptanceConfirmationOpen(false);
        onAnnounce(
          `Финальная приёмка подтверждена контрольным чтением. Контролёр: ${result.acceptance.controller.displayName}; время: ${formatDateTime(result.acceptance.acceptedAt)}.`,
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setAcceptanceConfirmationOpen(false);
        setFinalAcceptanceState({ error, phase: 'recovering' });
        try {
          const currentBatch = await recoverBatchCommand(readModel, batch.id, controller.signal);
          if (controller.signal.aborted) return;
          setBatch(currentBatch);
          const recovery = currentBatch.finalAcceptance
            ? 'current-accepted'
            : 'current-not-accepted';
          setFinalAcceptanceState({
            error,
            phase: 'error',
            recovery,
            recoveryError: null,
          });
          onAnnounce(
            recovery === 'current-accepted'
              ? 'Исход команды не подтверждён, но свежие данные уже содержат финальную приёмку. Повтор недоступен.'
              : 'Финальная приёмка не подтверждена. Партия перечитана; новое действие потребует нового подтверждения.',
          );
        } catch (recoveryError: unknown) {
          if (controller.signal.aborted || isAbort(recoveryError)) return;
          setFinalAcceptanceState({
            error,
            phase: 'error',
            recovery: 'unavailable',
            recoveryError,
          });
          onAnnounce(
            'Финальная приёмка не подтверждена, а безопасное перечитывание не завершилось. Автоматического повтора нет.',
          );
        }
      })
      .finally(() => {
        if (acceptanceControllerRef.current === controller) {
          acceptanceControllerRef.current = null;
        }
      });
  }

  function confirmRelease() {
    if (!canRelease || commandControllerRef.current) return;

    const controller = new AbortController();
    commandControllerRef.current = controller;
    setReleaseState({ phase: 'submitting' });

    void batchCommands
      .releaseBatch({
        batchId: batch.id,
        expectedBatchVersion: batch.version,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setBatch(result.batch);
        setReleaseState({ phase: 'success', result });
        setConfirmationOpen(false);
        onAnnounce(
          `Выпуск подтверждён: ${formatSetCount(result.batch.counts.setCount)}, ${formatCardCount(result.batch.counts.actualCardCount)}.`,
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;

        setConfirmationOpen(false);
        setReleaseState({ error, phase: 'recovering' });
        let recovery: ReleaseRecovery = 'unavailable';
        let recoveryError: unknown | null = null;
        try {
          const currentBatch = await recoverBatchCommand(readModel, batch.id, controller.signal);
          if (controller.signal.aborted) return;
          setBatch(currentBatch);
          recovery =
            currentBatch.lifecycleStatus !== 'CREATED' &&
            releasedBatchIntegrityIssue(currentBatch) === null
              ? 'current-released'
              : 'current-not-released';
        } catch (readError: unknown) {
          if (controller.signal.aborted || isAbort(readError)) return;
          recoveryError = readError;
        }

        setReleaseState({ error, phase: 'error', recovery, recoveryError });
        onAnnounce(
          recovery === 'current-released'
            ? 'Команда не подтверждена, но контрольное чтение показывает полный текущий выпуск.'
            : 'Выпуск не подтверждён. Автоматического повтора нет.',
        );
      })
      .finally(() => {
        if (commandControllerRef.current !== controller) return;
        commandControllerRef.current = null;
      });
  }

  return (
    <>
      <div className="screen-stack">
        {integrityIssue ? (
          <div className="notice notice--error command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <p>
                Данные партии не прошли проверку целостности. Производственные действия
                заблокированы; обновите данные или проверьте серверную проекцию.
              </p>
              <button className="button button--secondary" onClick={onRefresh} type="button">
                <Icon className="button__icon" name="refresh" />
                Перечитать всю партию
              </button>
            </div>
          </div>
        ) : null}

        {releaseState.phase === 'success' ? (
          <div className="notice notice--success command-notice" role="status">
            <Icon name="shield" />
            <div>
              <strong>Все комплекты выпущены</strong>
              <p>
                Сервер и контрольное чтение подтверждают{' '}
                {formatReleasePreview(
                  releaseState.result.batch.quantity,
                  releaseState.result.batch.counts.setCount,
                  releaseState.result.batch.counts.actualCardCount,
                )}
                . Частичного результата нет.
              </p>
            </div>
          </div>
        ) : null}

        {releaseState.phase === 'recovering' ? (
          <div className="notice notice--warning command-notice" role="status">
            <Icon name="refresh" />
            <div>
              <strong>Выпуск не подтверждён — перечитываем партию</strong>
              <p>Повторяются только безопасные чтения состава и итогов; команда не повторяется.</p>
            </div>
          </div>
        ) : null}

        {releaseState.phase === 'error' ? (
          <div
            className={`notice ${releaseState.recovery === 'current-released' ? 'notice--warning' : 'notice--error'} command-notice`}
            role="alert"
          >
            <Icon name="shield" />
            <div>
              <strong>
                {releaseState.recovery === 'current-released'
                  ? 'Текущее состояние перечитано'
                  : 'Выпуск не подтверждён'}
              </strong>
              <p>
                {releaseState.recovery === 'current-released'
                  ? 'Исход команды не подтверждён, но сервер уже показывает полный согласованный выпуск. Повторное действие недоступно.'
                  : releaseState.recovery === 'current-not-released'
                    ? `${commandErrorMessage(releaseState.error, 'release')} Показана актуальная невыпущенная партия; для повтора потребуется новое подтверждение.`
                    : `${commandErrorMessage(releaseState.error, 'release')} Контрольное чтение также недоступно.`}
              </p>
              {releaseState.recovery === 'unavailable' ? (
                <button className="button button--secondary" onClick={onRefresh} type="button">
                  <Icon className="button__icon" name="refresh" />
                  Перечитать всю партию
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {finalAcceptanceState.phase === 'success' ? (
          <div className="notice notice--success command-notice" role="status">
            <Icon name="shield" />
            <div>
              <strong>Финальная приёмка партии подтверждена</strong>
              <p>
                Контрольное чтение сверило отдельную запись, контролёра{' '}
                {finalAcceptanceState.result.acceptance.controller.displayName}, серверное время{' '}
                {formatDateTime(finalAcceptanceState.result.acceptance.acceptedAt)} и идентификатор
                приёмки.
              </p>
            </div>
          </div>
        ) : null}

        {finalAcceptanceState.phase === 'recovering' ? (
          <div className="notice notice--warning command-notice" role="status">
            <Icon name="refresh" />
            <div>
              <strong>Финальная приёмка не подтверждена — перечитываем партию</strong>
              <p>
                Проверяем свежие итоги, состояние партии и существующую запись без повтора команды.
              </p>
            </div>
          </div>
        ) : null}

        {finalAcceptanceState.phase === 'error' ? (
          <div className="notice notice--error command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Финальная приёмка не подтверждена</strong>
              <p>
                {commandRecoveryDescription(finalAcceptanceState.error)}{' '}
                {finalAcceptanceState.recovery === 'current-accepted'
                  ? 'Свежие данные уже содержат согласованную запись; это текущее состояние, а не подтверждение исхода команды. Повтор недоступен.'
                  : finalAcceptanceState.recovery === 'current-not-accepted'
                    ? 'Свежие данные перечитаны. Для новой попытки заново проверьте условия и подтвердите решение.'
                    : 'Перечитать все данные не удалось; действия остаются заблокированными.'}
              </p>
            </div>
          </div>
        ) : null}

        <section className="summary-panel" aria-label="Сведения о партии">
          <div className="summary-panel__heading">
            <div>
              <p>Производственный паспорт</p>
              <h2>
                {batch.passportSnapshot.code} · версия {batch.passportSnapshot.revision}
              </h2>
              <span>{batch.passportSnapshot.productName}</span>
            </div>
            <StatusBadge
              tone={readyForFinalAcceptance ? 'progress' : statusTone(batch.lifecycleStatus)}
            >
              {readyForFinalAcceptance
                ? 'Готова к финальной приёмке'
                : batchStatusLabels[batch.lifecycleStatus]}
            </StatusBadge>
          </div>
          <FactGrid>
            <Fact label="Изделий в партии" value={formatCount(batch.quantity)} />
            <Fact
              label="Комплектов выпущено"
              value={`${formatCount(batch.counts.setCount)} из ${formatCount(batch.operationPlan.length)}`}
            />
            <Fact
              label="Карточек выпущено"
              value={`${formatCount(batch.counts.actualCardCount)} из ${formatCount(batch.counts.plannedCardCount)}`}
            />
            <Fact
              label="Карточек закрыто"
              value={`${formatCount(batch.counts.closedCardCount)} из ${formatCount(batch.counts.actualCardCount)}`}
            />
            <Fact label="Создана" value={formatDateTime(batch.createdAt)} />
            <Fact
              label="Выпущена"
              value={batch.releasedAt ? formatDateTime(batch.releasedAt) : 'Ещё не выпущена'}
            />
          </FactGrid>
        </section>

        <ContentCard
          status="Нормы по группам операций"
          title={batch.sets.length === 0 ? 'План комплектов' : 'Комплекты карточек'}
        >
          {batch.sets.length === 0 ? (
            <div className="operation-list" aria-label="Снимок плана комплектов партии">
              {batch.operationPlan.map((operation) => (
                <article className="operation-row" key={operation.id}>
                  <div>
                    <span className="operation-row__code">{operation.scopeCode}</span>
                    <h3>{operation.scopeName}</h3>
                  </div>
                  <FactGrid>
                    <Fact label="Норма группы операций" value={formatHours(operation.normHours)} />
                    <Fact
                      label="Карточек по плану"
                      value={formatCount(operation.plannedCardCount)}
                    />
                  </FactGrid>
                </article>
              ))}
            </div>
          ) : (
            <div className="entity-list entity-list--sets">
              {batch.sets.map((cardSet) => (
                <article className="entity-row" key={cardSet.id}>
                  <div className="entity-row__heading">
                    <div>
                      <p className="entity-row__eyebrow">{cardSet.scopeCode}</p>
                      <h3>{cardSet.scopeName}</h3>
                    </div>
                    <StatusBadge tone={statusTone(cardSet.gateStatus)}>
                      {gateStatusLabels[cardSet.gateStatus]}
                    </StatusBadge>
                  </div>
                  <FactGrid>
                    <Fact label="Норма группы операций" value={formatHours(cardSet.normHours)} />
                    <Fact label="Карточек по плану" value={formatCount(cardSet.plannedCardCount)} />
                    <Fact label="Карточек выпущено" value={formatCount(cardSet.actualCardCount)} />
                    <Fact label="Карточек закрыто" value={formatCount(cardSet.closedCardCount)} />
                  </FactGrid>
                  <div className="entity-row__footer">
                    <AppLink
                      className="text-link"
                      navigate={navigate}
                      to={`/card-sets/${encodeURIComponent(cardSet.id)}`}
                    >
                      Открыть комплект
                      <Icon name="arrow-right" />
                    </AppLink>
                  </div>
                </article>
              ))}
            </div>
          )}
        </ContentCard>

        {releaseGuard.state !== 'hidden' ? (
          <ContentCard status="Одно подтверждение" title="Атомарный выпуск карточек">
            <div className="release-command-panel">
              <ReleasePreview
                cardCount={batch.counts.plannedCardCount}
                quantity={batch.quantity}
                setCount={batch.operationPlan.length}
              />
              <p>
                Один выпуск создаёт комплект для каждой группы операций и все предусмотренные
                карточки. Промежуточный результат интерфейс не показывает как успех.
              </p>
              <button
                aria-describedby={releaseGuard.state === 'disabled' ? releaseReasonId : undefined}
                className="button button--primary"
                disabled={!canRelease || releaseBusy}
                onClick={() => setConfirmationOpen(true)}
                type="button"
              >
                <Icon className="button__icon" name="card" />
                Выпустить все комплекты
              </button>
              {releaseGuard.state === 'disabled' ? (
                <p className="release-command-panel__reason" id={releaseReasonId}>
                  {releaseGuard.reason}
                </p>
              ) : null}
            </div>
          </ContentCard>
        ) : null}

        <ContentCard status="Отдельная проверка партии" title="Готовность к финальной приёмке">
          <div className="acceptance-summary">
            <FactGrid>
              <Fact
                label="Групп с принятой первой деталью"
                value={`${formatCount(gatesAllowed)} из ${formatCount(batch.operationPlan.length)}`}
              />
              <Fact
                label="Обязательных карточек закрыто"
                value={`${formatCount(batch.counts.closedCardCount)} из ${formatCount(batch.counts.plannedCardCount)}`}
              />
              <Fact
                label="Финальная приёмка"
                value={batch.finalAcceptance ? 'Записана' : 'Ещё не записана'}
              />
            </FactGrid>
            {batch.finalAcceptance ? (
              <div className="acceptance-record">
                <Icon name="shield" />
                <div>
                  <p>Финальная приёмка партии подтверждена</p>
                  <strong>{batch.finalAcceptance.controller.displayName}</strong>
                  <span>Время сервера: {formatDateTime(batch.finalAcceptance.acceptedAt)}</span>
                  <span>Идентификатор записи сверён обязательным контрольным чтением</span>
                </div>
              </div>
            ) : (
              <>
                <p className="acceptance-summary__note">
                  Закрытие карточек само по себе не создаёт финальную приёмку партии. Это отдельная
                  положительная и неизменяемая запись БТК.
                </p>
                {role === 'QUALITY_CONTROLLER' ? (
                  <div className="acceptance-command">
                    <div
                      className="acceptance-command__requirements"
                      aria-label="Условия финальной приёмки"
                    >
                      <p>
                        <span aria-hidden="true">
                          {gatesAllowed === batch.operationPlan.length ? '✓' : '○'}
                        </span>
                        <strong>Первые детали:</strong> {formatCount(gatesAllowed)} из{' '}
                        {formatCount(batch.operationPlan.length)}
                      </p>
                      <p>
                        <span aria-hidden="true">
                          {batch.counts.closedCardCount === batch.counts.plannedCardCount
                            ? '✓'
                            : '○'}
                        </span>
                        <strong>Закрытые карточки:</strong>{' '}
                        {formatCount(batch.counts.closedCardCount)} из{' '}
                        {formatCount(batch.counts.plannedCardCount)}
                      </p>
                    </div>
                    {finalReadinessIssues.length > 0 ? (
                      <div
                        className="acceptance-command__reasons"
                        id={finalAcceptanceReasonId}
                        role="status"
                      >
                        <strong>Финальная приёмка пока недоступна</strong>
                        <ul>
                          {finalReadinessIssues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ) : finalAcceptanceGuard.state === 'disabled' ? (
                      <p
                        className="acceptance-command__reasons"
                        id={finalAcceptanceReasonId}
                        role="alert"
                      >
                        {finalAcceptanceGuard.reason}
                      </p>
                    ) : null}
                    <button
                      aria-describedby={
                        finalAcceptanceGuard.state === 'disabled'
                          ? finalAcceptanceReasonId
                          : undefined
                      }
                      className="button button--primary"
                      disabled={!canAcceptBatch || acceptanceBusy}
                      onClick={() => setAcceptanceConfirmationOpen(true)}
                      type="button"
                    >
                      <Icon className="button__icon" name="shield" />
                      {accepting ? 'Принимаем и перечитываем…' : 'Принять завершённую партию'}
                    </button>
                    {finalAcceptanceState.phase === 'error' &&
                    finalAcceptanceState.recovery === 'unavailable' ? (
                      <button
                        className="button button--secondary"
                        onClick={onRefresh}
                        type="button"
                      >
                        <Icon className="button__icon" name="refresh" />
                        Перечитать партию
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </ContentCard>
      </div>

      <TechnicalDetails
        entries={[
          ...batchTechnicalEntries(batch),
          ...qualityTechnicalEntries(finalAcceptanceState),
          ...(releaseState.phase === 'success'
            ? commandTechnicalEntries(releaseState.result)
            : releaseState.phase === 'error'
              ? [
                  ...technicalErrorEntries(releaseState.error),
                  ...technicalErrorEntries(releaseState.recoveryError),
                ]
              : releaseState.phase === 'recovering'
                ? technicalErrorEntries(releaseState.error)
                : []),
        ]}
        route={route}
      />

      <ConfirmationDialog
        boundaryText="Команда выполняется один раз. Интерфейс покажет успех только после контрольного перечитывания всей партии."
        busy={releaseBusy}
        busyLabel="Выпускаем и проверяем…"
        confirmLabel="Выпустить все комплекты"
        description={`Будут атомарно созданы ${formatSetCount(batch.operationPlan.length)} и ${formatCardCount(batch.counts.plannedCardCount)}. Повторный выпуск недоступен.`}
        onCancel={() => {
          if (!submitting) setConfirmationOpen(false);
        }}
        onConfirm={confirmRelease}
        open={confirmationOpen}
        preview={
          <ReleasePreview
            cardCount={batch.counts.plannedCardCount}
            quantity={batch.quantity}
            setCount={batch.operationPlan.length}
          />
        }
        title="Выпустить все комплекты?"
      />

      <ConfirmationDialog
        boundaryText="Положительная финальная приёмка будет показана только после контрольного чтения и сверки контролёра, времени и идентификатора записи. Частичный успех не отображается."
        busy={acceptanceBusy}
        busyLabel="Принимаем и проверяем…"
        confirmLabel="Подтвердить финальную приёмку"
        description="Будет создана отдельная неизменяемая запись финальной приёмки всей завершённой партии. Отрицательный исход и физическая подпись этим действием не фиксируются."
        onCancel={() => {
          if (!accepting) setAcceptanceConfirmationOpen(false);
        }}
        onConfirm={confirmFinalAcceptance}
        open={acceptanceConfirmationOpen}
        preview={
          <div className="acceptance-dialog-summary">
            <strong>
              {formatCount(gatesAllowed)} из {formatCount(batch.operationPlan.length)} первых
              деталей приняты
            </strong>
            <strong>
              {formatCount(batch.counts.closedCardCount)} из{' '}
              {formatCount(batch.counts.plannedCardCount)} карточек закрыты
            </strong>
          </div>
        }
        title="Принять завершённую партию?"
      />
    </>
  );
}

export function BatchScreen({
  batchCommands,
  navigate,
  onAnnounce,
  onRefresh,
  permissions,
  qualityCommands,
  readModel,
  role,
  route,
}: ReadOnlyScreenProps) {
  const batchId = route.params.batchId ?? '';
  const loader = useCallback(
    (signal: AbortSignal) => readModel.getBatch(batchId, signal),
    [batchId, readModel],
  );
  const state = useReadResource(loader);
  const batch = state.phase === 'ready' ? state.data : null;

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            <BackToBatches navigate={navigate} />
          </>
        }
        description="Снимок производственного паспорта, состав комплектов и готовность всей партии по подтверждённым данным сервера."
        eyebrow="Производственный контекст"
        title={
          batch ? `Партия по паспорту ${batch.passportSnapshot.code}` : 'Производственная партия'
        }
      />

      {state.phase === 'loading' ? (
        <ContentCard status="Загрузка данных" title="Состав партии">
          <ReadLoadingPanel description="Получаем снимок паспорта, план комплектов и итоговые количества." />
        </ContentCard>
      ) : state.phase === 'error' ? (
        <>
          <ContentCard status="Ошибка чтения" title="Состав партии">
            <ReadErrorPanel error={state.error} navigate={navigate} onRetry={onRefresh} />
          </ContentCard>
          <TechnicalDetails entries={technicalErrorEntries(state.error)} route={route} />
        </>
      ) : (
        <BatchReadyContent
          batchCommands={batchCommands}
          initialBatch={state.data}
          navigate={navigate}
          onAnnounce={onAnnounce}
          onRefresh={onRefresh}
          permissions={permissions}
          qualityCommands={qualityCommands}
          readModel={readModel}
          role={role}
          route={route}
        />
      )}
    </>
  );
}

const workCardStatusOptions: readonly WorkCardStatus[] = [
  'RELEASED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED',
];

type AssignmentCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting' }>
  | Readonly<{ phase: 'success'; result: ConfirmedAssignmentCommand }>
  | Readonly<{ affectedCardIds: readonly string[]; error: unknown; phase: 'recovering' }>
  | Readonly<{ affectedCardIds: readonly string[]; error: unknown; phase: 'recovered' }>
  | Readonly<{
      affectedCardIds: readonly string[];
      error: unknown;
      phase: 'error';
      recoveryError: unknown;
    }>;

function assignmentUnavailableReason(cardSet: WorkCardSetDetail | null): string | null {
  if (!cardSet) return 'Комплект ещё не загружен.';
  if (cardSet.actualCardCount !== cardSet.plannedCardCount) {
    return 'Назначение заблокировано: состав комплекта не совпадает с планом.';
  }
  if (cardSet.gateStatus === 'FIRST_ARTICLE_PENDING' && cardSet.firstArticleWorkCardId) {
    return 'Карточка первой детали уже назначена. Обработка партии откроется после положительной приёмки БТК.';
  }
  if (cardSet.statusCounts.RELEASED === 0) {
    return 'Все карточки этого комплекта уже распределены; переназначение в прототип не входит.';
  }
  if (!cardSet.availableActions.includes('AssignWorkCards')) {
    return cardSet.gateStatus === 'FIRST_ARTICLE_PENDING'
      ? 'Сервер не разрешил выбор первой детали для текущего состояния или версии комплекта. Обновите данные.'
      : 'Сначала требуется положительная приёмка первой детали и открытый допуск обработки партии.';
  }
  return null;
}

function assignmentCommandMessage(error: unknown): string {
  if (error instanceof MasterCommandIntegrityError) {
    return 'Ответ команды и контрольное чтение не совпали. Успех не подтверждён; перечитайте комплект перед новым решением.';
  }
  if (error instanceof ApiClientError) {
    if (error.kind === 'transport' || error.kind === 'abort') {
      return 'Исход команды не подтверждён. Автоматического повтора нет; перечитайте комплект перед новым решением.';
    }
    if (error.status === 409) {
      return 'Данные изменились. Команда не повторится автоматически; перечитайте комплект и выберите карточки заново.';
    }
    return `${error.message} Перечитайте комплект перед новым решением.`;
  }
  return 'Назначение не подтверждено. Перечитайте комплект перед новым решением.';
}

function assignmentTechnicalEntries(state: AssignmentCommandState): TechnicalEntry[] {
  if (state.phase === 'success') {
    return [
      { label: 'Correlation ID', value: state.result.correlationId },
      { label: 'Command request ID', value: state.result.commandContext.requestId ?? null },
      ...state.result.readBackContexts.map((context, index) => ({
        label: `Read-back request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
    ];
  }
  if (state.phase === 'error') {
    return [...technicalErrorEntries(state.error), ...technicalErrorEntries(state.recoveryError)];
  }
  return state.phase === 'recovering' || state.phase === 'recovered'
    ? technicalErrorEntries(state.error)
    : [];
}

export function WorkCardSetScreen({
  masterCommands,
  navigate,
  onAnnounce,
  onFormDirtyChange,
  onRefresh,
  permissions,
  readModel,
  role,
  route,
  workers,
}: ReadOnlyScreenProps) {
  const setId = route.params.setId ?? '';
  const assignmentControllerRef = useRef<AbortController | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | WorkCardStatus>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<'ALL' | WorkCardPurpose>('ALL');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [selectedCardIds, setSelectedCardIds] = useState<ReadonlySet<string>>(new Set());
  const [assignmentConfirmationOpen, setAssignmentConfirmationOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState('59');
  const [confirmedSet, setConfirmedSet] = useState<WorkCardSetDetail | null>(null);
  const [confirmedCards, setConfirmedCards] = useState<ReadonlyMap<string, WorkCard>>(new Map());
  const [assignmentState, setAssignmentState] = useState<AssignmentCommandState>({
    phase: 'idle',
  });
  const assignmentSubmitReasonId = useId();
  const loadSet = useCallback(
    (signal: AbortSignal) => readModel.getWorkCardSet(setId, signal),
    [readModel, setId],
  );
  const setState = useReadResource(loadSet);
  const cardSet = setState.phase === 'ready' ? (confirmedSet ?? setState.data) : null;
  const loadCards = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      readModel.listWorkCards({
        limit: 100,
        setId,
        signal,
        ...(cursor ? { cursor } : {}),
        ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
        ...(assigneeFilter ? { assigneeId: assigneeFilter } : {}),
      }),
    [assigneeFilter, readModel, setId, statusFilter],
  );
  const cards = useCursorPage(loadCards);
  const currentCards = useMemo(
    () => cards.items.map((card) => confirmedCards.get(card.id) ?? card),
    [cards.items, confirmedCards],
  );
  const visibleCards = useMemo(
    () =>
      currentCards.filter(
        (card) =>
          (statusFilter === 'ALL' || card.status === statusFilter) &&
          (!assigneeFilter || card.assignee?.id === assigneeFilter) &&
          (purposeFilter === 'ALL' || card.purpose === purposeFilter),
      ),
    [assigneeFilter, currentCards, purposeFilter, statusFilter],
  );
  const assignees = useMemo(() => {
    if (!cardSet) return [];
    const unique = new Map<string, string>();
    for (const assignment of cardSet.assignmentCounts) {
      unique.set(assignment.assignee.id, assignment.assignee.displayName);
    }
    return [...unique.entries()].map(([id, displayName]) => ({ displayName, id }));
  }, [cardSet]);
  const availableCards = visibleCards.filter((card) => card.status === 'RELEASED');
  const selectedCards = currentCards.filter((card) => selectedCardIds.has(card.id));
  useFormDirtyState(selectedCardIds.size > 0 || Boolean(selectedAssigneeId), onFormDirtyChange);
  const assignmentPurpose: WorkCardPurpose =
    cardSet?.gateStatus === 'SERIAL_ALLOWED' ? 'SERIAL' : 'FIRST_ARTICLE';
  const assignmentGuard = commandGuardFor({
    command: 'AssignWorkCards',
    permissions,
    role,
    unavailableReason: assignmentUnavailableReason(cardSet),
  });
  const canAssign = assignmentGuard.state === 'enabled';
  const assignmentBlocked =
    assignmentState.phase === 'error' || assignmentState.phase === 'recovering';
  const assigning = assignmentState.phase === 'submitting';
  const requestedBulkCount = Number(bulkCount);
  const validBulkCount =
    Number.isInteger(requestedBulkCount) &&
    requestedBulkCount > 0 &&
    requestedBulkCount <= availableCards.length;
  const assignmentSubmitReason = assignmentBlocked
    ? 'Предыдущее назначение не подтверждено. Обновите комплект и выберите карточки заново.'
    : selectedCards.length === 0 && !selectedAssigneeId
      ? 'Выберите карточки и исполнителя.'
      : selectedCards.length === 0
        ? 'Выберите хотя бы одну доступную карточку.'
        : assignmentPurpose === 'FIRST_ARTICLE' && selectedCards.length !== 1
          ? 'Для первой детали выберите ровно одну доступную карточку.'
          : !selectedAssigneeId
            ? 'Выберите подготовленного исполнителя.'
            : null;
  const assignedTotal =
    cardSet?.assignmentCounts.reduce((total, assignment) => total + assignment.count, 0) ?? 0;
  const assignmentEquation = cardSet
    ? confirmedAssignmentEquation(cardSet.assignmentCounts)
    : '0 = 0';
  const filtersActive =
    statusFilter !== 'ALL' || purposeFilter !== 'ALL' || Boolean(assigneeFilter);
  const emptyCardsCopy = emptyWorkCardsCopy(role, filtersActive);
  const setTechnicalEntries: TechnicalEntry[] = cardSet
    ? [
        { label: 'WorkCardSet ID', value: cardSet.id },
        { label: 'ProductionBatch ID', value: cardSet.batchId },
        { label: 'Set version', value: cardSet.version },
        { label: 'Gate status', value: cardSet.gateStatus },
        { label: 'First article WorkCard ID', value: cardSet.firstArticleWorkCardId },
        { label: 'Available actions', value: cardSet.availableActions.join(', ') },
      ]
    : [];
  const cardTechnicalEntries: TechnicalEntry[] = currentCards.flatMap((card) => [
    { label: 'WorkCard ID', value: card.id },
    { label: 'Card version', value: card.version },
    { label: 'Card status', value: card.status },
    { label: 'Card purpose', value: card.purpose },
  ]);

  useEffect(
    () => () => {
      assignmentControllerRef.current?.abort();
    },
    [],
  );

  function clearSelection() {
    setSelectedCardIds(new Set());
    setAssignmentConfirmationOpen(false);
  }

  async function recoverAssignment(
    error: unknown,
    affectedCardIds: readonly string[],
    controller: AbortController,
  ) {
    setAssignmentState({ affectedCardIds, error, phase: 'recovering' });
    try {
      const recovered = await recoverAssignmentCommand(
        readModel,
        setId,
        affectedCardIds,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setConfirmedSet(recovered.set);
      setConfirmedCards((current) => {
        const next = new Map(current);
        for (const currentCard of recovered.cards) next.set(currentCard.id, currentCard);
        return next;
      });
      setAssignmentState({ affectedCardIds, error, phase: 'recovered' });
      onAnnounce(
        'Назначение не подтверждено. Комплект и все выбранные карточки перечитаны; выбор очищен, автоматического повтора нет.',
      );
    } catch (recoveryError: unknown) {
      if (controller.signal.aborted || isAbort(recoveryError)) return;
      setAssignmentState({ affectedCardIds, error, phase: 'error', recoveryError });
      onAnnounce(
        'Назначение не подтверждено, а полное перечитывание не завершилось. Действия заблокированы.',
      );
    }
  }

  function retryAssignmentRecovery() {
    if (assignmentState.phase !== 'error' || assignmentControllerRef.current) return;
    const controller = new AbortController();
    assignmentControllerRef.current = controller;
    clearSelection();
    setSelectedAssigneeId('');
    void recoverAssignment(
      assignmentState.error,
      assignmentState.affectedCardIds,
      controller,
    ).finally(() => {
      if (assignmentControllerRef.current === controller) {
        assignmentControllerRef.current = null;
      }
    });
  }

  function toggleCard(card: WorkCard) {
    if (!canAssign || assigning || assignmentBlocked || card.status !== 'RELEASED') return;
    if (assignmentPurpose === 'FIRST_ARTICLE') {
      setSelectedCardIds(new Set([card.id]));
      return;
    }
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  }

  function selectBulkCards() {
    if (!canAssign || assigning || assignmentBlocked || !validBulkCount) return;
    setSelectedCardIds(selectAvailableWorkCards(visibleCards, requestedBulkCount));
  }

  function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assignmentSubmitReason || !canAssign || assigning || assignmentControllerRef.current)
      return;
    setAssignmentConfirmationOpen(true);
  }

  function confirmAssignment() {
    if (
      !assignmentConfirmationOpen ||
      assignmentControllerRef.current ||
      !cardSet ||
      !canAssign ||
      assigning ||
      assignmentBlocked ||
      !selectedAssigneeId ||
      selectedCards.length === 0 ||
      (assignmentPurpose === 'FIRST_ARTICLE' && selectedCards.length !== 1)
    ) {
      return;
    }

    const controller = new AbortController();
    assignmentControllerRef.current = controller;
    setAssignmentState({ phase: 'submitting' });

    void masterCommands
      .assignWorkCards({
        assigneeId: selectedAssigneeId,
        cards: selectedCards,
        purpose: assignmentPurpose,
        set: cardSet,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setConfirmedSet(result.set);
        setConfirmedCards((current) => {
          const next = new Map(current);
          for (const card of result.cards) next.set(card.id, card);
          return next;
        });
        clearSelection();
        setAssignmentState({ phase: 'success', result });
        onAnnounce(
          assignmentPurpose === 'FIRST_ARTICLE'
            ? 'Карточка назначена для первой детали и подтверждена контрольным чтением.'
            : `Все ${result.assignment.assignedCount} карточек назначены и подтверждены контрольным чтением.`,
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        const affectedCardIds = selectedCards.map((card) => card.id);
        clearSelection();
        setSelectedAssigneeId('');
        await recoverAssignment(error, affectedCardIds, controller);
      })
      .finally(() => {
        if (assignmentControllerRef.current === controller) {
          assignmentControllerRef.current = null;
        }
      });
  }

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            <BackToBatches navigate={navigate} />
          </>
        }
        description="Группа операций, её собственная норма, допуск первой детали, распределение и серверные страницы рабочих карточек."
        eyebrow="Производственный контекст"
        title={cardSet?.scopeName ?? 'Комплект рабочих карточек'}
      />

      {setState.phase === 'loading' ? (
        <ContentCard status="Загрузка данных" title="Сведения о комплекте">
          <ReadLoadingPanel description="Получаем группу операций, норму и распределение карточек." />
        </ContentCard>
      ) : setState.phase === 'error' ? (
        <ContentCard status="Ошибка чтения" title="Сведения о комплекте">
          <ReadErrorPanel error={setState.error} navigate={navigate} onRetry={onRefresh} />
        </ContentCard>
      ) : cardSet ? (
        <div className="screen-stack">
          {cardSet.actualCardCount !== cardSet.plannedCardCount ? (
            <div className="notice notice--error command-notice" role="alert">
              <Icon name="shield" />
              <div>
                <p>
                  Количество выпущенных карточек не совпадает с паспортным планом. Продолжение
                  процесса должно оставаться заблокированным до повторной проверки данных.
                </p>
                <button className="button button--secondary" onClick={onRefresh} type="button">
                  <Icon className="button__icon" name="refresh" />
                  Перечитать комплект и карточки
                </button>
              </div>
            </div>
          ) : null}

          {assignmentState.phase === 'success' ? (
            <div className="notice notice--success command-notice" role="status">
              <Icon name="shield" />
              <div>
                <strong>
                  {assignmentState.result.assignment.purpose === 'FIRST_ARTICLE'
                    ? 'Карточка первой детали назначена'
                    : 'Массовое назначение подтверждено'}
                </strong>
                <p>
                  Серверный ответ, сводка комплекта и перечитанные карточки подтверждают весь набор
                  из {formatCardCount(assignmentState.result.assignment.assignedCount)}.
                </p>
              </div>
            </div>
          ) : null}

          {assignmentState.phase === 'error' ? (
            <div className="notice notice--error command-notice" role="alert">
              <Icon name="shield" />
              <div>
                <strong>Назначение не подтверждено</strong>
                <p>
                  {assignmentCommandMessage(assignmentState.error)} Полное перечитывание не
                  завершилось; действия остаются заблокированными.
                </p>
                <button
                  className="button button--secondary"
                  onClick={retryAssignmentRecovery}
                  type="button"
                >
                  <Icon className="button__icon" name="refresh" />
                  Перечитать комплект и карточки
                </button>
              </div>
            </div>
          ) : null}

          {assignmentState.phase === 'recovering' ? (
            <div className="notice notice--warning command-notice" role="status">
              <Icon name="refresh" />
              <div>
                <strong>Перечитываем весь набор назначения</strong>
                <p>
                  Выбор и исполнитель очищены. Проверяем комплект и каждую выбранную карточку без
                  повтора команды.
                </p>
              </div>
            </div>
          ) : null}

          {assignmentState.phase === 'recovered' ? (
            <div className="notice notice--warning command-notice" role="alert">
              <Icon name="shield" />
              <div>
                <strong>Данные перечитаны, выбор очищен</strong>
                <p>
                  {commandRecoveryDescription(assignmentState.error)} Доступность назначения
                  пересчитана по свежему комплекту и карточкам. Для новой команды заново выберите
                  карточки и исполнителя.
                </p>
              </div>
            </div>
          ) : null}

          <section className="summary-panel" aria-label="Сведения о комплекте">
            <div className="summary-panel__heading">
              <div>
                <p>{cardSet.scopeCode}</p>
                <h2>{cardSet.scopeName}</h2>
                <span>Норма относится только к этой группе операций</span>
              </div>
              <StatusBadge tone={statusTone(cardSet.gateStatus)}>
                {gateStatusLabels[cardSet.gateStatus]}
              </StatusBadge>
            </div>
            <FactGrid>
              <Fact label="Норма группы операций" value={formatHours(cardSet.normHours)} />
              <Fact label="Карточек по плану" value={formatCount(cardSet.plannedCardCount)} />
              <Fact label="Карточек выпущено" value={formatCount(cardSet.actualCardCount)} />
              {workCardStatusOptions.map((status) => (
                <Fact
                  key={status}
                  label={workCardStatusLabels[status]}
                  value={formatCount(cardSet.statusCounts[status])}
                />
              ))}
            </FactGrid>
          </section>

          <ContentCard status="Подтверждённое распределение" title="Назначения исполнителям">
            {cardSet.assignmentCounts.length === 0 ? (
              <StatePanel
                description="Назначенные карточки появятся здесь после подтверждённого сервером распределения."
                icon="user"
                title="Назначений пока нет"
              />
            ) : (
              <div className="assignment-list">
                {cardSet.assignmentCounts.map((assignment) => (
                  <div
                    className="assignment-row"
                    key={`${assignment.assignee.id}-${assignment.purpose}`}
                  >
                    <span className="assignment-row__avatar" aria-hidden="true">
                      <Icon name="user" />
                    </span>
                    <div>
                      <strong>{assignment.assignee.displayName}</strong>
                      <span>{workCardPurposeLabels[assignment.purpose]}</span>
                    </div>
                    <b>{formatCardCount(assignment.count)}</b>
                  </div>
                ))}
                <div className="assignment-equation" role="status">
                  <span>Итого по подтверждённой сводке</span>
                  <strong>{assignmentEquation} карточек</strong>
                  {cardSet.plannedCardCount === 112 && assignedTotal < 112 ? (
                    <small>Целевой демонстрационный итог: 1 + 59 + 52 = 112 карточек.</small>
                  ) : cardSet.plannedCardCount === 112 &&
                    assignmentEquation === '1 + 59 + 52 = 112' ? (
                    <small>Распределение 1 + 59 + 52 подтверждено сервером.</small>
                  ) : null}
                </div>
              </div>
            )}
          </ContentCard>

          {assignmentGuard.state !== 'hidden' ? (
            <ContentCard
              status={
                cardSet.gateStatus === 'FIRST_ARTICLE_PENDING'
                  ? 'Первая деталь'
                  : 'Обработка партии'
              }
              title="Назначить карточки"
            >
              {assignmentGuard.state === 'disabled' ? (
                <div className="assignment-command assignment-command--restricted">
                  <p>{assignmentGuard.reason}</p>
                </div>
              ) : (
                <form className="assignment-command" onSubmit={submitAssignment}>
                  <div className="assignment-command__intro">
                    <div>
                      <span>Группа операций</span>
                      <strong>{cardSet.scopeName}</strong>
                    </div>
                    <div>
                      <span>Назначение</span>
                      <strong>{workCardPurposeLabels[assignmentPurpose]}</strong>
                    </div>
                    <div>
                      <span>Выбрано</span>
                      <strong>{formatCardCount(selectedCards.length)}</strong>
                    </div>
                  </div>

                  {assignmentPurpose === 'SERIAL' ? (
                    <div className="bulk-selection">
                      <label className="command-field" htmlFor="bulk-card-count">
                        <span>Количество из загруженных свободных карточек</span>
                        <input
                          aria-describedby="bulk-card-count-help"
                          disabled={assigning || assignmentBlocked}
                          id="bulk-card-count"
                          inputMode="numeric"
                          max={availableCards.length}
                          min="1"
                          onChange={(event) => setBulkCount(event.target.value)}
                          type="number"
                          value={bulkCount}
                        />
                        <small id="bulk-card-count-help">
                          Загружено доступных для выбора: {formatCardCount(availableCards.length)}.
                          Диапазоны номеров деталей не создаются.
                        </small>
                      </label>
                      <button
                        className="button button--secondary"
                        disabled={!validBulkCount || assigning || assignmentBlocked}
                        onClick={selectBulkCards}
                        type="button"
                      >
                        Выбрать указанное количество
                      </button>
                    </div>
                  ) : (
                    <p className="assignment-command__help">
                      Выберите ровно одну свободную строку ниже. Карточка является внутренней
                      записью и не получает номер физической детали.
                    </p>
                  )}

                  <div className="assignment-command__footer">
                    <label className="filter-field filter-field--wide">
                      <span>Исполнитель</span>
                      <select
                        disabled={assigning || assignmentBlocked}
                        onChange={(event) => setSelectedAssigneeId(event.target.value)}
                        required
                        value={selectedAssigneeId}
                      >
                        <option value="">Выберите подготовленного исполнителя</option>
                        {workers.map((worker) => (
                          <option key={worker.id} value={worker.id}>
                            {worker.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      aria-describedby={
                        assignmentSubmitReason ? assignmentSubmitReasonId : undefined
                      }
                      className="button button--primary"
                      disabled={
                        assigning ||
                        assignmentBlocked ||
                        !selectedAssigneeId ||
                        selectedCards.length === 0 ||
                        (assignmentPurpose === 'FIRST_ARTICLE' && selectedCards.length !== 1)
                      }
                      type="submit"
                    >
                      <Icon className="button__icon" name="user" />
                      {assigning
                        ? 'Назначаем и перечитываем…'
                        : assignmentPurpose === 'FIRST_ARTICLE'
                          ? 'Назначить для первой детали'
                          : `Назначить ${formatCardCount(selectedCards.length)}`}
                    </button>
                  </div>
                  {assignmentSubmitReason ? (
                    <p
                      className="assignment-command__blocked"
                      id={assignmentSubmitReasonId}
                      role={assignmentBlocked ? 'alert' : 'status'}
                    >
                      {assignmentSubmitReason}
                    </p>
                  ) : null}
                </form>
              )}
            </ContentCard>
          ) : null}

          <ContentCard status="Серверная выборка" title="Рабочие карточки">
            <div className="filter-bar" aria-label="Фильтры рабочих карточек">
              <label className="filter-field">
                <span>Состояние карточки</span>
                <select
                  onChange={(event) => {
                    clearSelection();
                    setStatusFilter(event.target.value as 'ALL' | WorkCardStatus);
                  }}
                  value={statusFilter}
                >
                  <option value="ALL">Все состояния</option>
                  {workCardStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {workCardStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Назначение</span>
                <select
                  onChange={(event) => {
                    clearSelection();
                    setPurposeFilter(event.target.value as 'ALL' | WorkCardPurpose);
                  }}
                  value={purposeFilter}
                >
                  <option value="ALL">Все назначения</option>
                  <option value="FIRST_ARTICLE">Первая деталь</option>
                  <option value="SERIAL">Обработка партии</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Исполнитель</span>
                <select
                  onChange={(event) => {
                    clearSelection();
                    setAssigneeFilter(event.target.value);
                  }}
                  value={assigneeFilter}
                >
                  <option value="">Все доступные исполнители</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {filtersActive ? (
                <button
                  className="button button--quiet"
                  onClick={() => {
                    setStatusFilter('ALL');
                    setPurposeFilter('ALL');
                    setAssigneeFilter('');
                    clearSelection();
                  }}
                  type="button"
                >
                  Сбросить фильтры
                </button>
              ) : null}
            </div>

            {cards.loadingInitial ? (
              <ReadLoadingPanel description="Получаем первую страницу рабочих карточек с учётом выбранных фильтров." />
            ) : cards.error && cards.items.length === 0 ? (
              <ReadErrorPanel error={cards.error} navigate={navigate} onRetry={onRefresh} />
            ) : cards.items.length === 0 ? (
              <StatePanel
                action={
                  filtersActive ? (
                    <button
                      className="button button--secondary"
                      onClick={() => {
                        setStatusFilter('ALL');
                        setPurposeFilter('ALL');
                        setAssigneeFilter('');
                        clearSelection();
                      }}
                      type="button"
                    >
                      Сбросить фильтры
                    </button>
                  ) : undefined
                }
                description={emptyCardsCopy.description}
                icon="card"
                title={emptyCardsCopy.title}
              />
            ) : visibleCards.length === 0 ? (
              <StatePanel
                description="Среди загруженных карточек нет выбранного назначения. Загрузите следующую страницу или сбросьте фильтр."
                icon="search"
                title="На текущих страницах совпадений нет"
              />
            ) : (
              <div className="entity-list entity-list--cards">
                {visibleCards.map((card) => (
                  <article
                    className={`entity-row entity-row--card${selectedCardIds.has(card.id) ? ' entity-row--selected' : ''}`}
                    key={card.id}
                  >
                    <div className="entity-row__heading">
                      <div>
                        <p className="entity-row__eyebrow">{card.operation.scopeCode}</p>
                        <h3>{card.operation.scopeName}</h3>
                      </div>
                      <div className="entity-row__controls">
                        {canAssign && card.status === 'RELEASED' ? (
                          <label className="card-selection">
                            <input
                              checked={selectedCardIds.has(card.id)}
                              disabled={assigning || assignmentBlocked}
                              name={
                                assignmentPurpose === 'FIRST_ARTICLE'
                                  ? 'first-article-card'
                                  : undefined
                              }
                              onChange={() => toggleCard(card)}
                              type={assignmentPurpose === 'FIRST_ARTICLE' ? 'radio' : 'checkbox'}
                            />
                            <span>
                              {selectedCardIds.has(card.id)
                                ? 'Выбрана для назначения'
                                : assignmentPurpose === 'FIRST_ARTICLE'
                                  ? 'Выбрать для первой детали'
                                  : 'Выбрать для обработки партии'}
                            </span>
                          </label>
                        ) : null}
                        <StatusBadge tone={statusTone(card.status)}>
                          {workCardStatusLabels[card.status]}
                        </StatusBadge>
                      </div>
                    </div>
                    <FactGrid>
                      <Fact
                        label="Назначение"
                        value={card.purpose ? workCardPurposeLabels[card.purpose] : 'Не назначено'}
                      />
                      <Fact
                        label="Исполнитель"
                        value={card.assignee?.displayName ?? 'Не назначен'}
                      />
                      <Fact
                        label="Норма группы операций"
                        value={formatHours(card.operation.normHours)}
                      />
                      <Fact
                        label="Изделий в партии"
                        value={`${formatCount(card.batchQuantitySnapshot)} · не позиция карточки`}
                      />
                    </FactGrid>
                    <div className="entity-row__footer">
                      <AppLink
                        className="text-link"
                        navigate={navigate}
                        to={`/work-cards/${encodeURIComponent(card.id)}`}
                      >
                        Открыть рабочую карточку
                        <Icon name="arrow-right" />
                      </AppLink>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {!cards.loadingInitial && cards.items.length > 0 ? (
              <PaginationFooter
                count={cards.items.length}
                hasMore={Boolean(cards.nextCursor)}
                loading={cards.loadingMore}
                noun="карточек"
                onLoadMore={cards.loadMore}
              />
            ) : null}
            {cards.error && cards.items.length > 0 ? (
              <div className="inline-error" role="alert">
                Следующую страницу загрузить не удалось. Уже загруженные карточки сохранены.
              </div>
            ) : null}
          </ContentCard>
        </div>
      ) : null}

      <TechnicalDetails
        entries={[
          ...setTechnicalEntries,
          ...cardTechnicalEntries,
          ...(setState.phase === 'error' ? technicalErrorEntries(setState.error) : []),
          ...technicalErrorEntries(cards.error),
          ...assignmentTechnicalEntries(assignmentState),
        ]}
        route={route}
      />
      <ConfirmationDialog
        boundaryText="Назначение всего выбранного набора выполняется одной командой. Успех появится только после контрольного чтения комплекта и каждой карточки."
        busy={assigning}
        busyLabel="Назначаем и проверяем…"
        confirmLabel="Подтвердить назначение карточек"
        description="Проверьте группу операций, назначение и исполнителя. Переназначение карточек в текущем процессе недоступно."
        onCancel={() => {
          if (!assignmentControllerRef.current) setAssignmentConfirmationOpen(false);
        }}
        onConfirm={confirmAssignment}
        open={assignmentConfirmationOpen && canAssign}
        preview={
          <div className="quality-dialog-summary">
            <strong>{cardSet?.scopeName}</strong>
            <span>{workCardPurposeLabels[assignmentPurpose]}</span>
            <span>{workers.find((worker) => worker.id === selectedAssigneeId)?.displayName}</span>
            <span>{formatCardCount(selectedCards.length)}</span>
          </div>
        }
        title="Назначить выбранные карточки?"
      />
    </>
  );
}

function workCardTechnicalEntries(card: WorkCard): TechnicalEntry[] {
  return [
    { label: 'WorkCard ID', value: card.id },
    { label: 'WorkCardSet ID', value: card.workCardSetId },
    { label: 'ProductionBatch ID', value: card.batchId },
    { label: 'Assignee ID', value: card.assignee?.id ?? null },
    { label: 'Card version', value: card.version },
    { label: 'Card status', value: card.status },
    { label: 'Card purpose', value: card.purpose },
    { label: 'Closure type', value: card.closureType },
    { label: 'Available actions', value: card.availableActions.join(', ') },
    { label: 'Released UTC', value: card.timestamps.releasedAt },
    { label: 'Assigned UTC', value: card.timestamps.assignedAt },
    { label: 'Started UTC', value: card.timestamps.startedAt },
    { label: 'Completed UTC', value: card.timestamps.completedAt },
    { label: 'Closed UTC', value: card.timestamps.closedAt },
  ];
}

type LifecycleCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting'; action: 'complete' | 'start' }>
  | Readonly<{
      phase: 'success';
      action: 'complete' | 'start';
      result: ConfirmedWorkCardCommand;
    }>
  | Readonly<{ error: unknown; phase: 'recovering' }>
  | Readonly<{ error: unknown; phase: 'recovered' }>
  | Readonly<{ error: unknown; phase: 'error'; recoveryError: unknown }>;

type QualityCardCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting'; action: 'first-article' | 'serial' }>
  | Readonly<{
      phase: 'success';
      action: 'first-article';
      result: ConfirmedFirstArticleAcceptance;
    }>
  | Readonly<{ phase: 'success'; action: 'serial'; result: ConfirmedQualityCard }>
  | Readonly<{ error: unknown; phase: 'recovering' }>
  | Readonly<{ error: unknown; phase: 'recovered' }>
  | Readonly<{ error: unknown; phase: 'error'; recoveryError: unknown }>;

function lifecycleCommandMessage(error: unknown): string {
  if (error instanceof MasterCommandIntegrityError) {
    return 'Ответ команды не совпал с контрольным чтением карточки. Успех не подтверждён.';
  }
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return 'Версия карточки изменилась. Команда не повторится автоматически; перечитайте данные.';
    }
    if (error.kind === 'transport') {
      return 'Исход команды неизвестен. Автоматического повтора нет; сначала перечитайте карточку.';
    }
    return error.message;
  }
  return 'Команда не подтверждена. Перечитайте карточку перед новым решением.';
}

function lifecycleTechnicalEntries(state: LifecycleCommandState): TechnicalEntry[] {
  if (state.phase === 'success') {
    return [
      { label: 'Correlation ID', value: state.result.correlationId },
      { label: 'Command request ID', value: state.result.commandContext.requestId ?? null },
      { label: 'Read-back request ID', value: state.result.readBackContext.requestId ?? null },
    ];
  }
  if (state.phase === 'error') {
    return [...technicalErrorEntries(state.error), ...technicalErrorEntries(state.recoveryError)];
  }
  return state.phase === 'recovering' || state.phase === 'recovered'
    ? technicalErrorEntries(state.error)
    : [];
}

function lifecycleCommandFor(card: WorkCard): 'CompleteWorkCard' | 'StartWorkCard' | null {
  if (card.status === 'ASSIGNED') return 'StartWorkCard';
  if (card.status === 'IN_PROGRESS') return 'CompleteWorkCard';
  return null;
}

function lifecycleUnavailableReason(card: WorkCard, commandBlocked: boolean): string {
  if (commandBlocked) {
    return 'Предыдущее изменение не подтверждено. Перечитайте карточку перед новым явным решением.';
  }
  if (card.status === 'RELEASED') {
    return 'Карточка должна быть назначена мастером на экране комплекта.';
  }
  if (card.status === 'ASSIGNED') {
    return 'Сервер не разрешил начало работы: назначение или допуск обработки партии не подтверждены. Обновите карточку.';
  }
  if (card.status === 'IN_PROGRESS') {
    return 'Сервер не разрешил завершение для текущего состояния или версии карточки. Обновите данные.';
  }
  if (card.status === 'COMPLETED') {
    return 'Мастер уже зафиксировал завершение. Следующее положительное решение выполняет БТК.';
  }
  return 'Карточка уже закрыта; действия мастера завершены.';
}

function qualityCommandFor(card: WorkCard): 'AcceptFirstArticle' | 'ConfirmWorkCardQuality' | null {
  if (card.purpose === 'FIRST_ARTICLE') return 'AcceptFirstArticle';
  if (card.purpose === 'SERIAL') return 'ConfirmWorkCardQuality';
  return null;
}

function qualityUnavailableReason(card: WorkCard, qualityBlocked: boolean): string {
  if (qualityBlocked) {
    return 'Предыдущее решение БТК не подтверждено. Перечитайте карточку перед новым решением.';
  }
  if (!card.purpose) return 'Сначала мастер должен назначить карточку.';
  if (card.status === 'CLOSED') return 'Карточка уже закрыта и доступна только для просмотра.';
  if (card.status !== 'COMPLETED') {
    return 'Сначала мастер должен зафиксировать завершение карточки.';
  }
  return card.purpose === 'FIRST_ARTICLE'
    ? 'Для приёмки требуется зарегистрированная первая деталь и ожидающий допуск комплекта.'
    : 'Для подтверждения требуется карточка обработки партии и открытый допуск комплекта.';
}

export function WorkCardReadyContent({
  initialCard,
  masterCommands,
  navigate,
  onAnnounce,
  permissions,
  qualityCommands,
  readModel,
  role,
  route,
}: {
  initialCard: WorkCard;
  masterCommands: MasterCommandClient;
  navigate: Navigate;
  onAnnounce: (message: string) => void;
  permissions: readonly CommandName[];
  qualityCommands: QualityCommandClient;
  readModel: ReadModelClient;
  role: Role;
  route: ScreenRoute;
}) {
  const lifecycleControllerRef = useRef<AbortController | null>(null);
  const qualityControllerRef = useRef<AbortController | null>(null);
  const lifecycleReasonId = useId();
  const qualityReasonId = useId();
  const [card, setCard] = useState(initialCard);
  const [commandState, setCommandState] = useState<LifecycleCommandState>({ phase: 'idle' });
  const [qualityConfirmationOpen, setQualityConfirmationOpen] = useState(false);
  const [qualityState, setQualityState] = useState<QualityCardCommandState>({ phase: 'idle' });
  const statusIndex = workCardStatusOptions.indexOf(card.status);
  const submitting = commandState.phase === 'submitting';
  const commandBlocked = commandState.phase === 'error' || commandState.phase === 'recovering';
  const lifecycleCommand = lifecycleCommandFor(card);
  const lifecycleGuard: CommandGuard = lifecycleCommand
    ? commandGuardFor({
        command: lifecycleCommand,
        permissions,
        role,
        unavailableReason:
          commandBlocked || !card.availableActions.includes(lifecycleCommand)
            ? lifecycleUnavailableReason(card, commandBlocked)
            : null,
      })
    : { reason: lifecycleUnavailableReason(card, commandBlocked), state: 'disabled' };
  const qualityCommand = qualityCommandFor(card);
  const qualitySubmitting = qualityState.phase === 'submitting';
  const qualityBlocked = qualityState.phase === 'error' || qualityState.phase === 'recovering';
  const qualityGuard: CommandGuard = qualityCommand
    ? commandGuardFor({
        command: qualityCommand,
        permissions,
        role,
        unavailableReason:
          qualityBlocked || !card.availableActions.includes(qualityCommand)
            ? qualityUnavailableReason(card, qualityBlocked)
            : null,
      })
    : { reason: qualityUnavailableReason(card, qualityBlocked), state: 'disabled' };
  const canConfirmQuality = qualityGuard.state === 'enabled';

  useEffect(
    () => () => {
      lifecycleControllerRef.current?.abort();
      qualityControllerRef.current?.abort();
    },
    [],
  );

  async function recoverLifecycleState(error: unknown, controller: AbortController) {
    setCommandState({ error, phase: 'recovering' });
    try {
      const recovered = await recoverWorkCardCommand(
        readModel,
        card.id,
        card.workCardSetId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCard(recovered.card);
      setCommandState({ error, phase: 'recovered' });
      onAnnounce(
        'Изменение карточки не подтверждено. Карточка и связанный комплект перечитаны; доступность действия пересчитана.',
      );
    } catch (recoveryError: unknown) {
      if (controller.signal.aborted || isAbort(recoveryError)) return;
      setCommandState({ error, phase: 'error', recoveryError });
      onAnnounce(
        'Изменение карточки не подтверждено, а полное перечитывание не завершилось. Автоматического повтора нет.',
      );
    }
  }

  async function recoverQualityState(error: unknown, controller: AbortController) {
    setQualityConfirmationOpen(false);
    setQualityState({ error, phase: 'recovering' });
    try {
      const recovered = await recoverWorkCardCommand(
        readModel,
        card.id,
        card.workCardSetId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCard(recovered.card);
      setQualityState({ error, phase: 'recovered' });
      onAnnounce(
        'Действие БТК не подтверждено. Карточка и связанный комплект перечитаны; новое решение требует нового подтверждения.',
      );
    } catch (recoveryError: unknown) {
      if (controller.signal.aborted || isAbort(recoveryError)) return;
      setQualityState({ error, phase: 'error', recoveryError });
      onAnnounce(
        'Действие БТК не подтверждено, а полное перечитывание не завершилось. Автоматического повтора нет.',
      );
    }
  }

  function retryLifecycleRecovery() {
    if (commandState.phase !== 'error' || lifecycleControllerRef.current) return;
    const controller = new AbortController();
    lifecycleControllerRef.current = controller;
    void recoverLifecycleState(commandState.error, controller).finally(() => {
      if (lifecycleControllerRef.current === controller) {
        lifecycleControllerRef.current = null;
      }
    });
  }

  function retryQualityRecovery() {
    if (qualityState.phase !== 'error' || qualityControllerRef.current) return;
    const controller = new AbortController();
    qualityControllerRef.current = controller;
    void recoverQualityState(qualityState.error, controller).finally(() => {
      if (qualityControllerRef.current === controller) {
        qualityControllerRef.current = null;
      }
    });
  }

  function runQualityCommand() {
    if (!qualityCommand || !canConfirmQuality || qualityControllerRef.current) return;

    const controller = new AbortController();
    qualityControllerRef.current = controller;
    const qualityAction = qualityCommand === 'AcceptFirstArticle' ? 'first-article' : 'serial';
    setQualityState({ action: qualityAction, phase: 'submitting' });
    const command =
      qualityAction === 'first-article'
        ? qualityCommands.acceptFirstArticle({ card, signal: controller.signal })
        : qualityCommands.confirmWorkCardQuality({ card, signal: controller.signal });

    void command
      .then((result) => {
        if (controller.signal.aborted) return;
        setCard(result.card);
        setQualityState(
          qualityCommand === 'AcceptFirstArticle'
            ? {
                action: 'first-article',
                phase: 'success',
                result: result as ConfirmedFirstArticleAcceptance,
              }
            : {
                action: 'serial',
                phase: 'success',
                result: result as ConfirmedQualityCard,
              },
        );
        setQualityConfirmationOpen(false);
        onAnnounce(
          qualityCommand === 'AcceptFirstArticle'
            ? 'Первая деталь положительно принята; карточка и открытый допуск подтверждены контрольными чтениями.'
            : 'Качество карточки подтверждено; закрытие подтверждено контрольным чтением.',
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        await recoverQualityState(error, controller);
      })
      .finally(() => {
        if (qualityControllerRef.current === controller) {
          qualityControllerRef.current = null;
        }
      });
  }

  function runLifecycle(action: 'complete' | 'start') {
    if (
      submitting ||
      lifecycleGuard.state !== 'enabled' ||
      (action === 'start'
        ? lifecycleCommand !== 'StartWorkCard'
        : lifecycleCommand !== 'CompleteWorkCard') ||
      lifecycleControllerRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    lifecycleControllerRef.current = controller;
    setCommandState({ action, phase: 'submitting' });
    const command =
      action === 'start'
        ? masterCommands.startWorkCard({ card, signal: controller.signal })
        : masterCommands.completeWorkCard({ card, signal: controller.signal });

    void command
      .then((result) => {
        if (controller.signal.aborted) return;
        setCard(result.card);
        setCommandState({ action, phase: 'success', result });
        onAnnounce(
          action === 'start'
            ? 'Мастер зафиксировал начало; состояние подтверждено контрольным чтением.'
            : 'Мастер зафиксировал завершение; состояние подтверждено контрольным чтением.',
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        await recoverLifecycleState(error, controller);
      })
      .finally(() => {
        if (lifecycleControllerRef.current === controller) {
          lifecycleControllerRef.current = null;
        }
      });
  }

  return (
    <>
      <div className="screen-stack">
        {commandState.phase === 'success' ? (
          <div className="notice notice--success command-notice" role="status">
            <Icon name="shield" />
            <div>
              <strong>
                {commandState.action === 'start'
                  ? 'Начало работы зафиксировано мастером'
                  : 'Завершение работы зафиксировано мастером'}
              </strong>
              <p>
                Новое состояние и время получены обязательным контрольным чтением. Исполнитель
                карточки не изменён.
              </p>
            </div>
          </div>
        ) : null}

        {commandState.phase === 'error' ? (
          <div className="notice notice--error command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Изменение карточки не подтверждено</strong>
              <p>
                {lifecycleCommandMessage(commandState.error)} Карточку и связанный комплект
                перечитать полностью не удалось; действие заблокировано.
              </p>
            </div>
          </div>
        ) : null}

        {commandState.phase === 'recovering' ? (
          <div className="notice notice--warning command-notice" role="status">
            <Icon name="refresh" />
            <div>
              <strong>Перечитываем карточку и комплект</strong>
              <p>
                Команда не повторяется; до полного чтения производственные действия заблокированы.
              </p>
            </div>
          </div>
        ) : null}

        {commandState.phase === 'recovered' ? (
          <div className="notice notice--warning command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Данные перечитаны после неподтверждённого действия</strong>
              <p>
                {commandRecoveryDescription(commandState.error)} Доступность действия пересчитана по
                свежей карточке и комплекту; повтор возможен только как новое явное решение.
              </p>
            </div>
          </div>
        ) : null}

        {qualityState.phase === 'success' ? (
          <div className="notice notice--success command-notice" role="status">
            <Icon name="shield" />
            <div>
              <strong>
                {qualityState.action === 'first-article'
                  ? 'Первая деталь положительно принята'
                  : 'Качество карточки подтверждено'}
              </strong>
              <p>
                {qualityState.action === 'first-article'
                  ? 'Карточка закрыта, а обработка партии открыта одной атомарной командой. Оба результата подтверждены контрольными чтениями.'
                  : 'Только эта карточка закрыта после отдельного положительного подтверждения и контрольного чтения.'}
              </p>
            </div>
          </div>
        ) : null}

        {qualityState.phase === 'error' ? (
          <div className="notice notice--error command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Действие БТК не подтверждено</strong>
              <p>
                {qualityCommandMessage(qualityState.error, 'card')} Карточку и связанный комплект
                перечитать полностью не удалось; действие заблокировано.
              </p>
            </div>
          </div>
        ) : null}

        {qualityState.phase === 'recovering' ? (
          <div className="notice notice--warning command-notice" role="status">
            <Icon name="refresh" />
            <div>
              <strong>Перечитываем карточку и комплект</strong>
              <p>Диалог закрыт. Повторяются только безопасные чтения, а не решение БТК.</p>
            </div>
          </div>
        ) : null}

        {qualityState.phase === 'recovered' ? (
          <div className="notice notice--warning command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Свежие данные получены, прежний диалог сброшен</strong>
              <p>
                {commandRecoveryDescription(qualityState.error)} Доступность действия пересчитана.
                Новая команда потребует заново открыть диалог и подтвердить решение.
              </p>
            </div>
          </div>
        ) : null}

        <section className="summary-panel" aria-label="Состояние рабочей карточки">
          <div className="summary-panel__heading">
            <div>
              <p>{card.operation.scopeCode}</p>
              <h2>{card.operation.scopeName}</h2>
              <span>Рабочая карточка не является номером физической детали</span>
            </div>
            <StatusBadge tone={statusTone(card.status)}>
              {workCardStatusLabels[card.status]}
            </StatusBadge>
          </div>
          <FactGrid>
            <Fact label="Исполнитель" value={card.assignee?.displayName ?? 'Не назначен'} />
            <Fact
              label="Назначение"
              value={card.purpose ? workCardPurposeLabels[card.purpose] : 'Не назначено'}
            />
            <Fact
              label="Количество изделий в партии"
              value={`${formatCount(card.batchQuantitySnapshot)} · не позиция карточки`}
            />
            <Fact label="Норма группы операций" value={formatHours(card.operation.normHours)} />
            <Fact
              label="Основание закрытия"
              value={
                card.closureType ? closureTypeLabels[card.closureType] : 'Карточка ещё не закрыта'
              }
            />
          </FactGrid>
        </section>

        {role === 'MASTER' ? (
          <ContentCard status="Действие мастера" title="Ведение рабочей карточки">
            <div className="lifecycle-command">
              <div>
                <span>Исполнитель</span>
                <strong>{card.assignee?.displayName ?? 'Не назначен'}</strong>
                <p>
                  Мастер фиксирует состояние работы исполнителя. Переназначение карточки в прототип
                  не входит.
                </p>
              </div>
              {lifecycleCommand === 'StartWorkCard' ? (
                <button
                  aria-describedby={
                    lifecycleGuard.state === 'disabled' ? lifecycleReasonId : undefined
                  }
                  className="button button--primary"
                  disabled={submitting || lifecycleGuard.state !== 'enabled'}
                  onClick={() => runLifecycle('start')}
                  type="button"
                >
                  <Icon className="button__icon" name="clock" />
                  {submitting ? 'Фиксируем и перечитываем…' : 'Зафиксировать начало'}
                </button>
              ) : lifecycleCommand === 'CompleteWorkCard' ? (
                <button
                  aria-describedby={
                    lifecycleGuard.state === 'disabled' ? lifecycleReasonId : undefined
                  }
                  className="button button--primary"
                  disabled={submitting || lifecycleGuard.state !== 'enabled'}
                  onClick={() => runLifecycle('complete')}
                  type="button"
                >
                  <Icon className="button__icon" name="card" />
                  {submitting ? 'Фиксируем и перечитываем…' : 'Зафиксировать завершение'}
                </button>
              ) : null}
              {lifecycleGuard.state === 'disabled' ? (
                <p className="lifecycle-command__reason" id={lifecycleReasonId}>
                  {lifecycleGuard.reason}
                </p>
              ) : null}
              {commandState.phase === 'error' ? (
                <div className="lifecycle-command__recovery" role="alert">
                  <button
                    className="button button--secondary"
                    onClick={retryLifecycleRecovery}
                    type="button"
                  >
                    <Icon className="button__icon" name="refresh" />
                    Перечитать карточку и комплект
                  </button>
                </div>
              ) : null}
            </div>
          </ContentCard>
        ) : role === 'WORKER' ? (
          <ContentCard status="Только просмотр" title="Ведение рабочей карточки">
            <p className="lifecycle-command__reason">
              Исполнитель видит назначение только для просмотра. Изменение состояния фиксирует
              мастер.
            </p>
          </ContentCard>
        ) : null}

        {role === 'QUALITY_CONTROLLER' ? (
          <ContentCard status="Положительное решение" title="Контроль качества БТК">
            <div className="quality-command">
              <div>
                <span>Текущая карточка</span>
                <strong>
                  {card.purpose
                    ? `${workCardPurposeLabels[card.purpose]} · ${workCardStatusLabels[card.status]}`
                    : workCardStatusLabels[card.status]}
                </strong>
                <p>
                  Каждая завершённая карточка подтверждается отдельно. Отрицательная приёмка,
                  возврат и частичное закрытие в текущий процесс не входят.
                </p>
              </div>
              {qualityCommand ? (
                <button
                  aria-describedby={qualityGuard.state === 'disabled' ? qualityReasonId : undefined}
                  className="button button--primary"
                  disabled={qualitySubmitting || qualityGuard.state !== 'enabled'}
                  onClick={() => setQualityConfirmationOpen(true)}
                  type="button"
                >
                  <Icon className="button__icon" name="shield" />
                  {qualitySubmitting
                    ? 'Подтверждаем и перечитываем…'
                    : qualityCommand === 'AcceptFirstArticle'
                      ? 'Принять первую деталь и открыть обработку партии'
                      : 'Подтвердить качество и закрыть карточку'}
                </button>
              ) : null}
              {qualityGuard.state === 'disabled' ? (
                <p className="quality-command__reason" id={qualityReasonId}>
                  {qualityGuard.reason}
                </p>
              ) : null}
              {qualityState.phase === 'error' ? (
                <button
                  className="button button--secondary"
                  onClick={retryQualityRecovery}
                  type="button"
                >
                  <Icon className="button__icon" name="refresh" />
                  Перечитать карточку и комплект
                </button>
              ) : null}
            </div>
          </ContentCard>
        ) : null}

        <ContentCard status="Подтверждённое состояние" title="Ход выполнения">
          <ol className="card-timeline" aria-label="Последовательность состояний карточки">
            {workCardStatusOptions.map((status, index) => {
              const stateClass =
                index < statusIndex ? 'done' : index === statusIndex ? 'current' : 'upcoming';
              return (
                <li
                  className={`card-timeline__step card-timeline__step--${stateClass}`}
                  key={status}
                >
                  <span aria-hidden="true" />
                  <div>
                    <strong>{workCardStatusLabels[status]}</strong>
                    <small>
                      {stateClass === 'done'
                        ? 'Этап пройден'
                        : stateClass === 'current'
                          ? 'Текущее состояние'
                          : 'Следующий этап'}
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
        </ContentCard>

        <ContentCard status="Время сервера" title="Зафиксированные даты и время">
          <FactGrid>
            <Fact label="Выпуск" value={formatDateTime(card.timestamps.releasedAt)} />
            <Fact
              label="Назначение"
              value={
                card.timestamps.assignedAt
                  ? formatDateTime(card.timestamps.assignedAt)
                  : 'Ещё не зафиксировано'
              }
            />
            <Fact
              label="Начало, зафиксированное мастером"
              value={
                card.timestamps.startedAt
                  ? formatDateTime(card.timestamps.startedAt)
                  : 'Ещё не зафиксировано'
              }
            />
            <Fact
              label="Завершение, зафиксированное мастером"
              value={
                card.timestamps.completedAt
                  ? formatDateTime(card.timestamps.completedAt)
                  : 'Ещё не зафиксировано'
              }
            />
            <Fact
              label="Закрытие карточки"
              value={
                card.timestamps.closedAt
                  ? formatDateTime(card.timestamps.closedAt)
                  : 'Ещё не зафиксировано'
              }
            />
          </FactGrid>
        </ContentCard>

        <div className="context-links" aria-label="Связанный производственный контекст">
          <AppLink
            className="text-link"
            navigate={navigate}
            to={`/card-sets/${encodeURIComponent(card.workCardSetId)}`}
          >
            Открыть комплект
            <Icon name="arrow-right" />
          </AppLink>
          <AppLink
            className="text-link"
            navigate={navigate}
            to={`/batches/${encodeURIComponent(card.batchId)}`}
          >
            Открыть партию
            <Icon name="arrow-right" />
          </AppLink>
          {role === 'ADMIN_AUDITOR' ? (
            <>
              <AppLink
                className="text-link"
                navigate={navigate}
                to={`/work-cards/${encodeURIComponent(card.id)}/audit`}
              >
                Открыть журнал действий
                <Icon name="arrow-right" />
              </AppLink>
              <AppLink
                className="text-link"
                navigate={navigate}
                to={`/work-cards/${encodeURIComponent(card.id)}/payroll`}
              >
                Открыть тестовый учёт нормо-часов
                <Icon name="arrow-right" />
              </AppLink>
            </>
          ) : null}
        </div>

        <div className="notice notice--boundary">
          <Icon name="shield" />
          <p>
            Цифровое закрытие одной карточки не означает финальную приёмку всей партии и не заменяет
            физические подписи БТК.
          </p>
        </div>
      </div>

      <TechnicalDetails
        entries={[
          ...workCardTechnicalEntries(card),
          ...lifecycleTechnicalEntries(commandState),
          ...qualityTechnicalEntries(qualityState),
        ]}
        route={route}
      />

      <ConfirmationDialog
        boundaryText={
          qualityCommand === 'AcceptFirstArticle'
            ? 'Карточка и допуск комплекта изменятся одной командой. Успех появится только после контрольного чтения обоих результатов.'
            : 'Будет закрыта только эта карточка. Успех появится только после совпадающего контрольного чтения.'
        }
        busy={qualitySubmitting}
        busyLabel="Подтверждаем и проверяем…"
        confirmLabel={
          qualityCommand === 'AcceptFirstArticle'
            ? 'Положительно принять первую деталь'
            : 'Положительно подтвердить качество'
        }
        description={
          qualityCommand === 'AcceptFirstArticle'
            ? 'Первая деталь будет принята положительно, карточка закроется, а обработка партии станет доступна. Отрицательного исхода в текущем процессе нет.'
            : 'Качество этой завершённой карточки будет подтверждено отдельно, после чего только она перейдёт в закрытое состояние.'
        }
        onCancel={() => {
          if (!qualitySubmitting) setQualityConfirmationOpen(false);
        }}
        onConfirm={runQualityCommand}
        open={qualityConfirmationOpen}
        preview={
          <div className="quality-dialog-summary">
            <strong>{card.operation.scopeName}</strong>
            <span>{card.assignee?.displayName ?? 'Исполнитель не назначен'}</span>
          </div>
        }
        title={
          qualityCommand === 'AcceptFirstArticle'
            ? 'Принять первую деталь?'
            : 'Подтвердить качество карточки?'
        }
      />
    </>
  );
}

export function WorkCardScreen({
  masterCommands,
  navigate,
  onAnnounce,
  onRefresh,
  permissions,
  qualityCommands,
  readModel,
  role,
  route,
}: ReadOnlyScreenProps) {
  const workCardId = route.params.workCardId ?? '';
  const loader = useCallback(
    (signal: AbortSignal) => readModel.getWorkCard(workCardId, signal),
    [readModel, workCardId],
  );
  const state = useReadResource(loader);
  const card = state.phase === 'ready' ? state.data : null;

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            {card ? (
              <AppLink
                className="button button--secondary"
                navigate={navigate}
                to={`/card-sets/${encodeURIComponent(card.workCardSetId)}`}
              >
                <Icon className="button__icon" name="arrow-left" />К комплекту
              </AppLink>
            ) : (
              <BackToBatches navigate={navigate} />
            )}
          </>
        }
        description="Подтверждённое состояние выполнения, назначение и неизменяемые снимки производственного контекста."
        eyebrow="Производственный контекст"
        title="Рабочая карточка"
      />

      {state.phase === 'loading' ? (
        <>
          <ContentCard status="Загрузка данных" title="Состояние выполнения">
            <ReadLoadingPanel description="Получаем рабочую карточку и её производственные снимки." />
          </ContentCard>
          <TechnicalDetails route={route} />
        </>
      ) : state.phase === 'error' ? (
        <>
          <ContentCard status="Ошибка чтения" title="Состояние выполнения">
            <ReadErrorPanel error={state.error} navigate={navigate} onRetry={onRefresh} />
          </ContentCard>
          <TechnicalDetails entries={technicalErrorEntries(state.error)} route={route} />
        </>
      ) : (
        <WorkCardReadyContent
          initialCard={state.data}
          masterCommands={masterCommands}
          navigate={navigate}
          onAnnounce={onAnnounce}
          permissions={permissions}
          qualityCommands={qualityCommands}
          readModel={readModel}
          role={role}
          route={route}
        />
      )}
    </>
  );
}
