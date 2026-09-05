import type { CommandName, DemoUser, Role } from '@work-card/contracts';

import { createAdminAuditClient, type AdminAuditClient } from './admin-audit.js';
import { AuditScreen, PayrollScreen } from './admin-screens.js';
import { createApiClient } from './api-client.js';
import { AppLink } from './AppLink.js';
import { createBatchCommandClient, type BatchCommandClient } from './batch-commands.js';
import { Icon } from './Icon.js';
import { createMasterCommandClient, type MasterCommandClient } from './master-commands.js';
import { createPayrollCommandClient, type PayrollCommandClient } from './payroll-commands.js';
import { createQualityCommandClient, type QualityCommandClient } from './quality-commands.js';
import { routeAccessFor, type AppRoute } from './app-routing.js';
import {
  BatchScreen,
  BatchesScreen,
  NewBatchScreen,
  WorkCardScreen,
  WorkCardSetScreen,
} from './read-only-screens.js';
import { createReadModelClient, type ReadModelClient } from './read-model.js';
import { ContentCard, PageHeading, StatePanel, type Navigate } from './screen-ui.js';

type ScreenContentProps = Readonly<{
  navigate: Navigate;
  adminAudit?: AdminAuditClient;
  batchCommands?: BatchCommandClient;
  masterCommands?: MasterCommandClient;
  onAnnounce?: (message: string) => void;
  onFormDirtyChange?: (dirty: boolean) => void;
  onRefresh: () => void;
  payrollCommands?: PayrollCommandClient;
  permissions: readonly CommandName[];
  qualityCommands?: QualityCommandClient;
  readModel?: ReadModelClient;
  role: Role;
  roleLabel?: string;
  route: AppRoute;
  users?: readonly DemoUser[];
}>;

const defaultApiClient = createApiClient();
const defaultReadModel = createReadModelClient(defaultApiClient);
const defaultAdminAudit = createAdminAuditClient(defaultApiClient);
const defaultBatchCommands = createBatchCommandClient(defaultApiClient);
const defaultMasterCommands = createMasterCommandClient(defaultApiClient);
const defaultPayrollCommands = createPayrollCommandClient(defaultApiClient);
const defaultQualityCommands = createQualityCommandClient(defaultApiClient);

export function AccessDenied({ navigate, roleLabel }: { navigate: Navigate; roleLabel: string }) {
  return (
    <>
      <PageHeading
        description="Содержимое защищённого раздела не загружалось. Доступ рассчитывается заново при смене демонстрационной роли."
        eyebrow="Безопасный доступ"
        title="Раздел недоступен для активной роли"
      />
      <ContentCard status="Нет доступа" title="Ограничение доступа">
        <StatePanel
          action={
            <AppLink className="text-link" navigate={navigate} to="/batches">
              Вернуться к партиям
              <Icon name="arrow-right" />
            </AppLink>
          }
          description={`Активная роль «${roleLabel}» не читает этот раздел. Выберите подходящую подготовленную роль в верхней панели.`}
          icon="lock"
          title="Доступ ограничен"
          tone="restricted"
        />
      </ContentCard>
    </>
  );
}

function NotFoundScreen({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <PageHeading
        description="Проверьте адрес или вернитесь к списку производственных партий."
        eyebrow="Навигация"
        title="Страница не найдена"
      />
      <ContentCard status="Адрес не распознан" title="Запрошенный раздел">
        <StatePanel
          action={
            <AppLink className="text-link" navigate={navigate} to="/batches">
              Открыть партии
              <Icon name="arrow-right" />
            </AppLink>
          }
          description="Такого маршрута нет в текущей версии приложения."
          icon="search"
          title="Адрес не распознан"
          tone="error"
        />
      </ContentCard>
    </>
  );
}

export function RouteLoadingState() {
  return (
    <>
      <div className="page-heading page-heading--loading" aria-hidden="true">
        <div className="page-heading__copy">
          <span className="skeleton skeleton--eyebrow" />
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--text" />
        </div>
      </div>
      <section className="content-card content-card--loading" aria-label="Загрузка данных">
        <StatePanel
          description="Оболочка и активная роль уже доступны. Подготавливаем содержимое маршрута."
          icon="clock"
          title="Загружаем данные"
          tone="loading"
        />
      </section>
    </>
  );
}

export function ScreenContent(props: ScreenContentProps) {
  const { route } = props;
  if (route.kind === 'not-found') return <NotFoundScreen navigate={props.navigate} />;
  if (routeAccessFor(props.role, route) !== 'allowed') {
    return (
      <AccessDenied
        navigate={props.navigate}
        roleLabel={props.roleLabel ?? 'Активная демонстрационная роль'}
      />
    );
  }

  const readOnlyProps = {
    batchCommands: props.batchCommands ?? defaultBatchCommands,
    masterCommands: props.masterCommands ?? defaultMasterCommands,
    navigate: props.navigate,
    onAnnounce: props.onAnnounce ?? (() => undefined),
    ...(props.onFormDirtyChange ? { onFormDirtyChange: props.onFormDirtyChange } : {}),
    onRefresh: props.onRefresh,
    permissions: props.permissions,
    qualityCommands: props.qualityCommands ?? defaultQualityCommands,
    readModel: props.readModel ?? defaultReadModel,
    role: props.role,
    route,
    workers: (props.users ?? []).filter((user) => user.role === 'WORKER'),
  };

  switch (route.screenId) {
    case 'S-01':
      return <BatchesScreen {...readOnlyProps} />;
    case 'S-02':
      return <NewBatchScreen {...readOnlyProps} />;
    case 'S-03':
      return <BatchScreen {...readOnlyProps} />;
    case 'S-04':
      return <WorkCardSetScreen {...readOnlyProps} />;
    case 'S-05':
      return <WorkCardScreen {...readOnlyProps} />;
    case 'S-06':
      return (
        <AuditScreen
          auditClient={props.adminAudit ?? defaultAdminAudit}
          navigate={props.navigate}
          onAnnounce={props.onAnnounce ?? (() => undefined)}
          onRefresh={props.onRefresh}
          route={route}
        />
      );
    case 'S-07':
      return (
        <PayrollScreen
          navigate={props.navigate}
          onAnnounce={props.onAnnounce ?? (() => undefined)}
          onRefresh={props.onRefresh}
          permissions={props.permissions}
          payrollClient={props.payrollCommands ?? defaultPayrollCommands}
          route={route}
        />
      );
  }
}
