import {
  AcceptFirstArticleBodySchema,
  AssignWorkCardsBodySchema,
  AssignmentResponseSchema,
  AuditCorrelationResponseSchema,
  AuditEventsResponseSchema,
  BatchParamsSchema,
  CardVersionCommandBodySchema,
  CorrelationParamsSchema,
  CreateBatchResponseSchema,
  CreateDemoSessionBodySchema,
  CreateProductionBatchBodySchema,
  DemoSessionResponseSchema,
  DemoUsersResponseSchema,
  FinalBatchAcceptanceResponseSchema,
  FirstArticleAcceptanceResponseSchema,
  PageQuerySchema,
  PassportParamsSchema,
  PayrollExportResponseSchema,
  PayrollRecordSchema,
  ProductionBatchDetailSchema,
  ProductionBatchesResponseSchema,
  ProductionPassportDetailSchema,
  ProductionPassportsResponseSchema,
  ReleaseWorkCardsBodySchema,
  ReleaseWorkCardsResponseSchema,
  SetParamsSchema,
  WorkCardCommandResponseSchema,
  WorkCardParamsSchema,
  WorkCardSchema,
  WorkCardsQuerySchema,
  WorkCardsResponseSchema,
  WorkCardSetDetailSchema,
  type AcceptFirstArticleBody,
  type AssignWorkCardsBody,
  type CardVersionCommandBody,
  type CommandName,
  type CreateDemoSessionBody,
  type CreateProductionBatchBody,
  type ReleaseWorkCardsBody,
  type WorkCardStatus,
} from '@work-card/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { actionForbidden } from './domain-error.js';
import {
  createSessionManager,
  roleCan,
  type AuthenticatedSession,
  type SessionManagerOptions,
} from './session-manager.js';
import { createWorkflowService, type CommandResult } from './workflow-service.js';

type BatchParams = { batchId: string };
type CorrelationParams = { correlationId: string };
type PageQuery = { cursor?: string; limit?: number };
type PassportParams = { passportId: string };
type SetParams = { setId: string };
type WorkCardParams = { workCardId: string };
type WorkCardsQuery = PageQuery & { assigneeId?: string; status?: WorkCardStatus };

function scalarHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  pool: Pool,
  security: SessionManagerOptions,
  capacity: { maximumBatches: number; maximumSessions: number },
): Promise<void> {
  const sessions = createSessionManager(pool, {
    ...security,
    maximumSessions: capacity.maximumSessions,
  });
  const workflow = createWorkflowService(pool, capacity.maximumBatches);
  const requestSessions = new WeakMap<object, AuthenticatedSession>();

  const sessionFor = (request: object): AuthenticatedSession => {
    const session = requestSessions.get(request);
    if (!session) throw new Error('Authenticated session отсутствует в контексте запроса.');
    return session;
  };

  const authenticateRequest = async (request: FastifyRequest): Promise<void> => {
    requestSessions.set(request, await sessions.authenticate(request.headers.cookie));
  };

  const authorizeCommand =
    (command: CommandName) =>
    async (request: FastifyRequest): Promise<void> => {
      const session = sessionFor(request);
      if (!roleCan(session.actor.role, command)) throw actionForbidden();
    };

  const authorizeAuditor = async (request: FastifyRequest): Promise<void> => {
    const session = sessionFor(request);
    if (session.actor.role !== 'ADMIN_AUDITOR') throw actionForbidden();
  };

  const assertMutationOrigin = async (request: FastifyRequest): Promise<void> => {
    sessions.assertMutationOrigin(request.headers.origin);
  };

  const assertMutationCsrf = async (request: FastifyRequest): Promise<void> => {
    const session = sessionFor(request);
    sessions.assertCsrf(session, scalarHeader(request.headers['x-csrf-token']));
  };

  const mutationPreValidation = (command: CommandName) => [
    authenticateRequest,
    authorizeCommand(command),
    assertMutationOrigin,
    assertMutationCsrf,
  ];

  const authenticatedMutationPreValidation = [
    authenticateRequest,
    assertMutationOrigin,
    assertMutationCsrf,
  ];

  const sendResult = <T>(reply: FastifyReply, result: CommandResult<T>, businessReplay = false) => {
    if (result.replay || businessReplay) reply.header('Idempotent-Replay', 'true');
    return reply.code(result.status).send(result.body);
  };

  app.get(
    '/api/v1/demo-users',
    {
      schema: {
        response: { 200: DemoUsersResponseSchema },
        tags: ['demo-session'],
      },
    },
    async () => ({ items: await sessions.listUsers() }),
  );

  app.post<{ Body: CreateDemoSessionBody }>(
    '/api/v1/demo-session',
    {
      preValidation: assertMutationOrigin,
      schema: {
        body: CreateDemoSessionBodySchema,
        response: { 201: DemoSessionResponseSchema },
        tags: ['demo-session'],
      },
    },
    async (request, reply) => {
      const result = await sessions.createSession(request.body.demoUserId, request.headers.cookie);
      return reply.header('Set-Cookie', result.cookie).code(201).send(result.body);
    },
  );

  app.get(
    '/api/v1/demo-session',
    {
      preValidation: authenticateRequest,
      schema: {
        response: { 200: DemoSessionResponseSchema },
        tags: ['demo-session'],
      },
    },
    async (request) => sessions.getSessionResponse(sessionFor(request)),
  );

  app.delete(
    '/api/v1/demo-session',
    {
      preValidation: authenticatedMutationPreValidation,
      schema: { tags: ['demo-session'] },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      await sessions.deleteSession(session);
      return reply.header('Set-Cookie', sessions.clearSessionCookie()).code(204).send();
    },
  );

  app.get(
    '/api/v1/production-passports',
    {
      preValidation: authenticateRequest,
      schema: {
        response: { 200: ProductionPassportsResponseSchema },
        tags: ['production-passports'],
      },
    },
    async () => ({ items: await workflow.listPassports() }),
  );

  app.get<{ Params: PassportParams }>(
    '/api/v1/production-passports/:passportId',
    {
      preValidation: authenticateRequest,
      schema: {
        params: PassportParamsSchema,
        response: { 200: ProductionPassportDetailSchema },
        tags: ['production-passports'],
      },
    },
    async (request) => workflow.getPassport(request.params.passportId),
  );

  app.get<{ Querystring: PageQuery }>(
    '/api/v1/production-batches',
    {
      preValidation: authenticateRequest,
      schema: {
        querystring: PageQuerySchema,
        response: { 200: ProductionBatchesResponseSchema },
        tags: ['production-batches'],
      },
    },
    async (request) => workflow.listBatches(request.query),
  );

  app.post<{ Body: CreateProductionBatchBody }>(
    '/api/v1/production-batches',
    {
      preValidation: mutationPreValidation('CreateProductionBatch'),
      schema: {
        body: CreateProductionBatchBodySchema,
        response: { 200: CreateBatchResponseSchema, 201: CreateBatchResponseSchema },
        tags: ['production-batches'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(reply, await workflow.createBatch(session.actor, request.body));
    },
  );

  app.get<{ Params: BatchParams }>(
    '/api/v1/production-batches/:batchId',
    {
      preValidation: authenticateRequest,
      schema: {
        params: BatchParamsSchema,
        response: { 200: ProductionBatchDetailSchema },
        tags: ['production-batches'],
      },
    },
    async (request) => {
      const session = sessionFor(request);
      return workflow.getBatch(session.actor, request.params.batchId);
    },
  );

  app.post<{ Body: ReleaseWorkCardsBody; Params: BatchParams }>(
    '/api/v1/production-batches/:batchId/release',
    {
      preValidation: mutationPreValidation('ReleaseWorkCards'),
      schema: {
        body: ReleaseWorkCardsBodySchema,
        params: BatchParamsSchema,
        response: { 200: ReleaseWorkCardsResponseSchema },
        tags: ['production-batches'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.releaseWorkCards(session.actor, request.params.batchId, request.body),
      );
    },
  );

  app.post<{ Body: ReleaseWorkCardsBody; Params: BatchParams }>(
    '/api/v1/production-batches/:batchId/final-acceptance',
    {
      preValidation: mutationPreValidation('RecordFinalBatchAcceptance'),
      schema: {
        body: ReleaseWorkCardsBodySchema,
        params: BatchParamsSchema,
        response: {
          200: FinalBatchAcceptanceResponseSchema,
          201: FinalBatchAcceptanceResponseSchema,
        },
        tags: ['production-batches'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.recordFinalBatchAcceptance(
          session.actor,
          request.params.batchId,
          request.body,
        ),
      );
    },
  );

  app.get<{ Params: SetParams }>(
    '/api/v1/work-card-sets/:setId',
    {
      preValidation: authenticateRequest,
      schema: {
        params: SetParamsSchema,
        response: { 200: WorkCardSetDetailSchema },
        tags: ['work-card-sets'],
      },
    },
    async (request) => {
      const session = sessionFor(request);
      return workflow.getWorkCardSet(session.actor, request.params.setId);
    },
  );

  app.get<{ Params: SetParams; Querystring: WorkCardsQuery }>(
    '/api/v1/work-card-sets/:setId/work-cards',
    {
      preValidation: authenticateRequest,
      schema: {
        params: SetParamsSchema,
        querystring: WorkCardsQuerySchema,
        response: { 200: WorkCardsResponseSchema },
        tags: ['work-card-sets'],
      },
    },
    async (request) => {
      const session = sessionFor(request);
      return workflow.listWorkCards(session.actor, request.params.setId, request.query);
    },
  );

  app.post<{ Body: AssignWorkCardsBody; Params: SetParams }>(
    '/api/v1/work-card-sets/:setId/assignments',
    {
      preValidation: mutationPreValidation('AssignWorkCards'),
      schema: {
        body: AssignWorkCardsBodySchema,
        params: SetParamsSchema,
        response: { 200: AssignmentResponseSchema },
        tags: ['work-card-sets'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.assignWorkCards(session.actor, request.params.setId, request.body),
      );
    },
  );

  app.post<{ Body: AcceptFirstArticleBody; Params: SetParams }>(
    '/api/v1/work-card-sets/:setId/first-article-acceptance',
    {
      preValidation: mutationPreValidation('AcceptFirstArticle'),
      schema: {
        body: AcceptFirstArticleBodySchema,
        params: SetParamsSchema,
        response: { 200: FirstArticleAcceptanceResponseSchema },
        tags: ['work-card-sets'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.acceptFirstArticle(session.actor, request.params.setId, request.body),
      );
    },
  );

  app.get<{ Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId',
    {
      preValidation: authenticateRequest,
      schema: {
        params: WorkCardParamsSchema,
        response: { 200: WorkCardSchema },
        tags: ['work-cards'],
      },
    },
    async (request) => {
      const session = sessionFor(request);
      return workflow.getWorkCard(session.actor, request.params.workCardId);
    },
  );

  app.post<{ Body: CardVersionCommandBody; Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId/start',
    {
      preValidation: mutationPreValidation('StartWorkCard'),
      schema: {
        body: CardVersionCommandBodySchema,
        params: WorkCardParamsSchema,
        response: { 200: WorkCardCommandResponseSchema },
        tags: ['work-cards'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.startWorkCard(session.actor, request.params.workCardId, request.body),
      );
    },
  );

  app.post<{ Body: CardVersionCommandBody; Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId/complete',
    {
      preValidation: mutationPreValidation('CompleteWorkCard'),
      schema: {
        body: CardVersionCommandBodySchema,
        params: WorkCardParamsSchema,
        response: { 200: WorkCardCommandResponseSchema },
        tags: ['work-cards'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.completeWorkCard(session.actor, request.params.workCardId, request.body),
      );
    },
  );

  app.post<{ Body: CardVersionCommandBody; Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId/quality-confirmation',
    {
      preValidation: mutationPreValidation('ConfirmWorkCardQuality'),
      schema: {
        body: CardVersionCommandBodySchema,
        params: WorkCardParamsSchema,
        response: { 200: WorkCardCommandResponseSchema },
        tags: ['work-cards'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      return sendResult(
        reply,
        await workflow.confirmWorkCardQuality(
          session.actor,
          request.params.workCardId,
          request.body,
        ),
      );
    },
  );

  app.post<{ Body: CardVersionCommandBody; Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId/payroll-export',
    {
      preValidation: mutationPreValidation('ExportWorkCardToPayroll'),
      schema: {
        body: CardVersionCommandBodySchema,
        params: WorkCardParamsSchema,
        response: { 200: PayrollExportResponseSchema, 201: PayrollExportResponseSchema },
        tags: ['mock-payroll'],
      },
    },
    async (request, reply) => {
      const session = sessionFor(request);
      const result = await workflow.exportWorkCardToPayroll(
        session.actor,
        request.params.workCardId,
        request.body,
      );
      return sendResult(reply, result, result.status === 200);
    },
  );

  app.get<{ Params: WorkCardParams; Querystring: PageQuery }>(
    '/api/v1/work-cards/:workCardId/history',
    {
      preValidation: [authenticateRequest, authorizeAuditor],
      schema: {
        params: WorkCardParamsSchema,
        querystring: PageQuerySchema,
        response: { 200: AuditEventsResponseSchema },
        tags: ['audit'],
      },
    },
    async (request) => {
      return workflow.getWorkCardHistory(request.params.workCardId, request.query);
    },
  );

  app.get<{ Params: CorrelationParams; Querystring: PageQuery }>(
    '/api/v1/audit-correlations/:correlationId',
    {
      preValidation: [authenticateRequest, authorizeAuditor],
      schema: {
        params: CorrelationParamsSchema,
        querystring: PageQuerySchema,
        response: { 200: AuditCorrelationResponseSchema },
        tags: ['audit'],
      },
    },
    async (request) => {
      return workflow.getAuditCorrelation(request.params.correlationId, request.query);
    },
  );

  app.get<{ Params: WorkCardParams }>(
    '/api/v1/work-cards/:workCardId/payroll-record',
    {
      preValidation: [authenticateRequest, authorizeAuditor],
      schema: {
        params: WorkCardParamsSchema,
        response: { 200: PayrollRecordSchema },
        tags: ['mock-payroll'],
      },
    },
    async (request) => {
      return workflow.getPayrollRecord(request.params.workCardId);
    },
  );
}
