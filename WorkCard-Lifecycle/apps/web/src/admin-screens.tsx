import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AuditEvent, CommandName, PayrollRecord, Role, WorkCard } from '@work-card/contracts';

import {
  AuditIntegrityError,
  type AdminAuditClient,
  type CompleteAuditCorrelation,
  type WorkCardAuditHistory,
} from './admin-audit.js';
import { ApiClientError } from './api-client.js';
import { AppLink } from './AppLink.js';
import { commandRecoveryDescription } from './command-recovery.js';
import { Icon } from './Icon.js';
import { commandGuardFor } from './permission-guards.js';
import {
  PayrollCommandIntegrityError,
  payrollExportReadinessIssue,
  type ConfirmedPayrollExport,
  type PayrollCommandClient,
  type PayrollWorkspace,
} from './payroll-commands.js';
import {
  formatCount,
  formatDateTime,
  formatHours,
  workCardStatusLabels,
} from './read-presenters.js';
import { technicalErrorEntries, type TechnicalEntry } from './read-errors.js';
import type { ScreenRoute } from './app-routing.js';
import { ConfirmationDialog } from './read-only-screens.js';
import {
  ContentCard,
  PageHeading,
  ReadErrorPanel,
  RefreshButton,
  StatePanel,
  TechnicalDetails,
  type Navigate,
} from './screen-ui.js';

type ResourceState<T> =
  | Readonly<{ phase: 'error'; error: unknown }>
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ data: T; phase: 'ready' }>;

type CorrelationState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ correlationId: string; phase: 'loading' }>
  | Readonly<{ correlationId: string; error: unknown; phase: 'error' }>
  | Readonly<{ data: CompleteAuditCorrelation; phase: 'ready' }>;

type PayrollCommandState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'submitting' }>
  | Readonly<{ error: unknown; phase: 'recovering' }>
  | Readonly<{ error: unknown; phase: 'recovered' }>
  | Readonly<{ error: unknown; phase: 'error'; recoveryError: unknown }>
  | Readonly<{ phase: 'success'; result: ConfirmedPayrollExport }>;

const eventLabels: Readonly<Record<string, string>> = {
  FinalBatchAccepted: 'Финальная приёмка партии выполнена',
  FirstArticleAccepted: 'Первая деталь принята',
  FirstArticleWorkCardSelected: 'Карточка первой детали выбрана',
  ProductionBatchCreated: 'Производственная партия создана',
  ProductionBatchReleased: 'Производственная партия выпущена',
  WorkCardAssigned: 'Рабочая карточка назначена',
  WorkCardCompleted: 'Работа по карточке завершена',
  WorkCardExportedToPayroll: 'Создана тестовая запись нормо-часов',
  WorkCardQualityConfirmed: 'Качество рабочей карточки подтверждено',
  WorkCardReleased: 'Рабочая карточка выпущена',
  WorkCardSetCreated: 'Комплект рабочих карточек создан',
  WorkCardStarted: 'Работа по карточке начата',
};

const aggregateLabels: Readonly<Record<string, string>> = {
  PayrollRecord: 'Тестовая запись нормо-часов',
  ProductionBatch: 'Производственная партия',
  WorkCard: 'Рабочая карточка',
  WorkCardSet: 'Комплект рабочих карточек',
};

const roleLabels: Record<Role, string> = {
  ADMIN_AUDITOR: 'Администратор демонстрации',
  MASTER: 'Мастер',
  PLANNER: 'Специалист ПДБ',
  QUALITY_CONTROLLER: 'Контролёр БТК',
  WORKER: 'Исполнитель',
};

const commandLabels: Record<CommandName, string> = {
  AcceptFirstArticle: 'Приёмка первой детали',
  AssignWorkCards: 'Назначение рабочих карточек',
  CompleteWorkCard: 'Завершение работы',
  ConfirmWorkCardQuality: 'Подтверждение качества карточки',
  CreateProductionBatch: 'Создание производственной партии',
  ExportWorkCardToPayroll: 'Создание тестовой записи нормо-часов',
  RecordFinalBatchAcceptance: 'Финальная приёмка партии',
  ReleaseWorkCards: 'Выпуск комплектов рабочих карточек',
  StartWorkCard: 'Начало работы',
};

