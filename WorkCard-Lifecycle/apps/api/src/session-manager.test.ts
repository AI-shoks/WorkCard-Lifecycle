import type { CommandName, Role } from '@work-card/contracts';
import { describe, expect, it } from 'vitest';

import { roleCan } from './session-manager.js';

const roles: Role[] = ['PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR'];

const commandOwner: Record<CommandName, Role> = {
  CreateProductionBatch: 'PLANNER',
  ReleaseWorkCards: 'PLANNER',
  AssignWorkCards: 'MASTER',
  StartWorkCard: 'MASTER',
  CompleteWorkCard: 'MASTER',
  AcceptFirstArticle: 'QUALITY_CONTROLLER',
  ConfirmWorkCardQuality: 'QUALITY_CONTROLLER',
  RecordFinalBatchAcceptance: 'QUALITY_CONTROLLER',
  ExportWorkCardToPayroll: 'ADMIN_AUDITOR',
};

describe('trusted command permission matrix', () => {
  it('разрешает каждую backend-команду только принятой роли', () => {
    for (const [command, owner] of Object.entries(commandOwner) as [CommandName, Role][]) {
      for (const role of roles) {
        expect(roleCan(role, command), `${role} / ${command}`).toBe(role === owner);
      }
    }
  });
});
