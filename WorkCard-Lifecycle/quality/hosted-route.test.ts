import { randomUUID } from 'node:crypto';
import { createServer, type RequestListener } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { Route } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import { forwardHostedRoute, hostedRequestTimeoutMs } from './browser/hosted-route.js';

async function withServer(handler: RequestListener, run: (origin: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local fixture port.');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
  }
}

function routeFixture(url: string, headers: Record<string, string> = {}, body = '') {
  const fulfill = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const route = {
    request: () => ({
      url: () => url,
      method: () => (body ? 'POST' : 'GET'),
      allHeaders: async () => headers,
      postDataBuffer: () => (body ? Buffer.from(body) : null),
    }),
    fulfill,
    abort,
  } as unknown as Route;
  return { route, fulfill, abort };
}

it('forwards browser credentials/body only to the exact origin and preserves response cookies/bytes', async () => {
  const session = randomUUID();
  const csrf = randomUUID();
  let receivedBody = '';
  await withServer(
    (request, response) => {
      expect(request.headers.cookie).toBe(`wcl_session=${session}`);
      expect(request.headers['x-csrf-token']).toBe(csrf);
      request.on('data', (chunk: Buffer) => (receivedBody += chunk.toString()));
      request.on('end', () => {
        response.writeHead(201, {
          'content-encoding': 'gzip',
          'set-cookie': [
            'wcl_session=synthetic-replacement; HttpOnly; Path=/',
            'fixture=1; Path=/',
          ],
        });
        response.end(gzipSync('fixture-response'));
      });
    },
    async (origin) => {
      const fixture = routeFixture(
        `${origin}/api/v1/fixture`,
        { cookie: `wcl_session=${session}`, 'x-csrf-token': csrf },
        '{"commandId":"synthetic"}',
      );
      await forwardHostedRoute(fixture.route, origin);
      expect(receivedBody).toBe('{"commandId":"synthetic"}');
      expect(fixture.abort).not.toHaveBeenCalled();
      expect(fixture.fulfill).toHaveBeenCalledOnce();
      const result = fixture.fulfill.mock.calls[0] as unknown as [Parameters<Route['fulfill']>[0]];
      expect(result[0]?.status).toBe(201);
      expect(result[0]?.headers?.['set-cookie']).toBe(
        'wcl_session=synthetic-replacement; HttpOnly; Path=/\nfixture=1; Path=/',
      );
      expect(result[0]?.headers?.['transfer-encoding']).toBeUndefined();
      expect(gunzipSync(result[0]?.body as Buffer).toString()).toBe('fixture-response');
    },
  );
});

it('blocks off-origin/userinfo targets before requesting headers or opening a connection', async () => {
  for (const target of ['http://127.0.0.1:2/path', 'http://fixture:secret@127.0.0.1:1/path']) {
    const fixture = routeFixture(target);
    await expect(forwardHostedRoute(fixture.route, 'http://127.0.0.1:1')).rejects.toThrow(
      'Hosted browser request failed (origin).',
    );
    expect(fixture.abort).toHaveBeenCalledWith('failed');
    expect(fixture.fulfill).not.toHaveBeenCalled();
  }
});

it.each(['/next', 'http://127.0.0.1:1/forbidden'])(
  'never follows redirect %s or reports its response headers',
  async (location) => {
    let requests = 0;
    await withServer(
      (_request, response) => {
        requests += 1;
        response.writeHead(302, { location, 'set-cookie': 'synthetic=not-for-reports' });
        response.end();
      },
      async (origin) => {
        const fixture = routeFixture(`${origin}/redirect`);
        await expect(forwardHostedRoute(fixture.route, origin)).rejects.toThrow(
          'Hosted browser request failed (redirect).',
        );
        expect(requests).toBe(1);
        expect(fixture.fulfill).not.toHaveBeenCalled();
      },
    );
  },
);

it('keeps real non-2xx responses for the lifecycle assertions', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/problem+json' });
      response.end('{"status":503,"code":"UNAVAILABLE"}');
    },
    async (origin) => {
      const fixture = routeFixture(`${origin}/api/v1/fixture`);
      await forwardHostedRoute(fixture.route, origin);
      expect(fixture.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 503,
          body: Buffer.from('{"status":503,"code":"UNAVAILABLE"}'),
        }),
      );
      expect(fixture.abort).not.toHaveBeenCalled();
    },
  );
});

it('bounds the whole response and discards raw transport errors, headers and causes', async () => {
  expect(hostedRequestTimeoutMs).toBe(20_000);
  await withServer(
    (_request, response) => {
      response.writeHead(200);
      response.write('incomplete');
    },
    async (origin) => {
      const fixture = routeFixture(`${origin}/timeout`, { cookie: `wcl_session=${randomUUID()}` });
      const error = await forwardHostedRoute(fixture.route, origin, 30).catch(
        (value: unknown) => value,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Hosted browser request failed (timeout).');
      expect((error as Error).cause).toBeUndefined();
      expect(fixture.fulfill).not.toHaveBeenCalled();
    },
  );
});
