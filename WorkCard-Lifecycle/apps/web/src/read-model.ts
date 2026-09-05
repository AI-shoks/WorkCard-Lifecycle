import {
  ProductionBatchDetailSchema,
  ProductionBatchesResponseSchema,
  ProductionPassportDetailSchema,
  ProductionPassportsResponseSchema,
  WorkCardSchema,
  WorkCardsResponseSchema,
  WorkCardSetDetailSchema,
  type ContractValue,
  type ProductionBatchDetail,
  type ProductionPassportDetail,
  type WorkCard,
  type WorkCardSetDetail,
  type WorkCardStatus,
} from '@work-card/contracts';

import { contractResponse, type ApiClient, type ApiV1Path } from './api-client.js';

export type ProductionPassportsPage = ContractValue<typeof ProductionPassportsResponseSchema>;
export type ProductionBatchesPage = ContractValue<typeof ProductionBatchesResponseSchema>;
export type WorkCardsPage = ContractValue<typeof WorkCardsResponseSchema>;

export type CursorPageRequest = Readonly<{
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}>;

export type WorkCardsPageRequest = CursorPageRequest &
  Readonly<{
    assigneeId?: string;
    setId: string;
    status?: WorkCardStatus;
  }>;

export type ReadModelClient = Readonly<{
  getBatch: (batchId: string, signal?: AbortSignal) => Promise<ProductionBatchDetail>;
  getPassport: (passportId: string, signal?: AbortSignal) => Promise<ProductionPassportDetail>;
  getWorkCard: (workCardId: string, signal?: AbortSignal) => Promise<WorkCard>;
  getWorkCardSet: (setId: string, signal?: AbortSignal) => Promise<WorkCardSetDetail>;
  listBatches: (request?: CursorPageRequest) => Promise<ProductionBatchesPage>;
  listPassports: (signal?: AbortSignal) => Promise<ProductionPassportsPage>;
  listWorkCards: (request: WorkCardsPageRequest) => Promise<WorkCardsPage>;
}>;

function optionalSignal(signal?: AbortSignal): { signal: AbortSignal } | object {
  return signal ? { signal } : {};
}

function resourcePath(collection: string, id: string): ApiV1Path {
  return `/api/v1/${collection}/${encodeURIComponent(id)}`;
}

function pagePath(base: ApiV1Path, request: CursorPageRequest = {}): ApiV1Path {
  const search = new URLSearchParams();
  if (request.cursor) search.set('cursor', request.cursor);
  if (request.limit !== undefined) search.set('limit', String(request.limit));
  const query = search.toString();
  return query ? (`${base}?${query}` as ApiV1Path) : base;
}

function workCardsPath(request: WorkCardsPageRequest): ApiV1Path {
  const base = `${resourcePath('work-card-sets', request.setId)}/work-cards` as ApiV1Path;
  const search = new URLSearchParams();
  if (request.cursor) search.set('cursor', request.cursor);
  if (request.limit !== undefined) search.set('limit', String(request.limit));
  if (request.status) search.set('status', request.status);
  if (request.assigneeId) search.set('assigneeId', request.assigneeId);
  const query = search.toString();
  return query ? (`${base}?${query}` as ApiV1Path) : base;
}

export function createReadModelClient(api: ApiClient): ReadModelClient {
  return {
    async getBatch(batchId, signal) {
      const response = await api.read({
        path: resourcePath('production-batches', batchId),
        response: contractResponse(ProductionBatchDetailSchema),
        ...optionalSignal(signal),
      });
      return response.data;
    },

    async getPassport(passportId, signal) {
      const response = await api.read({
        path: resourcePath('production-passports', passportId),
        response: contractResponse(ProductionPassportDetailSchema),
        ...optionalSignal(signal),
      });
      return response.data;
    },

    async getWorkCard(workCardId, signal) {
      const response = await api.read({
        path: resourcePath('work-cards', workCardId),
        response: contractResponse(WorkCardSchema),
        ...optionalSignal(signal),
      });
      return response.data;
    },

    async getWorkCardSet(setId, signal) {
      const response = await api.read({
        path: resourcePath('work-card-sets', setId),
        response: contractResponse(WorkCardSetDetailSchema),
        ...optionalSignal(signal),
      });
      return response.data;
    },

    async listBatches(request = {}) {
      const response = await api.read({
        path: pagePath('/api/v1/production-batches', request),
        response: contractResponse(ProductionBatchesResponseSchema),
        ...optionalSignal(request.signal),
      });
      return response.data;
    },

    async listPassports(signal) {
      const response = await api.read({
        path: '/api/v1/production-passports',
        response: contractResponse(ProductionPassportsResponseSchema),
        ...optionalSignal(signal),
      });
      return response.data;
    },

    async listWorkCards(request) {
      const response = await api.read({
        path: workCardsPath(request),
        response: contractResponse(WorkCardsResponseSchema),
        ...optionalSignal(request.signal),
      });
      return response.data;
    },
  };
}
