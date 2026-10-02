import { expect, test } from '@playwright/test';

const isProtectedRequest = (url: string) => /^\/(api|health)\//.test(new URL(url).pathname);

for (const pathname of ['/about', '/about/']) {
  test(`public case ${pathname} opens without a session or API`, async ({ page, context }) => {
    const protectedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await context.route('**/*', async (route) => {
      if (isProtectedRequest(route.request().url())) {
        protectedRequests.push(new URL(route.request().url()).pathname);
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto(pathname);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Рабочая карточка: от выпуска до приёмки',
    );
    await expect(page).toHaveTitle('О проекте · Рабочие карточки');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByText('Выберите демонстрационную роль', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Что проверено', { exact: true })).toBeVisible();
    await expect(page.getByText('Проверка отката не выполнена.', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Показ за 5–7 минут', exact: true }),
    ).toHaveAttribute('href', /demo-script\.md#короткий-показ$/);
    await expect(page.getByRole('link', { name: 'Подробный кейс', exact: true })).toHaveAttribute(
      'href',
      /\/WorkCard-Lifecycle\/README\.md$/,
    );
    await expect(page.getByRole('heading', { name: 'Артём', exact: true })).toBeVisible();
    const author = page.locator('#project-author');
    await expect(author).toContainText('Направление — системный и бизнес-анализ.');
    await expect(author.getByRole('heading', { name: 'Мой вклад', exact: true })).toBeVisible();
    await expect(author).toContainText(
      'Исследование процесса, постановка задачи, требования, модель и проверка результата.',
    );
    await expect(
      author.getByRole('heading', { name: 'Как использовал ИИ', exact: true }),
    ).toBeVisible();
    await expect(author).toContainText(
      'ИИ помогал готовить документацию, код и проверки; решения и итоговый результат я оценивал сам.',
    );
    await expect(
      page.getByRole('link', { name: 'Связаться в Telegram · @AIShokstg', exact: true }),
    ).toHaveAttribute('href', 'https://t.me/AIShokstg');
    await page.waitForLoadState('networkidle');
    expect(protectedRequests).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
  });
}

test('public case is reachable from the demo when its API is unavailable', async ({
  page,
  context,
}) => {
  const protectedRequests: string[] = [];
  await context.route('**/*', async (route) => {
    if (isProtectedRequest(route.request().url())) {
      protectedRequests.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"detail":"Unavailable"}',
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/about');
  await page.getByRole('link', { name: 'Открыть демо', exact: true }).first().click();
  await expect(page).toHaveURL(/\/batches$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось подготовить сессию');
  expect(protectedRequests).toContain('/api/v1/demo-users');
  expect(protectedRequests).toContain('/health/ready');
  const requestsBeforeReturn = protectedRequests.length;

  await page.getByRole('link', { name: 'О проекте и авторе', exact: false }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Рабочая карточка: от выпуска до приёмки',
  );
  await page.waitForLoadState('networkidle');
  expect(protectedRequests).toHaveLength(requestsBeforeReturn);

  await page.goBack();
  await expect(page).toHaveURL(/\/batches$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось подготовить сессию');
  const requestsBeforeForward = protectedRequests.length;
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Рабочая карточка: от выпуска до приёмки',
  );
  await page.waitForLoadState('networkidle');
  expect(protectedRequests).toHaveLength(requestsBeforeForward);
});

test('selected server role is restored after visiting the public case', async ({ page }) => {
  test.skip(
    process.env['QUALITY_PUBLIC_ONLY'] === '1',
    'Local public-only preview has no session API.',
  );
  const masterId = '10000000-0000-4000-8000-000000000002';
  const protectedRequests: string[] = [];
  page.on('request', (request) => {
    if (isProtectedRequest(request.url())) protectedRequests.push(new URL(request.url()).pathname);
  });
  await page.goto('/batches');
  await page.locator('#initial-demo-role').selectOption(masterId);
  await expect(page.locator('#demo-role')).toHaveValue(masterId);
  await page.locator('.topbar').getByRole('link', { name: 'О проекте', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Рабочая карточка: от выпуска до приёмки',
  );
  const requestsAtPublicEntry = protectedRequests.length;
  await page.waitForLoadState('networkidle');
  expect(protectedRequests).toHaveLength(requestsAtPublicEntry);
  await page.getByRole('link', { name: 'Открыть демо', exact: true }).first().click();
  await expect(page.locator('#demo-role')).toHaveValue(masterId);
  await expect(page.getByText('Выберите демонстрационную роль', { exact: true })).toHaveCount(0);
});
