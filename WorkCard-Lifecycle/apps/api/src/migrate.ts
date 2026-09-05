import 'dotenv/config';

import { loadMigrationConfig } from './config.js';
import { runMigrations } from './migration-runner.js';

runMigrations(loadMigrationConfig()).catch(() => {
  console.error(
    'Миграция не выполнена. Проверьте доступность БД, SQL и неизменность истории миграций.',
  );
  process.exitCode = 1;
});