function isAbort(error: unknown): boolean {
  return error instanceof ApiClientError && error.kind === 'abort';
}

function useResource<T>(loader: (signal: AbortSignal) => Promise<T>): ResourceState<T> {
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

function eventLabel(eventType: string): string {
  return eventLabels[eventType] ?? 'Подтверждённое действие';
}

function aggregateLabel(aggregateType: string): string {
  return aggregateLabels[aggregateType] ?? 'Производственный объект';
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

function AuditTechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="audit-envelope">
      <summary>Сведения о прототипе</summary>
      <p>Журнал содержит подтверждённые действия синтетического производственного процесса.</p>
      <details className="audit-envelope" data-ux-technical-exception="developer-codes">
        <summary>Технические коды для разработчика</summary>
        <p>Эти сведения предназначены только для разработки и не являются номерами деталей.</p>
        {children}
      </details>
    </details>
  );
}

function eventTechnicalDetails(event: AuditEvent) {
  return (
    <AuditTechnicalDetails>
      <dl>
        <div>
          <dt>Event type</dt>
          <dd>
            <code>{event.eventType}</code>
          </dd>
        </div>
        <div>
          <dt>Event ID</dt>
          <dd>
            <code>{event.id}</code>
          </dd>
        </div>
        <div>
          <dt>Aggregate</dt>
          <dd>
            <code>
              {event.aggregateType} · {event.aggregateId}
            </code>
          </dd>
        </div>
        <div>
          <dt>Command ID</dt>
          <dd>
            <code>{event.commandId}</code>
          </dd>
        </div>
        <div>
          <dt>Correlation ID</dt>
          <dd>
            <code>{event.correlationId}</code>
          </dd>
        </div>
        <div>
          <dt>Actor ID / role</dt>
          <dd>
            <code>
              {event.actorId} · {event.actorRole}
            </code>
          </dd>
        </div>
        <div>
          <dt>UTC</dt>
          <dd>
            <code>{event.occurredAt}</code>
          </dd>
        </div>
        <div>
          <dt>Typed data</dt>
          <dd>
            <code>{JSON.stringify(event.data)}</code>
          </dd>
        </div>
      </dl>
    </AuditTechnicalDetails>
  );
}

function AuditEventList({
  events,
  onOpenCorrelation,
}: {
  events: readonly AuditEvent[];
  onOpenCorrelation?: (correlationId: string) => void;
}) {
  return (
    <ol className="audit-list">
      {events.map((event) => (
        <li className="audit-event" key={event.id}>
          <span className="audit-event__marker" aria-hidden="true">
            <Icon name="shield" />
          </span>
          <div className="audit-event__body">
            <div className="audit-event__heading">
              <div>
                <h3>{eventLabel(event.eventType)}</h3>
                <p>
                  {aggregateLabel(event.aggregateType)} · версия{' '}
                  {formatCount(event.aggregateVersion)}
                </p>
              </div>
              <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
            </div>
            <p className="audit-event__actor">Подтвердил: {roleLabels[event.actorRole]}</p>
            {onOpenCorrelation ? (
              <button
                className="text-button"
                onClick={() => onOpenCorrelation(event.correlationId)}
                type="button"
              >
                Проверить полный связанный набор
                <Icon name="arrow-right" />
              </button>
            ) : null}
            {eventTechnicalDetails(event)}
          </div>
        </li>
      ))}
    </ol>
  );
}

function auditContextTechnicalEntries(context: CompleteAuditCorrelation): TechnicalEntry[] {
  return [
    { label: 'Command type', value: context.commandType },
    { label: 'Command ID', value: context.commandId },
    { label: 'Correlation ID', value: context.correlationId },
    { label: 'Expected event count', value: context.expectedEventCount },
    { label: 'Total event count', value: context.totalEventCount },
    ...context.readContexts.map((readContext, index) => ({
      label: `Audit request ID ${index + 1}`,
      value: readContext.requestId ?? null,
    })),
  ];
}

