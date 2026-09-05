import type { WorkCard, WorkCardSetDetail } from '@work-card/contracts';

export function selectAvailableWorkCards(
  cards: readonly WorkCard[],
  count: number,
): ReadonlySet<string> {
  if (!Number.isInteger(count) || count < 1) return new Set();
  return new Set(
    cards
      .filter((card) => card.status === 'RELEASED')
      .slice(0, count)
      .map((card) => card.id),
  );
}

export function confirmedAssignmentEquation(
  assignments: WorkCardSetDetail['assignmentCounts'],
): string {
  const counts = assignments.map((assignment) => assignment.count);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return counts.length > 0 ? `${counts.join(' + ')} = ${total}` : `0 = ${total}`;
}
