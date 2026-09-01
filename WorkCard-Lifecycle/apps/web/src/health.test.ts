import { describe, expect, it } from 'vitest';

import { toReadinessView } from './health.js';

describe('toReadinessView', () => {
  it('показывает готовую среду только после backend readiness', () => {
    expect(
      toReadinessView({
        status: 'ok',
        database: 'up',
        migrationVersion: 1,
        expectedMigrationVersion: 1,
      }),
    ).toEqual({ tone: 'ready', label: 'Среда готова' });
  });

  it('не заявляет готовность без подтверждения backend', () => {
    expect(toReadinessView(null)).toEqual({ tone: 'waiting', label: 'Среда запускается' });
  });
});
