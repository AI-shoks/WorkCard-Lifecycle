// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppComponent } from './App.js';
import { isProjectPage } from './app-routing.js';

const fetchMock = vi.fn<typeof fetch>();
let App: typeof AppComponent;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  ({ App } = await import('./App.js'));
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockRejectedValue(new Error('API недоступен'));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  window.history.replaceState(null, '', '/about');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPage() {
  await act(async () => root.render(<App />));
}

async function clickLink(href: string) {
  const link = container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  if (!link) throw new Error(`Не найден переход ${href}`);
  await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
}

describe('публичная страница проекта', () => {
  it.each(['/about', '/about/', '/about///'])('опознаёт публичный адрес %s', (pathname) => {
    expect(isProjectPage(pathname)).toBe(true);
  });

  it.each(['/', '/batches', '/about-other', '/about/extra', '/work-cards/card-id/audit'])(
    'не открывает публичную страницу вместо %s',
    (pathname) => expect(isProjectPage(pathname)).toBe(false),
  );

  it('открывает кейс без сессии, readiness и предметных запросов при недоступном API', async () => {
    await openPage();

    expect(container.querySelector('h1')?.textContent).toContain('от выпуска до приёмки');
    expect(document.title).toBe('О проекте · Рабочие карточки');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('Выберите демонстрационную роль');
    expect(container.querySelector('#project-minute')).not.toBeNull();
    expect(container.querySelector('#project-engineering')).not.toBeNull();
    expect(container.textContent).toContain('синтетические');
    expect(container.textContent).toContain('Проверка отката не выполнена');
  });

  it('начинает штатную подготовку сессии только при переходе к рабочему демо', async () => {
    await openPage();
    await clickLink('/batches');

    expect(window.location.pathname).toBe('/batches');
    expect(fetchMock).toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Не удалось подготовить сессию');
    expect(container.querySelector('a[href="/about"]')?.textContent).toContain('О проекте');

    const requestCount = fetchMock.mock.calls.length;
    await clickLink('/about');
    expect(window.location.pathname).toBe('/about');
    expect(container.querySelector('#project-minute')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  it('обрабатывает возврат браузера к кейсу без новых запросов', async () => {
    window.history.replaceState(null, '', '/batches');
    await openPage();
    const requestCount = fetchMock.mock.calls.length;

    await act(async () => {
      window.history.replaceState(null, '', '/about/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(container.querySelector('#project-minute')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  it('связывает все якоря с разделами и не оставляет пустых переходов', async () => {
    await openPage();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')];
    for (const link of links) {
      const href = link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
      if (href?.startsWith('#')) expect(container.querySelector(href)).not.toBeNull();
    }
    expect(links.some((link) => link.href.includes('docs/portfolio/screenshots.md'))).toBe(true);
    expect(links.some((link) => link.href.includes('docs/portfolio/demo-script.md'))).toBe(true);
  });
});
