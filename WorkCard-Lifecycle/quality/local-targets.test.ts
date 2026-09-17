import { Client } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { isolatedDatabase } from './database.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it.each([
  'postgresql://owner:synthetic@remote.invalid:5432/postgres',
  'postgresql://owner:synthetic@localhost:5432/postgres?host=remote.invalid',
  'postgresql://owner:synthetic@localhost:5432/postgres?hostaddr=192.0.2.1',
  'postgresql://owner:synthetic@localhost:5432/postgres?options=-c%20search_path%3Dprivate',
  'postgresql://owner:synthetic@localhost:5432/postgres?sslmode=disable&sslmode=verify-full',
])('rejects remote/ambiguous test targets before any connection %#', async (url) => {
  const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => {
    throw new Error('A network connection must never be attempted');
  });
  vi.stubEnv('QUALITY_OWNER_URL', url);
  await expect(isolatedDatabase('blocked')).rejects.toThrow();
  expect(connect).not.toHaveBeenCalled();
});
