import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Saved image metadata is not valid JSON.');
  }
}

export function verifySavedImageConfig(archive, sourceSha, expectedDigest) {
  assert(/^[0-9a-f]{40}$/.test(sourceSha), 'A full source SHA is required.');
  if (expectedDigest)
    assert(/^sha256:[0-9a-f]{64}$/.test(expectedDigest), 'Invalid expected config digest.');
  const readEntry = (entry) =>
    execFileSync('tar', ['-xOf', resolve(archive), entry], {
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const manifest = parseJson(readEntry('manifest.json'));
  assert(Array.isArray(manifest) && manifest.length === 1, 'One saved image is required.');
  const configPath = manifest[0].Config;
  const match = /^(?:([0-9a-f]{64})\.json|blobs\/sha256\/([0-9a-f]{64}))$/.exec(configPath ?? '');
  assert(match, 'Saved image config must be a digest-addressed regular archive member.');
  const configBytes = readEntry(configPath);
  const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  assert.equal(configDigest, `sha256:${match[1] ?? match[2]}`, 'Saved config checksum mismatch.');
  if (expectedDigest)
    assert.equal(configDigest, expectedDigest, 'Published config differs from the built image.');
  const image = parseJson(configBytes);
  assert.equal(image.os, 'linux');
  assert.equal(image.architecture, 'amd64');
  assert.equal(image.config?.Labels?.['org.opencontainers.image.revision'], sourceSha);
  assert.deepEqual(
    image.config?.Env?.filter((value) => value.startsWith('APP_VERSION=')),
    [`APP_VERSION=${sourceSha}`],
  );
  assert(
    typeof image.config?.User === 'string' &&
      image.config.User.length > 0 &&
      !['root', '0'].includes(image.config.User.split(':')[0]),
    'The release image must run as a nonroot user.',
  );
  return configDigest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [archive, sourceSha, expectedDigest] = process.argv.slice(2);
  assert(archive && sourceSha && [4, 5].includes(process.argv.length));
  process.stdout.write(`${verifySavedImageConfig(archive, sourceSha, expectedDigest)}\n`);
}
