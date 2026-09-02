import type { ReactNode } from 'react';
import type { Role } from '@work-card/contracts';

import { AppLink } from './AppLink.js';
import { Icon } from './Icon.js';
import { screenTitles, type AppRoute, type ScreenRoute } from './app-routing.js';

type Navigate = (to: string) => void;

type ScreenContentProps = {
  navigate: Navigate;
  onRefresh: () => void;
  role: Role;
  route: AppRoute;
};

const screenDescriptions: Record<ScreenRoute['screenId'], string> = {
  'S-01': 'Единая точка входа в производственные партии, их выпуск и текущее состояние.',
  'S-02': 'Выберите подготовленный паспорт и задайте количество изделий в партии.',
  'S-03': 'Паспорт партии, состав комплектов и готовность к финальной приёмке.',
  'S-04': 'Операционный контекст, допуск первой детали, назначения и рабочие карточки.',
  'S-05': 'Состояние выполнения, исполнитель и следующий разрешённый шаг процесса.',
  'S-06': 'Хронология подтверждённых действий по карточке и связанным операциям.',
  'S-07': 'Неизменяемая учебная запись нормо-часов без расчёта денег и выплат.',
};

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button className="button button--secondary" onClick={onRefresh} type="button">
      <Icon className="button__icon" name="refresh" />
      Обновить
    </button>
  );
}

function PageHeading({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="page-heading">
      <div className="page-heading__copy">
        <p className="page-heading__eyebrow">{eyebrow}</p>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-heading__actions">{actions}</div> : null}
    </header>
  );
}

function StatePanel({
  action,
  description,
  icon,
  title,
  tone = 'empty',
}: {
  action?: ReactNode;
  description: string;
  icon: 'batch' | 'card' | 'clock' | 'document' | 'lock' | 'search' | 'shield';
  title: string;
  tone?: 'empty' | 'error' | 'loading' | 'restricted';
}) {
  return (
    <div
      aria-live={tone === 'loading' ? 'polite' : undefined}
      className={`state-panel state-panel--${tone}`}
      role={tone === 'error' || tone === 'restricted' ? 'alert' : 'status'}
    >
      <span className="state-panel__icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div className="state-panel__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="state-panel__action">{action}</div> : null}
    </div>
  );
}

function ContentCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="content-card" aria-labelledby="content-card-title">
      <div className="content-card__header">
        <div>
          <p className="content-card__overline">Рабочая область</p>
          <h2 id="content-card-title">{title}</h2>
        </div>
        <span className="content-card__status">Ожидает данных</span>
      </div>
      {children}
    </section>
  );
}

