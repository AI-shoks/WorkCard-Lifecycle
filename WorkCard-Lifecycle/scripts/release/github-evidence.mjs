import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const digestBytes = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function evidenceContext(environment = process.env) {
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, CONFIGURATION_REVISION } =
    environment;
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? ''));
  assert(
    /^[1-9][0-9]*$/.test(GITHUB_RUN_ID ?? '') && /^[1-9][0-9]*$/.test(GITHUB_RUN_ATTEMPT ?? ''),
  );
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(CONFIGURATION_REVISION ?? ''),
    'A non-secret CONFIGURATION_REVISION label is required.',
  );
  return {
    runUrl: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}`,
    configurationRevision: CONFIGURATION_REVISION,
  };
}

export async function appendDurableEvidence(manifest, candidate) {
  const tag = `work-card-${manifest.sourceSha}`;
  await mkdir('.quality-results', { recursive: true });
  const temporary = await mkdtemp(resolve('.quality-results', 'journal-'));
  const directory = resolve(manifest.lifecycleEvidence.directory);
  await mkdir(directory, { recursive: true });
  const assets = JSON.parse(gh('release', 'view', tag, '--json', 'assets'))
    .assets.map((asset) => asset.name)
    .filter((name) => /^evidence-\d{4}\.json$/.test(name))
    .sort();
  for (const name of assets) {
    gh('release', 'download', tag, '--pattern', name, '--dir', temporary);
    const downloaded = await readFile(resolve(temporary, name));
    const destination = resolve(directory, name.replace('evidence-', ''));
    try {
      assert(
        (await readFile(destination)).equals(downloaded),
        'Local evidence differs from its durable record.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(destination, downloaded, { flag: 'wx' });
    }
  }
  let timestamp = Date.now();
  if (assets.length) {
    const prior = JSON.parse(
      await readFile(resolve(directory, assets.at(-1).replace('evidence-', '')), 'utf8'),
    );
    timestamp = Math.max(timestamp, Date.parse(prior.recordedAt) + 1);
  }
  const candidatePath = resolve(temporary, 'candidate.json');
  await writeFile(
    candidatePath,
    `${JSON.stringify({ recordedAt: new Date(timestamp).toISOString(), sourceSha: manifest.sourceSha, immutableImage: manifest.immutableImage, ...candidate }, null, 2)}\n`,
    { flag: 'wx' },
  );
  const recordPath = execFileSync(
    process.execPath,
    ['scripts/release/append-release-evidence.mjs', '--record', candidatePath],
    { encoding: 'utf8' },
  ).trim();
  const uploadPath = resolve(temporary, `evidence-${basename(recordPath)}`);
  await copyFile(recordPath, uploadPath);
  gh('release', 'upload', tag, uploadPath); // Existing records must never be overwritten.
  return recordPath;
}

export async function retainReport(manifest, path) {
  const temporary = await mkdtemp(resolve('.quality-results', 'report-'));
  const name = basename(path).replace(
    /\.json$/,
    `-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`,
  );
  const upload = resolve(temporary, name);
  await copyFile(path, upload);
  gh('release', 'upload', `work-card-${manifest.sourceSha}`, upload);
}
