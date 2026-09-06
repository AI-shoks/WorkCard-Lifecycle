import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

test('two stale tabs conflict, and a committed command with a lost response recovers by reads without retry', async ({
  page,
  context,
}) => {
  const commandIds: string[] = [];
  const post = async (target: Page, suffix: string, name: string, status = 200) => {
    const scope = name === 'Выпустить все комплекты' ? target.getByRole('dialog') : target;
    const [response] = await Promise.all([
      target.waitForResponse(
        (response) => response.url().endsWith(suffix) && response.request().method() === 'POST',
      ),
      scope.getByRole('button', { name, exact: true }).click(),
    ]);
    expect(response.status()).toBe(status);
    commandIds.push(response.request().postDataJSON().commandId);
    return response.json();
  };
  await page.goto('/batches/new');
  await page
    .getByRole('combobox', { name: 'Демонстрационная роль', exact: true })
    .selectOption('10000000-0000-4000-8000-000000000001');
  const created = await post(page, '/production-batches', 'Создать партию', 201);
  await expect(page).toHaveURL(new RegExp(`/batches/${created.batch.id}$`));
  await page.getByRole('button', { name: /Выпустить.*комплект/ }).click();
  await post(page, '/release', 'Выпустить все комплекты');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Демонстрационная роль', exact: true })
    .selectOption('10000000-0000-4000-8000-000000000002');
  await page.locator('.entity-list--sets a').first().click();
  const first = page.locator('.entity-row--card').first();
  await first.getByRole('radio').check();
  const cardPath = (await first.locator('a').getAttribute('href'))!;
  await page
    .locator('.assignment-command')
    .getByRole('combobox', { name: 'Исполнитель', exact: true })
    .selectOption('10000000-0000-4000-8000-000000000003');
  await page.getByRole('button', { name: 'Назначить для первой детали', exact: true }).click();
  await post(page, '/assignments', 'Подтвердить назначение карточек');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(cardPath);
  await expect(
    page.getByRole('button', { name: 'Зафиксировать начало', exact: true }),
  ).toBeEnabled();
  const competitor = await context.newPage();
  await competitor.goto(cardPath);
  await post(competitor, '/start', 'Зафиксировать начало');
  await expect(
    competitor.getByRole('button', { name: 'Зафиксировать завершение', exact: true }),
  ).toBeEnabled();
  const conflict = await post(page, '/start', 'Зафиксировать начало', 409);
  expect(conflict.code).toBe('VERSION_CONFLICT');
  await expect(
    page.getByText('Данные перечитаны после неподтверждённого действия', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Зафиксировать завершение', exact: true }),
  ).toBeEnabled();
  await competitor.close();

  let sent = 0;
  let lostCommand = '';
  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET') reads.push(request.url());
  });
  await page.route('**/api/v1/work-cards/*/complete', async (route) => {
    sent++;
    lostCommand = route.request().postDataJSON().commandId;
    // Forward the UI request to the real API, wait for COMMIT, then drop its response.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Зафиксировать завершение', exact: true }).click();
  await expect(
    page.getByText('Данные перечитаны после неподтверждённого действия', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Зафиксировать завершение', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Завершение работы зафиксировано мастером', { exact: true }),
  ).toHaveCount(0);
  expect(sent).toBe(1);
  expect(reads.some((url) => url.endsWith(`/api/v1${cardPath}`))).toBe(true);
  expect(reads.some((url) => url.includes('/api/v1/work-card-sets/'))).toBe(true);
  await page.reload();
  await expect(page.locator('.summary-panel').first()).toContainText('Работа завершена');
  expect(sent).toBe(1);
  const db = new Pool({
    connectionString: process.env['QUALITY_READ_URL'],
    options: '-c default_transaction_read_only=on',
  });
  try {
    const cardId = cardPath.split('/').at(-1);
    const result = await db.query('SELECT status, version FROM work_cards WHERE id=$1', [cardId]);
    expect(result.rows).toEqual([{ status: 'COMPLETED', version: 4 }]);
    expect(
      (
        await db.query('SELECT COUNT(*)::int AS count FROM audit_events WHERE command_id=$1', [
          lostCommand,
        ])
      ).rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (await db.query('SELECT state FROM command_receipts WHERE command_id=$1', [lostCommand]))
        .rows,
    ).toEqual([{ state: 'SUCCEEDED' }]);
    expect(
      (
        await db.query('SELECT COUNT(*)::int AS count FROM command_receipts WHERE command_id=$1', [
          commandIds.at(-1),
        ])
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await db.end();
  }
});
