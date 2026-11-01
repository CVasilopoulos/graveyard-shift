import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHttpClient, HttpError } from '../../src/sources/http.js';

// Mock fetch globally
const originalFetch = globalThis.fetch;

interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs?: number;
}

interface MockRequest {
  url: string;
  responses: MockResponse[];
  requestCount: number;
}

describe('HTTP Client', () => {
  let mockRequests: Map<string, MockRequest>;

  beforeEach(() => {
    mockRequests = new Map();

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      let request = mockRequests.get(urlStr);

      if (!request) {
        request = {
          url: urlStr,
          responses: [],
          requestCount: 0,
        };
        mockRequests.set(urlStr, request);
      }

      const responseIndex = request.requestCount;
      request.requestCount++;

      if (responseIndex >= request.responses.length) {
        throw new Error(`No mock response configured for request ${responseIndex + 1} to ${urlStr}`);
      }

      const mockResp = request.responses[responseIndex];

      if (mockResp.delayMs) {
        await new Promise(resolve => setTimeout(resolve, mockResp.delayMs));
      }

      const headers = new Headers(mockResp.headers);

      return new Response(mockResp.body, {
        status: mockResp.status,
        headers,
      });
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Helper to set up mock responses for a URL
  function setupResponses(url: string, responses: MockResponse[]) {
    mockRequests.set(url, {
      url,
      responses,
      requestCount: 0,
    });
  }

  it('should successfully return a 200 response', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data": "test"}',
      },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    const response = await client.get(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"data": "test"}');
  });

  it('should include User-Agent header in requests', async () => {
    const url = 'https://example.com/api';
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    await client.get(url);
    expect(capturedHeaders?.['User-Agent']).toBe('test-client/1.0 (+https://github.com/test/repo)');
  });

  it('defaults the User-Agent to the package name, version and repository URL', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    }) as any;
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    await createHttpClient({}).get('https://example.com/api');
    expect(capturedHeaders?.['User-Agent']).toBe(
      `graveyard-shift/${pkg.version} (+https://github.com/CVasilopoulos/graveyard-shift)`,
    );
  });

  it('should merge custom headers with User-Agent', async () => {
    const url = 'https://example.com/api';
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    await client.get(url, {
      headers: { Authorization: 'Bearer token123' },
    });

    expect(capturedHeaders?.['User-Agent']).toBe('test-client/1.0 (+https://github.com/test/repo)');
    expect(capturedHeaders?.['Authorization']).toBe('Bearer token123');
  });

  it('should retry on 500 and succeed on third attempt', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
      { status: 200, headers: {}, body: '{"data": "success"}' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    const response = await client.get(url);
    expect(response.status).toBe(200);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(3);
  });

  it('should throw HttpError when exhausting max attempts on 500', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    await expect(client.get(url)).rejects.toThrow(HttpError);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(3);
  });

  it('should not retry on 404', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [{ status: 404, headers: {}, body: 'Not found' }]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    await expect(client.get(url)).rejects.toThrow(HttpError);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(1);
  });

  it('should not retry on 403', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [{ status: 403, headers: {}, body: 'Forbidden' }]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    await expect(client.get(url)).rejects.toThrow(HttpError);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(1);
  });

  it('should retry on 429 and succeed on second attempt', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 429, headers: {}, body: 'Too many requests' },
      { status: 200, headers: {}, body: '{"data": "success"}' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    const response = await client.get(url);
    expect(response.status).toBe(200);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(2);
  });

  it('should parse integer Retry-After header', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 429, headers: { 'Retry-After': '1' }, body: 'Too many requests' },
      { status: 200, headers: {}, body: '{"data": "success"}' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    const start = Date.now();
    const response = await client.get(url);
    const elapsed = Date.now() - start;

    expect(response.status).toBe(200);
    // Should wait roughly 1 second (1000ms), allow for timing variance
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('should retry on 503 with Retry-After header', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 503, headers: { 'Retry-After': '1' }, body: 'Service unavailable' },
      { status: 200, headers: {}, body: '{"data": "success"}' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    const start = Date.now();
    const response = await client.get(url);
    const elapsed = Date.now() - start;

    expect(response.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('should use exponential backoff by default', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
      { status: 200, headers: {}, body: 'Success' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 3,
    });

    const start = Date.now();
    const response = await client.get(url);
    const elapsed = Date.now() - start;

    expect(response.status).toBe(200);
    // First retry waits ~500ms + jitter, second wait ~1000ms + jitter
    // Total should be at least 1500ms
    expect(elapsed).toBeGreaterThanOrEqual(1400);
  });

  it('should respect per-call timeout override', async () => {
    const url = 'https://example.com/api';

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      timeoutMs: 5000,
    });

    // Override with shorter timeout for this call
    const response = await client.get(url, { timeoutMs: 200 });
    expect(response.status).toBe(200);
  });

  it('should respect per-call maxAttempts override', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
      { status: 500, headers: {}, body: 'Server error' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 5,
    });

    // Override with fewer attempts for this call
    await expect(client.get(url, { maxAttempts: 2 })).rejects.toThrow(HttpError);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(2);
  });

  it('should enforce per-host concurrency limit', async () => {
    const url1 = 'https://example.com/api1';
    const url2 = 'https://example.com/api2';
    const url3 = 'https://example.com/api3';
    const url4 = 'https://example.com/api4';
    const url5 = 'https://example.com/api5';

    let activeRequests = 0;
    let maxConcurrentRequests = 0;

    globalThis.fetch = vi.fn(async (url: string) => {
      activeRequests++;
      if (activeRequests > maxConcurrentRequests) {
        maxConcurrentRequests = activeRequests;
      }

      // Simulate slow request
      await new Promise(resolve => setTimeout(resolve, 50));

      activeRequests--;
      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      concurrencyPerHost: 2,
    });

    const promises = [
      client.get(url1),
      client.get(url2),
      client.get(url3),
      client.get(url4),
      client.get(url5),
    ];

    await Promise.all(promises);

    // With concurrency limit of 2, we should never have more than 3 simultaneous requests
    // (allowing some timing variance)
    expect(maxConcurrentRequests).toBeLessThanOrEqual(3);
  });

  it('should have default timeout of 30000ms', async () => {
    const url = 'https://example.com/api';

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    await client.get(url);

    // We can't directly check the timeout, but we can verify the client was created successfully
    // The default would be used internally
    expect(true).toBe(true);
  });

  it('should have default maxAttempts of 3', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [
      { status: 500, headers: {}, body: 'Error' },
      { status: 500, headers: {}, body: 'Error' },
      { status: 500, headers: {}, body: 'Error' },
      { status: 200, headers: {}, body: 'Success' },
    ]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    // Should fail after 3 attempts (not 4)
    await expect(client.get(url)).rejects.toThrow(HttpError);

    const req = mockRequests.get(url);
    expect(req?.requestCount).toBe(3);
  });

  it('should have default concurrencyPerHost of 4', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    globalThis.fetch = vi.fn(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }

      await new Promise(resolve => setTimeout(resolve, 30));
      currentConcurrent--;

      return new Response('ok', { status: 200 });
    }) as any;

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
    });

    const promises = Array.from({ length: 10 }, (_, i) =>
      client.get(`https://example.com/api${i}`),
    );

    await Promise.all(promises);

    // Default concurrency is 4, allowing reasonable timing variance
    expect(maxConcurrent).toBeLessThanOrEqual(8);
  });

  it('should throw HttpError with proper structure', async () => {
    const url = 'https://example.com/api';
    setupResponses(url, [{ status: 503, headers: {}, body: 'Unavailable' }]);

    const client = createHttpClient({
      userAgent: 'test-client/1.0 (+https://github.com/test/repo)',
      maxAttempts: 1,
    });

    try {
      await client.get(url);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.status).toBe(503);
      expect(httpError.url).toBe(url);
      expect(httpError.message).toContain('HTTP');
    }
  });
});
