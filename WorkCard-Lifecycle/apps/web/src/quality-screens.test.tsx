import type { ProductionBatchDetail, WorkCard } from '@work-card/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { matchAppRoute } from './app-routing.js';
import type { BatchCommandClient } from './batch-commands.js';
import type { MasterCommandClient } from './master-commands.js';
import type { QualityCommandClient } from './quality-commands.js';
import { BatchReadyContent, WorkCardReadyContent } from './read-only-screens.js';
import type { ReadModelClient } from './read-model.js';

const batchId = '10000000-0000-4000-8000-000000000001';
const setId = '20000000-0000-4000-8000-000000000001';
const cardId = '30000000-0000-4000-8000-000000000001';

const operationPlan = [112, 112, 26].map((plannedCardCount, index) => ({
  id: `40000000-0000-4000-8000-00000000000${index + 1}`,
  normHours: index === 0 ? '0.80' : index === 1 ? '1.25' : '0.55',
  plannedCardCount,
  position: index + 1,
  scopeCode: `OP-${index + 1}`,
  scopeName: `Группа операций ${index + 1}`,
}));

function batch(closedCardCount = 250): ProductionBatchDetail {
  return {
    availableActions: closedCardCount === 250 ? ['RecordFinalBatchAcceptance'] : [],
    counts: { actualCardCount: 250, closedCardCount, plannedCardCount: 250, setCount: 3 },
    createdAt: '2026-09-02T05:00:00.000Z',
    finalAcceptance: null,
    finalAcceptedAt: null,
    id: batchId,
    lifecycleStatus: 'RELEASED',
    operationPlan,
    passportSnapshot: { code: 'DEMO-250', productName: 'Учебное изделие', revision: 'A' },
    quantity: 112,
    releasedAt: '2026-09-02T05:01:00.000Z',
    sets: operationPlan.map((operation, index) => ({
      actualCardCount: operation.plannedCardCount,
      closedCardCount:
        index === 2 && closedCardCount !== 250
          ? Math.max(0, closedCardCount - 224)
          : operation.plannedCardCount,
      gateStatus: 'SERIAL_ALLOWED' as const,
      id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      normHours: operation.normHours,
      plannedCardCount: operation.plannedCardCount,
      scopeCode: operation.scopeCode,
      scopeName: operation.scopeName,
      version: 3,
    })),
    version: 2,
  };
}

function completedCard(purpose: 'FIRST_ARTICLE' | 'SERIAL'): WorkCard {
  return {
    assignee: {
      displayName: 'Исполнитель Иванов',
      id: '60000000-0000-4000-8000-000000000001',
    },
    availableActions: [
      purpose === 'FIRST_ARTICLE' ? 'AcceptFirstArticle' : 'ConfirmWorkCardQuality',
    ],
    batchId,
    batchQuantitySnapshot: 112,
    closureType: null,
    id: cardId,
    operation: {
      normHours: '0.80',
      scopeCode: 'OP-010-030',
      scopeName: 'Операции 010–030',
    },
    purpose,
    status: 'COMPLETED',
    timestamps: {
      assignedAt: '2026-09-02T05:01:00.000Z',
      closedAt: null,
      completedAt: '2026-09-02T05:03:00.000Z',
      releasedAt: '2026-09-02T05:00:00.000Z',
      startedAt: '2026-09-02T05:02:00.000Z',
    },
    version: 4,
    workCardSetId: setId,
  };
}

const batchCommands = {} as BatchCommandClient;
const masterCommands = {} as MasterCommandClient;
const qualityCommands = {} as QualityCommandClient;
const readModel = {} as ReadModelClient;

function renderBatch(currentBatch: ProductionBatchDetail, role: 'MASTER' | 'QUALITY_CONTROLLER') {
  const route = matchAppRoute(`/batches/${batchId}`);
  if (route.kind !== 'screen') throw new Error('Ожидался маршрут партии.');
  return renderToStaticMarkup(
    <BatchReadyContent
      batchCommands={batchCommands}
      initialBatch={currentBatch}
      navigate={vi.fn()}
      onAnnounce={vi.fn()}
      onRefresh={vi.fn()}
      permissions={
        role === 'QUALITY_CONTROLLER'
          ? ['AcceptFirstArticle', 'ConfirmWorkCardQuality', 'RecordFinalBatchAcceptance']
          : ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']
      }
      qualityCommands={qualityCommands}
      readModel={readModel}
      role={role}
      route={route}
    />,
  );
}

