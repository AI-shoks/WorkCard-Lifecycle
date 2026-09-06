import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseSchemaPath = resolve(scriptRoot, 'docs', 'release', 'release-manifest.schema.json');
const evidenceSchemaPath = resolve(scriptRoot, 'docs', 'release', 'release-evidence.schema.json');
const canonicalScanArtifact = '/scan/published-image.tar';
let validatorsPromise;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaFailure(name, validator) {
  const details = (validator.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  return new Error(`${name} не соответствует JSON Schema: ${details || 'unknown schema error'}`);
}

async function loadValidators() {
  if (!validatorsPromise) {
    validatorsPromise = (async () => {
      const [releaseSchemaBytes, evidenceSchemaBytes] = await Promise.all([
        readFile(releaseSchemaPath),
        readFile(evidenceSchemaPath),
      ]);
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return {
        release: ajv.compile(JSON.parse(releaseSchemaBytes.toString('utf8'))),
        evidence: ajv.compile(JSON.parse(evidenceSchemaBytes.toString('utf8'))),
      };
    })();
  }
  return validatorsPromise;
}

function repositoryFromRunUrl(value) {
  const segments = new URL(value).pathname.split('/').filter(Boolean);
  return `${segments[0]}/${segments[1]}`;
}

export async function validateReleaseManifest(manifest) {
  const validators = await loadValidators();
  if (!validators.release(manifest)) throw schemaFailure('Release manifest', validators.release);

  if (manifest.ociRevisionLabel !== manifest.sourceSha) {
    throw new Error('OCI revision label должен совпадать с source SHA.');
  }

  const tagSuffix = `:${manifest.sourceSha}`;
  const repository = manifest.imageTag.slice(0, -tagSuffix.length);
  if (!manifest.imageTag.endsWith(tagSuffix) || `${repository}${tagSuffix}` !== manifest.imageTag) {
    throw new Error('Image tag должен заканчиваться точным source SHA.');
  }
  if (manifest.immutableImage !== `${repository}@${manifest.imageDigest}`) {
    throw new Error('Immutable image должен связывать repository image tag с image digest.');
  }
  if (manifest.scan.image !== manifest.immutableImage) {
    throw new Error('scan.image должен совпадать с immutableImage.');
  }
  if (manifest.scan.imageConfigDigest !== manifest.imageConfigDigest) {
    throw new Error('Scan image config digest должен совпадать с manifest image config digest.');
  }
  if (manifest.lifecycleEvidence.directory !== `docs/release/evidence/${manifest.sourceSha}`) {
    throw new Error('Append-only evidence directory должен быть привязан к source SHA.');
  }
  if (
    repositoryFromRunUrl(manifest.sourceCiRunUrl) !== repositoryFromRunUrl(manifest.buildScanRunUrl)
  ) {
    throw new Error('Source CI и build/scan evidence должны относиться к одному repository.');
  }

  const migrationPaths = manifest.migrationsChecksumSummary.files.map((entry) => entry.path);
  if (new Set(migrationPaths).size !== migrationPaths.length) {
    throw new Error('Migration checksum summary содержит повторяющийся path.');
  }
  if (migrationPaths.some((path) => path.split('/').includes('..'))) {
    throw new Error('Migration checksum summary содержит небезопасный path.');
  }
  const sortedPaths = [...migrationPaths].sort((left, right) => left.localeCompare(right, 'en'));
  if (migrationPaths.some((path, index) => path !== sortedPaths[index])) {
    throw new Error('Migration checksum files должны быть отсортированы по path.');
  }

  const checksumInput = manifest.migrationsChecksumSummary.files
    .map((entry) => `${entry.sha256}  ${entry.path}\n`)
    .join('');
  if (manifest.migrationsChecksumSummary.digest !== `sha256:${sha256(checksumInput)}`) {
    throw new Error('Migration checksum summary digest не соответствует списку файлов.');
  }

  return manifest;
}

export function validateTrivyScanReport(scanReportBytes, expected) {
  let report;
  try {
    report = JSON.parse(Buffer.from(scanReportBytes).toString('utf8'));
  } catch {
    throw new Error('Trivy report должен быть корректным JSON.');
  }
  if (!isRecord(report)) throw new Error('Trivy report должен быть JSON object.');
  if (report.SchemaVersion !== 2) throw new Error('Trivy report должен иметь SchemaVersion 2.');
  if (report.ArtifactType !== 'container_image') {
    throw new Error('Trivy report должен описывать container_image.');
  }
  if (report.ArtifactName !== canonicalScanArtifact) {
    throw new Error(`Trivy report должен относиться к ${canonicalScanArtifact}.`);
  }
  if (
    typeof report.CreatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(report.CreatedAt)
  ) {
    throw new Error('Trivy report должен содержать UTC CreatedAt.');
  }
  if (!isRecord(report.Metadata)) throw new Error('Trivy report должен содержать Metadata.');
  if (report.Metadata.ImageID !== expected.imageConfigDigest) {
    throw new Error('Trivy ImageID должен совпадать с проверенным image config digest.');
  }

  if (report.Metadata.RepoDigests !== undefined) {
    if (
      !Array.isArray(report.Metadata.RepoDigests) ||
      report.Metadata.RepoDigests.some((value) => typeof value !== 'string')
    ) {
      throw new Error('Trivy RepoDigests должен быть массивом строк.');
    }
    if (
      report.Metadata.RepoDigests.length > 0 &&
      !report.Metadata.RepoDigests.includes(expected.immutableImage)
    ) {
      throw new Error('Trivy RepoDigests не содержит проверенный immutable image.');
    }
  }

  const imageConfig = report.Metadata.ImageConfig;
  if (!isRecord(imageConfig)) throw new Error('Trivy report должен содержать ImageConfig.');
  if (imageConfig.os !== 'linux' || imageConfig.architecture !== 'amd64') {
    throw new Error('Trivy ImageConfig должен описывать linux/amd64.');
  }
  const labels = imageConfig.config?.Labels;
  if (!isRecord(labels) || labels['org.opencontainers.image.revision'] !== expected.sourceSha) {
    throw new Error('Trivy image OCI revision label должен совпадать с source SHA.');
  }

  if (!Array.isArray(report.Results) || report.Results.length === 0) {
    throw new Error('Trivy report должен содержать хотя бы один vulnerability scan target.');
  }
  let vulnerabilityCount = 0;
  for (const [index, result] of report.Results.entries()) {
    if (
      !isRecord(result) ||
      typeof result.Target !== 'string' ||
      !result.Target ||
      typeof result.Class !== 'string' ||
      !result.Class ||
      typeof result.Type !== 'string' ||
      !result.Type
    ) {
      throw new Error(`Trivy Results[${index}] не является vulnerability scan target.`);
    }
    if (result.Class !== 'os-pkgs' && result.Class !== 'lang-pkgs') {
      throw new Error(`Trivy Results[${index}].Class не относится к vulnerability package scan.`);
    }
    if (result.Vulnerabilities !== undefined && result.Vulnerabilities !== null) {
      if (!Array.isArray(result.Vulnerabilities)) {
        throw new Error(`Trivy Results[${index}].Vulnerabilities должен быть массивом.`);
      }
      vulnerabilityCount += result.Vulnerabilities.length;
    }
  }
  if (vulnerabilityCount !== 0) {
    throw new Error('Trivy report содержит vulnerability findings при заявленном passed status.');
  }

  return {
    schemaVersion: 2,
    artifactType: 'container_image',
    targetCount: report.Results.length,
    vulnerabilityCount,
    severityThreshold: ['HIGH', 'CRITICAL'],
  };
}

export async function validateReleaseEvidenceRecord(record, manifest) {
  await validateReleaseManifest(manifest);
  const validators = await loadValidators();
  if (!validators.evidence(record)) {
    throw schemaFailure('Release evidence record', validators.evidence);
  }
  if (record.sourceSha !== manifest.sourceSha) {
    throw new Error('Evidence source SHA должен совпадать с immutable release manifest.');
  }
  if (record.immutableImage !== manifest.immutableImage) {
    throw new Error('Evidence immutable image должен совпадать с release manifest.');
  }
  if (Date.parse(record.recordedAt) < Date.parse(manifest.generatedAt)) {
    throw new Error('Evidence record не может предшествовать release manifest.');
  }
  if (
    (record.kind === 'staging-deployment' || record.kind === 'production-deployment') &&
    record.evidence.resolvedImage !== manifest.immutableImage
  ) {
    throw new Error('Deployment evidence resolved image должен совпадать с release manifest.');
  }
  if (
    repositoryFromRunUrl(record.evidence.runUrl) !== repositoryFromRunUrl(manifest.buildScanRunUrl)
  ) {
    throw new Error('Evidence run URL должен относиться к repository release manifest.');
  }
  return record;
}

function parseOptions(arguments_) {
  const allowed = new Set(['--manifest', '--scan-report']);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент validator: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  if (!options.has('--manifest')) throw new Error('Обязательный аргумент --manifest отсутствует.');
  return options;
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  const manifestPath = resolve(options.get('--manifest'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await validateReleaseManifest(manifest);

  const scanReportPath = options.get('--scan-report');
  if (scanReportPath) {
    const scanReportBytes = await readFile(resolve(scanReportPath));
    const reportSha256 = `sha256:${sha256(scanReportBytes)}`;
    if (manifest.scan.reportSha256 !== reportSha256) {
      throw new Error('Trivy report checksum не совпадает с release manifest.');
    }
    const reportSummary = validateTrivyScanReport(scanReportBytes, manifest);
    if (JSON.stringify(manifest.scan.reportSummary) !== JSON.stringify(reportSummary)) {
      throw new Error('Trivy report summary не совпадает с release manifest.');
    }
  }
  process.stdout.write(`${manifestPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
