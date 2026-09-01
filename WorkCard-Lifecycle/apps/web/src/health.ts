import type { ReadinessResponse } from '@work-card/contracts';

export type ReadinessView = {
  tone: 'ready' | 'waiting';
  label: string;
};

export function toReadinessView(response: ReadinessResponse | null): ReadinessView {
  if (response?.status === 'ok') {
    return { tone: 'ready', label: 'Среда готова' };
  }

  return { tone: 'waiting', label: 'Среда запускается' };
}

export async function fetchReadiness(signal: AbortSignal): Promise<ReadinessResponse> {
  const response = await fetch('/health/ready', {
    headers: { Accept: 'application/json' },
    signal,
  });

  const payload = (await response.json()) as ReadinessResponse;
  return payload;
}
