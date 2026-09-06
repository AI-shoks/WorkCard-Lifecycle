import type { Role } from '@work-card/contracts';

export type ScreenId = 'S-01' | 'S-02' | 'S-03' | 'S-04' | 'S-05' | 'S-06' | 'S-07';

export type ScreenRoute = {
  kind: 'screen';
  screenId: ScreenId;
  pathname: string;
  params: {
    batchId?: string;
    setId?: string;
    workCardId?: string;
  };
};

export type NotFoundRoute = {
  kind: 'not-found';
  pathname: string;
};

export type AppRoute = ScreenRoute | NotFoundRoute;

export type RouteAccess = 'allowed' | 'authentication-required' | 'forbidden';

export type Breadcrumb = {
  label: string;
  to?: string;
};

export const screenTitles: Record<ScreenId, string> = {
  'S-01': 'Производственные партии',
  'S-02': 'Новая производственная партия',
  'S-03': 'Партия',
  'S-04': 'Комплект рабочих карточек',
  'S-05': 'Рабочая карточка',
  'S-06': 'Журнал действий',
  'S-07': 'Учебный расчёт',
};

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function screenRoute(
  screenId: ScreenId,
  pathname: string,
  params: ScreenRoute['params'] = {},
): ScreenRoute {
  return { kind: 'screen', screenId, pathname, params };
}

export function matchAppRoute(inputPathname: string): AppRoute {
  const pathname = inputPathname.length > 1 ? inputPathname.replace(/\/+$/, '') : inputPathname;

  if (pathname === '/' || pathname === '/batches') {
    return screenRoute('S-01', '/batches');
  }

  if (pathname === '/batches/new') {
    return screenRoute('S-02', pathname);
  }

  const batchMatch = /^\/batches\/([^/]+)$/.exec(pathname);
  if (batchMatch?.[1]) {
    return screenRoute('S-03', pathname, { batchId: decoded(batchMatch[1]) });
  }

  const setMatch = /^\/card-sets\/([^/]+)$/.exec(pathname);
  if (setMatch?.[1]) {
    return screenRoute('S-04', pathname, { setId: decoded(setMatch[1]) });
  }

  const auditMatch = /^\/work-cards\/([^/]+)\/audit$/.exec(pathname);
  if (auditMatch?.[1]) {
    return screenRoute('S-06', pathname, { workCardId: decoded(auditMatch[1]) });
  }

  const payrollMatch = /^\/work-cards\/([^/]+)\/payroll$/.exec(pathname);
  if (payrollMatch?.[1]) {
    return screenRoute('S-07', pathname, { workCardId: decoded(payrollMatch[1]) });
  }

  const workCardMatch = /^\/work-cards\/([^/]+)$/.exec(pathname);
  if (workCardMatch?.[1]) {
    return screenRoute('S-05', pathname, { workCardId: decoded(workCardMatch[1]) });
  }

  return { kind: 'not-found', pathname };
}

export function canAccessScreen(role: Role, screenId: ScreenId): boolean {
  if (screenId === 'S-02') return role === 'PLANNER';
  if (screenId === 'S-06' || screenId === 'S-07') return role === 'ADMIN_AUDITOR';
  return true;
}

export function routeAccessFor(role: Role | null, route: AppRoute): RouteAccess {
  if (!role) return 'authentication-required';
  if (route.kind === 'screen' && !canAccessScreen(role, route.screenId)) return 'forbidden';
  return 'allowed';
}

export function breadcrumbsFor(route: AppRoute): Breadcrumb[] {
  if (route.kind === 'not-found') return [{ label: 'Страница не найдена' }];

  const batches: Breadcrumb = { label: 'Партии', to: '/batches' };

  switch (route.screenId) {
    case 'S-01':
      return [{ label: 'Партии' }];
    case 'S-02':
      return [batches, { label: 'Новая партия' }];
    case 'S-03':
      return [batches, { label: 'Партия' }];
    case 'S-04':
      return [batches, { label: 'Комплект' }];
    case 'S-05':
      return [batches, { label: 'Рабочая карточка' }];
    case 'S-06':
      return [
        batches,
        {
          label: 'Рабочая карточка',
          to: `/work-cards/${encodeURIComponent(route.params.workCardId ?? '')}`,
        },
        { label: 'Журнал действий' },
      ];
    case 'S-07':
      return [
        batches,
        {
          label: 'Рабочая карточка',
          to: `/work-cards/${encodeURIComponent(route.params.workCardId ?? '')}`,
        },
        { label: 'Учебный расчёт' },
      ];
  }
}

export function titleForRoute(route: AppRoute): string {
  return route.kind === 'screen' ? screenTitles[route.screenId] : 'Страница не найдена';
}
