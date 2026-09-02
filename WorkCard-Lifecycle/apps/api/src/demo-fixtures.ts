export const demoUsers = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'demo_planner',
    displayName: 'Специалист ПДБ',
    roleCode: 'PLANNER',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    username: 'demo_master',
    displayName: 'Мастер участка',
    roleCode: 'MASTER',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    username: 'demo_worker_1',
    displayName: 'Исполнитель Иванов',
    roleCode: 'WORKER',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    username: 'demo_worker_2',
    displayName: 'Исполнитель Петров',
    roleCode: 'WORKER',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    username: 'demo_quality',
    displayName: 'Контролёр БТК',
    roleCode: 'QUALITY_CONTROLLER',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    username: 'demo_auditor',
    displayName: 'Администратор-аудитор',
    roleCode: 'ADMIN_AUDITOR',
  },
] as const;

export const demoPassport = {
  id: '20000000-0000-4000-8000-000000000001',
  productCode: 'DEMO-250',
  productName: 'Учебное изделие',
  plannedQuantity: 250,
  revision: 'A',
} as const;

export const demoOperations = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    operationNumber: 10,
    operationName: 'Подготовительная операция',
    plannedCardCount: 112,
    normHours: '0.25',
    scopeCode: 'OP-010',
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    operationNumber: 20,
    operationName: 'Основная операция',
    plannedCardCount: 112,
    normHours: '0.50',
    scopeCode: 'OP-020',
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    operationNumber: 30,
    operationName: 'Контрольная операция',
    plannedCardCount: 26,
    normHours: '0.15',
    scopeCode: 'OP-030',
  },
] as const;
