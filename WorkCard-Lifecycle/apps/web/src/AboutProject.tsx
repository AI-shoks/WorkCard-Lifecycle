import { AppLink } from './AppLink.js';
import { Brand } from './Brand.js';
import { Icon } from './Icon.js';
import { PageHeading, type Navigate } from './screen-ui.js';

const repositoryUrl = 'https://github.com/AI-shoks/WorkCard-Lifecycle';
const caseUrl = `${repositoryUrl}/blob/main/WorkCard-Lifecycle/README.md`;
const docsUrl = `${repositoryUrl}/blob/main/WorkCard-Lifecycle/docs`;

const process = [
  {
    role: 'ПДБ',
    title: 'Подготовить работу',
    text: 'Создать партию по паспорту и выпустить комплекты рабочих карточек.',
  },
  {
    role: 'Мастер',
    title: 'Провести выполнение',
    text: 'Назначить исполнителя, зафиксировать начало и завершение работы.',
  },
  {
    role: 'БТК',
    title: 'Подтвердить качество',
    text: 'Принять первую деталь для открытия обработки партии, затем каждую карточку.',
  },
  {
    role: 'БТК',
    title: 'Принять партию',
    text: 'Отдельно подтвердить финальную приёмку после закрытия всех обязательных карточек.',
  },
];

const decisions = [
  {
    title: 'Изменение и его история — вместе',
    text: 'Состояние, результат команды и аудит записываются одной транзакцией. Ошибка не оставляет частично выполненное действие.',
  },
  {
    title: 'Повтор доставки без повторного действия',
    text: 'Версии и блокировки защищают от конфликтов. Сохранённый результат команды позволяет вернуть уже выполненное решение.',
  },
  {
    title: 'Успех после контрольного чтения',
    text: 'При потере ответа интерфейс перечитывает данные. Он не повторяет производственное действие автоматически.',
  },
  {
    title: 'Полномочия определяет сервер',
    text: 'Подготовленные роли демонстрируют разделение ответственности; защищённые экраны и команды проверяются на сервере.',
  },
];

