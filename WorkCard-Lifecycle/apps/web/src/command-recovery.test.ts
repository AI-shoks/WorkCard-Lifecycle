import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from './api-client.js';
import {
  CommandIntegrityError,
  commandRecoveryCause,
  commandRecoveryDescription,
  recoverAssignmentCommand,
  recoverBatchCommand,
  recoverCreateBatchCommand,
  recoverWorkCardCommand,
  readAffectedAggregates,
} from './command-recovery.js';
import type { ReadModelClient } from './read-model.js';

describe('восстановление после неподтверждённой команды', () => {
  it('отделяет conflict, сетевую неопределённость и ошибку целостности', () => {
    expect(
      commandRecoveryCause(
        new ApiClientError({ kind: 'http-problem', message: 'conflict', status: 409 }),
      ),
    ).toBe('conflict');
    expect(
      commandRecoveryCause(new ApiClientError({ kind: 'transport', message: 'network' })),
    ).toBe('network-uncertainty');
    expect(
      commandRecoveryCause(
        new ApiClientError({ kind: 'http-error', message: 'unavailable', status: 503 }),
      ),
    ).toBe('network-uncertainty');
    expect(commandRecoveryCause(new CommandIntegrityError('integrity'))).toBe('integrity');
    expect(
      commandRecoveryCause(
        new ApiClientError({ kind: 'http-problem', message: 'validation', status: 422 }),
      ),
    ).toBeNull();
    expect(
      commandRecoveryDescription(
        new ApiClientError({ kind: 'http-problem', message: 'conflict', status: 409 }),
      ),
    ).toBe('Данные изменились во время выполнения команды.');
  });

  it('перечитывает каждый затронутый агрегат ровно один раз и возвращает полный набор', async () => {
    const readCard = vi.fn(async () => ({ id: 'card', version: 3 }));
    const readSet = vi.fn(async () => ({ id: 'set', version: 4 }));

    await expect(readAffectedAggregates([readCard, readSet] as const)).resolves.toEqual([
      { id: 'card', version: 3 },
      { id: 'set', version: 4 },
    ]);
    expect(readCard).toHaveBeenCalledTimes(1);
    expect(readSet).toHaveBeenCalledTimes(1);
  });

  it('не возвращает частичный результат и не повторяет упавшее чтение', async () => {
    const readCard = vi.fn(async () => ({ id: 'card' }));
    const readSet = vi.fn(async () => {
      throw new Error('read failed');
    });

    await expect(readAffectedAggregates([readCard, readSet] as const)).rejects.toThrow(
      'read failed',
    );
    expect(readCard).toHaveBeenCalledTimes(1);
    expect(readSet).toHaveBeenCalledTimes(1);
  });

  it('для массовой команды перечитывает комплект и каждую выбранную карточку', async () => {
    const getWorkCardSet = vi.fn(async () => ({ id: 'set' }));
    const getWorkCard = vi.fn(async (id: string) => ({ id, workCardSetId: 'set' }));
    const readModel = { getWorkCard, getWorkCardSet } as unknown as ReadModelClient;

    const result = await recoverAssignmentCommand(readModel, 'set', ['card-1', 'card-2']);

    expect(result.cards.map((card) => card.id)).toEqual(['card-1', 'card-2']);
    expect(getWorkCardSet).toHaveBeenCalledTimes(1);
    expect(getWorkCard).toHaveBeenCalledTimes(2);
  });

  it('для выпуска и финальной приёмки перечитывает полную проекцию партии', async () => {
    const getBatch = vi.fn(async () => ({ id: 'batch', sets: [{ id: 'set' }] }));
    const readModel = { getBatch } as unknown as ReadModelClient;

    await expect(recoverBatchCommand(readModel, 'batch')).resolves.toMatchObject({
      id: 'batch',
      sets: [{ id: 'set' }],
    });
    expect(getBatch).toHaveBeenCalledTimes(1);
  });

  it('отклоняет несогласованный recovery-набор вместо частичного применения', async () => {
    const getWorkCardSet = vi.fn(async () => ({ id: 'set' }));
    const getWorkCard = vi.fn(async () => ({ id: 'other-card', workCardSetId: 'set' }));
    const readModel = { getWorkCard, getWorkCardSet } as unknown as ReadModelClient;

    await expect(recoverAssignmentCommand(readModel, 'set', ['card'])).rejects.toBeInstanceOf(
      CommandIntegrityError,
    );
  });

  it('для карточной команды перечитывает карточку и связанный комплект', async () => {
    const getWorkCard = vi.fn(async () => ({ id: 'card', workCardSetId: 'set' }));
    const getWorkCardSet = vi.fn(async () => ({ id: 'set' }));
    const readModel = { getWorkCard, getWorkCardSet } as unknown as ReadModelClient;

    await expect(recoverWorkCardCommand(readModel, 'card', 'set')).resolves.toMatchObject({
      card: { id: 'card' },
      set: { id: 'set' },
    });
    expect(getWorkCard).toHaveBeenCalledTimes(1);
    expect(getWorkCardSet).toHaveBeenCalledTimes(1);
  });

  it('после неопределённого создания перечитывает список партий и паспорта без новой команды', async () => {
    const listBatches = vi.fn(async () => ({ items: [], nextCursor: null }));
    const listPassports = vi.fn(async () => ({ items: [], nextCursor: null }));
    const readModel = { listBatches, listPassports } as unknown as ReadModelClient;

    await expect(recoverCreateBatchCommand(readModel)).resolves.toMatchObject({
      batches: { items: [] },
      passports: { items: [] },
    });
    expect(listBatches).toHaveBeenCalledTimes(1);
    expect(listPassports).toHaveBeenCalledTimes(1);
  });
});
