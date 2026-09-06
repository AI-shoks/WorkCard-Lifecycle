import { describe, expect, it } from 'vitest';

import { MAX_BATCH_QUANTITY, validateBatchQuantity } from './batch-form.js';

describe('форма количества партии', () => {
  it('принимает положительное целое количество', () => {
    expect(validateBatchQuantity('112')).toEqual({ error: null, value: 112 });
    expect(validateBatchQuantity(` ${MAX_BATCH_QUANTITY} `)).toEqual({
      error: null,
      value: MAX_BATCH_QUANTITY,
    });
  });

  it.each(['', '0', '-1', '1.5', '112 изделий', String(MAX_BATCH_QUANTITY + 1)])(
    'отклоняет недопустимое значение %j без округления',
    (value) => {
      const result = validateBatchQuantity(value);
      expect(result.value).toBeNull();
      expect(result.error).toBeTruthy();
    },
  );
});
