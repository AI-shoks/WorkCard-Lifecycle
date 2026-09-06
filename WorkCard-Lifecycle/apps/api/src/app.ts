import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import {
  LivenessResponseSchema,
  ReadinessResponseSchema,
  type LivenessResponse,
  type ProblemDetails,
  type ReadinessResponse,
} from '@work-card/contracts';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import type { Pool } from 'pg';

import { registerApiRoutes } from './api-routes.js';
import { DomainError } from './domain-error.js';
import { defaultDemoCapacity } from './demo-maintenance.js';
import type { ReadinessService } from './readiness.js';
import { registerRateLimits } from './runtime-protection.js';
import type { SessionManagerOptions } from './session-manager.js';

const expectedMigrationVersion = 3;
const cloudTraceContextPattern = /^([0-9a-f]{32})(?:\/[0-9]+)?(?:;o=[01])?$/;

function cloudTraceId(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.match(cloudTraceContextPattern)?.[1];
}

export type BuildAppOptions = {
  appVersion: string;
  demoCapacity?: {
    maximumBatches: number;
    maximumSessions: number;
  };
  logger?: FastifyServerOptions['logger'];
  pool?: Pool;
  readiness: ReadinessService;
  security?: SessionManagerOptions;
  trustProxy?: FastifyServerOptions['trustProxy'];
  webDistPath?: string;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    bodyLimit: 1_048_576,
    connectionTimeout: 10_000,
    genReqId: () => randomUUID(),
    requestTimeout: 15_000,
    handlerTimeout: 20_000,
    keepAliveTimeout: 5_000,
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'requestId',
    }),
    logger: options.logger ?? false,
    requestIdHeader: false,
    trustProxy: options.trustProxy ?? false,
  });

  await registerRateLimits(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Production Work Card Workflow API',
        version: options.appVersion,
      },
      openapi: '3.1.0',
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    );
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const traceId = cloudTraceId(request.headers['x-cloud-trace-context']);
    const fields = {
      durationMs: reply.elapsedTime,
      method: request.method,
      remoteIp: request.ip,
      requestId: request.id,
      routeTemplate: request.routeOptions.url ?? '[unmatched]',
      status: reply.statusCode,
      ...(traceId ? { traceId } : {}),
    };
    if (reply.statusCode >= 500) {
      request.log.error(fields, 'request completed');
    } else if (reply.statusCode >= 400) {
      request.log.warn(fields, 'request completed');
    } else {
      request.log.info(fields, 'request completed');
    }
  });

  app.setErrorHandler(problemDetailsErrorHandler);

  app.get(
    '/health/live',
    {
      schema: {
        response: { 200: LivenessResponseSchema },
        tags: ['health'],
      },
    },
    async (): Promise<LivenessResponse> => ({ status: 'ok' }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema,
        },
        tags: ['health'],
      },
    },
    async (request, reply): Promise<ReadinessResponse> => {
      const snapshot = await options.readiness.check();
      const ready =
        snapshot.database === 'up' &&
        snapshot.migrationVersion !== null &&
        snapshot.migrationVersion >= expectedMigrationVersion;
      const diagnostic = {
        databaseStatus: snapshot.database,
        event: 'health.readiness',
        migrationVersion: snapshot.migrationVersion,
        expectedMigrationVersion,
      };
      if (ready) {
        request.log.info(diagnostic, 'readiness check completed');
      } else {
        request.log.warn(diagnostic, 'readiness check unavailable');
      }

      const response: ReadinessResponse = { status: ready ? 'ok' : 'unavailable' };

      if (!ready) {
        return reply.code(503).send(response);
      }

      return response;
    },
  );

  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  if (options.pool || options.security) {
    if (!options.pool || !options.security) {
      throw new Error('Для производственных API routes нужны pool и security options.');
    }
    await registerApiRoutes(app, options.pool, options.security, {
      maximumBatches: options.demoCapacity?.maximumBatches ?? defaultDemoCapacity.maximumBatches,
      maximumSessions: options.demoCapacity?.maximumSessions ?? defaultDemoCapacity.maximumSessions,
    });
  }

  const webRoot = options.webDistPath ? resolve(options.webDistPath) : null;
  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  }

  async function problemDetailsErrorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let title = 'Внутренняя ошибка';
    let detail = 'Не удалось обработать запрос. Повторите попытку позднее.';
    let conflicts: ProblemDetails['conflicts'];

    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      title = error.title;
      detail = error.detail;
      conflicts = error.conflicts;
    } else if (typeof error === 'object' && error !== null && 'validation' in error) {
      status = 400;
      code = 'INVALID_REQUEST';
      title = 'Некорректный запрос';
      detail = 'Проверьте формат и обязательные поля запроса.';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      title = 'Запрос слишком большой';
      detail = 'Уменьшите объём запроса и повторите действие.';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 400
    ) {
      status = 400;
      code = 'INVALID_REQUEST';
      title = 'Некорректный запрос';
      detail = 'Проверьте формат запроса.';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      (error.code.startsWith('08') ||
        [
          '57P01',
          '57P02',
          '57P03',
          '57014',
          '55P03',
          '25P03',
          '25P04',
          'FST_ERR_HANDLER_TIMEOUT',
          'ECONNREFUSED',
          'ECONNRESET',
          'ETIMEDOUT',
        ].includes(error.code))
    ) {
      status = 503;
      code = 'SERVICE_UNAVAILABLE';
      title = 'Сервис временно недоступен';
      detail = 'Повторите попытку позднее.';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      status = error.statusCode;
      code =
        status === 429
          ? 'TOO_MANY_REQUESTS'
          : status === 415
            ? 'UNSUPPORTED_MEDIA_TYPE'
            : 'INVALID_REQUEST';
      title =
        status === 429
          ? 'Слишком много запросов'
          : status === 415
            ? 'Неподдерживаемый формат'
            : 'Некорректный запрос';
      detail =
        status === 429
          ? 'Подождите перед следующим действием.'
          : status === 415
            ? 'Отправьте JSON с Content-Type application/json.'
            : 'Проверьте формат запроса.';
    } else {
      request.log.error({ err: error }, 'request failed');
    }

    const problem: ProblemDetails = {
      type: `https://work-card.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
      title,
      status,
      detail,
      instance: request.url.split('?')[0] ?? request.url,
      code,
      requestId: request.id,
      ...(conflicts ? { conflicts } : {}),
    };
    return reply.code(status).type('application/problem+json').send(problem);
  }

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const isSpaNavigation =
      Boolean(webRoot) &&
      request.method === 'GET' &&
      !path.startsWith('/api/') &&
      !path.startsWith('/health/');

    if (isSpaNavigation) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }

    const problem: ProblemDetails = {
      type: 'https://work-card.example/problems/not-found',
      title: 'Ресурс не найден',
      status: 404,
      detail: 'Запрошенный ресурс отсутствует.',
      instance: path,
      code: 'RESOURCE_NOT_FOUND',
      requestId: request.id,
    };

    return reply.code(404).type('application/problem+json').send(problem);
  });

  return app;
}