export function AboutProject({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        К основному содержанию
      </a>
      <div className="project-page">
        <header className="project-header">
          <Brand compact />
          <nav aria-label="Навигация по кейсу" className="project-header__nav">
            <a href="#project-minute">За минуту</a>
            <a href="#project-engineering">Инженерные решения</a>
            <AppLink className="button button--primary" navigate={navigate} to="/batches">
              Открыть демо <Icon className="button__icon" name="arrow-right" />
            </AppLink>
          </nav>
        </header>
        <main className="project-content" id="main-content">
          <div className="project-hero">
            <PageHeading
              description="Независимый портфолио-кейс: от постановки производственной задачи до работающего приложения с ролями, контролем качества и проверяемой историей действий."
              eyebrow="О проекте · WorkCard-Lifecycle"
              title="Рабочая карточка: от выпуска до приёмки"
            />
            <aside className="project-hero__summary" aria-label="Масштаб демонстрационного примера">
              <p className="project-overline">Синтетический пример</p>
              <div className="project-metrics">
                <p>
                  <strong>112</strong>
                  <span>изделий</span>
                </p>
                <p>
                  <strong>3</strong>
                  <span>комплекта</span>
                </p>
                <p>
                  <strong>250</strong>
                  <span>карточек</span>
                </p>
              </div>
              <p>
                Один процесс, разные зоны ответственности. Финальная приёмка партии — отдельное
                решение.
              </p>
              <a className="text-link" href={`${docsUrl}/portfolio/screenshots.md`}>
                Посмотреть экраны <Icon name="arrow-right" />
              </a>
            </aside>
          </div>

          <section
            className="content-card project-section"
            id="project-minute"
            aria-labelledby="minute-title"
          >
            <p className="project-overline">Первое знакомство · 1 минута</p>
            <h2 id="minute-title">Кому и зачем нужен такой процесс</h2>
            <div className="project-columns">
              <div>
                <h3>Задача</h3>
                <p>
                  При передаче работы между ПДБ, мастером и БТК важно видеть, кому назначена
                  карточка, что уже выполнено и можно ли переходить к следующему этапу.
                </p>
                <p>
                  Кейс переводит этот маршрут в цифровую модель с явными условиями перехода и
                  разделением ответственности.
                </p>
              </div>
              <div>
                <h3>Результат</h3>
                <p>
                  Работающее приложение связывает выпуск, назначение, выполнение, приёмку качества и
                  отдельную финальную приёмку партии. Аудитор видит историю и тестовую запись
                  нормо-часов.
                </p>
                <p>
                  Для быстрого знакомства достаточно паспорта, одной карточки и сохранённого
                  результата полного прогона.
                </p>
              </div>
            </div>
            <div className="project-links">
              <AppLink className="button button--primary" navigate={navigate} to="/batches">
                Посмотреть живое демо
              </AppLink>
              <a className="button button--secondary" href={`${docsUrl}/portfolio/screenshots.md`}>
                Три ключевых экрана
              </a>
              <a
                className="button button--secondary"
                href={`${docsUrl}/portfolio/demo-script.md#короткий-показ`}
              >
                Показ за 5–7 минут
              </a>
            </div>
            <p className="project-note">
              Демо использует общие синтетические данные с ежедневным сбросом. Бесплатный сервис
              может просыпаться после простоя или быть недоступен по квотам; экраны и документация
              доступны отдельно.
            </p>
          </section>

          <section
            className="content-card project-section"
            id="project-author"
            aria-labelledby="author-title"
          >
            <p className="project-overline">Автор кейса</p>
            <h2 id="author-title">Артём</h2>
            <p>Автор независимого портфолио-кейса WorkCard-Lifecycle.</p>
            <div className="project-columns">
              <div>
                <h3>Что можно обсудить на интервью</h3>
                <p>
                  Постановку задачи и границы решения, требования и критерии приёмки, модель
                  процесса, ролевой интерфейс и проверку результата.
                </p>
              </div>
              <div>
                <h3>Где посмотреть подтверждения</h3>
                <p>
                  В документации связаны происхождение решений, требования, модель предметной
                  области и сценарии проверок. Работающее демо показывает их реализацию.
                </p>
              </div>
            </div>
            <div className="project-links">
              <a className="button button--primary" href="https://t.me/AIShokstg">
                Связаться в Telegram · @AIShokstg
              </a>
              <a className="text-link" href={`${docsUrl}/project/decision-provenance.md`}>
                Происхождение решений
              </a>
              <a className="text-link" href={`${docsUrl}/domain/domain-model.md`}>
                Модель предметной области
              </a>
            </div>
          </section>
          <section
            className="content-card project-section"
            id="project-process"
            aria-labelledby="process-title"
          >
            <p className="project-overline">Процесс</p>
            <h2 id="process-title">Четыре шага с проверяемыми условиями</h2>
            <ol className="project-process">
              {process.map((step, index) => (
                <li key={step.title}>
                  <span className="project-process__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <p className="project-overline">{step.role}</p>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <p className="project-note">
              Исполнитель видит собственные назначения. Работу ведёт мастер, качество подтверждает
              БТК. Просмотр страницы кейса доступен без выбора роли.
            </p>
          </section>

          <section
            className="content-card project-section"
            id="project-engineering"
            aria-labelledby="engineering-title"
          >
            <p className="project-overline">Для технического интервьюера</p>
            <h2 id="engineering-title">Решения, которые защищают результат</h2>
            <p>
              Модульный монолит: React и TypeScript в интерфейсе, Fastify в API, PostgreSQL с явным
              SQL. API раздаёт собранное приложение; состояние, аудит и тестовые нормо-часы хранятся
              в одной БД.
            </p>
            <div className="project-decision-grid">
              {decisions.map((decision) => (
                <div key={decision.title}>
                  <h3>{decision.title}</h3>
                  <p>{decision.text}</p>
                </div>
              ))}
            </div>
            <div className="project-links">
              <a className="text-link" href={`${caseUrl}#архитектура`}>
                Архитектура
              </a>
              <a className="text-link" href={`${docsUrl}/architecture/transactions-concurrency.md`}>
                Транзакции и конкуренция
              </a>
              <a className="text-link" href={`${docsUrl}/portfolio/engineering-retrospective.md`}>
                Решения и компромиссы
              </a>
              <a
                className="text-link"
                href={`${docsUrl}/requirements/requirements-traceability.md`}
              >
                От требований к проверкам
              </a>
            </div>
          </section>

          <div className="project-columns project-columns--cards">
            <section
              className="content-card project-section"
              id="project-results"
              aria-labelledby="results-title"
            >
              <p className="project-overline">Подтверждённые результаты</p>
              <h2 id="results-title">Что проверено</h2>
              <ul className="project-list">
                <li>
                  Полный браузерный процесс: 250 закрытых карточек из 250 и отдельная финальная
                  приёмка с контрольным чтением.
                </li>
                <li>Полный журнал выпуска: 254 события — партия, три комплекта и 250 карточек.</li>
                <li>
                  Повторное чтение той же тестовой записи нормо-часов; проверки ролей, конфликтов и
                  восстановления после неопределённого ответа.
                </li>
              </ul>
              <p>
                Это сохранённые результаты конкретных прогонов, связанные с версиями и окружением.
                Они не означают, что такая партия сейчас находится в общей публичной БД.
              </p>
              <a className="text-link" href={`${docsUrl}/engineering/quality-gates.md`}>
                Проверки и доказательства <Icon name="arrow-right" />
              </a>
            </section>
            <section
              className="content-card project-section"
              id="project-limits"
              aria-labelledby="limits-title"
            >
              <p className="project-overline">Границы кейса</p>
              <h2 id="limits-title">Что ещё не подтверждено</h2>
              <ul className="project-list">
                <li>Кейс не внедрён на заводе; бизнес-эффект не измерялся.</li>
                <li>
                  Пользователи, партии и нормы синтетические. Тестовые нормо-часы не подключены к
                  реальной зарплатной системе.
                </li>
                <li>
                  Подготовленные роли не заменяют персональную идентификацию и промышленную модель
                  доступа.
                </li>
                <li>
                  Отрицательная приёмка, доработка и повторный выпуск вне текущего объёма. Проверка
                  отката не выполнена.
                </li>
              </ul>
              <a className="text-link" href={`${docsUrl}/product/mvp-scope.md`}>
                Объём и ограничения <Icon name="arrow-right" />
              </a>
            </section>
          </div>

          <section
            className="content-card project-section project-next"
            aria-labelledby="next-title"
          >
            <p className="project-overline">Следующий шаг</p>
            <h2 id="next-title">Выберите глубину знакомства</h2>
            <p>
              За минуту — задача и экраны. За 5–7 минут — паспорт, одна рабочая карточка и
              объяснение результата. Для технического разговора — требования, код и сохранённые
              проверки.
            </p>
            <p>
              Проходить все 250 карточек вручную для знакомства с кейсом не требуется. Полный
              сценарий вынесен в документацию.
            </p>
            <div className="project-links">
              <AppLink className="button button--primary" navigate={navigate} to="/batches">
                Открыть демо
              </AppLink>
              <a className="button button--secondary" href={repositoryUrl}>
                Исходники
              </a>
              <a className="button button--secondary" href={caseUrl}>
                Подробный кейс
              </a>
              <a
                className="button button--secondary"
                href={`${docsUrl}/portfolio/demo-script.md#короткий-показ`}
              >
                Сценарий показа
              </a>
            </div>
          </section>
        </main>
        <footer className="app-footer">
          <span>Независимый портфолио-кейс · Только синтетические данные</span>
        </footer>
      </div>
    </>
  );
}
