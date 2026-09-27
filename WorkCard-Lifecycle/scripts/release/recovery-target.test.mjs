import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL } from 'node:url';

import { recoveryDatabase, recoveryTarget } from './recovery-target.mjs';

const host = 'ep-example.us-east-2.aws.neon.tech';
const source = `postgresql://workcard_app:secret@${host}/workcard?sslmode=verify-full`;

test('retargets only the approved direct staging URL', () => {
  const target = new URL(recoveryTarget(source, host, 'workcard_app'));
  assert.equal(target.pathname, `/${recoveryDatabase}`);
  assert.equal(target.hostname, host);
  assert.equal(target.username, 'workcard_app');
  assert.equal(target.searchParams.get('sslmode'), 'verify-full');
});

test('rejects a different host, user, database, or TLS mode without echoing credentials', () => {
  for (const [url, expectedHost, expectedUser] of [
    [source, 'ep-other.us-east-2.aws.neon.tech', 'workcard_app'],
    [source, host, 'workcard_owner'],
    [source.replace('/workcard?', '/production?'), host, 'workcard_app'],
    [source.replace('verify-full', 'require'), host, 'workcard_app'],
    [`${source}&options=-c%20statement_timeout%3D0`, host, 'workcard_app'],
    [source.replace(host, `ep-example-pooler.us-east-2.aws.neon.tech`), host, 'workcard_app'],
  ]) {
    assert.throws(
      () => recoveryTarget(url, expectedHost, expectedUser),
      (error) => !String(error).includes('secret'),
    );
  }
});
