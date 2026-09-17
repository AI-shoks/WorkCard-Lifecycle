import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertRenderService,
  deployRenderImage,
  renderClient,
  resolveCurrentRenderDeployment,
} from './render-adapter.mjs';
import {
  validateReleaseEvidenceRecord,
  validateReleaseManifest,
} from './validate-release-manifest.mjs';
import {
  appendDurableEvidence,
  digestBytes,
  evidenceContext,
  retainReport,
} from './github-evidence.mjs';

export async function verifyRollback({ currentManifest, targetManifest, deploymentRecord }) {
  await validateReleaseManifest(currentManifest);
  await validateReleaseManifest(targetManifest);
  assert.equal(currentManifest.schemaVersion, 2);
  assert.equal(targetManifest.schemaVersion, 2);
  await validateReleaseEvidenceRecord(deploymentRecord, currentManifest);
  assert(
    [
      'production-deployment',
      'production-attempt',
      'rollback-deployment',
      'rollback-attempt',
    ].includes(deploymentRecord.kind),
  );
  assert(
    /^dep-[a-z0-9]{20}$/.test(deploymentRecord.evidence.deployId ?? ''),
    'Rollback requires a recorded live/triggered deploy ID; reconcile prepared intents explicitly.',
  );
  assert.equal(
    deploymentRecord.evidence.previousImage,
    targetManifest.immutableImage,
    'Rollback target must be the recorded immediately previous image.',
  );
  assert.notEqual(currentManifest.immutableImage, targetManifest.immutableImage);
  // Conservative automatic compatibility rule. A different schema needs a new
  // reviewed forward-fix release; there is intentionally no destructive down path.
  assert.equal(
    targetManifest.migrationsChecksumSummary.digest,
    currentManifest.migrationsChecksumSummary.digest,
    'Automatic rollback requires identical migration history.',
  );
  return targetManifest.immutableImage;
}

export async function rollbackRender({
  currentManifest,
  targetManifest,
  deploymentRecord,
  expected,
  request,
  context,
  append = appendDurableEvidence,
  retain = retainReport,
  output,
}) {
  const image = await verifyRollback({ currentManifest, targetManifest, deploymentRecord });
  assert.equal(deploymentRecord.evidence.serviceId, expected.serviceId);
  const current = await resolveCurrentRenderDeployment(request, expected);
  assert.equal(
    current.image.ref,
    currentManifest.immutableImage,
    'Live deployment must match the current manifest before rollback.',
  );
  assert.equal(
    current.id,
    deploymentRecord.evidence.deployId,
    'Rollback evidence must identify the current live deployment, not an older use of the same image.',
  );
  assert.equal(
    assertRenderService(await request(`/services/${expected.serviceId}`), expected),
    currentManifest.immutableImage,
    'Current service drifted from the rollback evidence.',
  );
  const compatibilityEvidence = {
    currentSourceSha: currentManifest.sourceSha,
    targetSourceSha: targetManifest.sourceSha,
    migrationsChecksum: currentManifest.migrationsChecksumSummary.digest,
    deploymentRecordSha256: digestBytes(`${JSON.stringify(deploymentRecord)}\n`),
  };
  const compatibilityPath = `${output}.compatibility.json`;
  await mkdir(dirname(resolve(output)), { recursive: true });
  const compatibilityBytes = `${JSON.stringify(compatibilityEvidence, null, 2)}\n`;
  await writeFile(compatibilityPath, compatibilityBytes, { flag: 'wx' });
  const compatibilityEvidenceSha256 = digestBytes(compatibilityBytes);
  await retain(targetManifest, compatibilityPath);
  const report = await deployRenderImage({
    image,
    expected,
    request,
    expectedPreviousDeployId: deploymentRecord.evidence.deployId,
    onBefore: async (value) => {
      assert.equal(
        value.previousImage,
        currentManifest.immutableImage,
        'Rollback current image changed before mutation.',
      );
      await append(currentManifest, {
        kind: 'rollback-decision',
        evidence: {
          ...context,
          decision: 'required',
          fromImage: currentManifest.immutableImage,
          toImage: image,
          compatibilityEvidenceSha256,
        },
      });
      await append(targetManifest, {
        kind: 'rollback-attempt',
        evidence: {
          ...context,
          ...value,
          requestedImage: image,
          status: 'prepared',
          compatibilityEvidenceSha256,
        },
      });
    },
    onTriggered: async (value) => {
      await writeFile(`${output}.pending.json`, `${JSON.stringify(value, null, 2)}\n`, {
        flag: 'wx',
      });
      await append(targetManifest, {
        kind: 'rollback-attempt',
        evidence: {
          ...context,
          ...value,
          serviceId: expected.serviceId,
          status: 'triggered',
          compatibilityEvidenceSha256,
        },
      });
    },
  });
  const result = { ...report, compatibilityEvidenceSha256 };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  // A failed browser probe must not erase the fact that traffic already changed.
  const { schemaVersion: _schemaVersion, ...deployment } = result;
  void _schemaVersion;
  await append(targetManifest, {
    kind: 'rollback-deployment',
    evidence: { ...context, ...deployment },
  });
  await retain(targetManifest, output);
  return result;
}

async function main() {
  const [currentPath, targetPath, recordPath, output] = process.argv.slice(2);
  assert(currentPath && targetPath && recordPath && output && process.argv.length === 6);
  assert.equal(
    process.env.WORKCARD_ROLLBACK_AUTHORIZATION,
    'ROLLBACK PREVIOUS COMPATIBLE DIGEST',
    'Explicit rollback authorization is required.',
  );
  for (const name of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'APP_DATABASE_PASSWORD',
    'SESSION_SIGNING_SECRET',
  ])
    assert(!process.env[name]);
  const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const currentManifest = await read(currentPath);
  const targetManifest = await read(targetPath);
  const deploymentRecord = await read(recordPath);
  const expected = {
    serviceId: process.env.RENDER_SERVICE_ID,
    ownerId: process.env.RENDER_OWNER_ID,
    origin: process.env.RENDER_ORIGIN,
    repository: targetManifest.immutableImage.split('@')[0],
  };
  await rollbackRender({
    currentManifest,
    targetManifest,
    deploymentRecord,
    expected,
    request: renderClient({ token: process.env.RENDER_API_KEY }),
    context: evidenceContext(),
    output,
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
