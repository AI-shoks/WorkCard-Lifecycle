import { Type, type Static } from '@sinclair/typebox';

export const LivenessResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.Literal('work-card-api'),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type LivenessResponse = Static<typeof LivenessResponseSchema>;

export const ReadinessResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]),
    database: Type.Union([Type.Literal('up'), Type.Literal('down')]),
    migrationVersion: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    expectedMigrationVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type ReadinessResponse = Static<typeof ReadinessResponseSchema>;

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String({ format: 'uri-reference' }),
    title: Type.String({ minLength: 1 }),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String({ minLength: 1 }),
    instance: Type.String({ minLength: 1 }),
    code: Type.String({ pattern: '^[A-Z][A-Z0-9_]+$' }),
    requestId: Type.String({ minLength: 1 }),
    conflicts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            resourceType: Type.String({ minLength: 1 }),
            resourceId: Type.String({ minLength: 1 }),
            expectedVersion: Type.Integer({ minimum: 1 }),
            actualVersion: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

export type ProblemDetails = Static<typeof ProblemDetailsSchema>;
