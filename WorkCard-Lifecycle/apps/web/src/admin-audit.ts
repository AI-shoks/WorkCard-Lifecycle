import {
  AuditCorrelationResponseSchema,
  AuditEventsResponseSchema,
  type AuditEvent,
  type CommandName,
  type ContractValue,
} from '@work-card/contracts';

import {
  contractResponse,
  type ApiClient,
  type ApiRequestContext,
  type ApiResponse,
  type ApiV1Path,
} from './api-client.js';

type AuditEventsPage = ContractValue<typeof AuditEventsResponseSchema>;
type AuditCorrelationPage = ContractValue<typeof AuditCorrelationResponseSchema>;

export type WorkCardAuditHistory = Readonly<{
  events: readonly AuditEvent[];
  readContexts: readonly ApiRequestContext[];
}>;

export type CompleteAuditCorrelation = Readonly<{
  commandId: string;
  commandType: CommandName;
  correlationId: string;
  events: readonly AuditEvent[];
  expectedEventCount: number;
  readContexts: readonly ApiRequestContext[];
  totalEventCount: number;
}>;

export type AdminAuditClient = Readonly<{
  getCompleteCorrelation: (
    correlationId: string,
    signal?: AbortSignal,
  ) => Promise<CompleteAuditCorrelation>;
  getWorkCardHistory: (workCardId: string, signal?: AbortSignal) => Promise<WorkCardAuditHistory>;
}>;

export class AuditIntegrityError extends Error {
  readonly readContexts: readonly ApiRequestContext[];

  constructor(message: string, readContexts: readonly ApiRequestContext[] = []) {
    super(message);
    this.name = 'AuditIntegrityError';
    this.readContexts = readContexts;
  }
}

function optionalSignal(signal?: AbortSignal): { signal: AbortSignal } | object {
  return signal ? { signal } : {};
}

function pagePath(base: ApiV1Path, cursor: string | null, limit: number): ApiV1Path {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set('cursor', cursor);
  return `${base}?${search.toString()}` as ApiV1Path;
}

function assertNewCursor(
  cursor: string | null,
  seenCursors: ReadonlySet<string>,
  readContexts: readonly ApiRequestContext[],
): void {
  if (cursor && seenCursors.has(cursor)) {
    throw new AuditIntegrityError(
      'Сервер повторил курсор страницы аудита. Полнота истории не подтверждена.',
      readContexts,
    );
  }
}

function appendUniqueEvents(
  target: AuditEvent[],
  page: readonly AuditEvent[],
  seenEventIds: Set<string>,
  readContexts: readonly ApiRequestContext[],
): void {
  for (const event of page) {
    if (seenEventIds.has(event.id)) {
      throw new AuditIntegrityError(
        'Сервер повторил событие на нескольких страницах. Полнота истории не подтверждена.',
        readContexts,
      );
    }
    seenEventIds.add(event.id);
    target.push(event);
  }
}

function assertWorkCardPage(
  page: AuditEventsPage,
  workCardId: string,
  previousEvent: AuditEvent | undefined,
  readContexts: readonly ApiRequestContext[],
): void {
  for (const event of page.events) {
    if (event.aggregateType !== 'WorkCard' || event.aggregateId !== workCardId) {
      throw new AuditIntegrityError(
        'История карточки содержит событие другого производственного объекта.',
        readContexts,
      );
    }
    if (
      previousEvent &&
      (event.aggregateVersion < previousEvent.aggregateVersion ||
        (event.aggregateVersion === previousEvent.aggregateVersion && event.id <= previousEvent.id))
    ) {
      throw new AuditIntegrityError(
        'События карточки получены не в подтверждённом порядке версий.',
        readContexts,
      );
    }
    previousEvent = event;
  }
}

