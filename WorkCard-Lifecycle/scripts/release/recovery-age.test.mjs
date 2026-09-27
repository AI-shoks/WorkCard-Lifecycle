import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertRecoveryAge } from './recovery-age.mjs';

const base = {
  database_name: 'workcard_recovery_20260917',
  observed_at: new Date('2026-09-27T10:00:00Z'),
  last_reset_verified_at: new Date('2026-09-19T10:00:00Z'),
  maintenance: false,
  maintenance_requested: false,
};

test('accepts a genuinely elapsed recovery target and a fresh verified reset', () => {
  assert.equal(assertRecoveryAge({ ...base, age_seconds: 27 * 3600 }, 'stale').phase, 'stale');
  assert.equal(assertRecoveryAge({ ...base, age_seconds: 30 }, 'fresh').phase, 'fresh');
});

test('rejects closed, wrong, or borderline recovery states', () => {
  for (const row of [
    { ...base, age_seconds: 26 * 3600 },
    { ...base, age_seconds: 27 * 3600, maintenance: true },
    { ...base, age_seconds: 27 * 3600, database_name: 'workcard' },
  ])
    assert.throws(() => assertRecoveryAge(row, 'stale'));
  assert.throws(() => assertRecoveryAge({ ...base, age_seconds: 600 }, 'fresh'));
});
