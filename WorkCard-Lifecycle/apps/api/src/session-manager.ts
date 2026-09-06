import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

import type { CommandName, DemoSessionResponse, DemoUser, Role } from '@work-card/contracts';
import type { Pool } from 'pg';

import { demoMaintenanceLockKey } from './demo-maintenance.js';
import {
  actionForbidden,
  authenticationRequired,
  demoCapacityReached,
  invalidBusinessInput,
} from './domain-error.js';

const sessionCookieName = 'wcl_session';
const absoluteSessionHours = 8;
const idleSessionMinutes = 30;

const roleLabels: Record<Role, string> = {
  PLANNER: 'Специалист ПДБ',
  MASTER: 'Мастер участка',
  WORKER: 'Исполнитель',
  QUALITY_CONTROLLER: 'Контролёр БТК',
  ADMIN_AUDITOR: 'Администратор-аудитор',
};

const rolePermissions: Record<Role, readonly CommandName[]> = {
  PLANNER: ['CreateProductionBatch', 'ReleaseWorkCards'],
  MASTER: ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard'],
  WORKER: [],
  QUALITY_CONTROLLER: [
    'AcceptFirstArticle',
    'ConfirmWorkCardQuality',
    'RecordFinalBatchAcceptance',
  ],
  ADMIN_AUDITOR: ['ExportWorkCardToPayroll'],
};

export type ActorContext = {
  id: string;
  displayName: string;
  role: Role;
};

export type AuthenticatedSession = {
  actor: ActorContext;
  csrfTokenHash: Buffer;
  id: string;
};

export type SessionManagerOptions = {
  allowedOrigin: string;
  cookieSecure: boolean;
  maximumSessions?: number;
  signingSecret: string;
};

type UserRow = {
  display_name: string;
  id: string;
  role_code: string;
};

type SessionRow = UserRow & {
  csrf_token_hash: Buffer;
  session_id: string;
};

function isRole(value: string): value is Role {
  return value in roleLabels;
}

function toDemoUser(row: UserRow): DemoUser {
  if (!isRole(row.role_code)) throw new Error('В БД обнаружена неподдерживаемая demo-роль.');
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role_code,
    roleLabel: roleLabels[row.role_code],
  };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) values.set(name, value);
  }
  return values;
}

export function permissionsFor(role: Role): CommandName[] {
  return [...rolePermissions[role]];
}

export function roleCan(role: Role, command: CommandName): boolean {
  return rolePermissions[role].includes(command);
}

