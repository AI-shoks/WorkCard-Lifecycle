import { ApiClientError } from './api-client.js';
import type { ReadModelClient } from './read-model.js';

export type CommandRecoveryCause = 'conflict' | 'integrity' | 'network-uncertainty';

export class CommandIntegrityError extends Error {
  readonly recoveryCause = 'integrity' as const;
}

export function commandRecoveryCause(error: unknown): CommandRecoveryCause | null {
  if (error instanceof CommandIntegrityError) return error.recoveryCause;
  if (!(error instanceof ApiClientError)) return null;

  if (error.status === 409) return 'conflict';
  if (error.kind === 'invalid-response') return 'integrity';
  if (error.kind === 'transport' || (error.status !== null && error.status >= 500)) {
    return 'network-uncertainty';
  }

  return null;
}

export function commandRecoveryDescription(error: unknown): string {
  switch (commandRecoveryCause(error)) {
    case 'conflict':
      return 'Данные изменились во время выполнения команды.';
    case 'integrity':
      return 'Ответ команды и контрольные данные не совпали.';
    case 'network-uncertainty':
      return 'Из-за сбоя связи исход команды не подтверждён.';
    default:
      return 'Команда не подтверждена.';
  }
}

export async function readAffectedAggregates<T extends readonly unknown[]>(readers: {
  readonly [Index in keyof T]: () => Promise<T[Index]>;
}): Promise<T> {
  const values = await Promise.all(readers.map((reader) => reader()));
  return values as unknown as T;
}

export async function recoverBatchCommand(
  readModel: ReadModelClient,
  batchId: string,
  signal?: AbortSignal,
) {
  const [batch] = await readAffectedAggregates([
    () => readModel.getBatch(batchId, signal),
  ] as const);
  return batch;
}

export async function recoverCreateBatchCommand(readModel: ReadModelClient, signal?: AbortSignal) {
  const [batches, passports] = await readAffectedAggregates([
    () => readModel.listBatches({ limit: 20, ...(signal ? { signal } : {}) }),
    () => readModel.listPassports(signal),
  ] as const);
  return { batches, passports };
}

export async function recoverAssignmentCommand(
  readModel: ReadModelClient,
  setId: string,
  cardIds: readonly string[],
  signal?: AbortSignal,
) {
  const uniqueCardIds = [...new Set(cardIds)];
  const [cardSet, cards] = await readAffectedAggregates([
    () => readModel.getWorkCardSet(setId, signal),
    () => Promise.all(uniqueCardIds.map((cardId) => readModel.getWorkCard(cardId, signal))),
  ] as const);

  if (
    cardSet.id !== setId ||
    cards.some((card, index) => card.workCardSetId !== setId || card.id !== uniqueCardIds[index])
  ) {
    throw new CommandIntegrityError(
      'Контрольное чтение вернуло карточку или комплект вне восстанавливаемой команды.',
    );
  }

  return { cards, set: cardSet };
}

export async function recoverWorkCardCommand(
  readModel: ReadModelClient,
  workCardId: string,
  workCardSetId: string,
  signal?: AbortSignal,
) {
  const [card, cardSet] = await readAffectedAggregates([
    () => readModel.getWorkCard(workCardId, signal),
    () => readModel.getWorkCardSet(workCardSetId, signal),
  ] as const);

  if (card.id !== workCardId || card.workCardSetId !== cardSet.id || cardSet.id !== workCardSetId) {
    throw new CommandIntegrityError(
      'Карточка и связанный комплект не совпали после контрольного чтения.',
    );
  }

  return { card, set: cardSet };
}
