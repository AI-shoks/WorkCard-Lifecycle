import { Type, type Static } from '@sinclair/typebox';

export const UuidSchema = Type.String({ format: 'uuid' });
export const TimestampSchema = Type.String({ format: 'date-time' });
export const DecimalHoursSchema = Type.String({ pattern: '^[0-9]+(?:\\.[0-9]{1,2})?$' });

export const RoleSchema = Type.Union([
  Type.Literal('PLANNER'),
  Type.Literal('MASTER'),
  Type.Literal('WORKER'),
  Type.Literal('QUALITY_CONTROLLER'),
  Type.Literal('ADMIN_AUDITOR'),
]);
export type Role = Static<typeof RoleSchema>;

export const CommandNameSchema = Type.Union([
  Type.Literal('CreateProductionBatch'),
  Type.Literal('ReleaseWorkCards'),
  Type.Literal('AssignWorkCards'),
  Type.Literal('StartWorkCard'),
  Type.Literal('CompleteWorkCard'),
  Type.Literal('AcceptFirstArticle'),
  Type.Literal('ConfirmWorkCardQuality'),
  Type.Literal('RecordFinalBatchAcceptance'),
  Type.Literal('ExportWorkCardToPayroll'),
]);
export type CommandName = Static<typeof CommandNameSchema>;

export const BatchLifecycleStatusSchema = Type.Union([
  Type.Literal('CREATED'),
  Type.Literal('RELEASED'),
  Type.Literal('FINAL_ACCEPTED'),
]);
export type BatchLifecycleStatus = Static<typeof BatchLifecycleStatusSchema>;

export const GateStatusSchema = Type.Union([
  Type.Literal('FIRST_ARTICLE_PENDING'),
  Type.Literal('SERIAL_ALLOWED'),
]);
export type GateStatus = Static<typeof GateStatusSchema>;

export const WorkCardPurposeSchema = Type.Union([
  Type.Literal('FIRST_ARTICLE'),
  Type.Literal('SERIAL'),
]);
export type WorkCardPurpose = Static<typeof WorkCardPurposeSchema>;

