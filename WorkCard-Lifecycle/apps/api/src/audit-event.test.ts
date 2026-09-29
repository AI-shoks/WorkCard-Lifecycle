import { describe, expect, it } from 'vitest';

import { assertValidAuditInsert, type AuditInsert } from './audit-event.js';

const aggregateId = '11111111-1111-4111-8111-111111111111';
const relatedId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const operationScope = { code: 'OP-1', name: 'Обработка' };
const envelope = { aggregateId, aggregateVersion: 1 };
const samples: AuditInsert[] = [
  {
    ...envelope,
    eventType: 'ProductionBatchCreated',
    aggregateType: 'ProductionBatch',
    data: {
      batchId: aggregateId,
      quantity: 10,
      passportSnapshot: { code: 'P-1', revision: 'A', productName: 'Изделие' },
    },
  },
  {
    ...envelope,
    eventType: 'ProductionBatchReleased',
    aggregateType: 'ProductionBatch',
    data: {
      batchId: aggregateId,
      workCardSetIds: [aggregateId, relatedId, actorId],
      setCount: 3,
      cardCountTotal: 250,
    },
  },
  {
    ...envelope,
    eventType: 'WorkCardSetCreated',
    aggregateType: 'WorkCardSet',
    data: {
      setId: aggregateId,
      batchId: relatedId,
      operationScope,
      normHours: '1.25',
      plannedCardCount: 5,
      gateStatus: 'FIRST_ARTICLE_PENDING',
    },
  },
  {
    ...envelope,
    eventType: 'WorkCardReleased',
    aggregateType: 'WorkCard',
    data: {
      workCardId: aggregateId,
      setId: relatedId,
      batchId: relatedId,
      batchQuantitySnapshot: 10,
      operationScope,
      normHours: '2.00',
      status: 'RELEASED',
    },
  },
  {
    ...envelope,
    eventType: 'FirstArticleWorkCardSelected',
    aggregateType: 'WorkCardSet',
    data: { setId: aggregateId, workCardId: relatedId, gateStatus: 'FIRST_ARTICLE_PENDING' },
  },
  ...(['FIRST_ARTICLE', 'SERIAL'] as const).map((purpose): AuditInsert => ({
    ...envelope,
    eventType: 'WorkCardAssigned',
    aggregateType: 'WorkCard',
    data: { workCardId: aggregateId, assigneeId: actorId, purpose, status: 'ASSIGNED' },
  })),
  {
    ...envelope,
    eventType: 'WorkCardStarted',
    aggregateType: 'WorkCard',
    data: {
      workCardId: aggregateId,
      assigneeId: actorId,
      recordedByMasterId: relatedId,
      status: 'IN_PROGRESS',
    },
  },
  {
    ...envelope,
    eventType: 'WorkCardCompleted',
    aggregateType: 'WorkCard',
    data: {
      workCardId: aggregateId,
      assigneeId: actorId,
      recordedByMasterId: relatedId,
      status: 'COMPLETED',
    },
  },
  ...(['FIRST_ARTICLE', 'SERIAL'] as const).map((acceptanceType): AuditInsert => ({
    ...envelope,
    eventType: 'WorkCardQualityConfirmed',
    aggregateType: 'WorkCard',
    data: {
      workCardId: aggregateId,
      controllerId: actorId,
      confirmationScope: 'WORK_CARD',
      acceptanceType,
      resultingStatus: 'CLOSED',
    },
  })),
  {
    ...envelope,
    eventType: 'FirstArticleAccepted',
    aggregateType: 'WorkCardSet',
    data: { setId: aggregateId, workCardId: relatedId, resultingGateStatus: 'SERIAL_ALLOWED' },
  },
  {
    ...envelope,
    eventType: 'FinalBatchAccepted',
    aggregateType: 'ProductionBatch',
    data: {
      acceptanceId: relatedId,
      batchId: aggregateId,
      controllerId: actorId,
      acceptedAt: '2026-09-27T10:00:00.000Z',
      resultingBatchStatus: 'FINAL_ACCEPTED',
      resultingBatchVersion: 1,
    },
  },
  {
    ...envelope,
    eventType: 'WorkCardExportedToPayroll',
    aggregateType: 'PayrollRecord',
    data: {
      payrollRecordId: aggregateId,
      workCardId: relatedId,
      beneficiaryId: actorId,
      normHours: '2',
    },
  },
];

function sample(eventType: AuditInsert['eventType']): AuditInsert {
  const event = samples.find((item) => item.eventType === eventType);
  if (!event) throw new Error(`Отсутствует fixture ${eventType}`);
  return event;
}