function TechnicalDetails({ route }: { route: ScreenRoute }) {
  const params = Object.entries(route.params).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );

  return (
    <details className="developer-details">
      <summary>Технические коды для разработчика</summary>
      <dl>
        <div>
          <dt>Экран</dt>
          <dd>
            <code>{route.screenId}</code>
          </dd>
        </div>
        <div>
          <dt>Маршрут</dt>
          <dd>
            <code>{route.pathname}</code>
          </dd>
        </div>
        {params.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function BatchesScreen({ navigate, onRefresh, role, route }: ScreenContentProps) {
  const isPlanner = role === 'PLANNER';

  return (
    <>
      <PageHeading
        actions={
          <>
            <RefreshButton onRefresh={onRefresh} />
            {isPlanner ? (
              <AppLink className="button button--primary" navigate={navigate} to="/batches/new">
                <Icon className="button__icon" name="plus" />
                Создать партию
              </AppLink>
            ) : null}
          </>
        }
        description={screenDescriptions['S-01']}
        eyebrow="Обзор производства"
        title={screenTitles['S-01']}
      />

      <ContentCard title="Список партий">
        <StatePanel
          action={
            isPlanner ? (
              <AppLink className="text-link" navigate={navigate} to="/batches/new">
                Перейти к созданию
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
      </ContentCard>
      {route.kind === 'screen' ? <TechnicalDetails route={route} /> : null}
    </>
  );
}

function NewBatchScreen({ navigate, onRefresh, route }: ScreenContentProps) {
  return (
    <>
      <PageHeading
        actions={
          <AppLink className="button button--secondary" navigate={navigate} to="/batches">
            <Icon className="button__icon" name="arrow-left" />К партиям
          </AppLink>
        }
        description={screenDescriptions['S-02']}
        eyebrow="Планирование"
        title={screenTitles['S-02']}
      />

      <ContentCard title="Производственный паспорт">
        <StatePanel
          action={<RefreshButton onRefresh={onRefresh} />}
          description="Обновите экран или обратитесь к ответственному за подготовку демонстрационного контура. Маршрут и нормы здесь не редактируются."
          icon="document"
          title="Нет доступного подготовленного паспорта"
        />
      </ContentCard>
      {route.kind === 'screen' ? <TechnicalDetails route={route} /> : null}
    </>
  );
}

function MissingEntityScreen({
  contentTitle,
  description,
  icon,
  navigate,
  onRefresh,
  route,
}: {
  contentTitle: string;
  description: string;
  icon: 'batch' | 'card' | 'document' | 'search';
  navigate: Navigate;
  onRefresh: () => void;
  route: ScreenRoute;
}) {
  return (
    <>
      <PageHeading
        actions={<RefreshButton onRefresh={onRefresh} />}
        description={screenDescriptions[route.screenId]}
        eyebrow="Производственный контекст"
        title={screenTitles[route.screenId]}
      />
      <ContentCard title={contentTitle}>
        <StatePanel
          action={
            <AppLink className="text-link" navigate={navigate} to="/batches">
              Вернуться к партиям
              <Icon name="arrow-right" />
            </AppLink>
          }
          description={description}
          icon={icon}
          title="Данные не найдены"
          tone="error"
        />
      </ContentCard>
      <TechnicalDetails route={route} />
    </>
  );
}

function AuditScreen({ navigate, onRefresh, route }: ScreenContentProps) {
  return (
    <>
      <PageHeading
        actions={<RefreshButton onRefresh={onRefresh} />}
        description={screenDescriptions['S-06']}
        eyebrow="Контроль и прослеживаемость"
        title={screenTitles['S-06']}
      />
      <ContentCard title="Подтверждённые события">
        <StatePanel
          action={
            <AppLink
              className="text-link"
              navigate={navigate}
              to={`/work-cards/${encodeURIComponent(route.kind === 'screen' ? (route.params.workCardId ?? '') : '')}`}
            >
              Вернуться к карточке
              <Icon name="arrow-right" />
            </AppLink>
          }
          description="После загрузки здесь появится хронология в подтверждённом сервером порядке."
          icon="clock"
          title="Успешных событий не найдено"
        />
      </ContentCard>
      {route.kind === 'screen' ? <TechnicalDetails route={route} /> : null}
    </>
  );
}

function PayrollScreen({ navigate, onRefresh, route }: ScreenContentProps) {
  const workCardPath = `/work-cards/${encodeURIComponent(
    route.kind === 'screen' ? (route.params.workCardId ?? '') : '',
  )}`;

  return (
    <>
      <PageHeading
        actions={
          <AppLink className="button button--secondary" navigate={navigate} to={workCardPath}>
            <Icon className="button__icon" name="arrow-left" />К карточке
          </AppLink>
        }
        description={screenDescriptions['S-07']}
        eyebrow="Учебный расчёт"
        title={screenTitles['S-07']}
      />
      <div className="notice notice--boundary">
        <Icon name="shield" />
        <p>
          Это демонстрационный контур. Деньги, налоги, фактическое время и выплаты не
          рассчитываются.
        </p>
      </div>
      <ContentCard title="Запись нормо-часов">
        <StatePanel
          action={<RefreshButton onRefresh={onRefresh} />}
          description="Первый экспорт выполняется из закрытой рабочей карточки. Запись нельзя редактировать или удалить."
          icon="document"
          title="Запись учебного расчёта отсутствует"
        />
      </ContentCard>
      {route.kind === 'screen' ? <TechnicalDetails route={route} /> : null}
    </>
  );
}

export function AccessDenied({ navigate, roleLabel }: { navigate: Navigate; roleLabel: string }) {
  return (
    <>
      <PageHeading
        description="Содержимое защищённого раздела не загружалось. Доступ рассчитывается заново при смене демонстрационной роли."
        eyebrow="Безопасный доступ"
        title="Раздел недоступен для активной роли"
      />
      <ContentCard title="Ограничение доступа">
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
      <ContentCard title="Запрошенный раздел">
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

  switch (route.screenId) {
    case 'S-01':
      return <BatchesScreen {...props} />;
    case 'S-02':
      return <NewBatchScreen {...props} />;
    case 'S-03':
      return (
        <MissingEntityScreen
          contentTitle="Состав партии"
          description="Перечитайте данные или выберите партию из списка. Выпуск и финальная приёмка не выполнялись."
          icon="batch"
          navigate={props.navigate}
          onRefresh={props.onRefresh}
          route={route}
        />
      );
    case 'S-04':
      return (
        <MissingEntityScreen
          contentTitle="Операция и карточки"
          description="Перечитайте данные или откройте комплект из состава партии. Назначения не изменялись."
          icon="document"
          navigate={props.navigate}
          onRefresh={props.onRefresh}
          route={route}
        />
      );
    case 'S-05':
      return (
        <MissingEntityScreen
          contentTitle="Состояние выполнения"
          description="Перечитайте данные или откройте рабочую карточку из комплекта. Состояние процесса не изменялось."
          icon="card"
          navigate={props.navigate}
          onRefresh={props.onRefresh}
          route={route}
        />
      );
    case 'S-06':
      return <AuditScreen {...props} />;
    case 'S-07':
      return <PayrollScreen {...props} />;
  }
}
