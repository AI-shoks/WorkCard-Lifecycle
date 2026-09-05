import {
  PayrollExportResponseSchema,
  PayrollRecordSchema,
  WorkCardSchema,
  type CardVersionCommandBody,
  type PayrollRecord,
  type WorkCard,
} from '@work-card/contracts';

import {
  ApiClientError,
  contractResponse,
  type ApiClient,
  type ApiRequestContext,
  type ApiResponse,
  type ApiV1Path,
} from './api-client.js';
import { CommandIntegrityError } from './command-recovery.js';

export type PayrollWorkspace = Readonly<{
  card: WorkCard;
  readContexts: readonly ApiRequestContext[];
  record: PayrollRecord | null;
}>;

export type ConfirmedPayrollExport = Readonly<{
  commandContext: ApiRequestContext;
  correlationId: string;
  outcome: 'created' | 'existing';
  readBackContext: ApiRequestContext;
  record: PayrollRecord;
}>;

export type PayrollCommandClient = Readonly<{
  exportWorkCard: (card: WorkCard, signal?: AbortSignal) => Promise<ConfirmedPayrollExport>;
  loadWorkspace: (workCardId: string, signal?: AbortSignal) => Promise<PayrollWorkspace>;
}>;

export class PayrollCommandIntegrityError extends CommandIntegrityError {
  readonly commandContext: ApiRequestContext | null;
  readonly correlationId: string | null;
  readonly readBackContexts: readonly ApiRequestContext[];

  constructor(
    message: string,
    context: {
      commandContext?: ApiRequestContext;
      correlationId?: string;
      readBackContexts?: readonly ApiRequestContext[];
    } = {},
  ) {
    super(message);
    this.name = 'PayrollCommandIntegrityError';
    this.commandContext = context.commandContext ?? null;
    this.correlationId = context.correlationId ?? null;
    this.readBackContexts = context.readBackContexts ?? [];
  }
}

function cardPath(workCardId: string): ApiV1Path {
  return `/api/v1/work-cards/${encodeURIComponent(workCardId)}`;
}

function recordPath(workCardId: string): ApiV1Path {
  return `${cardPath(workCardId)}/payroll-record`;
}

function optionalSignal(signal?: AbortSignal): { signal: AbortSignal } | object {
  return signal ? { signal } : {};
}

function samePerson(
  left: PayrollRecord['beneficiary'],
  right: PayrollRecord['beneficiary'],
): boolean {
  return left.id === right.id && left.displayName === right.displayName;
}

function sameRecord(left: PayrollRecord, right: PayrollRecord): boolean {
  return (
    left.id === right.id &&
    left.workCardId === right.workCardId &&
    samePerson(left.beneficiary, right.beneficiary) &&
    left.normHoursSnapshot === right.normHoursSnapshot &&
    left.exportedBy.id === right.exportedBy.id &&
    left.exportedBy.displayName === right.exportedBy.displayName &&
    left.exportedAt === right.exportedAt &&
    left.commandId === right.commandId
  );
}

function recordMatchesCard(record: PayrollRecord, card: WorkCard): boolean {
  return (
    card.status === 'CLOSED' &&
    card.assignee !== null &&
    record.workCardId === card.id &&
    samePerson(record.beneficiary, card.assignee) &&
    record.normHoursSnapshot === card.operation.normHours
  );
}

export function payrollExportReadinessIssue(card: WorkCard): string | null {
  if (card.status !== 'CLOSED') {
    return 'Тестовая запись доступна только после закрытия карточки.';
  }
  if (!card.assignee) {
    return 'Для тестовой записи требуется подтверждённый исполнитель карточки.';
  }
  return null;
}

export function createPayrollCommandClient(
  api: ApiClient,
  createCommandId: () => string = () => globalThis.crypto.randomUUID(),
): PayrollCommandClient {
  return {
    async loadWorkspace(workCardId, signal) {
      let recordResponse: ApiResponse<PayrollRecord> | null = null;
      try {
        recordResponse = await api.read({
          path: recordPath(workCardId),
          response: contractResponse(PayrollRecordSchema),
          ...optionalSignal(signal),
        });
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 404) throw error;
      }

      const cardResponse = await api.read({
        path: cardPath(workCardId),
        response: contractResponse(WorkCardSchema),
        ...optionalSignal(signal),
      });
      const record = recordResponse?.data ?? null;
      const readContexts = [
        ...(recordResponse ? [recordResponse.context] : []),
        cardResponse.context,
      ];

      if (record && !recordMatchesCard(record, cardResponse.data)) {
        throw new PayrollCommandIntegrityError(
          'Существующая тестовая запись не совпала с карточкой и её снимком нормы.',
          { readBackContexts: readContexts },
        );
      }

      return { card: cardResponse.data, readContexts, record };
    },

    async exportWorkCard(card, signal) {
      const readinessIssue = payrollExportReadinessIssue(card);
      if (readinessIssue) throw new PayrollCommandIntegrityError(readinessIssue);

      const commandId = createCommandId();
      const body: CardVersionCommandBody = {
        commandId,
        expectedCardVersion: card.version,
      };
      const completion = await api.mutate({
        body,
        path: `${cardPath(card.id)}/payroll-export`,
        readBack: () => ({
          path: recordPath(card.id),
          response: contractResponse(PayrollRecordSchema),
        }),
        response: contractResponse(PayrollExportResponseSchema),
        ...optionalSignal(signal),
      });
      const command = completion.command.data;
      const record = completion.readBack.data;
      const outcome = completion.command.status === 201 ? 'created' : 'existing';
      const context = {
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContexts: [completion.readBack.context],
      };

      if (!sameRecord(command.payrollRecord, record)) {
        throw new PayrollCommandIntegrityError(
          'Контрольное чтение тестовой записи не совпало с ответом команды.',
          context,
        );
      }
      if (!recordMatchesCard(record, card)) {
        throw new PayrollCommandIntegrityError(
          'Тестовая запись не подтверждает исполнителя и норму выбранной карточки.',
          context,
        );
      }
      if (outcome === 'created' && record.commandId !== commandId) {
        throw new PayrollCommandIntegrityError(
          'Созданная запись не связана с отправленной командой.',
          context,
        );
      }

      return {
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        outcome,
        readBackContext: completion.readBack.context,
        record,
      };
    },
  };
}