function assertCorrelationPage(
  page: AuditCorrelationPage,
  correlationId: string,
  authoritative: AuditCorrelationPage | null,
  readContexts: readonly ApiRequestContext[],
): void {
  if (page.correlationId !== correlationId) {
    throw new AuditIntegrityError(
      'Сервер вернул события другого связанного действия.',
      readContexts,
    );
  }
  if (page.expectedEventCount !== page.totalEventCount) {
    throw new AuditIntegrityError(
      'Ожидаемое и фактическое число событий на сервере не совпадают.',
      readContexts,
    );
  }
  if (
    authoritative &&
    (page.commandId !== authoritative.commandId ||
      page.commandType !== authoritative.commandType ||
      page.expectedEventCount !== authoritative.expectedEventCount ||
      page.totalEventCount !== authoritative.totalEventCount)
  ) {
    throw new AuditIntegrityError(
      'Сервер изменил контрольные итоги между страницами аудита.',
      readContexts,
    );
  }
  if (
    page.events.some(
      (event) => event.correlationId !== correlationId || event.commandId !== page.commandId,
    )
  ) {
    throw new AuditIntegrityError('Связанный набор содержит событие другой команды.', readContexts);
  }
}

export function createAdminAuditClient(api: ApiClient, limit = 100): AdminAuditClient {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Размер страницы аудита должен быть целым числом от 1 до 100.');
  }

  return {
    async getWorkCardHistory(workCardId, signal) {
      const base = `/api/v1/work-cards/${encodeURIComponent(workCardId)}/history` as ApiV1Path;
      const events: AuditEvent[] = [];
      const readContexts: ApiRequestContext[] = [];
      const seenCursors = new Set<string>();
      const seenEventIds = new Set<string>();
      let cursor: string | null = null;

      do {
        const response: ApiResponse<AuditEventsPage> = await api.read({
          path: pagePath(base, cursor, limit),
          response: contractResponse(AuditEventsResponseSchema),
          ...optionalSignal(signal),
        });
        readContexts.push(response.context);
        const page: AuditEventsPage = response.data;
        assertWorkCardPage(page, workCardId, events.at(-1), readContexts);
        appendUniqueEvents(events, page.events, seenEventIds, readContexts);
        if (page.nextCursor && page.events.length === 0) {
          throw new AuditIntegrityError(
            'Сервер сообщил о продолжении пустой страницы. Полнота истории не подтверждена.',
            readContexts,
          );
        }
        assertNewCursor(page.nextCursor, seenCursors, readContexts);
        if (page.nextCursor) seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);

      return { events, readContexts };
    },

    async getCompleteCorrelation(correlationId, signal) {
      const base = `/api/v1/audit-correlations/${encodeURIComponent(correlationId)}` as ApiV1Path;
      const events: AuditEvent[] = [];
      const readContexts: ApiRequestContext[] = [];
      const seenCursors = new Set<string>();
      const seenEventIds = new Set<string>();
      let authoritative: AuditCorrelationPage | null = null;
      let cursor: string | null = null;

      do {
        const response: ApiResponse<AuditCorrelationPage> = await api.read({
          path: pagePath(base, cursor, limit),
          response: contractResponse(AuditCorrelationResponseSchema),
          ...optionalSignal(signal),
        });
        readContexts.push(response.context);
        const page: AuditCorrelationPage = response.data;
        assertCorrelationPage(page, correlationId, authoritative, readContexts);
        if (!authoritative) authoritative = page;
        const totals = authoritative;
        appendUniqueEvents(events, page.events, seenEventIds, readContexts);

        if (events.length > totals.totalEventCount) {
          throw new AuditIntegrityError(
            'Получено больше событий, чем подтверждает серверный итог.',
            readContexts,
          );
        }
        if (page.nextCursor && page.events.length === 0) {
          throw new AuditIntegrityError(
            'Сервер сообщил о продолжении пустой страницы. Полнота аудита не подтверждена.',
            readContexts,
          );
        }
        if (page.nextCursor && events.length >= totals.totalEventCount) {
          throw new AuditIntegrityError(
            'Сервер сообщил о лишней странице после достижения контрольного итога.',
            readContexts,
          );
        }
        assertNewCursor(page.nextCursor, seenCursors, readContexts);
        if (page.nextCursor) seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);

      if (!authoritative || events.length !== authoritative.totalEventCount) {
        throw new AuditIntegrityError(
          'Загружены не все события из подтверждённого сервером набора.',
          readContexts,
        );
      }

      return {
        commandId: authoritative.commandId,
        commandType: authoritative.commandType,
        correlationId: authoritative.correlationId,
        events,
        expectedEventCount: authoritative.expectedEventCount,
        readContexts,
        totalEventCount: authoritative.totalEventCount,
      };
    },
  };
}
