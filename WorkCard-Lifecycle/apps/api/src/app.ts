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
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { ReadinessService } from './readiness.js';

const expectedMigrationVersion = 1;

export type BuildAppOptions = {
  appVersion: string;
  logger?: FastifyServerOptions['logger'];
  readiness: ReadinessService;
  webDistPath?: string;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: options.logger ?? false,
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
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

  app.get(
    '/health/live',
    {
      schema: {
        response: { 200: LivenessResponseSchema },
        tags: ['health'],
      },
    },
    async (): Promise<LivenessResponse> => ({
      status: 'ok',
      service: 'work-card-api',
      version: options.appVersion,
    }),
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
    async (_request, reply): Promise<ReadinessResponse> => {
      const snapshot = await options.readiness.check();
      const ready =
        snapshot.database === 'up' &&
        snapshot.migrationVersion !== null &&
        snapshot.migrationVersion >= expectedMigrationVersion;
      const response: ReadinessResponse = {
        status: ready ? 'ok' : 'unavailable',
        database: snapshot.database,
        migrationVersion: snapshot.migrationVersion,
        expectedMigrationVersion,
      };

      if (!ready) {
        return reply.code(503).send(response);
      }

      return response;
    },
  );

  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  const webRoot = options.webDistPath ? resolve(options.webDistPath) : null;
  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
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