function aggregateCounts(events: readonly AuditEvent[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = aggregateLabel(event.aggregateType);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export function AuditCorrelationPanel({
  onRetry,
  state,
}: {
  onRetry: (correlationId: string) => void;
  state: CorrelationState;
}) {
  if (state.phase === 'idle') {
    return (
      <StatePanel
        description="Выберите событие истории: сервер соберёт все страницы исходной команды и сверит их с контрольным итогом."
        icon="search"
        title="Связанное действие не выбрано"
      />
    );
  }
  if (state.phase === 'loading') {
    return (
      <StatePanel
        description="Получаем все страницы связанного действия и проверяем серверные итоги."
        icon="clock"
        title="Проверяем полноту аудита"
        tone="loading"
      />
    );
  }
  if (state.phase === 'error') {
    return (
      <StatePanel
        action={
          <button
            className="button button--secondary"
            onClick={() => onRetry(state.correlationId)}
            type="button"
          >
            <Icon className="button__icon" name="refresh" />
            Повторить полное чтение
          </button>
        }
        description={
          state.error instanceof AuditIntegrityError
            ? 'Контрольные итоги или страницы не совпали. Неполный набор не показан как успешный.'
            : 'Не удалось получить все страницы связанного действия. Частичный результат скрыт.'
        }
        icon="shield"
        title="Полнота аудита не подтверждена"
        tone="error"
      />
    );
  }

  const context = state.data;
  return (
    <div className="audit-correlation">
      <div className="notice notice--success command-notice" role="status">
        <Icon name="shield" />
        <div>
          <strong>Полный набор событий подтверждён</strong>
          <p>
            Сервер ожидал {formatCount(context.expectedEventCount)}, насчитал{' '}
            {formatCount(context.totalEventCount)}, клиент получил все{' '}
            {formatCount(context.events.length)} уникальных событий.
          </p>
        </div>
      </div>
      <div className="audit-correlation__summary">
        <div>
          <span>Связанное действие</span>
          <strong>{commandLabels[context.commandType]}</strong>
        </div>
        {aggregateCounts(context.events).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{formatCount(count)}</strong>
          </div>
        ))}
      </div>
      {context.events.length > 0 ? (
        <details className="audit-correlation__events">
          <summary>
            Показать все подтверждённые события ({formatCount(context.events.length)})
          </summary>
          <AuditEventList events={context.events} />
        </details>
      ) : (
        <p className="audit-correlation__empty">
          Команда была идемпотентным повтором и не создала нового события.
        </p>
      )}
      <AuditTechnicalDetails>
        <dl>
          {auditContextTechnicalEntries(context).map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>
                <code>{entry.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      </AuditTechnicalDetails>
    </div>
  );
}

export function AuditReadyContent({
  auditClient,
  history,
  onAnnounce,
}: {
  auditClient: AdminAuditClient;
  history: WorkCardAuditHistory;
  onAnnounce: (message: string) => void;
}) {
  const controllerRef = useRef<AbortController | null>(null);
  const [correlationState, setCorrelationState] = useState<CorrelationState>({ phase: 'idle' });

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const openCorrelation = useCallback(
    (correlationId: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setCorrelationState({ correlationId, phase: 'loading' });
      onAnnounce('Проверяем полный связанный набор событий по серверным итогам.');

      void auditClient
        .getCompleteCorrelation(correlationId, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setCorrelationState({ data, phase: 'ready' });
          onAnnounce(`Полнота связанного действия подтверждена: ${data.events.length} событий.`);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbort(error)) return;
          setCorrelationState({ correlationId, error, phase: 'error' });
          onAnnounce('Полнота связанного действия не подтверждена.');
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
        });
    },
    [auditClient, onAnnounce],
  );

  return (
    <div className="screen-stack">
      <ContentCard status="Все страницы загружены" title="Подтверждённые события карточки">
        {history.events.length > 0 ? (
          <AuditEventList events={history.events} onOpenCorrelation={openCorrelation} />
        ) : (
          <StatePanel
            description="Сервер не вернул успешных событий для этой рабочей карточки."
            icon="clock"
            title="История карточки пока пуста"
          />
        )}
      </ContentCard>
      <ContentCard status="Проверка контрольных итогов" title="Полный контекст действия">
        <AuditCorrelationPanel onRetry={openCorrelation} state={correlationState} />
      </ContentCard>
    </div>
  );
}

