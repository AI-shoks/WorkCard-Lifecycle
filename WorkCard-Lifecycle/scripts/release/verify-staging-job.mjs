import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateReleaseManifest } from './validate-release-manifest.mjs';

const jobContracts = {
  migrate: {
    args: ['dist/migrate.js'],
    secrets: {
      APP_DATABASE_PASSWORD: ['work-card-app-database-password', 'appDatabasePassword'],
      MIGRATION_DATABASE_URL: ['work-card-migration-database-url', 'migrationDatabaseUrl'],
    },
  },
  seed: {
    args: ['dist/seed.js'],
    secrets: {
      APP_DATABASE_PASSWORD: ['work-card-app-database-password', 'appDatabasePassword'],
      MIGRATION_DATABASE_URL: ['work-card-migration-database-url', 'migrationDatabaseUrl'],
    },
  },
  verify: {
    args: ['dist/verify-database.js'],
    secrets: {
      DATABASE_URL: ['work-card-database-url', 'databaseUrl'],
    },
  },
};

function parseOptions(arguments_) {
  const allowed = new Set(['--job', '--manifest', '--metadata', '--project', '--secret-versions']);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент staging job verifier: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  for (const required of allowed) {
    if (!options.has(required)) throw new Error(`Обязательный аргумент ${required} отсутствует.`);
  }
  return options;
}

function resourceName(value) {
  if (typeof value !== 'string') return null;
  return value.split('/').filter(Boolean).at(-1) ?? null;
}

function jobTemplate(metadata) {
  return metadata.template ?? metadata.spec?.template?.spec ?? null;
}

function taskTemplate(metadata) {
  const job = jobTemplate(metadata);
  return job?.template?.spec ?? job?.template ?? job?.spec?.template?.spec ?? null;
}

function secretReference(entry) {
  const reference = entry?.valueSource?.secretKeyRef ?? entry?.valueFrom?.secretKeyRef;
  if (!reference) return null;
  return {
    secret: resourceName(reference.secret ?? reference.name),
    version: String(reference.version ?? reference.key ?? ''),
  };
}

function environmentMap(container) {
  assert(Array.isArray(container.env), 'Cloud Run Job container env должен быть массивом.');
  return new Map(container.env.map((entry) => [entry.name, entry]));
}

function cloudSqlInstances(metadata, task) {
  const volumes = Array.isArray(task?.volumes)
    ? task.volumes.flatMap((volume) => volume?.cloudSqlInstance?.instances ?? [])
    : [];
  if (volumes.length > 0) return volumes;
  const annotations =
    metadata.spec?.template?.spec?.template?.metadata?.annotations ??
    metadata.template?.template?.metadata?.annotations ??
    task?.metadata?.annotations;
  const annotation = annotations?.['run.googleapis.com/cloudsql-instances'];
  return typeof annotation === 'string'
    ? annotation
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

export async function verifyStagingJob(metadata, manifest, secretVersions, project, jobName) {
  await validateReleaseManifest(manifest);
  const contract = jobContracts[jobName];
  if (!contract) throw new Error(`Staging job не разрешён: ${jobName}.`);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
    throw new Error('Некорректный staging project ID.');
  }
  if (resourceName(metadata.metadata?.name ?? metadata.name) !== `work-card-${jobName}`) {
    throw new Error(`Metadata относится не к work-card-${jobName}.`);
  }

  const job = jobTemplate(metadata);
  const task = taskTemplate(metadata);
  assert(job && task, 'Cloud Run Job metadata не содержит task template.');
  assert.equal(Number(job.taskCount), 1, 'Cloud Run Job taskCount должен быть 1.');
  assert.equal(Number(job.parallelism), 1, 'Cloud Run Job parallelism должен быть 1.');
  assert.equal(Number(task.maxRetries), 0, 'Cloud Run Job maxRetries должен быть 0.');
  assert.equal(
    task.serviceAccount ?? task.serviceAccountName,
    `work-card-${jobName}@${project}.iam.gserviceaccount.com`,
    'Cloud Run Job использует неожиданную service account.',
  );

  const containers = task.containers;
  assert(Array.isArray(containers) && containers.length === 1, 'Cloud Run Job должен иметь container.');
  const container = containers[0];
  assert.equal(container.name, jobName);
  assert.equal(container.image, manifest.immutableImage, 'Cloud Run Job image не совпадает с digest.');
  assert.deepEqual(container.command, ['node']);
  assert.deepEqual(container.args, contract.args);

  const environment = environmentMap(container);
  const plain = {
    APP_DATABASE_USER: 'work_card_app',
    APP_ENV: 'staging',
    APP_VERSION: manifest.sourceSha,
    LOG_LEVEL: 'info',
  };
  assert.deepEqual(
    [...environment.keys()].sort(),
    [...Object.keys(plain), ...Object.keys(contract.secrets)].sort(),
    'Cloud Run Job env boundary изменилась.',
  );
  for (const [name, expected] of Object.entries(plain)) {
    assert.equal(environment.get(name)?.value, expected, `${name} имеет неожиданное значение.`);
  }
  for (const [name, [expectedSecret, versionKey]] of Object.entries(contract.secrets)) {
    const reference = secretReference(environment.get(name));
    assert(reference, `${name} не является Secret Manager reference.`);
    assert.equal(reference.secret, expectedSecret, `${name} ссылается на неожиданный secret.`);
    assert.equal(
      reference.version,
      String(secretVersions[versionKey]),
      `${name} не закреплён на ожидаемой числовой версии.`,
    );
    assert.match(reference.version, /^[1-9][0-9]*$/);
  }

  assert.deepEqual(cloudSqlInstances(metadata, task), [
    `${project}:europe-west1:work-card-staging`,
  ]);
  const volumeMounts = container.volumeMounts ?? [];
  if (Array.isArray(task.volumes) && task.volumes.length > 0) {
    assert.deepEqual(volumeMounts, [{ mountPath: '/cloudsql', name: 'cloudsql' }]);
  } else if (volumeMounts.length > 0) {
    assert.deepEqual(volumeMounts, [{ mountPath: '/cloudsql', name: 'cloudsql' }]);
  }
  return { image: manifest.immutableImage, job: `work-card-${jobName}` };
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  const [metadata, manifest, secretVersions] = await Promise.all(
    ['--metadata', '--manifest', '--secret-versions'].map(async (name) =>
      JSON.parse(await readFile(resolve(options.get(name)), 'utf8')),
    ),
  );
  const result = await verifyStagingJob(
    metadata,
    manifest,
    secretVersions,
    options.get('--project'),
    options.get('--job'),
  );
  process.stdout.write(`${result.job}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
