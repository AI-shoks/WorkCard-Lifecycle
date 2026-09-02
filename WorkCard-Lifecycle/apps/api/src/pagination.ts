import { DomainError } from './domain-error.js';

type CursorPayload = {
  id: string;
  sortKey: string;
  v: 1;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PageInput = {
  cursor?: string;
  limit?: number;
};

export function pageLimit(input: PageInput): number {
  return input.limit ?? 50;
}

export function encodeCursor(sortKey: string, id: string): string {
  const payload: CursorPayload = { id, sortKey, v: 1 };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('v' in parsed) ||
      parsed.v !== 1 ||
      !('sortKey' in parsed) ||
      typeof parsed.sortKey !== 'string' ||
      parsed.sortKey.length === 0 ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string' ||
      !uuidPattern.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { v: 1, sortKey: parsed.sortKey, id: parsed.id };
  } catch {
    throw new DomainError({
      code: 'INVALID_REQUEST',
      detail: 'Курсор страницы недействителен.',
      status: 400,
      title: 'Некорректный запрос',
    });
  }
}
