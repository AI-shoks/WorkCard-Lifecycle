import type {
  BatchLifecycleStatus,
  ClosureType,
  GateStatus,
  Role,
  WorkCardPurpose,
  WorkCardStatus,
} from '@work-card/contracts';

export function emptyWorkCardsCopy(
  role: Role,
  filtersActive: boolean,
): Readonly<{ description: string; title: string }> {
  if (filtersActive) {
    return {
      description: 'Сервер не вернул карточек с выбранным состоянием и исполнителем.',
      title: 'Нет карточек с такими условиями',
    };
  }
  if (role === 'WORKER') {
    return {
      description: 'Для активного исполнителя в этом комплекте нет доступных назначений.',
      title: 'Нет доступных карточек',
    };
  }
  return {
    description: 'В комплекте пока нет выпущенных рабочих карточек.',
    title: 'Карточек пока нет',
  };
}

export const batchStatusLabels = {
  CREATED: 'Не выпущена',
  FINAL_ACCEPTED: 'Финальная приёмка выполнена',
  RELEASED: 'Выпущена',
} satisfies Record<BatchLifecycleStatus, string>;

export const gateStatusLabels = {
  FIRST_ARTICLE_PENDING: 'Ожидается первая деталь',
  SERIAL_ALLOWED: 'Обработка партии разрешена',
} satisfies Record<GateStatus, string>;

export const workCardStatusLabels = {
  ASSIGNED: 'Назначена исполнителю',
  CLOSED: 'Закрыта',
  COMPLETED: 'Работа завершена',
  IN_PROGRESS: 'Выполняется',
  RELEASED: 'Выпущена',
} satisfies Record<WorkCardStatus, string>;

export const workCardPurposeLabels = {
  FIRST_ARTICLE: 'Первая деталь',
  SERIAL: 'Обработка партии',
} satisfies Record<WorkCardPurpose, string>;

export const closureTypeLabels = {
  FIRST_ARTICLE_ACCEPTANCE: 'Приёмка первой детали',
  SERIAL_QUALITY_CONFIRMATION: 'Подтверждение качества карточки',
} satisfies Record<ClosureType, string>;

const numberFormatter = new Intl.NumberFormat('ru-RU');
const hoursFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatCount(value: number): string {
  return numberFormatter.format(value);
}

export function formatCardCount(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? 'карточек'
      : mod10 === 1
        ? 'карточка'
        : mod10 >= 2 && mod10 <= 4
          ? 'карточки'
          : 'карточек';
  return `${formatCount(value)} ${noun}`;
}

function nounForCount(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function formatProductCount(value: number): string {
  return `${formatCount(value)} ${nounForCount(value, 'изделие', 'изделия', 'изделий')}`;
}

export function formatSetCount(value: number): string {
  return `${formatCount(value)} ${nounForCount(value, 'комплект', 'комплекта', 'комплектов')}`;
}

export function formatReleasePreview(
  quantity: number,
  setCount: number,
  cardCount: number,
): string {
  return `${formatProductCount(quantity)} → ${formatSetCount(setCount)} → ${formatCardCount(cardCount)}`;
}

export function formatHours(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${hoursFormatter.format(parsed)} ч` : 'Норма не указана';
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Время не указано' : dateTimeFormatter.format(parsed);
}

export function statusTone(
  status: BatchLifecycleStatus | GateStatus | WorkCardStatus,
): 'neutral' | 'progress' | 'success' | 'warning' {
  if (status === 'FINAL_ACCEPTED' || status === 'CLOSED' || status === 'SERIAL_ALLOWED') {
    return 'success';
  }
  if (status === 'IN_PROGRESS' || status === 'COMPLETED' || status === 'ASSIGNED') {
    return 'progress';
  }
  if (status === 'CREATED' || status === 'FIRST_ARTICLE_PENDING') return 'warning';
  return 'neutral';
}