function auditTechnicalEntries(history: WorkCardAuditHistory): TechnicalEntry[] {
  return [
    { label: 'Loaded work-card events', value: history.events.length },
    ...history.readContexts.map((context, index) => ({
      label: `History request ID ${index + 1}`,
      value: context.requestId ?? null,
    })),
  ];
}

export function AuditScreen({
  auditClient,
  navigate,
  onAnnounce,
  onRefresh,
  route,
}: {
  auditClient: AdminAuditClient;
  navigate: Navigate;
  onAnnounce: (message: string) => void;
  onRefresh: () => void;
  route: ScreenRoute;
}) {
  const workCardId = route.params.workCardId ?? '';
  const loader = useCallback(
    (signal: AbortSignal) => auditClient.getWorkCardHistory(workCardId, signal),
    [auditClient, workCardId],
  );
  const state = useResource(loader);
  const cardPath = `/work-cards/${encodeURIComponent(workCardId)}`;

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            <AppLink className="button button--secondary" navigate={navigate} to={cardPath}>
              <Icon className="button__icon" name="arrow-left" />К карточке
            </AppLink>
          </>
        }
        description="Хронология подтверждённых действий по карточке и полный серверный контекст выбранной команды."
        eyebrow="Контроль и прослеживаемость"
        title="Журнал действий"
      />
      {state.phase === 'loading' ? (
        <>
          <ContentCard status="Загрузка данных" title="Подтверждённые события карточки">
            <StatePanel
              description="Догружаем историю рабочей карточки до последней серверной страницы."
              icon="clock"
              title="Загружаем историю"
              tone="loading"
            />
          </ContentCard>
          <TechnicalDetails route={route} />
        </>
      ) : state.phase === 'error' ? (
        <>
          <ContentCard status="Ошибка чтения" title="Подтверждённые события карточки">
            {state.error instanceof AuditIntegrityError ? (
              <StatePanel
                action={<RefreshButton onRefresh={onRefresh} />}
                description="Порядок страниц или состав событий не прошли проверку. Частичная история не показана как успешная."
                icon="shield"
                title="Целостность истории не подтверждена"
                tone="error"
              />
            ) : (
              <ReadErrorPanel error={state.error} navigate={navigate} onRetry={onRefresh} />
            )}
          </ContentCard>
          <TechnicalDetails entries={technicalErrorEntries(state.error)} route={route} />
        </>
      ) : (
        <>
          <AuditReadyContent
            auditClient={auditClient}
            history={state.data}
            onAnnounce={onAnnounce}
          />
          <TechnicalDetails entries={auditTechnicalEntries(state.data)} route={route} />
        </>
      )}
    </>
  );
}

function payrollCommandMessage(error: unknown): string {
  if (error instanceof PayrollCommandIntegrityError) {
    return 'Ответ команды или контрольное чтение не подтвердили целостную запись. Успех не показан.';
  }
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return 'Карточка изменилась. Экспорт не повторяется автоматически; перечитайте данные.';
    }
    if (error.kind === 'transport') {
      return 'Результат команды неизвестен. Успех не показан; перечитайте существующую запись перед новым решением.';
    }
    if (error.kind === 'invalid-response') {
      return 'Ответ сервера не прошёл проверку. Новая запись не показана.';
    }
    if (error.problem?.detail) return error.problem.detail;
  }
  return 'Сервер не подтвердил тестовую запись. Автоматического повтора не будет.';
}

export function PayrollRecordSummary({
  card,
  outcome,
  record,
}: {
  card: WorkCard;
  outcome: ConfirmedPayrollExport['outcome'] | null;
  record: PayrollRecord;
}) {
  return (
    <>
      {outcome ? (
        <div className="notice notice--success command-notice" role="status">
          <Icon name="shield" />
          <div>
            <strong>
              {outcome === 'created'
                ? 'Тестовая запись создана и перечитана'
                : 'Открыта существующая тестовая запись'}
            </strong>
            <p>
              {outcome === 'created'
                ? 'Исполнитель и снимок нормы совпали с ответом обязательного контрольного чтения.'
                : 'Повтор не создал новую запись или новое событие; показан ранее сохранённый результат.'}
            </p>
          </div>
        </div>
      ) : null}
      <section className="summary-panel payroll-record" aria-label="Тестовая запись нормо-часов">
        <div className="summary-panel__heading">
          <div>
            <p>{card.operation.scopeCode}</p>
            <h2>{card.operation.scopeName}</h2>
            <span>Норма относится только к этой группе операций</span>
          </div>
          <span className="status-badge status-badge--success">Перечитана с сервера</span>
        </div>
        <FactGrid>
          <Fact label="Исполнитель" value={record.beneficiary.displayName} />
          <Fact label="Норма группы операций" value={formatHours(record.normHoursSnapshot)} />
          <Fact label="Создал запись" value={record.exportedBy.displayName} />
          <Fact label="Время сервера" value={formatDateTime(record.exportedAt)} />
          <Fact label="Денежный расчёт" value="Не выполняется" />
          <Fact label="Изменение и удаление" value="Недоступны" />
        </FactGrid>
      </section>
    </>
  );
}

