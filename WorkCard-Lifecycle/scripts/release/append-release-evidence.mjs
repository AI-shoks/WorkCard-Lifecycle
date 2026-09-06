import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  validateReleaseEvidenceRecord,
  validateReleaseManifest,
} from './validate-release-manifest.mjs';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceShaPattern = /^[0-9a-f]{40}$/;
const candidateKeys = ['evidence', 'immutableImage', 'kind', 'recordedAt', 'sourceSha'];

function sha256Digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseOptions(arguments_) {
  const allowed = new Set(['--record', '--root']);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент evidence appender: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  if (!options.has('--record')) throw new Error('Обязательный аргумент --record отсутствует.');
  return options;
}

async function readJson(path, description) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new Error(`Не удалось прочитать ${description}: ${error.message}`, { cause: error });
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${description} должен быть корректным JSON.`);
  }
}

function assertCandidateShape(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Evidence candidate должен быть JSON object.');
  }
  const actualKeys = Object.keys(candidate).sort((left, right) => left.localeCompare(right, 'en'));
  if (JSON.stringify(actualKeys) !== JSON.stringify(candidateKeys)) {
    throw new Error(`Evidence candidate должен содержать только: ${candidateKeys.join(', ')}.`);
  }
  if (!sourceShaPattern.test(candidate.sourceSha)) {
    throw new Error('Evidence candidate source SHA должен содержать 40 lowercase hex символов.');
  }
}

async function readExistingRecords(directory, manifest) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  if (entries.some((entry) => !entry.isFile() || !/^\d{4}\.json$/.test(entry.name))) {
    throw new Error('Evidence directory содержит посторонний файл или каталог.');
  }

  const records = [];
  const sortedEntries = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, 'en'),
  );
  let previousBytes = null;
  let previousRecordedAt = null;
  for (const [index, entry] of sortedEntries.entries()) {
    const sequence = index + 1;
    const expectedName = `${String(sequence).padStart(4, '0')}.json`;
    if (entry.name !== expectedName) throw new Error('Evidence record sequence содержит gap.');

    const recordFile = await readJson(
      resolve(directory, entry.name),
      `evidence record ${entry.name}`,
    );
    await validateReleaseEvidenceRecord(recordFile.value, manifest);
    if (recordFile.value.sequence !== sequence) {
      throw new Error(`Evidence record ${entry.name} имеет неверный sequence.`);
    }
    const expectedPrevious = previousBytes ? sha256Digest(previousBytes) : null;
    if (recordFile.value.previousRecordSha256 !== expectedPrevious) {
      throw new Error(`Evidence record ${entry.name} нарушает append-only hash chain.`);
    }
    if (
      previousRecordedAt !== null &&
      Date.parse(recordFile.value.recordedAt) <= Date.parse(previousRecordedAt)
    ) {
      throw new Error('Evidence record timestamps должны строго возрастать.');
    }
    records.push(recordFile);
    previousBytes = recordFile.bytes;
    previousRecordedAt = recordFile.value.recordedAt;
  }
  return records;
}

const options = parseOptions(process.argv.slice(2));
const root = resolve(options.get('--root') ?? scriptRoot);
const candidateFile = await readJson(resolve(options.get('--record')), 'evidence candidate');
const candidate = candidateFile.value;
assertCandidateShape(candidate);

const manifestPath = resolve(root, 'docs', 'release', 'manifests', `${candidate.sourceSha}.json`);
const manifestFile = await readJson(manifestPath, 'release manifest');
await validateReleaseManifest(manifestFile.value);

const evidenceDirectory = resolve(
  root,
  ...manifestFile.value.lifecycleEvidence.directory.split('/'),
);
const existingRecords = await readExistingRecords(evidenceDirectory, manifestFile.value);
const previousRecord = existingRecords.at(-1);
if (
  previousRecord &&
  Date.parse(candidate.recordedAt) <= Date.parse(previousRecord.value.recordedAt)
) {
  throw new Error('Новый evidence record timestamp должен быть позже предыдущего.');
}

const record = {
  $schema: '../../release-evidence.schema.json',
  schemaVersion: 1,
  sequence: existingRecords.length + 1,
  recordedAt: candidate.recordedAt,
  sourceSha: candidate.sourceSha,
  immutableImage: candidate.immutableImage,
  previousRecordSha256: previousRecord ? sha256Digest(previousRecord.bytes) : null,
  kind: candidate.kind,
  evidence: candidate.evidence,
};
await validateReleaseEvidenceRecord(record, manifestFile.value);

await mkdir(evidenceDirectory, { recursive: true });
const outputPath = resolve(evidenceDirectory, `${String(record.sequence).padStart(4, '0')}.json`);
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
});
process.stdout.write(`${relative(root, outputPath).split(sep).join('/')}\n`);
