import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertCompactTarget, compactPassportId } from './recovery-compact-fixture.mjs';

const stagingHost = 'ep-staging.us-east-2.aws.neon.tech';
const productionHost = 'ep-production.us-east-2.aws.neon.tech';
const ownerUrl = `postgresql://workcard_owner:secret@${stagingHost}/workcard_recovery_20260917?sslmode=verify-full`;

test('compact fixture accepts only the exact isolated staging owner target', () => {
  assert.equal(assertCompactTarget(ownerUrl, stagingHost, productionHost), ownerUrl);
  assert.match(compactPassportId, /^[0-9a-f-]{36}$/);
  for (const invalid of [
    ownerUrl.replace(stagingHost, productionHost),
    ownerUrl.replace('workcard_owner', 'workcard_app'),
    ownerUrl.replace('workcard_recovery_20260917', 'workcard'),
    ownerUrl.replace('sslmode=verify-full', 'sslmode=require'),
    ownerUrl.replace(stagingHost, 'ep-staging-pooler.us-east-2.aws.neon.tech'),
  ]) {
    assert.throws(() => assertCompactTarget(invalid, stagingHost, productionHost));
  }
});
