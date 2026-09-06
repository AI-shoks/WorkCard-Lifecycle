import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

const canonical = process.env['QUALITY_CANONICAL'] === '1';
const counts = canonical ? [112, 112, 26] : [2, 2, 2];
const total = counts.reduce((sum, value) => sum + value, 0);
const roleIds = {
  planner: '10000000-0000-4000-8000-000000000001',
  master: '10000000-0000-4000-8000-000000000002',
  worker: '10000000-0000-4000-8000-000000000003',
  quality: '10000000-0000-4000-8000-000000000005',
  auditor: '10000000-0000-4000-8000-000000000006',
};

async function role(page: Page, name: keyof typeof roleIds) {
  await page
    .getByRole('combobox', { name: 'Демонстрационная роль', exact: true })
    .selectOption(roleIds[name]);
  await expect(page.locator('#demo-role')).toHaveValue(roleIds[name]);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function uiCommand(page: Page, path: string, button: string, expected = 200) {
  const target = button === 'Выпустить все комплекты' ? page.getByRole('dialog') : page;
  const [result] = await Promise.all([
    page.waitForResponse(
      (value) => value.url().endsWith(`/api/v1${path}`) && value.request().method() === 'POST',
    ),
    target.getByRole('button', { name: button, exact: true }).click(),
  ]);
  expect(result.status(), await result.text()).toBe(expected);
  return result.json();
}
async function get(page: Page, path: string) {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function allCardLinks(page: Page) {
  await expect(page.locator('.entity-row--card').first()).toBeVisible();
  while (await page.getByRole('button', { name: 'Загрузить ещё', exact: true }).count()) {
    const next = page.waitForResponse(
      (response) =>
        response.url().includes('/work-cards?') && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Загрузить ещё', exact: true }).click();
    expect((await next).status()).toBe(200);
    await expect(
      page.getByRole('button', { name: 'Загружаем следующую страницу', exact: true }),
    ).toHaveCount(0);
  }
  return page
    .locator('.entity-row--card a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
}
async function finishCard(page: Page, path: string) {
  await page.goto(path);
  await uiCommand(page, `${path}/start`, 'Зафиксировать начало');
  await uiCommand(page, `${path}/complete`, 'Зафиксировать завершение');
  await expect(
    page.getByText('Завершение работы зафиксировано мастером', { exact: true }),
  ).toBeVisible();
}
async function checkVisibleUi(page: Page) {
  expect(await page.locator('html').getAttribute('lang')).toBe('ru');
  expect(await page.locator('body').innerText()).not.toMatch(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test(`${canonical ? 'canonical 112 → 3 → 250' : 'compact 112 → 3 → 6'}: every lifecycle transition, separate final acceptance and audit/payroll read-back through UI`, async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const mutations: { url: string; commandId: string }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && !request.url().endsWith('/demo-session'))
      mutations.push({ url: request.url(), commandId: request.postDataJSON().commandId });
  });
  await page.goto('/batches/new');
  await role(page, 'planner');
  await expect(page.getByLabel('Количество изделий в партии')).toHaveValue('112');
  const created = await uiCommand(page, '/production-batches', 'Создать партию', 201);
  const batchId: string = created.batch.id;
  await expect(page).toHaveURL(new RegExp(`/batches/${batchId}$`));
  await page.getByRole('button', { name: /Выпустить.*комплект/ }).click();
  const released = await uiCommand(
    page,
    `/production-batches/${batchId}/release`,
    'Выпустить все комплекты',
  );
  expect(released).toMatchObject({ setCount: 3, actualCardCount: total });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Выпустить.*комплект/ })).toBeDisabled();
  const batch = await get(page, `/production-batches/${batchId}`);
  expect(batch.counts).toMatchObject({ setCount: 3, actualCardCount: total, closedCardCount: 0 });
  const sets = batch.sets as { id: string; plannedCardCount: number; scopeCode: string }[];
  sets.sort((a, b) => a.scopeCode.localeCompare(b.scopeCode));
  expect(sets.map((set) => set.plannedCardCount)).toEqual(counts);
  await role(page, 'quality');
  await expect(
    page.getByRole('button', { name: 'Принять завершённую партию', exact: true }),
  ).toBeDisabled();
  await checkVisibleUi(page);

  const firstCards: string[] = [];
  await role(page, 'master');
  for (const set of sets) {
    await page.goto(`/card-sets/${set.id}`);
    const first = page.locator('.entity-row--card').first();
    await first.getByRole('radio').check();
    const path = (await first.locator('a').getAttribute('href'))!;
    firstCards.push(path);
    await page
      .locator('.assignment-command')
      .getByRole('combobox', { name: 'Исполнитель', exact: true })
      .selectOption(roleIds.worker);
    await page.getByRole('button', { name: 'Назначить для первой детали', exact: true }).click();
    await uiCommand(
      page,
      `/work-card-sets/${set.id}/assignments`,
      'Подтвердить назначение карточек',
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await finishCard(page, path);
  }
  await role(page, 'quality');
  for (const [index, path] of firstCards.entries()) {
    await page.goto(path);
    await page
      .getByRole('button', {
        name: 'Принять первую деталь и открыть обработку партии',
        exact: true,
      })
      .click();
    await uiCommand(
      page,
      `/work-card-sets/${sets[index]!.id}/first-article-acceptance`,
      'Положительно принять первую деталь',
    );
    await expect(
      page.getByText('Первая деталь положительно принята', { exact: true }),
    ).toBeVisible();
  }

  const serialCards: string[] = [];
  await role(page, 'master');
  for (const [index, set] of sets.entries()) {
    await page.goto(`/card-sets/${set.id}`);
    const links = await allCardLinks(page);
    const serial = links.filter((path) => path !== firstCards[index]);
    serialCards.push(...serial);
    const groups = set.plannedCardCount === 112 ? [59, 52] : [set.plannedCardCount - 1];
    for (const [groupIndex, count] of groups.entries()) {
      await page.getByLabel('Количество из загруженных свободных карточек').fill(String(count));
      await page.getByRole('button', { name: 'Выбрать указанное количество', exact: true }).click();
      await page
        .locator('.assignment-command')
        .getByRole('combobox', { name: 'Исполнитель', exact: true })
        .selectOption(groupIndex === 0 ? roleIds.worker : '10000000-0000-4000-8000-000000000004');
      await page
        .locator('.assignment-command')
        .getByRole('button', { name: /^Назначить / })
        .click();
      await uiCommand(
        page,
        `/work-card-sets/${set.id}/assignments`,
        'Подтвердить назначение карточек',
      );
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    if (canonical && set.plannedCardCount === 112)
      await expect(page.locator('.assignment-equation strong')).toHaveText(
        '1 + 59 + 52 = 112 карточек',
      );
    await checkVisibleUi(page);
    for (const path of serial) await finishCard(page, path);
  }
  expect(serialCards).toHaveLength(total - 3);
  await role(page, 'quality');
  for (const path of serialCards) {
    await page.goto(path);
    await page
      .getByRole('button', { name: 'Подтвердить качество и закрыть карточку', exact: true })
      .click();
    await uiCommand(page, `${path}/quality-confirmation`, 'Положительно подтвердить качество');
    await expect(page.getByText('Качество карточки подтверждено', { exact: true })).toBeVisible();
  }

  await page.goto(`/batches/${batchId}`);
  const allClosed = await get(page, `/production-batches/${batchId}`);
  expect(allClosed.counts.closedCardCount).toBe(total);
  expect(allClosed.finalAcceptance).toBeNull();
  await page.getByRole('button', { name: 'Принять завершённую партию', exact: true }).click();
  const accepted = await uiCommand(
    page,
    `/production-batches/${batchId}/final-acceptance`,
    'Подтвердить финальную приёмку',
    201,
  );
  await expect(
    page.locator('.notice strong').filter({ hasText: /^Финальная приёмка партии подтверждена$/ }),
  ).toBeVisible();
  const finalRead = await get(page, `/production-batches/${batchId}`);
  expect(finalRead.finalAcceptance).toEqual(accepted.acceptance);
  await page.reload();
  await expect(
    page.getByText('Идентификатор записи сверён обязательным контрольным чтением'),
  ).toBeVisible();
  await checkVisibleUi(page);
  await page.screenshot({ path: testInfo.outputPath('final-acceptance.png'), fullPage: true });

  await role(page, 'auditor');
  await page.goto(`${serialCards[0]}/audit`);
  await page
    .getByRole('button', { name: 'Проверить полный связанный набор', exact: true })
    .first()
    .click();
  await expect(page.getByText('Полный набор событий подтверждён', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      `Сервер ожидал ${total + 4}, насчитал ${total + 4}, клиент получил все ${total + 4} уникальных событий.`,
    ),
  ).toBeVisible();
  await page.goto(`${serialCards[0]}/payroll`);
  await page
    .getByRole('button', { name: 'Создать тестовую запись нормо-часов', exact: true })
    .click();
  const payroll = await uiCommand(
    page,
    `${serialCards[0]}/payroll-export`,
    'Подтвердить создание тестовой записи',
    201,
  );
  await expect(page.getByRole('region', { name: 'Тестовая запись нормо-часов' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Тестовая запись нормо-часов' })).toBeVisible();
  expect(await get(page, `${serialCards[0]}/payroll-record`)).toEqual(payroll.payrollRecord);
  expect(mutations.filter((entry) => entry.url.endsWith('/payroll-export'))).toHaveLength(1);
  await role(page, 'worker');
  await page.goto(serialCards[0]!);
  await expect(
    page.getByRole('button', { name: /Зафиксировать|Подтвердить качество/ }),
  ).toHaveCount(0);
  await page.goto(`${serialCards[0]}/audit`);
  await expect(page.getByRole('heading', { name: 'Доступ ограничен', exact: true })).toBeVisible();

  const db = new Pool({
    connectionString: process.env['QUALITY_READ_URL'],
    options: '-c default_transaction_read_only=on',
  });
  try {
    const saved = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM work_cards WHERE batch_id=$1 AND status='CLOSED') AS closed, (SELECT COUNT(*)::int FROM final_batch_acceptances WHERE batch_id=$1) AS accepted, (SELECT COUNT(*)::int FROM payroll_records WHERE work_card_id=$2) AS payroll, (SELECT COUNT(*)::int FROM audit_events WHERE correlation_id=$3) AS release_events`,
      [batchId, serialCards[0]!.split('/').at(-1), released.correlationId],
    );
    expect(saved.rows).toEqual([
      { closed: total, accepted: 1, payroll: 1, release_events: total + 4 },
    ]);
    const commands = await db.query(
      "SELECT COUNT(*)::int AS count FROM command_receipts WHERE command_id=ANY($1::uuid[]) AND state='SUCCEEDED'",
      [mutations.map((entry) => entry.commandId)],
    );
    expect(commands.rows[0].count).toBe(mutations.length);
    expect(new Set(mutations.map((entry) => entry.commandId)).size).toBe(mutations.length);
  } finally {
    await db.end();
  }
  expect(errors).toEqual([]);
  await testInfo.attach('coverage', {
    body: JSON.stringify({
      scale: canonical ? 'canonical' : 'compact',
      quantity: 112,
      sets: counts,
      closed: total,
      uiCommands: mutations.length,
      releaseEvents: total + 4,
      finalAcceptances: 1,
      payrollRecords: 1,
    }),
    contentType: 'application/json',
  });
});
