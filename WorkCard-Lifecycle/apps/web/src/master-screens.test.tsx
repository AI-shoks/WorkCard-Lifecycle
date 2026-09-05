import type { WorkCard, WorkCardSetDetail } from '@work-card/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { matchAppRoute } from './app-routing.js';
import type { MasterCommandClient } from './master-commands.js';
import type { QualityCommandClient } from './quality-commands.js';
import { confirmedAssignmentEquation, selectAvailableWorkCards } from './master-selection.js';
import { WorkCardReadyContent } from './read-only-screens.js';
import type { ReadModelClient } from './read-model.js';

const setId = '20000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000001';

function workCard(index: number, status: WorkCard['status'] = 'RELEASED'): WorkCard {
  return {
    assignee:
      status === 'RELEASED'
        ? null
        : {
            displayName: 'Исполнитель Иванов',
            id: '10000000-0000-4000-8000-000000000003',
          },
    availableActions: status === 'ASSIGNED' ? ['StartWorkCard'] : [],
    batchId,
    batchQuantitySnapshot: 112,
    closureType: null,
    id: `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    operation: {
      normHours: '0.80',
      scopeCode: 'OP-010-030',
      scopeName: 'Операции 010–030',
    },
    purpose: status === 'RELEASED' ? null : 'SERIAL',
    status,
    timestamps: {
      assignedAt: status === 'RELEASED' ? null : '2026-09-02T05:01:00.000Z',
      closedAt: null,
      completedAt: null,
      releasedAt: '2026-09-02T05:00:00.000Z',
      startedAt: null,
    },
    version: status === 'RELEASED' ? 1 : 2,
    workCardSetId: setId,
  };
}

const masterCommands = {
  assignWorkCards: vi.fn(),
  completeWorkCard: vi.fn(),
  startWorkCard: vi.fn(),
} as unknown as MasterCommandClient;
const qualityCommands = {} as QualityCommandClient;
const readModel = {} as ReadModelClient;

describe('мастерский выбор и lifecycle controls', () => {
  it('выбирает заданное число только свободных карточек без диапазонов деталей', () => {
    const cards = [
      workCard(1, 'ASSIGNED'),
      ...Array.from({ length: 60 }, (_, i) => workCard(i + 2)),
    ];

    const selected = selectAvailableWorkCards(cards, 59);

    expect(selected.size).toBe(59);
    expect(selected.has(cards[0]!.id)).toBe(false);
    expect(selected.has(cards.at(-1)!.id)).toBe(false);
  });

  it('строит итог 1 + 59 + 52 только из подтверждённой сводки комплекта', () => {
    const assignments: WorkCardSetDetail['assignmentCounts'] = [
      {
        assignee: { displayName: 'Исполнитель Иванов', id: '10000000-0000-4000-8000-000000000003' },
        count: 1,
        purpose: 'FIRST_ARTICLE',
      },
      {
        assignee: { displayName: 'Исполнитель Иванов', id: '10000000-0000-4000-8000-000000000003' },
        count: 59,
        purpose: 'SERIAL',
      },
      {
        assignee: { displayName: 'Исполнитель Петров', id: '10000000-0000-4000-8000-000000000004' },
        count: 52,
        purpose: 'SERIAL',
      },
    ];

    expect(confirmedAssignmentEquation(assignments)).toBe('1 + 59 + 52 = 112');
  });

  it('показывает start мастеру и оставляет исполнителю read-only объяснение', () => {
    const route = matchAppRoute(`/work-cards/${workCard(1).id}`);
    if (route.kind !== 'screen') throw new Error('Ожидался маршрут карточки.');
    const assigned = workCard(1, 'ASSIGNED');
    const masterMarkup = renderToStaticMarkup(
      <WorkCardReadyContent
        initialCard={assigned}
        masterCommands={masterCommands}
        navigate={vi.fn()}
        onAnnounce={vi.fn()}
        permissions={['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']}
        qualityCommands={qualityCommands}
        readModel={readModel}
        role="MASTER"
        route={route}
      />,
    );
    const workerMarkup = renderToStaticMarkup(
      <WorkCardReadyContent
        initialCard={{ ...assigned, availableActions: [] }}
        masterCommands={masterCommands}
        navigate={vi.fn()}
        onAnnounce={vi.fn()}
        permissions={[]}
        qualityCommands={qualityCommands}
        readModel={readModel}
        role="WORKER"
        route={route}
      />,
    );

    expect(masterMarkup).toContain('Зафиксировать начало');
    expect(masterMarkup).toContain('Исполнитель Иванов');
    expect(workerMarkup).toContain('Исполнитель видит назначение только для просмотра');
    expect(workerMarkup).not.toContain('>Зафиксировать начало<');
    expect(workerMarkup).not.toContain('>Зафиксировать завершение<');
  });

  it('показывает мастеру точную причину недоступного начала и скрывает мастерскую панель от ПДБ', () => {
    const route = matchAppRoute(`/work-cards/${workCard(1).id}`);
    if (route.kind !== 'screen') throw new Error('Ожидался маршрут карточки.');
    const assignedWithoutGate = { ...workCard(1, 'ASSIGNED'), availableActions: [] };
    const commonProps = {
      initialCard: assignedWithoutGate,
      masterCommands,
      navigate: vi.fn(),
      onAnnounce: vi.fn(),
      qualityCommands,
      readModel,
      route,
    };
    const masterMarkup = renderToStaticMarkup(
      <WorkCardReadyContent
        {...commonProps}
        permissions={['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']}
        role="MASTER"
      />,
    );
    const plannerMarkup = renderToStaticMarkup(
      <WorkCardReadyContent
        {...commonProps}
        permissions={['CreateProductionBatch', 'ReleaseWorkCards']}
        role="PLANNER"
      />,
    );

    expect(masterMarkup).toContain('назначение или допуск обработки партии не подтверждены');
    expect(masterMarkup).toContain('aria-describedby=');
    expect(masterMarkup).toContain('disabled=""');
    expect(plannerMarkup).not.toContain('Ведение рабочей карточки');
    expect(plannerMarkup).not.toContain('Зафиксировать начало');
  });
});
