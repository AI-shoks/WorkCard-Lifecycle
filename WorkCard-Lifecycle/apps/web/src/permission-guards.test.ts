import type { CommandName, Role } from '@work-card/contracts';
import { describe, expect, it } from 'vitest';

import {
  commandGuardFor,
  missingSessionPermissionReason,
  roleOwnsCommand,
} from './permission-guards.js';

const roleCommands: Readonly<Record<Role, readonly CommandName[]>> = {
  ADMIN_AUDITOR: ['ExportWorkCardToPayroll'],
  MASTER: ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard'],
  PLANNER: ['CreateProductionBatch', 'ReleaseWorkCards'],
  QUALITY_CONTROLLER: [
    'AcceptFirstArticle',
    'ConfirmWorkCardQuality',
    'RecordFinalBatchAcceptance',
  ],
  WORKER: [],
};

const commands = Object.values(roleCommands).flat();

describe('guards действий', () => {
  it.each(Object.entries(roleCommands) as [Role, readonly CommandName[]][])(
    'для роли %s оставляет видимыми только принадлежащие ей действия',
    (role, ownedCommands) => {
      for (const command of commands) {
        expect(roleOwnsCommand(role, command)).toBe(ownedCommands.includes(command));
        expect(
          commandGuardFor({ command, permissions: ownedCommands, role }).state === 'hidden',
        ).toBe(!ownedCommands.includes(command));
      }
    },
  );

  it('объясняет отсутствие полномочия в подтверждённой серверной проекции', () => {
    expect(
      commandGuardFor({ command: 'ReleaseWorkCards', permissions: [], role: 'PLANNER' }),
    ).toEqual({ reason: missingSessionPermissionReason, state: 'disabled' });
  });

  it('сохраняет точную предметную причину для действия своей роли', () => {
    expect(
      commandGuardFor({
        command: 'AssignWorkCards',
        permissions: roleCommands.MASTER,
        role: 'MASTER',
        unavailableReason: 'Сначала требуется положительная приёмка первой детали.',
      }),
    ).toEqual({
      reason: 'Сначала требуется положительная приёмка первой детали.',
      state: 'disabled',
    });
  });

  it('пересчитывает доступ из новой роли и новой permission-проекции без старого результата', () => {
    const beforeSwitch = commandGuardFor({
      command: 'ExportWorkCardToPayroll',
      permissions: roleCommands.ADMIN_AUDITOR,
      role: 'ADMIN_AUDITOR',
    });
    const afterSwitch = commandGuardFor({
      command: 'ExportWorkCardToPayroll',
      permissions: roleCommands.MASTER,
      role: 'MASTER',
    });

    expect(beforeSwitch.state).toBe('enabled');
    expect(afterSwitch.state).toBe('hidden');
  });
});
