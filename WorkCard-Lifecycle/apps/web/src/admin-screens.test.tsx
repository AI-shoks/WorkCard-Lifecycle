import type { AuditEvent, PayrollRecord, WorkCard } from '@work-card/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AuditIntegrityError, type CompleteAuditCorrelation } from './admin-audit.js';
import {
  AuditCorrelationPanel,
  PayrollReadyContent,
  PayrollRecordSummary,
} from './admin-screens.js';
import { matchAppRoute } from './app-routing.js';
import type { PayrollCommandClient, PayrollWorkspace } from './payroll-commands.js';

const cardId = '10000000-0000-4000-8000-000000000001';
const setId = '20000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000001';
const workerId = '40000000-0000-4000-8000-000000000001';
const auditorId = '50000000-0000-4000-8000-000000000001';
const recordId = '60000000-0000-4000-8000-000000000001';
const commandId = '70000000-0000-4000-8000-000000000001';
const correlationId = '80000000-0000-4000-8000-000000000001';

const card: WorkCard = {
  assignee: { displayName: 'Исполнитель Иванов', id: workerId },
  availableActions: ['ExportWorkCardToPayroll'],
  batchId,
  batchQuantitySnapshot: 112,
  closureType: 'SERIAL_QUALITY_CONFIRMATION',
  id: cardId,
  operation: { normHours: '0.80', scopeCode: 'OP-010', scopeName: 'Операции 010–030' },
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

function auditEvent(index: number, aggregateType = 'WorkCard'): AuditEvent {
  return {
    actorId: auditorId,
    actorRole: 'ADMIN_AUDITOR',
    aggregateId: cardId,
    aggregateType,
    aggregateVersion: index,
    commandId,
    correlationId,
    data: {},
    eventType: 'WorkCardExportedToPayroll',
    id: `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: `2026-09-03T08:00:0${index}.000Z`,
  };
}

describe('экраны администратора-аудитора', () => {
  it('показывает полный correlation success только с тремя совпавшими итогами', () => {
    const context: CompleteAuditCorrelation = {
      commandId,
      commandType: 'ReleaseWorkCards',
      correlationId,
      events: [auditEvent(1), auditEvent(2, 'WorkCardSet'), auditEvent(3, 'ProductionBatch')],
      expectedEventCount: 3,
      readContexts: [],
      totalEventCount: 3,
    };

    const markup = renderToStaticMarkup(
      <AuditCorrelationPanel onRetry={vi.fn()} state={{ data: context, phase: 'ready' }} />,
    );

    expect(markup).toContain('Полный набор событий подтверждён');
    expect(markup).toContain('клиент получил все 3 уникальных событий');
    expect(markup).toContain('Показать все подтверждённые события (3)');
  });

  it('при integrity error скрывает частичный набор и не показывает success', () => {
    const markup = renderToStaticMarkup(
      <AuditCorrelationPanel
        onRetry={vi.fn()}
        state={{
          correlationId,
          error: new AuditIntegrityError('неполный набор'),
          phase: 'error',
        }}
      />,
    );

    expect(markup).toContain('Полнота аудита не подтверждена');
    expect(markup).toContain('Неполный набор не показан как успешный');
    expect(markup).not.toContain('Полный набор событий подтверждён');
  });

  it('для replay называет запись существующей, а не новой', () => {
    const markup = renderToStaticMarkup(
      <PayrollRecordSummary card={card} outcome="existing" record={record} />,
    );

    expect(markup).toContain('Открыта существующая тестовая запись');
    expect(markup).toContain('Повтор не создал новую запись');
    expect(markup).not.toContain('Тестовая запись создана и перечитана');
  });

  it('при существующей записи не показывает кнопку нового export', () => {
    const route = matchAppRoute(`/work-cards/${cardId}/payroll`);
    if (route.kind !== 'screen') throw new Error('Ожидался маршрут тестового учёта.');
    const workspace: PayrollWorkspace = { card, readContexts: [], record };
    const markup = renderToStaticMarkup(
      <PayrollReadyContent
        initialWorkspace={workspace}
        onAnnounce={vi.fn()}
        onRefresh={vi.fn()}
        permissions={['ExportWorkCardToPayroll']}
        payrollClient={{} as PayrollCommandClient}
        route={route}
      />,
    );

    expect(markup).toContain('Перечитана с сервера');
    expect(markup).not.toContain('Создать тестовую запись нормо-часов');
  });

  it('не запускает export без подтверждённого сервером полномочия и объясняет блокировку', () => {
    const route = matchAppRoute(`/work-cards/${cardId}/payroll`);
    if (route.kind !== 'screen') throw new Error('Ожидался маршрут тестового учёта.');
    const workspace: PayrollWorkspace = { card, readContexts: [], record: null };
    const markup = renderToStaticMarkup(
      <PayrollReadyContent
        initialWorkspace={workspace}
        onAnnounce={vi.fn()}
        onRefresh={vi.fn()}
        permissions={[]}
        payrollClient={{} as PayrollCommandClient}
        route={route}
      />,
    );

    expect(markup).toContain('Серверная сессия не подтвердила полномочие');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('disabled=""');
  });
});
