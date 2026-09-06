import {
  ProblemDetailsSchema,
  isContractValue,
  type ContractSchema,
  type ContractValue,
  type DemoSessionResponse,
  type ProblemDetails,
} from '@work-card/contracts';

export type ApiV1Path = '/api/v1' | `/api/v1/${string}`;

export type ApiRequestContext = Readonly<{
  correlationId?: string;
  requestId?: string;
}>;

export type ApiResponse<T> = Readonly<{
  context: ApiRequestContext;
  data: T;
  status: number;
}>;

export type ApiClientErrorKind =
  | 'abort'
  | 'http-error'
  | 'http-problem'
  | 'invalid-request'
  | 'invalid-response'
  | 'missing-csrf'
  | 'transport';

export class ApiClientError extends Error {
  readonly context: ApiRequestContext;
  readonly kind: ApiClientErrorKind;
  readonly problem: ProblemDetails | null;
  readonly status: number | null;

  constructor(options: {
    context?: ApiRequestContext;
    kind: ApiClientErrorKind;
    message: string;
    problem?: ProblemDetails;
    status?: number;
  }) {
    super(options.message);
    this.name = 'ApiClientError';
    this.context = options.context ?? {};
    this.kind = options.kind;
    this.problem = options.problem ?? null;
    this.status = options.status ?? null;
  }
}

export type ApiResponseContract<T> = Readonly<{
  decode: (response: Response, context: ApiRequestContext) => Promise<T>;
}>;

function invalidResponse(status: number, context: ApiRequestContext): ApiClientError {
  return new ApiClientError({
    context,
    kind: 'invalid-response',
    message: 'Сервер вернул некорректный ответ.',
    status,
  });
}

async function readResponseText(response: Response, context: ApiRequestContext): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw invalidResponse(response.status, context);
  }
}

function isJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('Content-Type');
  if (!contentType) return false;

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'));
}

export function contractResponse<Schema extends ContractSchema>(
  schema: Schema,
): ApiResponseContract<ContractValue<Schema>> {
  return {
    async decode(response, context) {
      if (!isJsonContentType(response)) throw invalidResponse(response.status, context);

      const text = await readResponseText(response, context);
      if (!text.trim()) throw invalidResponse(response.status, context);

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw invalidResponse(response.status, context);
      }

      try {
        if (isContractValue(schema, payload)) return payload;
      } catch {
        // Неизвестная runtime-схема также означает, что ответ нельзя считать подтверждённым.
      }

      throw invalidResponse(response.status, context);
    },
  };
}

export const emptyResponse: ApiResponseContract<undefined> = {
  async decode(response, context) {
    const text = await readResponseText(response, context);
    if (text.length > 0) throw invalidResponse(response.status, context);
    return undefined;
  },
};

export type ApiReadRequest<T> = Readonly<{
  path: ApiV1Path;
  response: ApiResponseContract<T>;
  signal?: AbortSignal;
}>;

export type ApiReadBackRequest<T> = Readonly<{
  path: ApiV1Path;
  response: ApiResponseContract<T>;
}>;

export type ApiMutationRequest<Body, Command, State> = Readonly<{
  body: Body;
  path: ApiV1Path;
  readBack: (command: ApiResponse<Command>) => ApiReadBackRequest<State>;
  response: ApiResponseContract<Command>;
  signal?: AbortSignal;
}>;

export type ApiMutationCompletion<Command, State> = Readonly<{
  command: ApiResponse<Command>;
  readBack: ApiResponse<State>;
}>;

export type CreateApiClientOptions = Readonly<{
  fetchImplementation?: typeof fetch;
  getConfirmedDemoSession?: () => DemoSessionResponse | null;
}>;

type ExecuteRequest<T> = Readonly<{
  body?: unknown;
  csrfToken?: string;
  method: 'GET' | 'POST';
  path: ApiV1Path;
  response: ApiResponseContract<T>;
  signal?: AbortSignal;
}>;

function requestIdFrom(response: Response): string | undefined {
  const requestId = response.headers.get('X-Request-Id')?.trim();
  return requestId || undefined;
}

