import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertRenderService,
  assertResolvedDeploy,
  deployRenderImage,
  renderClient,
} from './render-adapter.mjs';

const repository = 'ghcr.io/ai-shoks/workcard-lifecycle/work-card';
const image = `${repository}@sha256:${'a'.repeat(64)}`;
const previous = `${repository}@sha256:${'b'.repeat(64)}`;
const expected = {
  serviceId: `srv-${'a'.repeat(20)}`,
  ownerId: `tea-${'b'.repeat(20)}`,
  origin: 'https://work-card-demo.onrender.com',
  repository,
};
const deployId = `dep-${'c'.repeat(20)}`;
const service = () => ({
  id: expected.serviceId,
  ownerId: expected.ownerId,
  type: 'web_service',
  autoDeploy: 'no',
  imagePath: previous,
  serviceDetails: {
    runtime: 'image',
    plan: 'free',
    numInstances: 1,
    healthCheckPath: '/health/live',
    url: expected.origin,
    pullRequestPreviewsEnabled: 'no',
  },
});
const deploy = () => ({
  id: deployId,
  status: 'live',
  image: { ref: image, sha: image.split('@')[1] },
});

test('persistent reference is patched and read back before triggering, then resolved digest verified', async () => {
  const calls = [];
  const state = service();
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    if (path.endsWith('?limit=20'))
      return [{ deploy: { ...deploy(), image: { ref: previous, sha: previous.split('@')[1] } } }];
    if (options.method === 'PATCH') {
      state.imagePath = options.body.image.imagePath;
      return state;
    }
    if (options.method === 'POST') return { id: deployId, status: 'queued' };
    return path.endsWith(deployId) ? deploy() : state;
  };
  const result = await deployRenderImage({ image, expected, request });
  assert.equal(result.previousImage, previous);
  assert.equal(result.resolvedImage, image);
  assert.deepEqual(
    calls.map(([, options]) => options.method ?? 'GET'),
    ['GET', 'GET', 'GET', 'PATCH', 'GET', 'POST', 'GET', 'GET'],
  );
  assert.equal(calls[3][1].body.image.ownerId, expected.ownerId);
});

test('rejects paid plans, previews, disks, runtime jobs, target drift and mutable references', () => {
  const mutations = [
    (s) => {
      s.serviceDetails.plan = 'starter';
    },
    (s) => {
      s.serviceDetails.healthCheckPath = '/health/ready';
    },
    (s) => {
      s.serviceDetails.disk = {};
    },
    (s) => {
      s.serviceDetails.numInstances = 2;
    },
    (s) => {
      s.serviceDetails.runtime = 'docker';
    },
    (s) => {
      s.serviceDetails.pullRequestPreviewsEnabled = 'yes';
    },
    (s) => {
      s.serviceDetails.preDeployCommand = 'migrate';
    },
    (s) => {
      s.ownerId = 'other';
    },
    (s) => {
      s.autoDeploy = 'yes';
    },
    (s) => {
      s.registryCredential = { id: 'credential', name: 'private-registry' };
    },
    (s) => {
      s.image = { registryCredentialId: 'credential' };
    },
    (s) => {
      s.serviceDetails.envSpecificDetails = { registryCredential: { id: 'credential' } };
    },
    (s) => {
      s.imagePath = `${repository}:latest`;
    },
  ];
  for (const mutate of mutations) {
    const value = service();
    mutate(value);
    assert.throws(() => assertRenderService(value, expected));
  }
});

test('live without the resolved exact digest is insufficient', () => {
  for (const change of [
    { status: 'queued' },
    { image: { ref: image } },
    { image: { ref: previous, sha: image.split('@')[1] } },
    { image: { ref: image, sha: 'b'.repeat(64) } },
    { image: { ref: image, sha: image.split('@')[1], registryCredential: 'private-registry' } },
  ]) {
    assert.throws(() => assertResolvedDeploy({ ...deploy(), ...change }, image, deployId));
  }
});

test('a 202/empty response never proves a completed deploy or SQL drain', async () => {
  const client = renderClient({
    token: 'test-token',
    fetchImplementation: async () => new globalThis.Response('', { status: 202 }),
  });
  await assert.rejects(
    client(`/services/${expected.serviceId}/deploys`, { method: 'POST' }),
    /without a verifiable/,
  );
});

test('provider error body never leaks in an adapter error and redirects are prohibited', async () => {
  const client = renderClient({
    token: 'test-token',
    fetchImplementation: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      return new globalThis.Response('postgresql://sensitive', { status: 403 });
    },
  });
  await assert.rejects(
    client(`/services/${expected.serviceId}`),
    (error) => !error.message.includes('sensitive') && error.message.includes('403'),
  );
});

test('malformed provider JSON never leaks its response body in parser errors', async () => {
  const client = renderClient({
    token: 'test-token',
    fetchImplementation: async () => new globalThis.Response('postgresql://sensitive'),
  });
  await assert.rejects(
    client(`/services/${expected.serviceId}`),
    (error) => !error.stack.includes('sensitive') && error.message.includes('invalid JSON'),
  );
});

test('failure or cancellation produces no automatic rollback or gate-open operation', async () => {
  const state = service();
  let mutations = 0;
  const request = async (path, options = {}) => {
    if (path.endsWith('?limit=20'))
      return [{ deploy: { ...deploy(), image: { ref: previous, sha: previous.split('@')[1] } } }];
    if (options.method === 'PATCH') {
      state.imagePath = image;
      mutations++;
      return state;
    }
    if (options.method === 'POST') {
      mutations++;
      return { id: deployId };
    }
    return path.endsWith(deployId) ? { id: deployId, status: 'canceled' } : state;
  };
  await assert.rejects(deployRenderImage({ image, expected, request }), /canceled/);
  assert.equal(mutations, 2);
});

test('failure to persist the prior-image journal prevents the first Render mutation', async () => {
  let mutations = 0;
  const request = async (path, options = {}) => {
    if (options.method) mutations++;
    if (path.endsWith('?limit=20'))
      return [{ deploy: { ...deploy(), image: { ref: previous, sha: previous.split('@')[1] } } }];
    return service();
  };
  await assert.rejects(
    deployRenderImage({
      image,
      expected,
      request,
      onBefore: async () => {
        throw new Error('Durable journal unavailable');
      },
    }),
    /journal unavailable/,
  );
  assert.equal(mutations, 0);
});

test('persistent image drift from the actual live digest fails before mutation', async () => {
  const request = async (path) => (path.endsWith('?limit=20') ? [{ deploy: deploy() }] : service());
  await assert.rejects(
    deployRenderImage({ image, expected, request }),
    /unexpected image reference/,
  );
});
