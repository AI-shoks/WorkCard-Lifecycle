import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../apps/api/src/app.js';
import { createDatabaseReadiness } from '../apps/api/src/readiness.js';
import { isolatedDatabase, referenceFixtures } from './database.js';

const canonical = process.argv.includes('canonical');
const db = await isolatedDatabase('browser');
try {
  await referenceFixtures(db, !canonical);
  const security = { allowedOrigin: '', cookieSecure: false, signingSecret: randomUUID() };
  const app = await buildApp({
    appVersion: 'quality-browser',
    pool: db.runtime,
    readiness: createDatabaseReadiness(db.runtime),
    security,
    webDistPath: resolve('apps/web/dist'),
  });
  try {
    security.allowedOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
        'test',
        ...(canonical ? ['--project=desktop'] : process.argv.slice(2)),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          QUALITY_BASE_URL: security.allowedOrigin,
          QUALITY_READ_URL: db.runtimeUrl,
          QUALITY_CANONICAL: canonical ? '1' : '0',
        },
      },
    );
    process.exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
  } finally {
    await app.close();
  }
} finally {
  await db.dispose();
}