export const WorkCardStatusSchema = Type.Union([
  Type.Literal('RELEASED'),
  Type.Literal('ASSIGNED'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('COMPLETED'),
  Type.Literal('CLOSED'),
]);
export type WorkCardStatus = Static<typeof WorkCardStatusSchema>;

export const ClosureTypeSchema = Type.Union([
  Type.Literal('FIRST_ARTICLE_ACCEPTANCE'),
  Type.Literal('SERIAL_QUALITY_CONFIRMATION'),
]);
export type ClosureType = Static<typeof ClosureTypeSchema>;

export const DemoUserSchema = Type.Object(
  {
    id: UuidSchema,
    displayName: Type.String({ minLength: 1 }),
    role: RoleSchema,
    roleLabel: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type DemoUser = Static<typeof DemoUserSchema>;

export const DemoUsersResponseSchema = Type.Object(
  { items: Type.Array(DemoUserSchema) },
  { additionalProperties: false },
);

export const CreateDemoSessionBodySchema = Type.Object(
  { demoUserId: UuidSchema },
  { additionalProperties: false },
);
export type CreateDemoSessionBody = Static<typeof CreateDemoSessionBodySchema>;

export const DemoSessionResponseSchema = Type.Object(
  {
    actor: DemoUserSchema,
    csrfToken: Type.String({ minLength: 32 }),
    permissions: Type.Array(CommandNameSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type DemoSessionResponse = Static<typeof DemoSessionResponseSchema>;

export const OperationPlanSchema = Type.Object(
  {
    id: UuidSchema,
    position: Type.Integer({ minimum: 1 }),
    scopeCode: Type.String({ minLength: 1 }),
    scopeName: Type.String({ minLength: 1 }),
    plannedCardCount: Type.Integer({ minimum: 1 }),
    normHours: DecimalHoursSchema,
  },
  { additionalProperties: false },
);
export type OperationPlan = Static<typeof OperationPlanSchema>;

export const ProductionPassportSummarySchema = Type.Object(
  {
    id: UuidSchema,
    code: Type.String({ minLength: 1 }),
    revision: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1 }),
    operationCount: Type.Integer({ minimum: 1 }),
    plannedCardCount: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type ProductionPassportSummary = Static<typeof ProductionPassportSummarySchema>;

export const ProductionPassportDetailSchema = Type.Object(
  {
    id: UuidSchema,
    code: Type.String({ minLength: 1 }),
    revision: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1 }),
    operationCount: Type.Integer({ minimum: 1 }),
    plannedCardCount: Type.Integer({ minimum: 1 }),
    operations: Type.Array(OperationPlanSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type ProductionPassportDetail = Static<typeof ProductionPassportDetailSchema>;

export const ProductionPassportsResponseSchema = Type.Object(
  { items: Type.Array(ProductionPassportSummarySchema) },
  { additionalProperties: false },
);

export const PassportSnapshotSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    revision: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type PassportSnapshot = Static<typeof PassportSnapshotSchema>;

export const FinalBatchAcceptanceSchema = Type.Object(
  {
    id: UuidSchema,
    batchId: UuidSchema,
    controller: Type.Object(
      { id: UuidSchema, displayName: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    acceptedAt: TimestampSchema,
    commandId: UuidSchema,
    resultingBatchVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type FinalBatchAcceptance = Static<typeof FinalBatchAcceptanceSchema>;

export const BatchCountsSchema = Type.Object(
  {
    setCount: Type.Integer({ minimum: 0 }),
    plannedCardCount: Type.Integer({ minimum: 0 }),
    actualCardCount: Type.Integer({ minimum: 0 }),
    closedCardCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type BatchCounts = Static<typeof BatchCountsSchema>;

export const WorkCardSetSummarySchema = Type.Object(
  {
    id: UuidSchema,
    scopeCode: Type.String({ minLength: 1 }),
    scopeName: Type.String({ minLength: 1 }),
    normHours: DecimalHoursSchema,
    plannedCardCount: Type.Integer({ minimum: 1 }),
    actualCardCount: Type.Integer({ minimum: 0 }),
    closedCardCount: Type.Integer({ minimum: 0 }),
    gateStatus: GateStatusSchema,
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type WorkCardSetSummary = Static<typeof WorkCardSetSummarySchema>;

export const BatchOperationPlanSnapshotSchema = Type.Object(
  {
    id: UuidSchema,
    position: Type.Integer({ minimum: 1 }),
    scopeCode: Type.String({ minLength: 1 }),
    scopeName: Type.String({ minLength: 1 }),
    plannedCardCount: Type.Integer({ minimum: 1 }),
    normHours: DecimalHoursSchema,
  },
  { additionalProperties: false },
);
export type BatchOperationPlanSnapshot = Static<typeof BatchOperationPlanSnapshotSchema>;

export const ProductionBatchSummarySchema = Type.Object(
  {
    id: UuidSchema,
    quantity: Type.Integer({ minimum: 1 }),
    lifecycleStatus: BatchLifecycleStatusSchema,
    version: Type.Integer({ minimum: 1 }),
    passportSnapshot: PassportSnapshotSchema,
    counts: BatchCountsSchema,
    createdAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type ProductionBatchSummary = Static<typeof ProductionBatchSummarySchema>;

export const ProductionBatchDetailSchema = Type.Object(
  {
    id: UuidSchema,
    quantity: Type.Integer({ minimum: 1 }),
    lifecycleStatus: BatchLifecycleStatusSchema,
    version: Type.Integer({ minimum: 1 }),
    passportSnapshot: PassportSnapshotSchema,
    counts: BatchCountsSchema,
    operationPlan: Type.Array(BatchOperationPlanSnapshotSchema, { minItems: 1 }),
    sets: Type.Array(WorkCardSetSummarySchema),
    finalAcceptance: Type.Union([FinalBatchAcceptanceSchema, Type.Null()]),
    availableActions: Type.Array(CommandNameSchema, { uniqueItems: true }),
    createdAt: TimestampSchema,
    releasedAt: Type.Union([TimestampSchema, Type.Null()]),
    finalAcceptedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProductionBatchDetail = Static<typeof ProductionBatchDetailSchema>;

export const ProductionBatchesResponseSchema = Type.Object(
  {
    items: Type.Array(ProductionBatchSummarySchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const StatusCountsSchema = Type.Object(
  {
    RELEASED: Type.Integer({ minimum: 0 }),
    ASSIGNED: Type.Integer({ minimum: 0 }),
    IN_PROGRESS: Type.Integer({ minimum: 0 }),
    COMPLETED: Type.Integer({ minimum: 0 }),
    CLOSED: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AssignmentCountSchema = Type.Object(
  {
    assignee: Type.Object(
      { id: UuidSchema, displayName: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    purpose: WorkCardPurposeSchema,
    count: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const WorkCardSetDetailSchema = Type.Object(
  {
    id: UuidSchema,
    batchId: UuidSchema,
    scopeCode: Type.String({ minLength: 1 }),
    scopeName: Type.String({ minLength: 1 }),
    normHours: DecimalHoursSchema,
    plannedCardCount: Type.Integer({ minimum: 1 }),
    actualCardCount: Type.Integer({ minimum: 0 }),
    gateStatus: GateStatusSchema,
    firstArticleWorkCardId: Type.Union([UuidSchema, Type.Null()]),
    version: Type.Integer({ minimum: 1 }),
    statusCounts: StatusCountsSchema,
    assignmentCounts: Type.Array(AssignmentCountSchema),
    availableActions: Type.Array(CommandNameSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type WorkCardSetDetail = Static<typeof WorkCardSetDetailSchema>;

export const AssigneeSchema = Type.Object(
  { id: UuidSchema, displayName: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const WorkCardSchema = Type.Object(
  {
    id: UuidSchema,
    workCardSetId: UuidSchema,
    batchId: UuidSchema,
    batchQuantitySnapshot: Type.Integer({ minimum: 1 }),
    operation: Type.Object(
      {
        scopeCode: Type.String({ minLength: 1 }),
        scopeName: Type.String({ minLength: 1 }),
        normHours: DecimalHoursSchema,
      },
      { additionalProperties: false },
    ),
    purpose: Type.Union([WorkCardPurposeSchema, Type.Null()]),
    status: WorkCardStatusSchema,
    closureType: Type.Union([ClosureTypeSchema, Type.Null()]),
    assignee: Type.Union([AssigneeSchema, Type.Null()]),
    version: Type.Integer({ minimum: 1 }),
    timestamps: Type.Object(
      {
        releasedAt: TimestampSchema,
        assignedAt: Type.Union([TimestampSchema, Type.Null()]),
        startedAt: Type.Union([TimestampSchema, Type.Null()]),
        completedAt: Type.Union([TimestampSchema, Type.Null()]),
        closedAt: Type.Union([TimestampSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    availableActions: Type.Array(CommandNameSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type WorkCard = Static<typeof WorkCardSchema>;

export const WorkCardsResponseSchema = Type.Object(
  {
    items: Type.Array(WorkCardSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CreateProductionBatchBodySchema = Type.Object(
  {
    commandId: UuidSchema,
    productionPassportId: UuidSchema,
    quantity: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  },
  { additionalProperties: false },
);
export type CreateProductionBatchBody = Static<typeof CreateProductionBatchBodySchema>;

export const ReleaseWorkCardsBodySchema = Type.Object(
  { commandId: UuidSchema, expectedBatchVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type ReleaseWorkCardsBody = Static<typeof ReleaseWorkCardsBodySchema>;

export const AssignmentCardInputSchema = Type.Object(
  { workCardId: UuidSchema, expectedVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const AssignWorkCardsBodySchema = Type.Object(
  {
    commandId: UuidSchema,
    purpose: WorkCardPurposeSchema,
    assigneeId: UuidSchema,
    expectedSetVersion: Type.Integer({ minimum: 1 }),
    cards: Type.Array(AssignmentCardInputSchema, { minItems: 1, maxItems: 250 }),
  },
  { additionalProperties: false },
);
export type AssignWorkCardsBody = Static<typeof AssignWorkCardsBodySchema>;

export const CardVersionCommandBodySchema = Type.Object(
  { commandId: UuidSchema, expectedCardVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type CardVersionCommandBody = Static<typeof CardVersionCommandBodySchema>;

export const AcceptFirstArticleBodySchema = Type.Object(
  {
    commandId: UuidSchema,
    expectedSetVersion: Type.Integer({ minimum: 1 }),
    expectedCardVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type AcceptFirstArticleBody = Static<typeof AcceptFirstArticleBodySchema>;

export const CreateBatchResponseSchema = Type.Object(
  { batch: ProductionBatchSummarySchema, correlationId: UuidSchema },
  { additionalProperties: false },
);
export type CreateBatchResponse = Static<typeof CreateBatchResponseSchema>;

export const ReleaseWorkCardsResponseSchema = Type.Object(
  {
    batchId: UuidSchema,
    lifecycleStatus: Type.Literal('RELEASED'),
    setCount: Type.Integer({ minimum: 1 }),
    plannedCardCount: Type.Integer({ minimum: 1 }),
    actualCardCount: Type.Integer({ minimum: 1 }),
    batchVersion: Type.Integer({ minimum: 2 }),
    correlationId: UuidSchema,
  },
  { additionalProperties: false },
);
export type ReleaseWorkCardsResponse = Static<typeof ReleaseWorkCardsResponseSchema>;

export const AssignmentResponseSchema = Type.Object(
  {
    workCardSetId: UuidSchema,
    purpose: WorkCardPurposeSchema,
    assignee: AssigneeSchema,
    assignedCount: Type.Integer({ minimum: 1 }),
    setVersion: Type.Integer({ minimum: 1 }),
    cards: Type.Array(
      Type.Object(
        { workCardId: UuidSchema, version: Type.Integer({ minimum: 2 }) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    correlationId: UuidSchema,
  },
  { additionalProperties: false },
);
export type AssignmentResponse = Static<typeof AssignmentResponseSchema>;

export const WorkCardCommandResponseSchema = Type.Object(
  { workCard: WorkCardSchema, correlationId: UuidSchema },
  { additionalProperties: false },
);
export type WorkCardCommandResponse = Static<typeof WorkCardCommandResponseSchema>;

export const FirstArticleAcceptanceResponseSchema = Type.Object(
  {
    workCardSetId: UuidSchema,
    gateStatus: Type.Literal('SERIAL_ALLOWED'),
    setVersion: Type.Integer({ minimum: 2 }),
    workCard: WorkCardSchema,
    correlationId: UuidSchema,
  },
  { additionalProperties: false },
);
export type FirstArticleAcceptanceResponse = Static<typeof FirstArticleAcceptanceResponseSchema>;

export const FinalBatchAcceptanceResponseSchema = Type.Object(
  {
    acceptance: FinalBatchAcceptanceSchema,
    batchLifecycleStatus: Type.Literal('FINAL_ACCEPTED'),
    correlationId: UuidSchema,
  },
  { additionalProperties: false },
);
export type FinalBatchAcceptanceResponse = Static<typeof FinalBatchAcceptanceResponseSchema>;

export const PayrollRecordSchema = Type.Object(
  {
    id: UuidSchema,
    workCardId: UuidSchema,
    beneficiary: AssigneeSchema,
    normHoursSnapshot: DecimalHoursSchema,
    exportedBy: AssigneeSchema,
    exportedAt: TimestampSchema,
    commandId: UuidSchema,
  },
  { additionalProperties: false },
);
export type PayrollRecord = Static<typeof PayrollRecordSchema>;

export const PayrollExportResponseSchema = Type.Object(
  { payrollRecord: PayrollRecordSchema, correlationId: UuidSchema },
  { additionalProperties: false },
);
export type PayrollExportResponse = Static<typeof PayrollExportResponseSchema>;

export const AuditEventSchema = Type.Object(
  {
    id: UuidSchema,
    eventType: Type.String({ minLength: 1 }),
    aggregateType: Type.String({ minLength: 1 }),
    aggregateId: UuidSchema,
    aggregateVersion: Type.Integer({ minimum: 1 }),
    occurredAt: TimestampSchema,
    actorId: UuidSchema,
    actorRole: RoleSchema,
    commandId: UuidSchema,
    correlationId: UuidSchema,
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type AuditEvent = Static<typeof AuditEventSchema>;

export const AuditEventsResponseSchema = Type.Object(
  {
    events: Type.Array(AuditEventSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const AuditCorrelationResponseSchema = Type.Object(
  {
    correlationId: UuidSchema,
    commandId: UuidSchema,
    commandType: CommandNameSchema,
    expectedEventCount: Type.Integer({ minimum: 0 }),
    totalEventCount: Type.Integer({ minimum: 0 }),
    events: Type.Array(AuditEventSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const IdParamSchema = Type.Object({ id: UuidSchema }, { additionalProperties: false });

export const PassportParamsSchema = Type.Object(
  { passportId: UuidSchema },
  { additionalProperties: false },
);
export const BatchParamsSchema = Type.Object(
  { batchId: UuidSchema },
  { additionalProperties: false },
);
export const SetParamsSchema = Type.Object({ setId: UuidSchema }, { additionalProperties: false });
export const WorkCardParamsSchema = Type.Object(
  { workCardId: UuidSchema },
  { additionalProperties: false },
);
export const CorrelationParamsSchema = Type.Object(
  { correlationId: UuidSchema },
  { additionalProperties: false },
);

export const PageQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  },
  { additionalProperties: false },
);

export const WorkCardsQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    status: Type.Optional(WorkCardStatusSchema),
    assigneeId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);