export function createSessionManager(pool: Pool, options: SessionManagerOptions) {
  const maximumSessions = options.maximumSessions ?? 500;
  const signatureFor = (sessionId: string): string =>
    createHmac('sha256', options.signingSecret).update(`session:${sessionId}`).digest('base64url');

  const csrfTokenFor = (sessionId: string): string =>
    createHmac('sha256', options.signingSecret).update(`csrf:${sessionId}`).digest('base64url');

  const hashCsrf = (token: string): Buffer => createHash('sha256').update(token).digest();

  const parseSignedSessionId = (cookieHeader: string | undefined): string | null => {
    const value = parseCookies(cookieHeader).get(sessionCookieName);
    if (!value) return null;
    const separator = value.lastIndexOf('.');
    if (separator <= 0) return null;
    const sessionId = value.slice(0, separator);
    const suppliedSignature = value.slice(separator + 1);
    const expectedSignature = signatureFor(sessionId);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return sessionId;
  };

  const sessionCookie = (sessionId: string): string => {
    const secure = options.cookieSecure ? '; Secure' : '';
    return `${sessionCookieName}=${sessionId}.${signatureFor(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${absoluteSessionHours * 60 * 60}${secure}`;
  };

  const clearSessionCookie = (): string => {
    const secure = options.cookieSecure ? '; Secure' : '';
    return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  };

  return {
    assertMutationOrigin(origin: string | undefined): void {
      if (origin !== options.allowedOrigin) throw actionForbidden();
    },

    assertCsrf(session: AuthenticatedSession, suppliedToken: string | undefined): void {
      if (!suppliedToken) throw actionForbidden();
      const suppliedHash = hashCsrf(suppliedToken);
      if (
        suppliedHash.length !== session.csrfTokenHash.length ||
        !timingSafeEqual(suppliedHash, session.csrfTokenHash)
      ) {
        throw actionForbidden();
      }
    },

    async authenticate(cookieHeader: string | undefined): Promise<AuthenticatedSession> {
      const sessionId = parseSignedSessionId(cookieHeader);
      if (!sessionId) throw authenticationRequired();

      const result = await pool.query<SessionRow>(
        `UPDATE demo_sessions AS session
         SET last_seen_at = CURRENT_TIMESTAMP,
             idle_expires_at = LEAST(session.expires_at, CURRENT_TIMESTAMP + interval '${idleSessionMinutes} minutes')
         FROM demo_users AS demo_user
         WHERE session.id = $1
           AND session.demo_user_id = demo_user.id
           AND demo_user.enabled
           AND session.expires_at > CURRENT_TIMESTAMP
           AND session.idle_expires_at > CURRENT_TIMESTAMP
         RETURNING session.id AS session_id, session.csrf_token_hash,
                   demo_user.id, demo_user.display_name, demo_user.role_code`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row || !isRole(row.role_code)) {
        await pool.query(
          `DELETE FROM demo_sessions AS session
           WHERE session.id = $1
             AND (
               session.expires_at <= CURRENT_TIMESTAMP
               OR session.idle_expires_at <= CURRENT_TIMESTAMP
               OR NOT EXISTS (
                 SELECT 1 FROM demo_users AS demo_user
                 WHERE demo_user.id = session.demo_user_id AND demo_user.enabled
               )
             )`,
          [sessionId],
        );
        throw authenticationRequired();
      }
      return {
        id: row.session_id,
        csrfTokenHash: row.csrf_token_hash,
        actor: { id: row.id, displayName: row.display_name, role: row.role_code },
      };
    },

    clearSessionCookie,

    async createSession(
      demoUserId: string,
      previousCookieHeader: string | undefined,
    ): Promise<{ body: DemoSessionResponse; cookie: string }> {
      const userResult = await pool.query<UserRow>(
        `SELECT id, display_name, role_code
         FROM demo_users
         WHERE id = $1 AND enabled`,
        [demoUserId],
      );
      const userRow = userResult.rows[0];
      if (!userRow) {
        throw invalidBusinessInput(
          'INVALID_DEMO_USER',
          'Выберите доступную демонстрационную роль.',
        );
      }
      const user = toDemoUser(userRow);
      const sessionId = randomUUID();
      const csrfToken = csrfTokenFor(sessionId);
      const previousSessionId = parseSignedSessionId(previousCookieHeader);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [demoMaintenanceLockKey]);
        if (previousSessionId) {
          await client.query('DELETE FROM demo_sessions WHERE id = $1', [previousSessionId]);
        }
        await client.query(
          `DELETE FROM demo_sessions
           WHERE expires_at <= CURRENT_TIMESTAMP OR idle_expires_at <= CURRENT_TIMESTAMP`,
        );
        const capacity = await client.query<{ count: number }>(
          'SELECT COUNT(*)::integer AS count FROM demo_sessions',
        );
        if ((capacity.rows[0]?.count ?? maximumSessions) >= maximumSessions) {
          throw demoCapacityReached(
            'Достигнут лимит активных сессий общего контура. Повторите попытку позднее.',
          );
        }
        await client.query(
          `INSERT INTO demo_sessions(
             id, demo_user_id, csrf_token_hash, created_at, expires_at, idle_expires_at,
             last_seen_at
           ) VALUES (
             $1, $2, $3, CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP + interval '${absoluteSessionHours} hours',
             CURRENT_TIMESTAMP + interval '${idleSessionMinutes} minutes',
             CURRENT_TIMESTAMP
           )`,
          [sessionId, demoUserId, hashCsrf(csrfToken)],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return {
        body: { actor: user, csrfToken, permissions: permissionsFor(user.role) },
        cookie: sessionCookie(sessionId),
      };
    },

    async deleteSession(session: AuthenticatedSession): Promise<void> {
      await pool.query('DELETE FROM demo_sessions WHERE id = $1', [session.id]);
    },

    async getSessionResponse(session: AuthenticatedSession): Promise<DemoSessionResponse> {
      const actor: DemoUser = {
        ...session.actor,
        roleLabel: roleLabels[session.actor.role],
      };
      return {
        actor,
        csrfToken: csrfTokenFor(session.id),
        permissions: permissionsFor(session.actor.role),
      };
    },

    async listUsers(): Promise<DemoUser[]> {
      const result = await pool.query<UserRow>(
        `SELECT id, display_name, role_code
         FROM demo_users
         WHERE enabled
         ORDER BY id`,
      );
      return result.rows.map(toDemoUser);
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
