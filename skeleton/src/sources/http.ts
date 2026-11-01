import { projectUserAgent } from '../core/pkg.js';

// ============================================================================
// Types
// ============================================================================

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  concurrencyPerHost?: number;
}

export interface HttpRequestOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  headers?: Record<string, string>;
  userAgent?: string;
}

export interface HttpClient {
  get(url: string, opts?: HttpRequestOptions): Promise<Response>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: string | number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// ============================================================================
// Semaphore for per-host concurrency control
// ============================================================================

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const resolve = this.queue.shift();
    if (resolve) {
      resolve();
    } else {
      this.count++;
    }
  }
}

// ============================================================================
// Retry-After parsing
// ============================================================================

function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) {
    return null;
  }

  // Try parsing as integer seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as RFC 7231 HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const now = Date.now();
    const delay = date.getTime() - now;
    return Math.max(0, delay);
  }

  return null;
}

// ============================================================================
// Exponential backoff calculation
// ============================================================================

function calculateBackoff(attempt: number): number {
  const base = 500;
  const jitter = Math.random() * 500;
  const delay = base * Math.pow(2, attempt - 1) + jitter;
  const maxDelay = 30000;
  return Math.min(delay, maxDelay);
}

// ============================================================================
// HTTP Client Factory
// ============================================================================

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const defaultTimeoutMs = opts.timeoutMs ?? 30000;
  const defaultMaxAttempts = opts.maxAttempts ?? 3;
  const concurrencyPerHost = opts.concurrencyPerHost ?? 4;
  const userAgent = opts.userAgent ?? projectUserAgent;

  const semaphores = new Map<string, Semaphore>();

  function getSemaphore(hostname: string): Semaphore {
    if (!semaphores.has(hostname)) {
      semaphores.set(hostname, new Semaphore(concurrencyPerHost));
    }
    return semaphores.get(hostname)!;
  }

  async function get(url: string, opts?: HttpRequestOptions): Promise<Response> {
    const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
    const maxAttempts = opts?.maxAttempts ?? defaultMaxAttempts;
    const headers = {
      'User-Agent': opts?.userAgent ?? userAgent,
      ...(opts?.headers ?? {}),
    };

    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const semaphore = getSemaphore(hostname);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await semaphore.acquire();

      let semaphoreReleased = false;

      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await fetch(url, { signal, headers });

        // Check for successful response
        if (response.ok) {
          semaphore.release();
          return response;
        }

        // Non-retryable 4xx (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new HttpError(`HTTP ${response.status}`, response.status, url);
        }

        // Retryable: 429, 503, 5xx
        if (response.status === 429 || response.status === 503 || response.status >= 500) {
          lastError = new HttpError(`HTTP ${response.status}`, response.status, url);

          if (attempt >= maxAttempts) {
            throw lastError;
          }

          // Check for Retry-After header
          const retryAfterMs = parseRetryAfter(response);
          const delayMs = retryAfterMs ?? calculateBackoff(attempt);

          semaphore.release();
          semaphoreReleased = true;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Unexpected status (shouldn't reach here)
        throw new HttpError(`HTTP ${response.status}`, response.status, url);
      } catch (error) {
        // Handle timeout (AbortError)
        if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new HttpError('Request timeout', 'timeout', url);

          if (attempt >= maxAttempts) {
            throw lastError;
          }

          const delayMs = calculateBackoff(attempt);
          semaphore.release();
          semaphoreReleased = true;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Handle HttpError
        if (error instanceof HttpError) {
          if (
            typeof error.status === 'number' &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            // Non-retryable 4xx - throw immediately
            throw error;
          }

          lastError = error;

          if (attempt >= maxAttempts) {
            throw error;
          }

          // Retryable error
          const delayMs = calculateBackoff(attempt);
          semaphore.release();
          semaphoreReleased = true;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Network error
        lastError = new HttpError(
          `Network error: ${(error as Error).message}`,
          'network_error',
          url,
        );

        if (attempt >= maxAttempts) {
          throw lastError;
        }

        const delayMs = calculateBackoff(attempt);
        semaphore.release();
        semaphoreReleased = true;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      } finally {
        if (!semaphoreReleased) {
          semaphore.release();
        }
      }
    }

    // Exhausted all attempts
    throw lastError ?? new HttpError('Unknown error', 'unknown', url);
  }

  return { get };
}
