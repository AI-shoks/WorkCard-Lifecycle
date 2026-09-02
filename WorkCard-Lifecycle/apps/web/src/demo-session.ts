import type { DemoSessionResponse, DemoUser } from '@work-card/contracts';

const demoSessionPath = '/api/v1/demo-session';
const demoUsersPath = '/api/v1/demo-users';

type DemoUsersResponse = {
  items: DemoUser[];
};

type ProblemPayload = {
  detail?: unknown;
  title?: unknown;
};

export type DemoSessionBootstrap = {
  session: DemoSessionResponse | null;
  users: DemoUser[];
};

export class DemoSessionRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DemoSessionRequestError';
    this.status = status;
  }
}

function requestInit(method: 'DELETE' | 'GET' | 'POST', signal?: AbortSignal): RequestInit {
  return {
    cache: 'no-store',
    credentials: 'same-origin',
    method,
    ...(signal ? { signal } : {}),
  };
}

async function requestError(response: Response): Promise<DemoSessionRequestError> {
  let message = 'Не удалось выполнить запрос демонстрационной сессии.';

  try {
    const payload = (await response.json()) as ProblemPayload;
    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      message = payload.detail;
    } else if (typeof payload.title === 'string' && payload.title.trim()) {
      message = payload.title;
    }
  } catch {
    // Ошибка транспорта остаётся нейтральной и не раскрывает ответ сервера.
  }

  return new DemoSessionRequestError(response.status, message);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await requestError(response);
  return (await response.json()) as T;
}

export function createDemoSessionClient(fetchImplementation: typeof fetch = globalThis.fetch) {
  return {
    async createSession(demoUserId: string, signal?: AbortSignal): Promise<DemoSessionResponse> {
      const response = await fetchImplementation(demoSessionPath, {
        ...requestInit('POST', signal),
        body: JSON.stringify({ demoUserId }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      return readJson<DemoSessionResponse>(response);
    },

    async deleteSession(csrfToken: string, signal?: AbortSignal): Promise<void> {
      const response = await fetchImplementation(demoSessionPath, {
        ...requestInit('DELETE', signal),
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });

      // Истёкшая серверная сессия уже эквивалентна завершённой для клиента.
      if (response.status === 401) return;
      if (!response.ok) throw await requestError(response);
    },

    async getSession(signal?: AbortSignal): Promise<DemoSessionResponse | null> {
      const response = await fetchImplementation(demoSessionPath, {
        ...requestInit('GET', signal),
        headers: { Accept: 'application/json' },
      });

      if (response.status === 401) return null;
      return readJson<DemoSessionResponse>(response);
    },

    async listUsers(signal?: AbortSignal): Promise<DemoUser[]> {
      const response = await fetchImplementation(demoUsersPath, {
        ...requestInit('GET', signal),
        headers: { Accept: 'application/json' },
      });
      const payload = await readJson<DemoUsersResponse>(response);
      return payload.items;
    },
  };
}

export type DemoSessionClient = ReturnType<typeof createDemoSessionClient>;

export async function bootstrapDemoSession(
  client: DemoSessionClient,
  signal?: AbortSignal,
): Promise<DemoSessionBootstrap> {
  const [users, session] = await Promise.all([client.listUsers(signal), client.getSession(signal)]);

  return { session, users };
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
