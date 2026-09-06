import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AccessDenied, RouteLoadingState, ScreenContent } from './ScreenContent.js';
import { matchAppRoute } from './app-routing.js';

describe('состояния экранов', () => {
  it('объявляет загрузку и оставляет понятное текстовое состояние', () => {
    const markup = renderToStaticMarkup(<RouteLoadingState />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Загружаем данные');
    expect(markup).toContain('Оболочка и активная роль уже доступны');
  });

  it('не раскрывает содержимое защищённого маршрута в состоянии доступа', () => {
    const markup = renderToStaticMarkup(
      <AccessDenied navigate={vi.fn()} roleLabel="Мастер участка" />,
    );

    expect(markup).toContain('Доступ ограничен');
    expect(markup).toContain('Мастер участка');
    expect(markup).not.toContain('Журнал действий');
    expect(markup).not.toContain('Учебный расчёт');
  });

  it('останавливает защищённый экран до создания audit/payroll-компонента', () => {
    const markup = renderToStaticMarkup(
      <ScreenContent
        navigate={vi.fn()}
        onRefresh={vi.fn()}
        permissions={['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']}
        role="MASTER"
        roleLabel="Мастер участка"
        route={matchAppRoute('/work-cards/technical-card-id/audit')}
      />,
    );

    expect(markup).toContain('Содержимое защищённого раздела не загружалось');
    expect(markup).not.toContain('Загружаем историю');
  });

  it('показывает создание партии только роли ПДБ', () => {
    const route = matchAppRoute('/batches');
    const commonProps = { navigate: vi.fn(), onRefresh: vi.fn(), route };
    const plannerMarkup = renderToStaticMarkup(
      <ScreenContent
        {...commonProps}
        permissions={['CreateProductionBatch', 'ReleaseWorkCards']}
        role="PLANNER"
      />,
    );
    const masterMarkup = renderToStaticMarkup(
      <ScreenContent
        {...commonProps}
        permissions={['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']}
        role="MASTER"
      />,
    );

    expect(plannerMarkup).toContain('Создать партию');
    expect(masterMarkup).not.toContain('Создать партию');
    expect(masterMarkup).toContain('Получаем первую страницу партий с сервера');
  });

  it('оставляет технические коды в закрытом вложенном блоке', () => {
    const markup = renderToStaticMarkup(
      <ScreenContent
        navigate={vi.fn()}
        onRefresh={vi.fn()}
        permissions={['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']}
        role="MASTER"
        route={matchAppRoute('/work-cards/technical-card-id')}
      />,
    );

    expect(markup).toContain(
      '<details class="developer-details" data-ux-technical-exception="developer-codes">',
    );
    expect(markup).not.toContain('open=""');
    expect(markup).toContain('Технические коды для разработчика');
    expect(markup).toContain('не являются номерами деталей или карточек');
  });
});
