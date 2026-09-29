type Validator<T> = (value: unknown) => value is T;
type Validated<T> = T extends Validator<infer Value> ? Value : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const uuid: Validator<string> = (value): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const uniqueUuidList: Validator<string[]> = (value): value is string[] => {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids: unknown[] = Array.from(value);
  return ids.every(uuid) && new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
};
const positiveInteger: Validator<number> = (value): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonemptyString: Validator<string> = (value): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const positiveHours: Validator<string> = (value): value is string =>
  typeof value === 'string' &&
  /^[0-9]+(?:\.[0-9]{1,2})?$/.test(value) &&
  Number.isFinite(Number(value)) &&
  Number(value) > 0;
const utcTimestamp: Validator<string> = (value): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function oneOf<const Values extends string[]>(...values: Values): Validator<Values[number]> {
  return (value): value is Values[number] => typeof value === 'string' && values.includes(value);
}

function object<Fields extends Record<string, Validator<unknown>>>(
  fields: Fields,
): Validator<{ [Key in keyof Fields]: Validated<Fields[Key]> }> {
  return (value): value is { [Key in keyof Fields]: Validated<Fields[Key]> } =>
    isRecord(value) &&
    Object.keys(value).length === Object.keys(fields).length &&
    Object.entries(fields).every(([key, validate]) =>
      Object.hasOwn(value, key) ? validate(value[key]) : false,
    );
}

const operationScope = object({ code: nonemptyString, name: nonemptyString });

// One definition supplies both the internal discriminated type and runtime payload validation.
const eventDefinitions = {
  ProductionBatchCreated: {
    aggregateType: 'ProductionBatch',
    identityField: 'batchId',
    data: object({
      batchId: uuid,
      quantity: positiveInteger,
      passportSnapshot: object({
        code: nonemptyString,
        revision: nonemptyString,
        productName: nonemptyString,
      }),
    }),
  },
  ProductionBatchReleased: {
    aggregateType: 'ProductionBatch',
    identityField: 'batchId',
    data: object({
      batchId: uuid,
      workCardSetIds: uniqueUuidList,
      setCount: positiveInteger,
      cardCountTotal: positiveInteger,
    }),
  },
  WorkCardSetCreated: {
    aggregateType: 'WorkCardSet',
    identityField: 'setId',
    data: object({
      setId: uuid,
      batchId: uuid,
      operationScope,
      normHours: positiveHours,
      plannedCardCount: positiveInteger,
      gateStatus: oneOf('FIRST_ARTICLE_PENDING'),
    }),
  },
  WorkCardReleased: {
    aggregateType: 'WorkCard',
    identityField: 'workCardId',
    data: object({
      workCardId: uuid,
      setId: uuid,
      batchId: uuid,
      batchQuantitySnapshot: positiveInteger,
      operationScope,
      normHours: positiveHours,
      status: oneOf('RELEASED'),
    }),
  },
  FirstArticleWorkCardSelected: {
    aggregateType: 'WorkCardSet',
    identityField: 'setId',
    data: object({ setId: uuid, workCardId: uuid, gateStatus: oneOf('FIRST_ARTICLE_PENDING') }),
  },
  WorkCardAssigned: {
    aggregateType: 'WorkCard',
    identityField: 'workCardId',
    data: object({
      workCardId: uuid,
      assigneeId: uuid,
      purpose: oneOf('FIRST_ARTICLE', 'SERIAL'),
      status: oneOf('ASSIGNED'),
    }),
  },
  WorkCardStarted: {
    aggregateType: 'WorkCard',
    identityField: 'workCardId',
    data: object({
      workCardId: uuid,
      assigneeId: uuid,
      recordedByMasterId: uuid,
      status: oneOf('IN_PROGRESS'),
    }),
  },
  WorkCardCompleted: {
    aggregateType: 'WorkCard',
    identityField: 'workCardId',
    data: object({
      workCardId: uuid,
      assigneeId: uuid,
      recordedByMasterId: uuid,
      status: oneOf('COMPLETED'),
    }),
  },
  WorkCardQualityConfirmed: {
    aggregateType: 'WorkCard',
    identityField: 'workCardId',
    data: object({
      workCardId: uuid,
      controllerId: uuid,
      confirmationScope: oneOf('WORK_CARD'),
      acceptanceType: oneOf('FIRST_ARTICLE', 'SERIAL'),
      resultingStatus: oneOf('CLOSED'),
    }),
  },
  FirstArticleAccepted: {
    aggregateType: 'WorkCardSet',
    identityField: 'setId',
    data: object({ setId: uuid, workCardId: uuid, resultingGateStatus: oneOf('SERIAL_ALLOWED') }),
  },
  FinalBatchAccepted: {
    aggregateType: 'ProductionBatch',
    identityField: 'batchId',
    data: object({
      acceptanceId: uuid,
      batchId: uuid,
      controllerId: uuid,
      acceptedAt: utcTimestamp,
      resultingBatchStatus: oneOf('FINAL_ACCEPTED'),
      resultingBatchVersion: positiveInteger,
    }),
  },
  WorkCardExportedToPayroll: {
    aggregateType: 'PayrollRecord',
    identityField: 'payrollRecordId',
    data: object({
      payrollRecordId: uuid,
      workCardId: uuid,
      beneficiaryId: uuid,
      normHours: positiveHours,
    }),
  },
} as const;

export type AuditInsert = {
  [EventType in keyof typeof eventDefinitions]: {
    aggregateId: string;
    aggregateType: (typeof eventDefinitions)[EventType]['aggregateType'];
    aggregateVersion: number;
    data: Validated<(typeof eventDefinitions)[EventType]['data']>;
    eventType: EventType;
  };
}[keyof typeof eventDefinitions];

export function assertValidAuditInsert(event: unknown): asserts event is AuditInsert {
  if (
    !isRecord(event) ||
    typeof event['eventType'] !== 'string' ||
    !Object.hasOwn(eventDefinitions, event['eventType']) ||
    !uuid(event['aggregateId']) ||
    !positiveInteger(event['aggregateVersion']) ||
    !isRecord(event['data'])
  ) {
    throw new Error('Некорректный envelope события аудита.');
  }
  const definition = eventDefinitions[event['eventType'] as keyof typeof eventDefinitions];
  const data = event['data'];
  if (
    event['aggregateType'] !== definition.aggregateType ||
    data[definition.identityField] !== event['aggregateId'] ||
    (event['eventType'] === 'FinalBatchAccepted' &&
      data['resultingBatchVersion'] !== event['aggregateVersion']) ||
    (event['eventType'] === 'ProductionBatchReleased' &&
      (!Array.isArray(data['workCardSetIds']) ||
        data['workCardSetIds'].length !== data['setCount'])) ||
    !definition.data(data)
  ) {
    throw new Error('Некорректный payload события аудита.');
  }
}
