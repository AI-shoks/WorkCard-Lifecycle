import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const recoveryDatabase = 'workcard_recovery_20260917';

export function recoveryTarget(rawUrl, expectedHost, expectedUser) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid recovery source URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) ||
    url.hostname.split('.')[0].includes('-pooler') ||
    url.hostname !== expectedHost ||
    url.username !== expectedUser ||
    !url.password ||
    url.pathname !== '/workcard' ||
    url.hash ||
    url.search !== '?sslmode=verify-full' ||
    (url.port && url.port !== '5432')
  ) {
    throw new Error('Recovery source target does not match the approved staging database.');
  }
  url.pathname = `/${recoveryDatabase}`;
  return url.toString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 2, 'No CLI arguments are accepted.');
  process.stdout.write(
    recoveryTarget(
      process.env.SOURCE_DATABASE_URL,
      process.env.NEON_DATABASE_HOST,
      process.env.EXPECTED_DATABASE_USER,
    ),
  );
}
