import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

async function filesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    files.push(...(entry.isDirectory() ? await filesBelow(path) : [path]));
  }
  return files;
}

function embeddedReportPayloads(html: Buffer): Buffer[] {
  // HTML stores step errors in a base64 ZIP; searching only the visible HTML
  // bytes would miss the exact artifact channel this regression protects.
  const base64 = html
    .toString()
    .match(
      /<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=]+)<\/template>/,
    )?.[1];
  if (!base64) throw new Error('Expected embedded Playwright report archive.');
  const zip = Buffer.from(base64, 'base64');
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Expected ZIP directory.');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const payloads: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const local = zip.readUInt32LE(offset + 42);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP entry.');
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(data, data + size);
    if (method !== 0 && method !== 8) throw new Error('Unexpected ZIP compression.');
    payloads.push(method === 8 ? inflateRawSync(compressed) : compressed);
    offset +=
      46 +
      zip.readUInt16LE(offset + 28) +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
  }
  if (!payloads.length) throw new Error('Expected archived report entries.');
  return payloads;
}

test('real failed Playwright reports contain no synthetic cookie/CSRF from the forwarded request', async () => {
  // This harness starts another runner/browser and builds both report formats.
  // Its process budget does not change application, HTTP or lifecycle deadlines.
  test.setTimeout(90_000);
  const session = randomUUID();
  const csrf = randomUUID();
  const root = resolve('.quality-results');
  await mkdir(root, { recursive: true });
  const fixture = await mkdtemp(resolve(root, 'hosted-route-artifacts-'));
  const helper = fileURLToPath(new URL('./hosted-route.ts', import.meta.url));
  await writeFile(
    resolve(fixture, 'playwright.config.ts'),
    `export default {
      testDir: '.', testMatch: 'artifact.spec.ts', workers: 1, retries: 0, timeout: 10000,
      outputDir: './results', reporter: [['json', { outputFile: './report.json' }],
        ['html', { outputFolder: './html', open: 'never' }]],
      use: { trace: 'off', screenshot: 'only-on-failure' }
    };`,
  );
  await writeFile(
    resolve(fixture, 'artifact.spec.ts'),
    `import { test } from '@playwright/test';
    import { createServer } from 'node:http';
    import { forwardHostedRoute } from ${JSON.stringify(helper)};
    test('expected safe transport failure', async ({ page, context }) => {
      const server = createServer((request, response) => {
        if (request.url === '/') {
          response.writeHead(200, { 'content-type': 'text/html',
            'set-cookie': 'wcl_session=' + process.env.FIXTURE_SESSION + '; HttpOnly; Path=/' });
          response.end('<!doctype html><html lang="ru"><body>Fixture page</body></html>');
        } else if (request.headers.cookie === 'wcl_session=' + process.env.FIXTURE_SESSION &&
          request.headers['x-csrf-token'] === process.env.FIXTURE_CSRF) {
          request.socket.destroy();
        } else {
          response.writeHead(418); response.end('Fixture credential forwarding did not occur.');
        }
      });
      await new Promise(done => server.listen(0, '127.0.0.1', done));
      const origin = 'http://127.0.0.1:' + server.address().port;
      try {
        await context.route('**/*', route => forwardHostedRoute(route, origin));
        await page.goto(origin);
        await page.evaluate(async csrf => {
          await fetch('/failure', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: '{}' });
        }, process.env.FIXTURE_CSRF);
      } finally {
        await new Promise(done => { server.close(done); server.closeAllConnections(); });
      }
    });`,
  );
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TEMP', 'TMP', 'SYSTEMROOT', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment['FIXTURE_SESSION'] = session;
  environment['FIXTURE_CSRF'] = csrf;
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      resolve(fixture, 'playwright.config.ts'),
    ],
    {
      cwd: fixture,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 60_000,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exitCode = await new Promise<number | null>((done, fail) => {
    child.once('error', fail);
    child.once('exit', done);
  });
  expect(
    exitCode,
    'The intentionally failing browser fixture must finish with one test failure.',
  ).toBe(1);
  expect(
    output.includes(session) || output.includes(csrf),
    'No synthetic credentials in child output.',
  ).toBe(false);
  const report = JSON.parse(await readFile(resolve(fixture, 'report.json'), 'utf8')) as {
    stats: { unexpected: number };
  };
  expect(report.stats.unexpected).toBe(1);
  const files = await filesBelow(fixture);
  expect(files.some((file) => file.endsWith('error-context.md'))).toBe(true);
  expect(files.some((file) => file.endsWith('index.html'))).toBe(true);
  let safeFailureFound = false;
  for (const file of files) {
    const bytes = await readFile(file);
    const payloads = file.endsWith('index.html')
      ? [bytes, ...embeddedReportPayloads(bytes)]
      : [bytes];
    for (const payload of payloads) {
      expect(
        payload.includes(Buffer.from(session)) || payload.includes(Buffer.from(csrf)),
        `Synthetic credential leaked in fixture artifact ${file.slice(fixture.length)}.`,
      ).toBe(false);
      if (payload.includes(Buffer.from('Hosted browser request failed (transport).')))
        safeFailureFound = true;
    }
  }
  expect(safeFailureFound, 'The artifact must retain the fixed failure classification.').toBe(true);
});
