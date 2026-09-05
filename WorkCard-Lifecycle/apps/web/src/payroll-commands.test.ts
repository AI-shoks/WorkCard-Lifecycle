import type {
  DemoSessionResponse,
  PayrollExportResponse,
  PayrollRecord,
  WorkCard,
} from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client.js';
import { PayrollCommandIntegrityError, createPayrollCommandClient } from './payroll-commands.js';

const cardId = '10000000-0000-4000-8000-000000000001';
const setId = '20000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000001';
const workerId = '40000000-0000-4000-8000-000000000001';
const auditorId = '50000000-0000-4000-8000-000000000001';
const recordId = '60000000-0000-4000-8000-000000000001';
const commandId = '70000000-0000-4000-8000-000000000001';
const correlationId = '80000000-0000-4000-8000-000000000001';

const session: DemoSessionResponse = {
  actor: {
    displayName: 'Администратор демонстрации',
    id: auditorId,
    role: 'ADMIN_AUDITOR',
    roleLabel: 'Администратор-аудитор',
  },
  csrfToken: 'csrf-token-with-at-least-thirty-two-characters',
  permissions: ['ExportWorkCardToPayroll'],
};

const card: WorkCard = {
  assignee: { displayName: 'Исполнитель Иванов', id: workerId },
  availableActions: ['ExportWorkCardToPayroll'],
  batchId,
  batchQuantitySnapshot: 112,
  closureType: 'SERIAL_QUALITY_CONFIRMATION',
  id: cardId,
  operation: {
    normHours: '0.80',
    scopeCode: 'OP-010-030',
    scopeName: 'Операции 010–030',
  },
  purpose: 'SERIAL',
  status: 'CLOSED',
  timestamps: {
    assignedAt: '2026-09-03T07:01:00.000Z',
    closedAt: '2026-09-03T07:04:00.000Z',
    completedAt: '2026-09-03T07:03:00.000Z',
    releasedAt: '2026-09-03T07:00:00.000Z',
    startedAt: '2026-09-03T07:02:00.000Z',
  },
  version: 5,
  workCardSetId: setId,
};

const record: PayrollRecord = {
  beneficiary: card.assignee!,
  commandId,
  exportedAt: '2026-09-03T08:00:00.000Z',
  exportedBy: { displayName: 'Администратор демонстрации', id: auditorId },
  id: recordId,
  normHoursSnapshot: '0.80',
  workCardId: cardId,
};

function jsonResponse(payload: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
    status,
  });
}

function client(fetchImplementation: typeof fetch) {
  const api = createApiClient({
    fetchImplementation,
    getConfirmedDemoSession: () => session,
  });
  return createPayrollCommandClient(api, () => commandId);
}

describe('идемпотентный тестовый учёт нормо-часов', () => {
  it('сначала читает существующую запись, затем сверяет её с карточкой', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(record, 200, 'record-read'))
      .mockResolvedValueOnce(jsonResponse(card, 200, 'card-read'));

    const workspace = await client(fetchMock).loadWorkspace(cardId);

    expect(workspace.record).toEqual(record);
    expect(workspace.readContexts).toEqual([
      { requestId: 'record-read' },
      { requestId: 'card-read' },
    ]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-cards/${cardId}/payroll-record`,
      `/api/v1/work-cards/${cardId}`,
    ]);
  });

  it('после 404 записи читает карточку и разрешает только явный первый export', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse(card));

    const workspace = await client(fetchMock).loadWorkspace(cardId);

    expect(workspace).toMatchObject({ card, record: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('считает первый export созданным только после совпадающего read-back записи', async () => {
    const command: PayrollExportResponse = { correlationId, payrollRecord: record };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(command, 201, 'command-request'))
      .mockResolvedValueOnce(jsonResponse(record, 200, 'read-back-request'));

    const result = await client(fetchMock).exportWorkCard(card);

    expect(result).toMatchObject({
      commandContext: { correlationId, requestId: 'command-request' },
      correlationId,
      outcome: 'created',
      readBackContext: { requestId: 'read-back-request' },
      record,
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-cards/${cardId}/payroll-export`,
      `/api/v1/work-cards/${cardId}/payroll-record`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      commandId,
      expectedCardVersion: 5,
    });
  });

  it('при replay возвращает existing и не выдаёт запись за новый export', async () => {
    const existingRecord = {
      ...record,
      commandId: '90000000-0000-4000-8000-000000000001',
    };
    const command: PayrollExportResponse = {
      correlationId,
      payrollRecord: existingRecord,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(command, 200))
      .mockResolvedValueOnce(jsonResponse(existingRecord));

    const result = await client(fetchMock).exportWorkCard(card);

    expect(result.outcome).toBe('existing');
    expect(result.record).toEqual(existingRecord);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не показывает успех при несовпавшем обязательном read-back', async () => {
    const command: PayrollExportResponse = { correlationId, payrollRecord: record };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(command, 201))
      .mockResolvedValueOnce(jsonResponse({ ...record, normHoursSnapshot: '1.25' }));

    await expect(client(fetchMock).exportWorkCard(card)).rejects.toBeInstanceOf(
      PayrollCommandIntegrityError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не отправляет export для незакрытой карточки', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      client(fetchMock).exportWorkCard({ ...card, status: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(PayrollCommandIntegrityError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
