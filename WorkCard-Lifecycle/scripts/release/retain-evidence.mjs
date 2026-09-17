import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  appendDurableEvidence,
  digestBytes,
  evidenceContext,
  retainReport,
} from './github-evidence.mjs';
import { validateReleaseManifest } from './validate-release-manifest.mjs';

const [sourceSha, rollbackFromSha] = process.argv.slice(2);
assert(/^[0-9a-f]{40}$/.test(sourceSha ?? '') && [3, 4].includes(process.argv.length));
if (rollbackFromSha)
  assert(/^[0-9a-f]{40}$/.test(rollbackFromSha) && rollbackFromSha !== sourceSha);
const manifest = JSON.parse(await readFile(`docs/release/manifests/${sourceSha}.json`, 'utf8'));
await validateReleaseManifest(manifest);
const smokeBytes = await readFile('.quality-results/render-smoke.json');
const observationsBytes = await readFile('.quality-results/render-observations.json');
const smoke = JSON.parse(smokeBytes);
const observations = JSON.parse(observationsBytes);
for (const report of [smoke, observations]) {
  assert.equal(report.status, 'passed');
  assert.equal(report.sourceSha, manifest.sourceSha);
  assert.equal(report.immutableImage, manifest.immutableImage);
}
assert.equal(smoke.platform, 'render');
assert.equal(
  observations.mode,
  'full',
  'Liveness discovery cannot substitute for full hosted qualification.',
);
for (const check of [
  'canonical-browser-112-3-250',
  'spoof-resistant-session-rate-limit',
  'origin-csrf-permission-no-side-effect',
  'session-cookie-security',
])
  assert(smoke.checks.includes(check));
await retainReport(manifest, '.quality-results/render-smoke.json');
await retainReport(manifest, '.quality-results/render-observations.json');
await appendDurableEvidence(manifest, {
  kind: 'production-smoke',
  evidence: {
    ...evidenceContext(),
    status: 'passed',
    origin: smoke.origin,
    checks: [...new Set([...smoke.checks, ...observations.checks])],
    smokeReportSha256: digestBytes(smokeBytes),
    observationsSha256: digestBytes(observationsBytes),
  },
});
if (rollbackFromSha) {
  const previous = JSON.parse(
    await readFile(`docs/release/manifests/${rollbackFromSha}.json`, 'utf8'),
  );
  await validateReleaseManifest(previous);
  const rollback = JSON.parse(await readFile('.quality-results/render-rollback.json', 'utf8'));
  assert.equal(rollback.status, 'live');
  assert.equal(rollback.previousImage, previous.immutableImage);
  assert.equal(rollback.persistentImage, manifest.immutableImage);
  assert.equal(rollback.resolvedImage, manifest.immutableImage);
  assert.equal(rollback.resolvedDigest, manifest.imageDigest);
  assert.equal(
    previous.migrationsChecksumSummary.digest,
    manifest.migrationsChecksumSummary.digest,
  );
  await appendDurableEvidence(previous, {
    kind: 'rollback-decision',
    evidence: {
      ...evidenceContext(),
      decision: 'completed',
      fromImage: previous.immutableImage,
      toImage: manifest.immutableImage,
      compatibilityEvidenceSha256: rollback.compatibilityEvidenceSha256,
    },
  });
}