function payrollTechnicalEntries(
  workspace: PayrollWorkspace,
  commandState: PayrollCommandState,
): TechnicalEntry[] {
  const record = commandState.phase === 'success' ? commandState.result.record : workspace.record;
  const entries: TechnicalEntry[] = [
    { label: 'WorkCard ID', value: workspace.card.id },
    { label: 'Card version', value: workspace.card.version },
    { label: 'PayrollRecord ID', value: record?.id ?? null },
    { label: 'Payroll command ID', value: record?.commandId ?? null },
    ...workspace.readContexts.map((context, index) => ({
      label: `Initial read request ID ${index + 1}`,
      value: context.requestId ?? null,
    })),
  ];
  if (commandState.phase === 'success') {
    entries.push(
      { label: 'Export outcome', value: commandState.result.outcome },
      { label: 'Correlation ID', value: commandState.result.correlationId },
      {
        label: 'Command request ID',
        value: commandState.result.commandContext.requestId ?? null,
      },
      {
        label: 'Read-back request ID',
        value: commandState.result.readBackContext.requestId ?? null,
      },
    );
  }
  if (
    commandState.phase === 'error' ||
    commandState.phase === 'recovering' ||
    commandState.phase === 'recovered'
  ) {
    entries.push(...technicalErrorEntries(commandState.error));
  }
  if (commandState.phase === 'error') {
    entries.push(...technicalErrorEntries(commandState.recoveryError));
  }
  return entries;
}

