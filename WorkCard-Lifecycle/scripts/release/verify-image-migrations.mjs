import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { validateReleaseManifest } from './validate-release-manifest.mjs';

const [manifestPath, migrationDirectory] = process.argv.slice(2);
assert(manifestPath && migrationDirectory && process.argv.length === 4);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await validateReleaseManifest(manifest);
const files = (await readdir(migrationDirectory)).sort();
const expected = manifest.migrationsChecksumSummary.files;
assert.deepEqual(
  files,
  expected.map((file) => file.path.replace('apps/api/migrations/', '')).sort(),
);
for (const entry of expected) {
  const name = entry.path.replace('apps/api/migrations/', '');
  assert(!name.includes('/') && !name.includes('..'));
  assert.equal(
    createHash('sha256')
      .update(await readFile(resolve(migrationDirectory, name)))
      .digest('hex'),
    entry.sha256,
  );
}
