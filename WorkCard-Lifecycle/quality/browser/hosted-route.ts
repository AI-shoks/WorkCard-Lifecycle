import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';

import type { Route } from '@playwright/test';

// Match the application's handler deadline, independently of its unchanged
// 15-second database transaction budget and the browser's UI action deadlines.
export const hostedRequestTimeoutMs = 20_000;

type FailureKind = 'origin' | 'redirect' | 'timeout' | 'transport';
class HostedRouteFailure extends Error {
  constructor(readonly kind: FailureKind) {
    super(`Hosted browser request failed (${kind}).`);
    this.name = 'HostedRouteFailure';
  }
}

type ForwardedResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

// route.fetch records its raw request-header log in Playwright's reporter BEFORE
// a caller can catch it. Native HTTP(S) has no Playwright API-request log. Keep
// credentials only in memory, never follow redirects and discard raw errors.
export async function forwardHostedRoute(
  route: Route,
  origin: string,
  timeoutMs = hostedRequestTimeoutMs,
): Promise<void> {
  try {
    const request = route.request();
    const target = new URL(request.url());
    if (
      target.origin !== origin ||
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      throw new HostedRouteFailure('origin');
    }
    const headers = await request.allHeaders();
    headers['host'] = target.host;
    const response = await new Promise<ForwardedResponse>((resolve, reject) => {
      let settled = false;
      const fail = (kind: FailureKind) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(new HostedRouteFailure(kind));
      };
      const transport = target.protocol === 'https:' ? requestHttps : requestHttp;
      const forwarded = transport(target, { method: request.method(), headers }, (incoming) => {
        const status = incoming.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          fail('redirect');
          incoming.destroy();
          forwarded.destroy();
          return;
        }
        const body: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => body.push(chunk));
        incoming.on('error', () => fail('transport'));
        incoming.on('aborted', () => fail('transport'));
        incoming.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          const responseHeaders: Record<string, string> = {};
          for (const [name, value] of Object.entries(incoming.headers)) {
            // Node has already decoded HTTP chunk framing. Keep representation
            // bytes/Content-Encoding and cookie headers, not hop-by-hop framing.
            if (
              value !== undefined &&
              !['connection', 'keep-alive', 'transfer-encoding', 'trailer', 'upgrade'].includes(
                name,
              )
            )
              responseHeaders[name] = Array.isArray(value) ? value.join('\n') : value;
          }
          resolve({ status, headers: responseHeaders, body: Buffer.concat(body) });
        });
      });
      const deadline = setTimeout(() => {
        fail('timeout');
        forwarded.destroy();
      }, timeoutMs);
      forwarded.on('error', () => fail('transport'));
      // No TLS options, alternate Host, redirect following or retries are added.
      forwarded.end(request.postDataBuffer());
    });
    await route.fulfill(response);
  } catch (error) {
    // Do not retain the original error as a cause, attach it, or print it.
    const kind = error instanceof HostedRouteFailure ? error.kind : 'transport';
    await route.abort('failed').catch(() => undefined);
    throw new HostedRouteFailure(kind);
  }
}
