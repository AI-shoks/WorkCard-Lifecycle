import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoSessionResponse, DemoUser, Role } from '@work-card/contracts';

import { createAdminAuditClient } from './admin-audit.js';
import { createApiClient } from './api-client.js';
import { AppLink } from './AppLink.js';
import { createBatchCommandClient } from './batch-commands.js';
import { Icon } from './Icon.js';
import { AccessDenied, RouteLoadingState, ScreenContent } from './ScreenContent.js';
import {
  breadcrumbsFor,
  routeAccessFor,
  matchAppRoute,
  titleForRoute,
  type Breadcrumb,
} from './app-routing.js';
import { bootstrapDemoSession, createDemoSessionClient, isAbortError } from './demo-session.js';
import { fetchReadiness, toReadinessView } from './health.js';
import { createMasterCommandClient } from './master-commands.js';
import { createPayrollCommandClient } from './payroll-commands.js';
import { createQualityCommandClient } from './quality-commands.js';
import { createReadModelClient } from './read-model.js';
import { ConfirmationDialog } from './read-only-screens.js';
import { resetSessionScope, SessionScope } from './session-scope.js';

type RolePresentation = {
  responsibility: string;
  shortLabel: string;
};

const rolePresentation: Record<Role, RolePresentation> = {
  PLANNER: {
    responsibility: 'Создаёт партии и выпускает комплекты рабочих карточек.',
    shortLabel: 'ПДБ',
  },
  MASTER: {
    responsibility: 'Назначает карточки и фиксирует начало и завершение работ.',
    shortLabel: 'Мастер',
  },
  WORKER: {
    responsibility: 'Видит свои назначения и состояние карточек без действий мастера.',
    shortLabel: 'Исполнитель',
  },
  QUALITY_CONTROLLER: {
    responsibility: 'Подтверждает качество и отдельно принимает завершённую партию.',
    shortLabel: 'БТК',
  },
  ADMIN_AUDITOR: {
    responsibility: 'Читает журнал действий и неизменяемые учебные расчёты.',
    shortLabel: 'Аудитор',
  },
};

type SessionPhase = 'bootstrapping' | 'ending' | 'error' | 'ready' | 'signed-out' | 'switching';

const sessionClient = createDemoSessionClient();

function useBrowserNavigation() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', '/batches');
      setPathname('/batches');
    }

    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setPathname(window.location.pathname);
  }, []);

  return { navigate, pathname };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand__copy">
        <strong>Рабочие карточки</strong>
        <span>Производственный цикл</span>
      </span>
    </div>
  );
}

function Sidebar({
  navigate,
  pathname,
  user,
}: {
  navigate: (to: string) => void;
  pathname: string;
  user: DemoUser;
}) {
  const presentation = rolePresentation[user.role];
  const inBatchArea =
    pathname === '/batches' ||
    pathname.startsWith('/batches/') ||
    pathname.startsWith('/card-sets/') ||
    pathname.startsWith('/work-cards/');

  return (
    <aside className="sidebar">
      <Brand />

      <nav className="primary-nav" aria-label="Основная навигация">
        <p className="primary-nav__label">Рабочая область</p>
        <AppLink
          aria-current={inBatchArea && pathname !== '/batches/new' ? 'page' : undefined}
          className={`primary-nav__link${
            inBatchArea && pathname !== '/batches/new' ? ' primary-nav__link--active' : ''
          }`}
          navigate={navigate}
          to="/batches"
        >
          <Icon name="batch" />
          <span>Партии</span>
        </AppLink>
        {user.role === 'PLANNER' ? (
          <AppLink
            aria-current={pathname === '/batches/new' ? 'page' : undefined}
            className={`primary-nav__link${
              pathname === '/batches/new' ? ' primary-nav__link--active' : ''
            }`}
            navigate={navigate}
            to="/batches/new"
          >
            <Icon name="plus" />
            <span>Новая партия</span>
          </AppLink>
        ) : null}

        <p className="primary-nav__label primary-nav__label--secondary">По контексту</p>
        <div className="primary-nav__context" aria-label="Контекстные разделы">
          <span>
            <Icon name="document" />
            Комплекты
          </span>
          <span>
            <Icon name="card" />
            Рабочие карточки
          </span>
        </div>
      </nav>

      <div className="role-summary">
        <span className="role-summary__icon" aria-hidden="true">
          <Icon name="shield" />
        </span>
        <p>Зона ответственности</p>
        <strong>{presentation.shortLabel}</strong>
        <span>{presentation.responsibility}</span>
      </div>

      <p className="sidebar__boundary">Только синтетические демонстрационные данные</p>
    </aside>
  );
}

