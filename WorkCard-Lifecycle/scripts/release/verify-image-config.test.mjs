import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { verifySavedImageConfig } from './verify-image-config.mjs';

const sourceSha = 'a'.repeat(40);
const configuration = () => ({
  architecture: 'amd64',
  os: 'linux',
  config: {
    User: '65532:65532',
    Env: [`APP_VERSION=${sourceSha}`],
    Labels: { 'org.opencontainers.image.revision': sourceSha },
  },
});

async function withArchive(options, run) {
  const directory = await mkdtemp(join(tmpdir(), 'work-card-image-config-test-'));
  try {
    const bytes = JSON.stringify(options.config ?? configuration());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const configPath =
      options.path ?? (options.containerd ? `blobs/sha256/${hash}` : `${hash}.json`);
    await mkdir(dirname(join(directory, configPath)), { recursive: true });
    await writeFile(join(directory, configPath), bytes);
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify(options.manifest ?? [{ Config: configPath, RepoTags: [], Layers: [] }]),
    );
    const archive = join(directory, 'image.tar');
    execFileSync('tar', ['-cf', archive, '-C', directory, 'manifest.json', configPath]);
    await run(archive, `sha256:${hash}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('reads the actual config digest from classic and containerd saved image formats', async () => {
  for (const containerd of [false, true]) {
    await withArchive({ containerd }, (archive, digest) => {
      assert.equal(verifySavedImageConfig(archive, sourceSha), digest);
      assert.equal(verifySavedImageConfig(archive, sourceSha, digest), digest);
      assert.throws(
        () => verifySavedImageConfig(archive, sourceSha, `sha256:${'b'.repeat(64)}`),
        /differs from the built image/,
      );
    });
  }
});

test('rejects mismatched config checksums and ambiguous or unsafe archive references', async () => {
  await withArchive({ path: `${'b'.repeat(64)}.json` }, (archive) => {
    assert.throws(() => verifySavedImageConfig(archive, sourceSha), /checksum mismatch/);
  });
  for (const manifest of [[], [{ Config: '../../outside.json' }], [{}, {}]]) {
    await withArchive({ manifest }, (archive) => {
      assert.throws(() => verifySavedImageConfig(archive, sourceSha), /saved image|archive member/);
    });
  }
});

test('rejects source, version, platform or root user drift in the saved image', async () => {
  for (const mutate of [
    (config) => {
      config.architecture = 'arm64';
    },
    (config) => {
      config.os = 'windows';
    },
    (config) => {
      config.config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);
    },
    (config) => {
      config.config.Env = ['APP_VERSION=wrong'];
    },
    (config) => {
      config.config.User = '';
    },
    (config) => {
      config.config.User = 'root:root';
    },
    (config) => {
      config.config.User = '0:0';
    },
  ]) {
    const config = configuration();
    mutate(config);
    await withArchive({ config }, (archive) => {
      assert.throws(() => verifySavedImageConfig(archive, sourceSha));
    });
  }
});
