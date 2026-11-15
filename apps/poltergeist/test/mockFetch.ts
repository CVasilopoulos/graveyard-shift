import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { Config } from '../src/config.js';
import { rawLockfileUrl } from '../src/lockfiles.js';

export interface Exchange {
  name?: string;
  method: string;
  url: string;
  requestBody?: unknown;
  respondWith: {
    status: number;
    headers?: Record<string, string>;
    body: unknown;
    delayMs?: number;
  };
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export function loadFixture(relativePath: string): Exchange[] {
  return JSON.parse(readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), 'utf-8')) as Exchange[];
}

export function demoFile(name: string): string {
  return readFileSync(new URL(`../demo/haunted-house/${name}`, import.meta.url), 'utf-8');
}

export function serveLockfiles(config: Config, contents: Record<string, string>): Exchange[] {
  return config.targets.flatMap((target) =>
    target.lockfiles.map((path) => ({
      method: 'GET',
      url: rawLockfileUrl(target, path),
      respondWith: { status: 200, headers: { 'content-type': 'text/plain' }, body: contents[path] },
    })),
  );
}

export function mockFetch(exchanges: Exchange[]): RecordedRequest[] {
  const unused = [...exchanges];
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      requests.push({ method, url, headers: { ...(init?.headers as Record<string, string>) }, body });
      const index = unused.findIndex((exchange) => exchange.method === method && exchange.url === url);
      if (index === -1) {
        return new Response(`No recorded response for ${method} ${url}`, { status: 418 });
      }
      const [exchange] = unused.splice(index, 1);
      const { status, headers = {}, body: responseBody, delayMs } = exchange.respondWith;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const text = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      return new Response(text, { status, headers });
    }),
  );
  return requests;
}