function Breadcrumbs({
  breadcrumbs,
  navigate,
}: {
  breadcrumbs: Breadcrumb[];
  navigate: (to: string) => void;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <ol>
        {breadcrumbs.map((breadcrumb, index) => {
          const isCurrent = index === breadcrumbs.length - 1;
          return (
            <li key={`${breadcrumb.label}-${index}`}>
              {index > 0 ? <Icon name="chevron-right" /> : null}
              {breadcrumb.to && !isCurrent ? (
                <AppLink navigate={navigate} to={breadcrumb.to}>
                  {breadcrumb.label}
                </AppLink>
              ) : (
                <span aria-current={isCurrent ? 'page' : undefined}>{breadcrumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function RoleSwitcher({
  onChange,
  onLogout,
  session,
  users,
}: {
  onChange: (demoUserId: string) => void;
  onLogout: () => void;
  session: DemoSessionResponse;
  users: DemoUser[];
}) {
  const choices = users.some((candidate) => candidate.id === session.actor.id)
    ? users
    : [session.actor, ...users];

  return (
    <div className="role-switcher">
      <span className="role-switcher__avatar" aria-hidden="true">
        <Icon name="user" />
      </span>
      <label htmlFor="demo-role">Демонстрационная роль</label>
      <select
        id="demo-role"
        onChange={(event) => {
          if (event.target.value !== session.actor.id) onChange(event.target.value);
        }}
        value={session.actor.id}
      >
        {choices.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.displayName}
          </option>
        ))}
      </select>
      <span className="role-switcher__meta">{session.actor.roleLabel}</span>
      <button className="role-switcher__logout" onClick={onLogout} type="button">
        Выйти
      </button>
    </div>
  );
}

function SessionGate({
  errorMessage,
  onRetry,
  onSelect,
  phase,
  users,
}: {
  errorMessage: string | null;
  onRetry: () => void;
  onSelect: (demoUserId: string) => void;
  phase: Exclude<SessionPhase, 'ready'>;
  users: DemoUser[];
}) {
  const busy = phase === 'bootstrapping' || phase === 'ending' || phase === 'switching';
  const title =
    phase === 'switching'
      ? 'Меняем демонстрационную роль'
      : phase === 'ending'
        ? 'Завершаем демонстрационную сессию'
        : phase === 'error'
          ? 'Не удалось подготовить сессию'
          : phase === 'bootstrapping'
            ? 'Восстанавливаем демонстрационную сессию'
            : 'Выберите демонстрационную роль';

  return (
    <div className="session-entry">
      <main className="session-entry__card" id="main-content">
        <Brand compact />
        <p className="session-entry__eyebrow">Серверная демонстрационная сессия</p>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        <p className="session-entry__description">
          Роль и полномочия определяет сервер. В приложении используются только подготовленные
          синтетические пользователи.
        </p>

        {busy ? (
          <div className="session-entry__status" role="status">
            <span aria-hidden="true" />
            Подождите, подтверждаем сессию на сервере.
          </div>
        ) : null}

        {phase === 'signed-out' ? (
          <label className="session-entry__selector" htmlFor="initial-demo-role">
            <span>Демонстрационная роль</span>
            <select
              defaultValue=""
              id="initial-demo-role"
              onChange={(event) => {
                if (event.target.value) onSelect(event.target.value);
              }}
            >
              <option disabled value="">
                Выберите подготовленного пользователя
              </option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                  {user.displayName === user.roleLabel ? '' : ` — ${user.roleLabel}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {phase === 'error' ? (
          <div className="session-entry__error" role="alert">
            <p>{errorMessage ?? 'Сервер демонстрационных ролей временно недоступен.'}</p>
            <button className="button button--secondary" onClick={onRetry} type="button">
              <Icon className="button__icon" name="refresh" />
              Повторить
            </button>
          </div>
        ) : null}

        <p className="session-entry__boundary">
          Данные сессии не сохраняются в браузерном хранилище страницы.
        </p>
      </main>
    </div>
  );
}

export function App() {
  const { navigate, pathname } = useBrowserNavigation();
  const sessionActionControllerRef = useRef<AbortController | null>(null);
  const [sessionScope] = useState(() => new SessionScope());
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [session, setSession] = useState<DemoSessionResponse | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('bootstrapping');
  const [sessionScopeRevision, setSessionScopeRevision] = useState(0);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [readinessState, setReadinessState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [announcement, setAnnouncement] = useState('Подготавливаем приложение.');
  const [hasUnfinishedForm, setHasUnfinishedForm] = useState(false);
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);
  const apiClient = useMemo(
    () =>
      createApiClient({
        getConfirmedDemoSession: () => (sessionPhase === 'ready' ? session : null),
      }),
    [session, sessionPhase],
  );
  const adminAudit = useMemo(() => createAdminAuditClient(apiClient), [apiClient]);
  const batchCommands = useMemo(() => createBatchCommandClient(apiClient), [apiClient]);
  const masterCommands = useMemo(() => createMasterCommandClient(apiClient), [apiClient]);
  const payrollCommands = useMemo(() => createPayrollCommandClient(apiClient), [apiClient]);
  const qualityCommands = useMemo(() => createQualityCommandClient(apiClient), [apiClient]);
  const readModel = useMemo(() => createReadModelClient(apiClient), [apiClient]);
  const route = useMemo(() => matchAppRoute(pathname), [pathname]);
  const routeAccess = routeAccessFor(session?.actor.role ?? null, route);
  const hasAccess = routeAccess === 'allowed';

  const breadcrumbs = useMemo(() => {
    if (routeAccess === 'forbidden') {
      return [
        { label: 'Партии', to: '/batches' },
        { label: 'Доступ ограничен' },
      ] satisfies Breadcrumb[];
    }
    return breadcrumbsFor(route);
  }, [route, routeAccess]);

  const clearSessionBoundary = useCallback(() => {
    const revision = resetSessionScope(sessionScope);
    setSessionScopeRevision(revision);
    setRefreshVersion(0);
    setHasUnfinishedForm(false);
    setPendingRoleId(null);
  }, [sessionScope]);

  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setSessionError(null);
    setSessionPhase('bootstrapping');

    void bootstrapDemoSession(sessionClient, controller.signal)
      .then((bootstrap) => {
        if (controller.signal.aborted) return;
        setUsers(bootstrap.users);
        setSession(bootstrap.session);
        setSessionPhase(bootstrap.session ? 'ready' : 'signed-out');
        setAnnouncement(
          bootstrap.session
            ? `Восстановлена сессия пользователя «${bootstrap.session.actor.displayName}».`
            : 'Выберите подготовленную демонстрационную роль.',
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        setSessionError('Не удалось получить подготовленные роли и проверить текущую сессию.');
        setSessionPhase('error');
        setAnnouncement('Не удалось подготовить демонстрационную сессию.');
      });

    return () => controller.abort();
  }, [bootstrapVersion]);

  useEffect(
    () => () => {
      sessionActionControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setReadinessState('loading');

    void fetchReadiness(controller.signal)
      .then((response) => {
        const view = toReadinessView(response);
        setReadinessState(view.tone === 'ready' ? 'ready' : 'unavailable');
        setAnnouncement(
          view.tone === 'ready'
            ? 'Приложение готово. Доступ маршрута рассчитан.'
            : 'Среда пока недоступна. Обновите экран позднее.',
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setReadinessState('unavailable');
        setAnnouncement('Не удалось проверить готовность среды. Обновите экран позднее.');
      });

    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const pageTitle =
      sessionPhase === 'ready'
        ? hasAccess
          ? titleForRoute(route)
          : 'Доступ ограничен'
        : 'Демонстрационная сессия';
    document.title = `${pageTitle} · Рабочие карточки`;

    window.scrollTo({ left: 0, top: 0 });
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#page-title')?.focus());
  }, [hasAccess, route, sessionPhase]);

  function changeRole(demoUserId: string) {
    if (sessionPhase === 'ready' && session?.actor.id === demoUserId) return;
    if (sessionPhase === 'ready' && hasUnfinishedForm) {
      setPendingRoleId(demoUserId);
      return;
    }
    performRoleChange(demoUserId);
  }

  function performRoleChange(demoUserId: string) {
    if (sessionActionControllerRef.current) return;
    const controller = new AbortController();
    sessionActionControllerRef.current = controller;
    clearSessionBoundary();
    setSession(null);
    setSessionError(null);
    setSessionPhase('switching');
    setAnnouncement('Меняем демонстрационную роль и очищаем данные предыдущего пользователя.');

    void sessionClient
      .createSession(demoUserId, controller.signal)
      .then((nextSession) => {
        if (controller.signal.aborted) return;
        setSession(nextSession);
        setSessionPhase('ready');
        setAnnouncement(
          `Активна роль «${nextSession.actor.displayName}». Доступ рассчитан по серверной сессии.`,
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        setSessionError(
          'Не удалось подтвердить выбранную роль. Повторная проверка восстановит фактическую серверную сессию.',
        );
        setSessionPhase('error');
        setAnnouncement('Смена демонстрационной роли не подтверждена.');
      })
      .finally(() => {
        if (sessionActionControllerRef.current === controller) {
          sessionActionControllerRef.current = null;
        }
      });
  }

  function logout() {
    if (!session || sessionPhase !== 'ready') return;

    const csrfToken = session.csrfToken;
    sessionActionControllerRef.current?.abort();
    const controller = new AbortController();
    sessionActionControllerRef.current = controller;
    clearSessionBoundary();
    setSession(null);
    setSessionError(null);
    setSessionPhase('ending');
    setAnnouncement('Завершаем демонстрационную сессию.');

    void sessionClient
      .deleteSession(csrfToken, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        setSessionPhase('signed-out');
        setAnnouncement('Демонстрационная сессия завершена.');
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        setSessionError(
          'Не удалось подтвердить выход. Повторная проверка восстановит фактическое состояние сессии.',
        );
        setSessionPhase('error');
        setAnnouncement('Завершение демонстрационной сессии не подтверждено.');
      })
      .finally(() => {
        if (sessionActionControllerRef.current === controller) {
          sessionActionControllerRef.current = null;
        }
      });
  }

  function retrySessionBootstrap() {
    sessionActionControllerRef.current?.abort();
    clearSessionBoundary();
    setBootstrapVersion((version) => version + 1);
  }

  function refreshPage() {
    setAnnouncement('Перечитываем текущий экран без повторения производственных действий.');
    setReadinessState('loading');
    setRefreshVersion((version) => version + 1);
  }

  const readinessLabel =
    readinessState === 'ready'
      ? 'Среда готова'
      : readinessState === 'loading'
        ? 'Проверяем среду'
        : 'Среда недоступна';

  if (!session || sessionPhase !== 'ready') {
    const gatePhase = sessionPhase === 'ready' ? 'error' : sessionPhase;
    return (
      <>
        <a className="skip-link" href="#main-content">
          К основному содержанию
        </a>
        <SessionGate
          errorMessage={sessionError}
          onRetry={retrySessionBootstrap}
          onSelect={changeRole}
          phase={gatePhase}
          users={users}
        />
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        К основному содержанию
      </a>
      <div className="app-layout">
        <Sidebar navigate={navigate} pathname={pathname} user={session.actor} />

        <div className="workspace">
          <header className="topbar">
            <div className="topbar__mobile-brand">
              <Brand compact />
            </div>
            <div className="topbar__context">
              <Breadcrumbs breadcrumbs={breadcrumbs} navigate={navigate} />
              <span
                className={`environment-status environment-status--${readinessState}`}
                role="status"
              >
                <span aria-hidden="true" />
                {readinessLabel}
              </span>
            </div>
            <RoleSwitcher onChange={changeRole} onLogout={logout} session={session} users={users} />
          </header>

          <main
            className="main-content"
            id="main-content"
            key={`${sessionScopeRevision}:${session.actor.id}:${route.pathname}:${refreshVersion}`}
          >
            {!hasAccess ? (
              <AccessDenied navigate={navigate} roleLabel={session.actor.displayName} />
            ) : readinessState === 'loading' ? (
              <RouteLoadingState />
            ) : (
              <ScreenContent
                adminAudit={adminAudit}
                batchCommands={batchCommands}
                masterCommands={masterCommands}
                navigate={navigate}
                onAnnounce={setAnnouncement}
                onFormDirtyChange={setHasUnfinishedForm}
                onRefresh={refreshPage}
                payrollCommands={payrollCommands}
                permissions={session.permissions}
                qualityCommands={qualityCommands}
                readModel={readModel}
                role={session.actor.role}
                roleLabel={session.actor.displayName}
                route={route}
                users={users}
              />
            )}
          </main>

          <footer className="app-footer">
            <span>Демонстрационный производственный контур</span>
            <span aria-hidden="true">·</span>
            <span>Без подключения к реальным системам</span>
          </footer>
        </div>
      </div>
      <ConfirmationDialog
        boundaryText="Введённые данные и выбор карточек будут очищены. Для продолжения потребуется новое решение в выбранной роли."
        busy={false}
        busyLabel="Меняем роль…"
        confirmLabel="Очистить форму и сменить роль"
        description={`У пользователя «${session.actor.displayName}» есть незавершённая форма. Подтвердите смену роли или вернитесь к форме.`}
        onCancel={() => setPendingRoleId(null)}
        onConfirm={() => {
          if (pendingRoleId) performRoleChange(pendingRoleId);
        }}
        open={pendingRoleId !== null}
        preview={<p>Новая роль: {users.find((user) => user.id === pendingRoleId)?.displayName}</p>}
        title="Сменить роль и очистить незавершённую форму?"
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}
