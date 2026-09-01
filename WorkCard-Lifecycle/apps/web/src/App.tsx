import { useEffect, useState } from 'react';

import { fetchReadiness, toReadinessView } from './health.js';
import type { ReadinessResponse } from '@work-card/contracts';

export function App() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const view = toReadinessView(readiness);

  useEffect(() => {
    const controller = new AbortController();

    void fetchReadiness(controller.signal)
      .then(setReadiness)
      .catch(() => setReadiness(null));

    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Независимый демонстрационный проект</p>
        <h1 id="page-title">Жизненный цикл рабочей карточки</h1>
        <p className="summary">
          Базовая среда приложения собрана. Производственный сценарий будет подключаться малыми
          проверяемыми срезами.
        </p>

        <div className={`status status--${view.tone}`} role="status" aria-live="polite">
          <span className="status__dot" aria-hidden="true" />
          <span>{view.label}</span>
        </div>

        <p className="boundary">
          Здесь используются только синтетические данные. Приложение не подключено к реальным
          производственным или расчётным системам.
        </p>
      </section>
    </main>
  );
}