function renderCard(card: WorkCard, role: 'MASTER' | 'QUALITY_CONTROLLER') {
  const route = matchAppRoute(`/work-cards/${card.id}`);
  if (route.kind !== 'screen') throw new Error('Ожидался маршрут карточки.');
  return renderToStaticMarkup(
    <WorkCardReadyContent
      initialCard={card}
      masterCommands={masterCommands}
      navigate={vi.fn()}
      onAnnounce={vi.fn()}
      permissions={
        role === 'QUALITY_CONTROLLER'
          ? ['AcceptFirstArticle', 'ConfirmWorkCardQuality', 'RecordFinalBatchAcceptance']
          : ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']
      }
      qualityCommands={qualityCommands}
      readModel={readModel}
      role={role}
      route={route}
    />,
  );
}

describe('экраны positive-only контроля БТК', () => {
  it('показывает финальную команду БТК только при 3/3 и 250/250', () => {
    const markup = renderBatch(batch(), 'QUALITY_CONTROLLER');

    expect(markup).toContain('Первые детали:');
    expect(markup).toContain('3 из 3');
    expect(markup).toContain('Закрытые карточки:');
    expect(markup).toContain('250 из 250');
    expect(markup).toContain('Принять завершённую партию');
    expect(markup).not.toContain('disabled=""');
  });

  it('оставляет преждевременную финальную команду disabled с точной причиной', () => {
    const markup = renderBatch(batch(249), 'QUALITY_CONTROLLER');

    expect(markup).toContain('Финальная приёмка пока недоступна');
    expect(markup).toContain('подтверждено 249 из 250');
    expect(markup).toContain('disabled=""');
  });

  it('не показывает финальное действие другой производственной роли', () => {
    const markup = renderBatch(batch(), 'MASTER');

    expect(markup).not.toContain('>Принять завершённую партию<');
  });

  it('после приёмки показывает перечитанные контролёра, время и сверку ID', () => {
    const acceptedAt = '2026-09-02T05:05:00.000Z';
    const acceptedBatch: ProductionBatchDetail = {
      ...batch(),
      availableActions: [],
      finalAcceptance: {
        acceptedAt,
        batchId,
        commandId: '70000000-0000-4000-8000-000000000001',
        controller: {
          displayName: 'Контролёр БТК',
          id: '80000000-0000-4000-8000-000000000001',
        },
        id: '90000000-0000-4000-8000-000000000001',
        resultingBatchVersion: 3,
      },
      finalAcceptedAt: acceptedAt,
      lifecycleStatus: 'FINAL_ACCEPTED',
      version: 3,
    };
    const markup = renderBatch(acceptedBatch, 'QUALITY_CONTROLLER');

    expect(markup).toContain('Контролёр БТК');
    expect(markup).toContain('Время сервера:');
    expect(markup).toContain('Идентификатор записи сверён обязательным контрольным чтением');
    expect(markup).not.toContain('>Принять завершённую партию<');
  });

  it('различает отдельное подтверждение первой детали и каждой серийной карточки', () => {
    const firstArticleMarkup = renderCard(completedCard('FIRST_ARTICLE'), 'QUALITY_CONTROLLER');
    const serialMarkup = renderCard(completedCard('SERIAL'), 'QUALITY_CONTROLLER');

    expect(firstArticleMarkup).toContain('Принять первую деталь и открыть обработку партии');
    expect(serialMarkup).toContain('Подтвердить качество и закрыть карточку');
    expect(serialMarkup).toContain('Каждая завершённая карточка подтверждается отдельно');
    expect(serialMarkup).not.toContain('Отклонить');
    expect(renderCard(completedCard('SERIAL'), 'MASTER')).not.toContain(
      'Подтвердить качество и закрыть карточку',
    );
  });
});
