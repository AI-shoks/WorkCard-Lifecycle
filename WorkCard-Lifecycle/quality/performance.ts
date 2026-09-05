import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import { testApi } from './api.js';
import { isolatedDatabase, referenceFixtures } from './database.js';

const db = await isolatedDatabase('performance');
const samples: Record<string, number[]> = {};
const sample = async <T>(name: string, operation: () => Promise<T>) => {
  const start = performance.now();
  const value = await operation();
  (samples[name] ??= []).push(performance.now() - start);
  return value;
};
try {
  await referenceFixtures(db);
  const api = await testApi(db);
  try {
    const base = await api.app.listen({ port: 0, host: '127.0.0.1' });
    async function request(role: string, path: string, body?: object) {
      const response = await fetch(`${base}/api/v1${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { ...api.headers(role), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert(response.ok, `Unexpected HTTP ${response.status} at ${path}`);
      return response.json();
    }
    const batches: { id: string; setId: string; correlationId: string }[] = [];
    // Setup uses real API commands. No SQL manufactures production results.
    for (let index = 0; index < 40; index++) {
      const created = await request('PLANNER', '/production-batches', {
        commandId: randomUUID(),
        productionPassportId: demoPassport.id,
        quantity: 112,
      });
      const released = await sample('release_250', () =>
        request('PLANNER', `/production-batches/${created.batch.id}/release`, {
          commandId: randomUUID(),
          expectedBatchVersion: 1,
        }),
      );
      assert.equal(released.actualCardCount, 250);
      const detail = await request('MASTER', `/production-batches/${created.batch.id}`);
      const set = detail.sets.find(
        (value: { plannedCardCount: number }) => value.plannedCardCount === 112,
      );
      batches.push({ id: created.batch.id, setId: set.id, correlationId: released.correlationId });
      const cards = (await request('MASTER', `/work-card-sets/${set.id}/work-cards?limit=100`))
        .items;
      const first = cards[0];
      await request('MASTER', `/work-card-sets/${set.id}/assignments`, {
        commandId: randomUUID(),
        purpose: 'FIRST_ARTICLE',
        expectedSetVersion: 1,
        assigneeId: demoUsers[2].id,
        cards: [{ workCardId: first.id, expectedVersion: 1 }],
      });
      await request('MASTER', `/work-cards/${first.id}/start`, {
        commandId: randomUUID(),
        expectedCardVersion: 2,
      });
      await request('MASTER', `/work-cards/${first.id}/complete`, {
        commandId: randomUUID(),
        expectedCardVersion: 3,
      });
      await request('QUALITY_CONTROLLER', `/work-card-sets/${set.id}/first-article-acceptance`, {
        commandId: randomUUID(),
        expectedSetVersion: 2,
        expectedCardVersion: 4,
      });
      const assigned = await sample('assign_59', () =>
        request('MASTER', `/work-card-sets/${set.id}/assignments`, {
          commandId: randomUUID(),
          purpose: 'SERIAL',
          expectedSetVersion: 3,
          assigneeId: demoUsers[2].id,
          cards: cards
            .slice(1, 60)
            .map((card: { id: string }) => ({ workCardId: card.id, expectedVersion: 1 })),
        }),
      );
      assert.equal(assigned.assignedCount, 59);
    }
    await db.owner.query('ANALYZE');
    // Read measurements start only after the complete representative volume exists.
    await request('ADMIN_AUDITOR', `/production-batches/${batches[0]!.id}`);
    for (const batch of batches) {
      const detail = await sample('batch_detail_at_10000_cards', () =>
        request('ADMIN_AUDITOR', `/production-batches/${batch.id}`),
      );
      assert.equal(detail.counts.actualCardCount, 250);
      await sample('cards_112_all_pages', async () => {
        let cursor: string | null = null;
        const ids = new Set<string>();
        do {
          const page = await request(
            'MASTER',
            `/work-card-sets/${batch.setId}/work-cards?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          for (const card of page.items) ids.add(card.id);
          cursor = page.nextCursor;
        } while (cursor);
        assert.equal(ids.size, 112);
      });
      await sample('audit_254_all_pages', async () => {
        let cursor: string | null = null;
        const ids = new Set<string>();
        do {
          const page = await request(
            'ADMIN_AUDITOR',
            `/audit-correlations/${batch.correlationId}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          assert.equal(page.totalEventCount, 254);
          assert.equal(page.expectedEventCount, 254);
          for (const event of page.events) ids.add(event.id);
          cursor = page.nextCursor;
        } while (cursor);
        assert.equal(ids.size, 254);
      });
    }
    // Concurrent reads, with one request per worker, supplement sequential measurements.
    await sample('four_concurrent_batch_reads', async () => {
      await Promise.all(
        batches.slice(0, 4).map(async (batch) => {
          const detail = await request('ADMIN_AUDITOR', `/production-batches/${batch.id}`);
          assert.equal(detail.counts.actualCardCount, 250);
        }),
      );
    });
    const volume = (
      await db.owner.query(
        'SELECT (SELECT COUNT(*)::int FROM production_batches) AS batches, (SELECT COUNT(*)::int FROM work_card_sets) AS sets, (SELECT COUNT(*)::int FROM work_cards) AS cards, (SELECT COUNT(*)::int FROM audit_events) AS events',
      )
    ).rows[0];
    assert.equal(volume.cards, 10000);
    const measurements = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [
          name,
          {
            samples: values.length,
            minMs: sorted[0],
            medianMs:
              (sorted[Math.floor((sorted.length - 1) / 2)]! +
                sorted[Math.floor(sorted.length / 2)]!) /
              2,
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
            maxMs: sorted.at(-1),
            rawMs: values,
          },
        ];
      }),
    );
    const report = {
      measuredAt: new Date().toISOString(),
      baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      worktree:
        spawnSync('git', ['diff', '--quiet']).status === 0
          ? 'clean tracked files'
          : 'uncommitted changes',
      environment: {
        node: process.version,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryGiB: totalmem() / 2 ** 30,
        postgres: (await db.owner.query('SHOW server_version')).rows[0].server_version,
      },
      volume,
      conditions:
        'Real loopback HTTP + runtime role + isolated PostgreSQL. Sequential command samples during growth; read samples after 10,000 cards and ANALYZE; one warm-up detail read. No business SLA or production load claim.',
      measurements,
    };
    await mkdir('.quality-results', { recursive: true });
    await writeFile('.quality-results/performance.json', JSON.stringify(report, null, 2));
    console.info(
      JSON.stringify(
        {
          volume,
          measurements: Object.fromEntries(
            Object.entries(measurements).map(([name, result]) => [
              name,
              { ...result, rawMs: undefined },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await api.app.close();
  }
} finally {
  await db.dispose();
}
