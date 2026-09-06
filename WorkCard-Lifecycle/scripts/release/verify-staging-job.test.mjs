import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { verifyStagingJob } from './verify-staging-job.mjs';

const sourceSha = 'a'.repeat(40);
const immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@sha256:${'b'.repeat(64)}`;
const migrationPath = 'apps/api/migrations/0001_foundation.sql';
const migrationSha = 'c'.repeat(64);
const checksumInput = `${migrationSha}  ${migrationPath}\n`;
const manifest = {
  $schema: '../release-manifest.schema.json',
  schemaVersion: 1,
  generatedAt: '2026-09-06T10:00:00Z',
  sourceSha,
  sourceCiRunUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/1',
  imageTag: `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card:${sourceSha}`,
  imageDigest: `sha256:${'b'.repeat(64)}`,
  immutableImage,
  imageConfigDigest: `sha256:${'d'.repeat(64)}`,
  ociRevisionLabel: sourceSha,
  platform: 'linux/amd64',
  buildScanRunUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/2',
  scan: {
    status: 'passed',
    image: immutableImage,
    imageConfigDigest: `sha256:${'d'.repeat(64)}`,
    scannerImage: `aquasec/trivy:0.74.0@sha256:${'e'.repeat(64)}`,
    reportPath: '.quality-results/release/image-vulnerabilities.json',
    reportSha256: `sha256:${'f'.repeat(64)}`,
    reportSummary: {
      schemaVersion: 2,
      artifactType: 'container_image',
      targetCount: 1,
      vulnerabilityCount: 0,
      severityThreshold: ['HIGH', 'CRITICAL'],
    },
  },
  migrationsChecksumSummary: {
    algorithm: 'sha256',
    digest: `sha256:${createHash('sha256').update(checksumInput).digest('hex')}`,
    files: [{ path: migrationPath, sha256: migrationSha }],
  },
  lifecycleEvidence: {
    mode: 'append-only-files',
    directory: `docs/release/evidence/${sourceSha}`,
    recordSchema: 'docs/release/release-evidence.schema.json',
  },
};
const secretVersions = {
  ownerDatabasePassword: 1,
  databaseUrl: 2,
  migrationDatabaseUrl: 3,
  appDatabasePassword: 4,
  sessionSigningSecret: 5,
};
const project = 'work-card-staging';

function metadata(job = 'migrate') {
  const specifications = {
    migrate: {
      args: ['dist/migrate.js'],
      secrets: [
        ['MIGRATION_DATABASE_URL', 'work-card-migration-database-url', '3'],
        ['APP_DATABASE_PASSWORD', 'work-card-app-database-password', '4'],
      ],
    },
    verify: {
      args: ['dist/verify-database.js'],
      secrets: [['DATABASE_URL', 'work-card-database-url', '2']],
    },
  };
  const specification = specifications[job];
  return {
    name: `projects/${project}/locations/europe-west1/jobs/work-card-${job}`,
    template: {
      parallelism: 1,
      taskCount: 1,
      template: {
        containers: [
          {
            name: job,
            image: immutableImage,
            command: ['node'],
            args: specification.args,
            env: [
              { name: 'APP_ENV', value: 'staging' },
              { name: 'APP_VERSION', value: sourceSha },
              { name: 'APP_DATABASE_USER', value: 'work_card_app' },
              { name: 'LOG_LEVEL', value: 'info' },
              ...specification.secrets.map(([name, secret, version]) => ({
                name,
                valueSource: { secretKeyRef: { secret, version } },
              })),
            ],
            volumeMounts: [{ mountPath: '/cloudsql', name: 'cloudsql' }],
          },
        ],
        maxRetries: 0,
        serviceAccount: `work-card-${job}@${project}.iam.gserviceaccount.com`,
        volumes: [
          { cloudSqlInstance: { instances: [`${project}:europe-west1:work-card-staging`] } },
        ],
      },
    },
  };
}

function v1Metadata(job = 'migrate') {
  const value = metadata(job);
  const task = JSON.parse(JSON.stringify(value.template.template));
  delete task.volumes;
  delete task.containers[0].volumeMounts;
  return {
    metadata: { name: `work-card-${job}` },
    spec: {
      template: {
        spec: {
          parallelism: 1,
          taskCount: 1,
          template: {
            metadata: {
              annotations: {
                'run.googleapis.com/cloudsql-instances': `${project}:europe-west1:work-card-staging`,
              },
            },
            spec: task,
          },
        },
      },
    },
  };
}

test('accepts only exact-digest owner and runtime staging job definitions', async () => {
  await assert.doesNotReject(
    verifyStagingJob(metadata('migrate'), manifest, secretVersions, project, 'migrate'),
  );
  await assert.doesNotReject(
    verifyStagingJob(metadata('verify'), manifest, secretVersions, project, 'verify'),
  );
  await assert.doesNotReject(
    verifyStagingJob(v1Metadata('migrate'), manifest, secretVersions, project, 'migrate'),
  );
});

test('rejects a mutable image, secret drift and owner secret in runtime verify', async (context) => {
  await context.test('image mismatch', async () => {
    const value = metadata('migrate');
    value.template.template.containers[0].image = `${manifest.imageTag}`;
    await assert.rejects(
      verifyStagingJob(value, manifest, secretVersions, project, 'migrate'),
      /image не совпадает с digest/,
    );
  });

  await context.test('secret version drift', async () => {
    const value = metadata('migrate');
    value.template.template.containers[0].env.find(
      (entry) => entry.name === 'MIGRATION_DATABASE_URL',
    ).valueSource.secretKeyRef.version = 'latest';
    await assert.rejects(
      verifyStagingJob(value, manifest, secretVersions, project, 'migrate'),
      /числовой версии/,
    );
  });

  await context.test('owner URL on verify', async () => {
    const value = metadata('verify');
    value.template.template.containers[0].env.push({
      name: 'MIGRATION_DATABASE_URL',
      valueSource: {
        secretKeyRef: { secret: 'work-card-migration-database-url', version: '3' },
      },
    });
    await assert.rejects(
      verifyStagingJob(value, manifest, secretVersions, project, 'verify'),
      /env boundary/,
    );
  });
});
