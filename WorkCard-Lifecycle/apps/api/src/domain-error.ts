export type VersionConflict = {
  resourceType: string;
  resourceId: string;
  expectedVersion: number;
  actualVersion: number;
};

export class DomainError extends Error {
  readonly code: string;
  readonly conflicts?: VersionConflict[];
  readonly detail: string;
  readonly status: number;
  readonly title: string;

  constructor(options: {
    code: string;
    conflicts?: VersionConflict[];
    detail: string;
    status: number;
    title: string;
  }) {
    super(options.detail);
    this.name = 'DomainError';
    this.code = options.code;
    this.detail = options.detail;
    this.status = options.status;
    this.title = options.title;
    if (options.conflicts) this.conflicts = options.conflicts;
  }
}

export function authenticationRequired(): DomainError {
  return new DomainError({
    code: 'AUTHENTICATION_REQUIRED',
    detail: 'Выберите демонстрационную роль и повторите действие.',
    status: 401,
    title: 'Требуется вход',
  });
}

export function actionForbidden(): DomainError {
  return new DomainError({
    code: 'ACTION_FORBIDDEN',
    detail: 'Текущая роль не может выполнить это действие.',
    status: 403,
    title: 'Действие недоступно',
  });
}

export function resourceNotFound(): DomainError {
  return new DomainError({
    code: 'RESOURCE_NOT_FOUND',
    detail: 'Запрошенный ресурс отсутствует.',
    status: 404,
    title: 'Ресурс не найден',
  });
}

export function versionConflict(
  resourceType: string,
  resourceId: string,
  expectedVersion: number,
  actualVersion: number,
): DomainError {
  return new DomainError({
    code: 'VERSION_CONFLICT',
    conflicts: [{ resourceType, resourceId, expectedVersion, actualVersion }],
    detail: 'Обновите данные и повторите решение.',
    status: 409,
    title: 'Данные были изменены',
  });
}

export function stateConflict(detail: string): DomainError {
  return new DomainError({
    code: 'STATE_CONFLICT',
    detail,
    status: 409,
    title: 'Действие не соответствует текущему состоянию',
  });
}

export function gateClosed(): DomainError {
  return new DomainError({
    code: 'GATE_CLOSED',
    detail: 'Серийная работа станет доступна после положительной приёмки первой детали.',
    status: 409,
    title: 'Серийная работа пока недоступна',
  });
}

export function invalidBusinessInput(code: string, detail: string): DomainError {
  return new DomainError({
    code,
    detail,
    status: 422,
    title: 'Недопустимые данные команды',
  });
}