function contextFrom(response: Response, value?: unknown): ApiRequestContext {
  const requestId = requestIdFrom(response);
  let correlationId: string | undefined;

  if (typeof value === 'object' && value !== null && 'correlationId' in value) {
    const candidate = value.correlationId;
    if (typeof candidate === 'string' && candidate.trim()) correlationId = candidate;
  }

  return {
    ...(correlationId ? { correlationId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function isProblemContentType(response: Response): boolean {
  const contentType = response.headers.get('Content-Type');
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/problem+json';
}

async function readProblem(response: Response): Promise<ProblemDetails | null> {
  if (!isProblemContentType(response)) return null;

  try {
    const payload: unknown = JSON.parse(await response.text());
    if (isContractValue(ProblemDetailsSchema, payload) && payload.status === response.status) {
      return payload;
    }
  } catch {
    // Невалидное error body не показывается пользователю и обрабатывается как общий HTTP error.
  }

  return null;
}

async function httpError(response: Response): Promise<ApiClientError> {
  const problem = await readProblem(response);
  const headerRequestId = requestIdFrom(response);
  const requestId = headerRequestId ?? problem?.requestId;
  const context: ApiRequestContext = requestId ? { requestId } : {};

  if (problem) {
    return new ApiClientError({
      context,
      kind: 'http-problem',
      message: problem.detail,
      problem,
      status: response.status,
    });
  }

  return new ApiClientError({
    context,
    kind: 'http-error',
    message: 'Сервер отклонил запрос.',
    status: response.status,
  });
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

function assertApiPath(path: ApiV1Path): void {
  try {
    const url = new URL(path, 'https://work-card.invalid');
    const isApiPath = url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/');
    const isRelativeSameOrigin =
      path.startsWith('/') &&
      !path.startsWith('//') &&
      !path.includes('\\') &&
      !url.hash &&
      url.origin === 'https://work-card.invalid';

    if (isApiPath && isRelativeSameOrigin) return;
  } catch {
    // Единая безопасная ошибка ниже не раскрывает переданный адрес.
  }

  throw new ApiClientError({
    kind: 'invalid-request',
    message: 'Указан недопустимый адрес API.',
  });
}

export function createApiClient(options: CreateApiClientOptions = {}) {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const getConfirmedDemoSession = options.getConfirmedDemoSession ?? (() => null);

  async function execute<T>(request: ExecuteRequest<T>): Promise<ApiResponse<T>> {
    assertApiPath(request.path);

    const headers = new Headers({ Accept: 'application/json' });
    if (request.method === 'POST') {
      headers.set('Content-Type', 'application/json');
      if (request.csrfToken) headers.set('X-CSRF-Token', request.csrfToken);
    }

    let response: Response;
    try {
      response = await fetchImplementation(request.path, {
        credentials: 'same-origin',
        headers,
        method: request.method,
        ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      if (isAbort(error, request.signal)) {
        throw new ApiClientError({ kind: 'abort', message: 'Запрос отменён.' });
      }

      throw new ApiClientError({
        kind: 'transport',
        message: 'Не удалось связаться с сервером.',
      });
    }

    if (!response.ok) throw await httpError(response);

    const responseContext = contextFrom(response);
    const data = await request.response.decode(response, responseContext);

    return {
      context: contextFrom(response, data),
      data,
      status: response.status,
    };
  }

  return {
    async mutate<Body, Command, State>(
      request: ApiMutationRequest<Body, Command, State>,
    ): Promise<ApiMutationCompletion<Command, State>> {
      const csrfToken = getConfirmedDemoSession()?.csrfToken;
      if (!csrfToken?.trim()) {
        throw new ApiClientError({
          kind: 'missing-csrf',
          message: 'Защищённое действие недоступно без подтверждённой серверной сессии.',
        });
      }

      const command = await execute({
        body: request.body,
        csrfToken,
        method: 'POST',
        path: request.path,
        response: request.response,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      const readBackRequest = request.readBack(command);
      const readBack = await execute({
        method: 'GET',
        path: readBackRequest.path,
        response: readBackRequest.response,
        ...(request.signal ? { signal: request.signal } : {}),
      });

      return { command, readBack };
    },

    async read<T>(request: ApiReadRequest<T>): Promise<ApiResponse<T>> {
      return execute({
        method: 'GET',
        path: request.path,
        response: request.response,
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
