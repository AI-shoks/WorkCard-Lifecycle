import type { CommandName, Role } from '@work-card/contracts';

const commandOwner: Readonly<Record<CommandName, Role>> = {
  AcceptFirstArticle: 'QUALITY_CONTROLLER',
  AssignWorkCards: 'MASTER',
  CompleteWorkCard: 'MASTER',
  ConfirmWorkCardQuality: 'QUALITY_CONTROLLER',
  CreateProductionBatch: 'PLANNER',
  ExportWorkCardToPayroll: 'ADMIN_AUDITOR',
  RecordFinalBatchAcceptance: 'QUALITY_CONTROLLER',
  ReleaseWorkCards: 'PLANNER',
  StartWorkCard: 'MASTER',
};

export type CommandGuard =
  | Readonly<{ state: 'hidden' }>
  | Readonly<{ reason: string; state: 'disabled' }>
  | Readonly<{ state: 'enabled' }>;

export const missingSessionPermissionReason =
  'Серверная сессия не подтвердила полномочие для этого действия. Смените роль или войдите снова, чтобы обновить доступ.';

export function commandGuardFor(input: {
  command: CommandName;
  permissions: readonly CommandName[];
  role: Role;
  unavailableReason?: string | null;
}): CommandGuard {
  if (commandOwner[input.command] !== input.role) return { state: 'hidden' };

  if (!input.permissions.includes(input.command)) {
    return { reason: missingSessionPermissionReason, state: 'disabled' };
  }

  if (input.unavailableReason) {
    return { reason: input.unavailableReason, state: 'disabled' };
  }

  return { state: 'enabled' };
}

export function roleOwnsCommand(role: Role, command: CommandName): boolean {
  return commandOwner[command] === role;
}