describe('typed audit payloads', () => {
  it.each(samples)('принимает существующий payload $eventType', (event) => {
    expect(() => assertValidAuditInsert(event)).not.toThrow();
  });

  it.each(samples)('отклоняет отсутствие любого обязательного поля $eventType', (event) => {
    for (const key of Object.keys(event.data)) {
      const data: Record<string, unknown> = { ...event.data };
      delete data[key];
      expect(() => assertValidAuditInsert({ ...event, data }), key).toThrow();
    }
  });

  it.each(samples)('отклоняет неверную форму, aggregate и identity $eventType', (event) => {
    for (const data of [null, [], 'payload', {}, { ...event.data, unexpected: true }]) {
      expect(() => assertValidAuditInsert({ ...event, data })).toThrow();
    }
    expect(() => assertValidAuditInsert({ ...event, aggregateType: 'Unknown' })).toThrow();
    expect(() => assertValidAuditInsert({ ...event, aggregateId: relatedId })).toThrow();
  });

  it.each<[AuditInsert['eventType'], Record<string, unknown>]>([
    ['ProductionBatchCreated', { quantity: 0 }],
    ['ProductionBatchCreated', { quantity: 1.5 }],
    ['ProductionBatchCreated', { passportSnapshot: { code: 'P-1', revision: 'A' } }],
    [
      'ProductionBatchCreated',
      { passportSnapshot: { code: ' ', revision: 'A', productName: 'P' } },
    ],
    ['ProductionBatchReleased', { setCount: -1 }],
    ['ProductionBatchReleased', { cardCountTotal: '250' }],
    ['ProductionBatchReleased', { workCardSetIds: [] }],
    ['ProductionBatchReleased', { workCardSetIds: relatedId }],
    ['ProductionBatchReleased', { workCardSetIds: [aggregateId, relatedId, 'not-a-uuid'] }],
    ['ProductionBatchReleased', { workCardSetIds: [aggregateId, relatedId, relatedId] }],
    ['ProductionBatchReleased', { workCardSetIds: [relatedId] }],
    ['ProductionBatchReleased', { workCardSetIds: Array(3) }],
    ['WorkCardSetCreated', { plannedCardCount: 0 }],
    ['WorkCardSetCreated', { operationScope: { code: 'OP-1', name: '' } }],
    ['WorkCardSetCreated', { gateStatus: 'SERIAL_ALLOWED' }],
    ['WorkCardReleased', { setId: 'not-a-uuid' }],
    ['WorkCardReleased', { batchQuantitySnapshot: 0 }],
    ['WorkCardReleased', { status: 'ASSIGNED' }],
    ['FirstArticleWorkCardSelected', { workCardId: null }],
    ['FirstArticleWorkCardSelected', { gateStatus: 'SERIAL_ALLOWED' }],
    ['WorkCardAssigned', { purpose: 'UNKNOWN' }],
    ['WorkCardAssigned', { assigneeId: '' }],
    ['WorkCardAssigned', { status: 'RELEASED' }],
    ['WorkCardStarted', { assigneeId: null }],
    ['WorkCardStarted', { status: 'COMPLETED' }],
    ['WorkCardCompleted', { recordedByMasterId: 'MASTER' }],
    ['WorkCardCompleted', { status: 'IN_PROGRESS' }],
    ['WorkCardQualityConfirmed', { controllerId: null }],
    ['WorkCardQualityConfirmed', { confirmationScope: 'BATCH' }],
    ['WorkCardQualityConfirmed', { acceptanceType: 'UNKNOWN' }],
    ['WorkCardQualityConfirmed', { resultingStatus: 'COMPLETED' }],
    ['FirstArticleAccepted', { resultingGateStatus: 'FIRST_ARTICLE_PENDING' }],
    ['FinalBatchAccepted', { acceptanceId: 'not-a-uuid' }],
    ['FinalBatchAccepted', { acceptedAt: '2026-02-30T10:00:00Z' }],
    ['FinalBatchAccepted', { acceptedAt: '2026-09-27T10:00:00+03:00' }],
    ['FinalBatchAccepted', { resultingBatchStatus: 'RELEASED' }],
    ['FinalBatchAccepted', { resultingBatchVersion: 2 }],
    ['WorkCardExportedToPayroll', { beneficiaryId: null }],
    ['WorkCardExportedToPayroll', { normHours: 2 }],
    ['WorkCardExportedToPayroll', { normHours: '0.00' }],
    ['WorkCardExportedToPayroll', { normHours: '-1' }],
    ['WorkCardExportedToPayroll', { normHours: '1.234' }],
  ])('отклоняет неверное содержимое %s: %j', (eventType, invalidFields) => {
    const event = sample(eventType);
    expect(() =>
      assertValidAuditInsert({ ...event, data: { ...event.data, ...invalidFields } }),
    ).toThrow();
  });

  it('отклоняет некорректный envelope и неизвестный тип события', () => {
    const event = sample('ProductionBatchCreated');
    for (const value of [null, undefined, [], 'event']) {
      expect(() => assertValidAuditInsert(value)).toThrow();
    }
    for (const eventType of ['', 'Unknown', 'toString', '__proto__', null]) {
      expect(() => assertValidAuditInsert({ ...event, eventType })).toThrow();
    }
    for (const aggregateId of ['', 'not-a-uuid', null]) {
      expect(() => assertValidAuditInsert({ ...event, aggregateId })).toThrow();
    }
    for (const aggregateVersion of [0, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertValidAuditInsert({ ...event, aggregateVersion })).toThrow();
    }
  });
});
