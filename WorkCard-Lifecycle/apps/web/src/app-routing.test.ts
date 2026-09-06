import { describe, expect, it } from 'vitest';
import type { Role } from '@work-card/contracts';

import {
  breadcrumbsFor,
  canAccessScreen,
  matchAppRoute,
  routeAccessFor,
  type ScreenId,
} from './app-routing.js';

describe('маршруты приложения', () => {
  it.each([
    ['/batches', 'S-01'],
    ['/batches/new', 'S-02'],
    ['/batches/batch-id', 'S-03'],
    ['/card-sets/set-id', 'S-04'],
    ['/work-cards/card-id', 'S-05'],
    ['/work-cards/card-id/audit', 'S-06'],
    ['/work-cards/card-id/payroll', 'S-07'],
  ] as const)('сопоставляет %s с экраном %s', (pathname, screenId) => {
    expect(matchAppRoute(pathname)).toMatchObject({ kind: 'screen', screenId });
  });

  it('канонизирует корень и завершающий слеш списка партий', () => {
    expect(matchAppRoute('/')).toEqual({
      kind: 'screen',
      params: {},
      pathname: '/batches',
      screenId: 'S-01',
    });
    expect(matchAppRoute('/batches/')).toEqual(matchAppRoute('/batches'));
  });

  it('не принимает похожий неизвестный адрес за предметный маршрут', () => {
    expect(matchAppRoute('/work-cards/card-id/unknown')).toEqual({
      kind: 'not-found',
      pathname: '/work-cards/card-id/unknown',
    });
  });

  it('не выводит технический идентификатор в хлебные крошки', () => {
    const route = matchAppRoute('/work-cards/technical-card-id/audit');
    const visibleLabels = breadcrumbsFor(route).map((item) => item.label);

    expect(visibleLabels).toEqual(['Партии', 'Рабочая карточка', 'Журнал действий']);
    expect(visibleLabels.join(' ')).not.toContain('technical-card-id');
  });
});

describe('доступ по ролям', () => {
  const roles: Role[] = ['PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR'];

  it('оставляет создание партии только специалисту ПДБ', () => {
    expect(roles.filter((role) => canAccessScreen(role, 'S-02'))).toEqual(['PLANNER']);
  });

  it.each(['S-06', 'S-07'] satisfies ScreenId[])(
    'оставляет защищённый экран %s только администратору-аудитору',
    (screenId) => {
      expect(roles.filter((role) => canAccessScreen(role, screenId))).toEqual(['ADMIN_AUDITOR']);
    },
  );

  it.each(['S-01', 'S-03', 'S-04', 'S-05'] satisfies ScreenId[])(
    'разрешает общий предметный маршрут %s всем демонстрационным ролям',
    (screenId) => {
      expect(roles.every((role) => canAccessScreen(role, screenId))).toBe(true);
    },
  );

  it('не открывает ни один маршрут до подтверждения серверной сессии', () => {
    expect(routeAccessFor(null, matchAppRoute('/batches'))).toBe('authentication-required');
    expect(routeAccessFor(null, matchAppRoute('/work-cards/card-id/audit'))).toBe(
      'authentication-required',
    );
  });

  it('пересчитывает защищённый маршрут после смены подтверждённой роли', () => {
    const auditRoute = matchAppRoute('/work-cards/card-id/audit');

    expect(routeAccessFor('PLANNER', auditRoute)).toBe('forbidden');
    expect(routeAccessFor('ADMIN_AUDITOR', auditRoute)).toBe('allowed');
  });
});
