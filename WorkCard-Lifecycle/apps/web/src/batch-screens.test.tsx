import type { CommandName, ProductionBatchDetail } from '@work-card/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { matchAppRoute } from './app-routing.js';
import type { BatchCommandClient } from './batch-commands.js';
import type { QualityCommandClient } from './quality-commands.js';
import { BatchReadyContent } from './read-only-screens.js';
import type { ReadModelClient } from './read-model.js';

const operationPlan = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    normHours: '0.80',
    plannedCardCount: 112,
    position: 1,
    scopeCode: 'OP-010-030',
    scopeName: 'Операции 010–030',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    normHours: '1.25',
    plannedCardCount: 112,
    position: 2,
    scopeCode: 'OP-040-060',
    scopeName: 'Операции 040–060',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    normHours: '0.55',
    plannedCardCount: 26,
    position: 3,
    scopeCode: 'OP-070',
    scopeName: 'Операция 070',
  },
] as const;

const createdBatch: ProductionBatchDetail = {
  availableActions: ['ReleaseWorkCards'],
  counts: { actualCardCount: 0, closedCardCount: 0, plannedCardCount: 250, setCount: 0 },
  createdAt: '2026-09-02T05:00:00.000Z',
  finalAcceptance: null,
  finalAcceptedAt: null,
  id: '20000000-0000-4000-8000-000000000001',
  lifecycleStatus: 'CREATED',
  operationPlan: [...operationPlan],
  passportSnapshot: {
    code: 'DEMO-250',
    productName: 'Учебное изделие',
    revision: 'A',
  },
  quantity: 112,
  releasedAt: null,
  sets: [],
  version: 1,
};

const releasedBatch: ProductionBatchDetail = {
  ...createdBatch,
  availableActions: [],
  counts: { actualCardCount: 250, closedCardCount: 0, plannedCardCount: 250, setCount: 3 },
  lifecycleStatus: 'RELEASED',
  releasedAt: '2026-09-02T05:01:00.000Z',
  sets: operationPlan.map((operation, index) => ({
    actualCardCount: operation.plannedCardCount,
    closedCardCount: 0,
    gateStatus: 'FIRST_ARTICLE_PENDING' as const,
    id: `30000000-0000-4000-8000-00000000000${index + 1}`,
    normHours: operation.normHours,
    plannedCardCount: operation.plannedCardCount,
    scopeCode: operation.scopeCode,
    scopeName: operation.scopeName,
    version: 1,
  })),
  version: 2,
};

const batchCommands = {
  createBatch: vi.fn(),
  releaseBatch: vi.fn(),
} as unknown as BatchCommandClient;
const readModel = {} as ReadModelClient;
const qualityCommands = {} as QualityCommandClient;
const route = matchAppRoute(`/batches/${createdBatch.id}`);

function renderBatch(
  batch: ProductionBatchDetail,
  role: 'MASTER' | 'PLANNER' = 'PLANNER',
  permissions: readonly CommandName[] = role === 'PLANNER'
    ? (['CreateProductionBatch', 'ReleaseWorkCards'] as const)
    : (['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard'] as const),
) {
  if (route.kind !== 'screen') throw new Error('Ожидался маршрут партии.');
  return renderToStaticMarkup(
    <BatchReadyContent
      batchCommands={batchCommands}
      initialBatch={batch}
      navigate={vi.fn()}
      onAnnounce={vi.fn()}
      onRefresh={vi.fn()}
      permissions={permissions}
      qualityCommands={qualityCommands}
      readModel={readModel}
      role={role}
      route={route}
    />,
  );
}

describe('экраны создания и выпуска партии для ПДБ', () => {
  it('показывает preview 112 → 3 → 250 и единственное действие выпуска роли ПДБ', () => {
    const markup = renderBatch(createdBatch);

    expect(markup).toContain('112 изделий');
    expect(markup).toContain('3 комплекта');
    expect(markup).toContain('250 карточек');
    expect(markup).toContain('Выпустить все комплекты');
    expect(markup).toContain('План комплектов');
  });

  it('полностью скрывает действие выпуска от чужой роли', () => {
    const markup = renderBatch(createdBatch, 'MASTER');

    expect(markup).not.toContain('Атомарный выпуск карточек');
    expect(markup).not.toContain('Выпустить все комплекты');
    expect(markup).not.toContain('<button class="button button--primary"');
  });

  it('блокирует действие своей роли с причиной, если серверная сессия не дала полномочие', () => {
    const markup = renderBatch(createdBatch, 'PLANNER', []);

    expect(markup).toContain('Серверная сессия не подтвердила полномочие');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('disabled=""');
  });

  it('убирает повторный выпуск после подтверждённого полного read-back', () => {
    const markup = renderBatch(releasedBatch);

    expect(markup).toContain('Партия уже выпущена; повторный выпуск недоступен');
    expect(markup).toContain('disabled=""');
  });

  it('не показывает ложный успех при частичном составе', () => {
    const partialBatch: ProductionBatchDetail = {
      ...releasedBatch,
      counts: { ...releasedBatch.counts, actualCardCount: 249 },
      sets: releasedBatch.sets.map((cardSet, index) =>
        index === 2 ? { ...cardSet, actualCardCount: 25 } : cardSet,
      ),
    };
    const markup = renderBatch(partialBatch);

    expect(markup).toContain('Данные партии не прошли проверку целостности');
    expect(markup).toContain('Успех не подтверждён');
    expect(markup).not.toContain('Полный выпуск подтверждён текущими данными сервера');
  });
});
