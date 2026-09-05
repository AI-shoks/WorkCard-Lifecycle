export const MAX_BATCH_QUANTITY = 2_147_483_647;

export type BatchQuantityValidation =
  Readonly<{ error: string; value: null }> | Readonly<{ error: null; value: number }>;

export function validateBatchQuantity(rawValue: string): BatchQuantityValidation {
  const value = rawValue.trim();
  if (!value) return { error: 'Введите количество изделий в партии.', value: null };
  if (!/^[0-9]+$/.test(value)) {
    return { error: 'Количество должно быть положительным целым числом.', value: null };
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_QUANTITY) {
    return {
      error: `Введите целое число от 1 до ${MAX_BATCH_QUANTITY.toLocaleString('ru-RU')}.`,
      value: null,
    };
  }

  return { error: null, value: parsed };
}
