import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const docker = process.env['DOCKER_CLI'] || 'docker';
const image =
  'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const results = resolve('.quality-results');
await mkdir(results, { recursive: true });
const snapshot = await mkdtemp(join(tmpdir(), 'wcl-q9-secrets-'));
try {
  const files = execFileSync(
    'git',
    [
      '-C',
      root,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'WorkCard-Lifecycle',
      '.github',
    ],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  for (const file of new Set(files)) {
    const source = resolve(root, file);
    const target = resolve(snapshot, file);
    assert(source.startsWith(resolve(root) + sep) && target.startsWith(snapshot + sep));
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
  for (const mode of ['git', 'dir']) {
    const target = mode === 'git' ? root : snapshot;
    const command = spawnSync(
      docker,
      [
        'run',
        '--rm',
        '--network=none',
        '-e',
        'GIT_CONFIG_COUNT=1',
        '-e',
        'GIT_CONFIG_KEY_0=safe.directory',
        '-e',
        'GIT_CONFIG_VALUE_0=/repo',
        '-v',
        `${target}:/repo:ro`,
        '-v',
        `${results}:/results`,
        image,
        mode,
        '/repo',
        '--redact=100',
        '--no-banner',
        '--exit-code=1',
        '--report-format=json',
        `--report-path=/results/secrets-${mode}.json`,
        ...(mode === 'git'
          ? ['--log-opts=--all', '--gitleaks-ignore-path=/repo/WorkCard-Lifecycle/.gitleaksignore']
          : []),
      ],
      { stdio: 'inherit' },
    );
    assert.equal(command.status, 0, `${mode} secret scan failed; inspect the redacted report.`);
  }
} finally {
  assert(snapshot.startsWith(join(tmpdir(), 'wcl-q9-secrets-')));
  await rm(snapshot, { recursive: true });
}
