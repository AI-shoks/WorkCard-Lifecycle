import { useId, type ReactNode } from 'react';

import { ApiClientError } from './api-client.js';
import { AppLink } from './AppLink.js';
import { Icon } from './Icon.js';
import type { ScreenRoute } from './app-routing.js';
import type { TechnicalEntry } from './read-errors.js';

export type Navigate = (to: string) => void;

export function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button className="button button--secondary" onClick={onRefresh} type="button">
      <Icon className="button__icon" name="refresh" />
      Обновить данные
    </button>
  );
}

export function PageHeading({
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

export function StatePanel({
  action,
  description,
  icon,
  title,
  tone = 'empty',
}: {
  action?: ReactNode;
  description: string;
  icon: 'batch' | 'card' | 'clock' | 'document' | 'lock' | 'search' | 'shield' | 'user';
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

export function ContentCard({
  children,
  status = 'Только просмотр',
  title,
}: {
  children: ReactNode;
  status?: string;
  title: string;
}) {
  const headingId = useId();

  return (
    <section className="content-card" aria-labelledby={headingId}>
      <div className="content-card__header">
        <div>
          <p className="content-card__overline">Рабочая область</p>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span className="content-card__status">{status}</span>
      </div>
      {children}
    </section>
  );
}

export function TechnicalDetails({
  entries = [],
  route,
}: {
  entries?: readonly TechnicalEntry[];
  route: ScreenRoute;
}) {
  const params = Object.entries(route.params).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  const visibleEntries = entries.filter((entry) => entry.value !== null && entry.value !== '');

  return (
    <details className="developer-details">
      <summary>Сведения о прототипе</summary>
      <p>Приложение использует синтетические данные для демонстрации производственного процесса.</p>
      <details className="developer-details" data-ux-technical-exception="developer-codes">
        <summary>Технические коды для разработчика</summary>
        <p className="developer-details__warning">
          Эти значения предназначены только для разработки и не являются номерами деталей или
          карточек.
        </p>
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
            <div key={`route-${name}`}>
              <dt>{name}</dt>
              <dd>
                <code>{value}</code>
              </dd>
            </div>
          ))}
          {visibleEntries.map((entry, index) => (
            <div key={`${entry.label}-${index}`}>
              <dt>{entry.label}</dt>
              <dd>
                <code>{entry.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </details>
  );
}

export function ReadErrorPanel({
  error,
  navigate,
  onRetry,
}: {
  error: unknown;
  navigate: Navigate;
  onRetry: () => void;
}) {
  const missing = error instanceof ApiClientError && error.status === 404;

  return (
    <StatePanel
      action={
        <div className="state-panel__actions">
          <button className="button button--secondary" onClick={onRetry} type="button">
            <Icon className="button__icon" name="refresh" />
            Повторить чтение
          </button>
          <AppLink className="text-link" navigate={navigate} to="/batches">
            Вернуться к партиям
            <Icon name="arrow-right" />
          </AppLink>
        </div>
      }
      description={
        missing
          ? 'Проверьте переход из списка или обновите данные. Производственные действия не выполнялись.'
          : 'Повторите чтение данных. Если ошибка сохранится, сообщите администратору демонстрации.'
      }
      icon={missing ? 'search' : 'shield'}
      title={missing ? 'Данные не найдены' : 'Не удалось загрузить данные'}
      tone="error"
    />
  );
}
