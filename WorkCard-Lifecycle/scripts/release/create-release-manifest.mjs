import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { validateReleaseManifest, validateTrivyScanReport } from './validate-release-manifest.mjs';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const imageRepositoryPattern =
  /^europe-west1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/work-card\/work-card$/;
const scannerImagePattern = /^aquasec\/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/;

function parseOptions(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Некорректный аргумент release manifest: ${name ?? '<missing>'}`);
    }
    if (options.has(name)) throw new Error(`Аргумент ${name} указан повторно.`);
    options.set(name, value);
  }
  return options;
}

function requireOption(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Обязательный аргумент ${name} отсутствует.`);
  return value;
}

function assertRunUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} должен быть корректным URL.`);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*)?$/.test(
      url.pathname,
    ) ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} должен ссылаться на GitHub Actions run.`);
  }
}

async function listMigrationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listMigrationFiles(path)));
    if (entry.isFile() && entry.name.endsWith('.sql')) files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const options = parseOptions(process.argv.slice(2));
const root = resolve(options.get('--root') ?? scriptRoot);
const sourceSha = requireOption(options, '--source-sha');
const imageTag = requireOption(options, '--image-tag');
const imageDigest = requireOption(options, '--image-digest');
const imageConfigDigest = requireOption(options, '--image-config-digest');
const ociRevisionLabel = requireOption(options, '--oci-revision-label');
const sourceCiRunUrl = requireOption(options, '--source-ci-run-url');
const buildScanRunUrl = requireOption(options, '--build-scan-run-url');
const scannerImage = requireOption(options, '--scanner-image');
const generatedAt = requireOption(options, '--generated-at');

if (!shaPattern.test(sourceSha)) {
  throw new Error('source SHA должен содержать ровно 40 lowercase hex символов.');
}
if (!digestPattern.test(imageDigest)) {
  throw new Error('image digest должен иметь формат sha256:<64 lowercase hex>.');
}
if (!digestPattern.test(imageConfigDigest)) {
  throw new Error('image config digest должен иметь формат sha256:<64 lowercase hex>.');
}
if (ociRevisionLabel !== sourceSha) {
  throw new Error('OCI revision label должен совпадать с source SHA.');
}
const tagSuffix = `:${sourceSha}`;
if (!imageTag.endsWith(tagSuffix)) {
  throw new Error('Immutable image tag должен оканчиваться полным source SHA.');
}
const imageRepository = imageTag.slice(0, -tagSuffix.length);
if (!imageRepositoryPattern.test(imageRepository)) {
  throw new Error('Image tag должен указывать на канонический Artifact Registry repository.');
}
if (!scannerImagePattern.test(scannerImage)) {
  throw new Error('Scanner image должен быть Trivy, закреплённым одновременно tag и digest.');
}
assertRunUrl(sourceCiRunUrl, 'source CI run URL');
assertRunUrl(buildScanRunUrl, 'build/scan run URL');
if (
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(generatedAt) ||
  Number.isNaN(Date.parse(generatedAt))
) {
  throw new Error('generated-at должен быть каноническим UTC timestamp.');
}

const migrations = [];
for (const path of await listMigrationFiles(resolve(root, 'apps', 'api', 'migrations'))) {
  const bytes = await readFile(path);
  migrations.push({
    path: relative(root, path).split(sep).join('/'),
    sha256: sha256(bytes),
  });
}
if (migrations.length === 0) throw new Error('Не найдено ни одной SQL-миграции.');

const checksumInput = migrations.map((entry) => `${entry.sha256}  ${entry.path}\n`).join('');
const scanReportPath = resolve(root, '.quality-results', 'release', 'image-vulnerabilities.json');
const scanReportBytes = await readFile(scanReportPath);

const immutableImage = `${imageRepository}@${imageDigest}`;
const reportSummary = validateTrivyScanReport(scanReportBytes, {
  imageConfigDigest,
  immutableImage,
  sourceSha,
});
const manifest = {
  $schema: '../release-manifest.schema.json',
  schemaVersion: 1,
  generatedAt,
  sourceSha,
  sourceCiRunUrl,
  imageTag,
  imageDigest,
  immutableImage,
  imageConfigDigest,
  ociRevisionLabel,
  platform: 'linux/amd64',
  buildScanRunUrl,
  scan: {
    status: 'passed',
    image: immutableImage,
    imageConfigDigest,
    scannerImage,
    reportPath: '.quality-results/release/image-vulnerabilities.json',
    reportSha256: `sha256:${sha256(scanReportBytes)}`,
    reportSummary,
  },
  migrationsChecksumSummary: {
    algorithm: 'sha256',
    digest: `sha256:${sha256(checksumInput)}`,
    files: migrations,
  },
  lifecycleEvidence: {
    mode: 'append-only-files',
    directory: `docs/release/evidence/${sourceSha}`,
    recordSchema: 'docs/release/release-evidence.schema.json',
  },
};

await validateReleaseManifest(manifest);

const outputPath = resolve(root, 'docs', 'release', 'manifests', `${sourceSha}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
});
process.stdout.write(`${relative(root, outputPath).split(sep).join('/')}\n`);