export function PayrollReadyContent({
  initialWorkspace,
  onAnnounce,
  onRefresh,
  permissions,
  payrollClient,
  route,
}: {
  initialWorkspace: PayrollWorkspace;
  onAnnounce: (message: string) => void;
  onRefresh: () => void;
  permissions: readonly CommandName[];
  payrollClient: PayrollCommandClient;
  route: ScreenRoute;
}) {
  const controllerRef = useRef<AbortController | null>(null);
  const exportReasonId = useId();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [commandState, setCommandState] = useState<PayrollCommandState>({ phase: 'idle' });
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const record = commandState.phase === 'success' ? commandState.result.record : workspace.record;
  const readinessIssue = payrollExportReadinessIssue(workspace.card);
  const recoveryBlocked = commandState.phase === 'recovering' || commandState.phase === 'error';
  const exportGuard = commandGuardFor({
    command: 'ExportWorkCardToPayroll',
    permissions,
    role: 'ADMIN_AUDITOR',
    unavailableReason:
      readinessIssue ??
      (recoveryBlocked
        ? 'Предыдущее создание записи не подтверждено. Перечитайте карточку и запись перед новым решением.'
        : !workspace.card.availableActions.includes('ExportWorkCardToPayroll')
          ? 'Сервер не разрешил создание тестовой записи для текущего состояния или версии карточки. Обновите данные.'
          : null),
  });

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  function runExport() {
    if (
      !confirmationOpen ||
      record ||
      exportGuard.state !== 'enabled' ||
      commandState.phase === 'submitting'
    )
      return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setCommandState({ phase: 'submitting' });
    onAnnounce('Создаём или читаем существующую тестовую запись и выполняем контрольное чтение.');

    void payrollClient
      .exportWorkCard(workspace.card, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setConfirmationOpen(false);
        setCommandState({ phase: 'success', result });
        onAnnounce(
          result.outcome === 'created'
            ? 'Тестовая запись создана и подтверждена контрольным чтением.'
            : 'Перечитана существующая тестовая запись; новая не создавалась.',
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setConfirmationOpen(false);
        setCommandState({ error, phase: 'recovering' });
        try {
          const recovered = await payrollClient.loadWorkspace(workspace.card.id, controller.signal);
          if (controller.signal.aborted) return;
          setWorkspace(recovered);
          setCommandState({ error, phase: 'recovered' });
          onAnnounce(
            recovered.record
              ? 'Исход команды не подтверждён, но карточка и существующая запись перечитаны. Повтор недоступен.'
              : 'Тестовая запись не подтверждена. Карточка и отсутствие записи перечитаны; повтор потребует нового явного решения.',
          );
        } catch (recoveryError: unknown) {
          if (controller.signal.aborted || isAbort(recoveryError)) return;
          setCommandState({ error, phase: 'error', recoveryError });
          onAnnounce(
            'Тестовая запись не подтверждена, а полное перечитывание карточки и записи не завершилось.',
          );
        }
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
  }

  const outcome = commandState.phase === 'success' ? commandState.result.outcome : null;
  return (
    <>
      <div className="screen-stack">
        {commandState.phase === 'error' ? (
          <div className="notice notice--error command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Тестовая запись не подтверждена</strong>
              <p>
                {payrollCommandMessage(commandState.error)} Полное перечитывание не завершилось;
                действие остаётся заблокированным.
              </p>
            </div>
          </div>
        ) : null}

        {commandState.phase === 'recovering' ? (
          <div className="notice notice--warning command-notice" role="status">
            <Icon name="refresh" />
            <div>
              <strong>Перечитываем карточку и тестовую запись</strong>
              <p>Команда не повторяется; частичный результат не показывается.</p>
            </div>
          </div>
        ) : null}

        {commandState.phase === 'recovered' ? (
          <div className="notice notice--warning command-notice" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Текущее состояние перечитано</strong>
              <p>
                {commandRecoveryDescription(commandState.error)} Доступность действия пересчитана по
                свежей карточке и записи.{' '}
                {record
                  ? 'Свежие данные уже содержат запись; повтор команды недоступен.'
                  : 'Если действие доступно, новая команда требует нового подтверждения пользователя.'}
              </p>
            </div>
          </div>
        ) : null}

        {record ? (
          <PayrollRecordSummary card={workspace.card} outcome={outcome} record={record} />
        ) : (
          <>
            <section className="summary-panel" aria-label="Карточка для тестового учёта">
              <div className="summary-panel__heading">
                <div>
                  <p>{workspace.card.operation.scopeCode}</p>
                  <h2>{workspace.card.operation.scopeName}</h2>
                  <span>Будет сохранён снимок нормы этой группы операций</span>
                </div>
                <span
                  className={`status-badge status-badge--${readinessIssue ? 'warning' : 'success'}`}
                >
                  {workCardStatusLabels[workspace.card.status]}
                </span>
              </div>
              <FactGrid>
                <Fact
                  label="Исполнитель"
                  value={workspace.card.assignee?.displayName ?? 'Не назначен'}
                />
                <Fact
                  label="Норма группы операций"
                  value={formatHours(workspace.card.operation.normHours)}
                />
                <Fact label="Тестовая запись" value="Ещё не создана" />
                <Fact label="Денежный расчёт" value="Не выполняется" />
              </FactGrid>
            </section>
            <ContentCard status="Действие администратора" title="Создание тестовой записи">
              <div className="payroll-command">
                <div>
                  <strong>Одна карточка — одна неизменяемая запись нормы</strong>
                  <p>
                    Перед действием проверено отсутствие записи. После ответа команды запись будет
                    обязательно перечитана с сервера.
                  </p>
                </div>
                <button
                  aria-describedby={exportGuard.state === 'disabled' ? exportReasonId : undefined}
                  className="button button--primary"
                  disabled={exportGuard.state !== 'enabled' || commandState.phase === 'submitting'}
                  onClick={() => setConfirmationOpen(true)}
                  type="button"
                >
                  <Icon className="button__icon" name="document" />
                  {commandState.phase === 'submitting'
                    ? 'Проверяем и перечитываем…'
                    : 'Создать тестовую запись нормо-часов'}
                </button>
                {exportGuard.state === 'disabled' ? (
                  <p className="payroll-command__reason" id={exportReasonId}>
                    {exportGuard.reason}
                  </p>
                ) : null}
                {commandState.phase === 'error' ? (
                  <button className="button button--secondary" onClick={onRefresh} type="button">
                    <Icon className="button__icon" name="refresh" />
                    Перечитать карточку и запись
                  </button>
                ) : null}
              </div>
            </ContentCard>
          </>
        )}
      </div>
      <TechnicalDetails entries={payrollTechnicalEntries(workspace, commandState)} route={route} />
      <ConfirmationDialog
        boundaryText="Будет сохранена одна неизменяемая тестовая запись нормы. Деньги и выплаты не рассчитываются; результат появится после контрольного чтения."
        busy={commandState.phase === 'submitting'}
        busyLabel="Создаём и перечитываем…"
        confirmLabel="Подтвердить создание тестовой записи"
        description="Администратор демонстрации сохраняет нормо-часы закрытой карточки для назначенного исполнителя. Проверьте группу операций, исполнителя и норму."
        onCancel={() => {
          if (commandState.phase !== 'submitting') setConfirmationOpen(false);
        }}
        onConfirm={runExport}
        open={confirmationOpen}
        preview={
          <div className="quality-dialog-summary">
            <strong>{workspace.card.operation.scopeName}</strong>
            <span>{workspace.card.assignee?.displayName ?? 'Исполнитель не назначен'}</span>
            <span>{formatHours(workspace.card.operation.normHours)}</span>
          </div>
        }
        title="Создать тестовую запись нормо-часов?"
      />
    </>
  );
}

export function PayrollScreen({
  navigate,
  onAnnounce,
  onRefresh,
  permissions,
  payrollClient,
  route,
}: {
  navigate: Navigate;
  onAnnounce: (message: string) => void;
  onRefresh: () => void;
  permissions: readonly CommandName[];
  payrollClient: PayrollCommandClient;
  route: ScreenRoute;
}) {
  const workCardId = route.params.workCardId ?? '';
  const loader = useCallback(
    (signal: AbortSignal) => payrollClient.loadWorkspace(workCardId, signal),
    [payrollClient, workCardId],
  );
  const state = useResource(loader);
  const workCardPath = `/work-cards/${encodeURIComponent(workCardId)}`;

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            <AppLink className="button button--secondary" navigate={navigate} to={workCardPath}>
              <Icon className="button__icon" name="arrow-left" />К карточке
            </AppLink>
          </>
        }
        description="Неизменяемая учебная запись нормо-часов без расчёта денег и выплат."
        eyebrow="Учебный расчёт"
        title="Тестовый учёт нормо-часов"
      />
      <div className="notice notice--boundary">
        <Icon name="shield" />
        <p>
          Это демонстрационный контур. Деньги, налоги, фактическое время и выплаты не
          рассчитываются.
        </p>
      </div>
      {state.phase === 'loading' ? (
        <>
          <ContentCard status="Проверка существующей записи" title="Тестовая запись нормо-часов">
            <StatePanel
              description="Сначала читаем существующую запись, затем подтверждённое состояние карточки."
              icon="clock"
              title="Проверяем серверные данные"
              tone="loading"
            />
          </ContentCard>
          <TechnicalDetails route={route} />
        </>
      ) : state.phase === 'error' ? (
        <>
          <ContentCard status="Ошибка чтения" title="Тестовая запись нормо-часов">
            {state.error instanceof PayrollCommandIntegrityError ? (
              <StatePanel
                action={<RefreshButton onRefresh={onRefresh} />}
                description="Запись, исполнитель или снимок нормы не совпали. Непроверенный результат скрыт."
                icon="shield"
                title="Целостность записи не подтверждена"
                tone="error"
              />
            ) : (
              <ReadErrorPanel error={state.error} navigate={navigate} onRetry={onRefresh} />
            )}
          </ContentCard>
          <TechnicalDetails entries={technicalErrorEntries(state.error)} route={route} />
        </>
      ) : (
        <PayrollReadyContent
          initialWorkspace={state.data}
          onAnnounce={onAnnounce}
          onRefresh={onRefresh}
          permissions={permissions}
          payrollClient={payrollClient}
          route={route}
        />
      )}
    </>
  );
}
