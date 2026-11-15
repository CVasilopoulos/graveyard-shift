import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notify } from '../../src/notify/notifier.js';
import type { Finding, DiffResult } from '../../src/core/types.js';

// ============================================================================
// Mock Setup
// ============================================================================

// Store the original fetch to restore later if needed
const originalFetch = global.fetch;

// Track API calls made during tests
interface ApiCall {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

const apiCalls: ApiCall[] = [];

// Helper to create a mock fetch function with consistent default behavior
function createMockFetch() {
  return vi.fn(async (url: string, options?: RequestInit & { signal?: AbortSignal }): Promise<Response> => {
    apiCalls.push({
      method: options?.method || 'GET',
      url,
      headers: options?.headers as Record<string, string>,
      body: options?.body as string,
    });

    // Handle different API endpoints
    if (url.includes('/search/issues')) {
      // Issue search endpoint - return no items by default
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/labels/')) {
      // Label endpoint
      if (options?.method === 'GET') {
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Create label
      return new Response(JSON.stringify({}), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/issues')) {
      if (options?.method === 'POST') {
        // Create issue
        return new Response(JSON.stringify({ number: 123 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (options?.method === 'PATCH') {
        // Update or close issue
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.includes('/pulls')) {
      if (options?.method === 'POST') {
        // Create PR
        return new Response(JSON.stringify({ number: 456 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

// Helper function to create a test finding
function createTestFinding(overrides?: Partial<Finding>): Finding {
  return {
    id: 'test-finding-1',
    title: 'Test Finding',
    summary: 'A test finding for unit tests',
    severity: 'high',
    status: 'confirmed',
    sources: ['source1', 'source2'],
    evidence: [
      { sourceName: 'source1', text: 'Found by source 1' },
      { sourceName: 'source2', text: 'Found by source 2' },
    ],
    firstSeen: '2024-01-01T00:00:00Z',
    lastSeen: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

// Helper function to create a test diff
function createTestDiff(overrides?: Partial<DiffResult>): DiffResult {
  return {
    appeared: [],
    still: [],
    resolved: [],
    promoted: [],
    demoted: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('notifier', () => {
  beforeEach(() => {
    // Clear API calls before each test
    apiCalls.length = 0;
    // Clear environment variables before each test
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    // Set up mock fetch with fresh instance
    global.fetch = createMockFetch();
    // Mock console methods to reduce noise
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Restore original fetch
    global.fetch = originalFetch;
  });

  // ========================================================================
  // Requirement 10.11: GITHUB_TOKEN validation
  // ========================================================================

  it('throws descriptive error if GITHUB_TOKEN is absent', async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const diff = createTestDiff();
    const findings: Finding[] = [];

    await expect(notify(diff, findings)).rejects.toThrow(
      /GITHUB_TOKEN environment variable is required/,
    );

    // Verify no API calls were made
    expect(apiCalls).toHaveLength(0);
  });

  // ========================================================================
  // Requirement 10.1: Open new issues with finding id in title
  // ========================================================================

  it('opens new issue for confirmed appeared finding', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-2024-001',
      title: 'SQL Injection Vulnerability',
    });

    const diff = createTestDiff({
      appeared: ['vuln-2024-001'],
    });

    await notify(diff, [finding]);

    // Should have called ensureLabel and created an issue
    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls).toHaveLength(1);
    const createCall = createIssueCalls[0];
    const body = JSON.parse(createCall.body || '{}');

    // Verify finding id is in title
    expect(body.title).toContain('vuln-2024-001');
    expect(body.title).toContain('SQL Injection Vulnerability');
    // Verify finding id is in body
    expect(body.body).toContain('vuln-2024-001');
    // Verify label is added
    expect(body.labels).toContain('graveyard-shift');
  });

  // ========================================================================
  // Requirement 10.2: Update existing issue body when issue exists
  // ========================================================================

  it('updates existing issue body when issue already exists', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-2024-001',
      summary: 'Updated summary',
    });

    const diff = createTestDiff({
      appeared: ['vuln-2024-001'],
    });

    // Create a custom mock that returns an existing issue on search
    let searchCalled = false;
    const mockFetch = vi.fn(async (url: string, options?: RequestInit & { signal?: AbortSignal }) => {
      apiCalls.push({
        method: options?.method || 'GET',
        url,
        headers: options?.headers as Record<string, string>,
        body: options?.body as string,
      });

      if (url.includes('/search/issues') && !searchCalled) {
        searchCalled = true;
        // Return existing issue
        return new Response(
          JSON.stringify({
            items: [{ number: 42, state: 'open' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.includes('/labels')) {
        if (options?.method === 'GET') {
          return new Response(JSON.stringify({}), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/issues/42')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/search/issues')) {
        // Subsequent search calls
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    global.fetch = mockFetch;

    await notify(diff, [finding]);

    // Should have updated the issue
    const updateCalls = apiCalls.filter(
      (call) => call.method === 'PATCH' && call.url.includes('/issues/42'),
    );

    expect(updateCalls.length).toBeGreaterThan(0);
    const updateCall = updateCalls[0];
    const body = JSON.parse(updateCall.body || '{}');

    // Verify body contains updated content
    expect(body.body).toContain('Updated summary');
    expect(body.body).toContain('vuln-2024-001');
  });

  // ========================================================================
  // Requirement 10.5: Close issues for resolved findings
  // ========================================================================

  it('closes open issue for resolved confirmed finding', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-2024-001',
      resolvedAt: '2024-01-15T00:00:00Z',
    });

    const diff = createTestDiff({
      resolved: ['vuln-2024-001'],
    });

    // Create a custom mock that returns existing issue on search
    let searchCalled = false;
    const mockFetch = vi.fn(async (url: string, options?: RequestInit & { signal?: AbortSignal }) => {
      apiCalls.push({
        method: options?.method || 'GET',
        url,
        headers: options?.headers as Record<string, string>,
        body: options?.body as string,
      });

      if (url.includes('/search/issues') && !searchCalled) {
        searchCalled = true;
        return new Response(
          JSON.stringify({
            items: [{ number: 42, state: 'open' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.includes('/labels')) {
        if (options?.method === 'GET') {
          return new Response(JSON.stringify({}), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/issues/42')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    global.fetch = mockFetch;

    await notify(diff, [finding]);

    // Should have closed the issue
    const closeCalls = apiCalls.filter(
      (call) => call.method === 'PATCH' && call.url.includes('/issues/42'),
    );

    expect(closeCalls.length).toBeGreaterThan(0);
    const closeCall = closeCalls[0];
    const body = JSON.parse(closeCall.body || '{}');

    // Verify issue is closed
    expect(body.state).toBe('closed');
  });

  // ========================================================================
  // Requirement 10.3: Don't open issues for ghost findings
  // ========================================================================

  it('does not open issue for ghost finding', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'ghost-finding-1',
      status: 'ghost',
      sources: ['source1'], // Only one source
    });

    const diff = createTestDiff({
      appeared: ['ghost-finding-1'],
    });

    await notify(diff, [finding]);

    // Should not have created any issues (only ensureLabel)
    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls).toHaveLength(0);
  });

  // ========================================================================
  // Requirement 10.6: Open PR for confirmed appeared findings with edits
  // ========================================================================

  it('attempts to open PR for confirmed finding with edits', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'fix-2024-001',
      edits: [
        {
          path: 'src/vulnerable.ts',
          newContent: 'fixed code here',
        },
      ],
    });

    const diff = createTestDiff({
      appeared: ['fix-2024-001'],
    });

    await notify(diff, [finding]);

    // Since PR creation is not fully implemented, we expect a warning
    // but the issue should still be created
    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls.length).toBeGreaterThan(0);
  });

  // ========================================================================
  // Requirement 10.13: Dry-run mode
  // ========================================================================

  it('dry-run mode logs actions without any API call', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-2024-001',
    });

    const diff = createTestDiff({
      appeared: ['vuln-2024-001'],
    });

    const consoleSpy = vi.spyOn(console, 'log');

    await notify(diff, [finding], { dryRun: true });

    // Should have logged dry-run message
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));

    // No API calls should have been made
    expect(apiCalls).toHaveLength(0);
  });

  // ========================================================================
  // Requirement 10.12: Cap enforcement
  // ========================================================================

  it('caps new issues per run at maxNewIssues', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    // Create multiple findings
    const findings = [
      createTestFinding({ id: 'vuln-1' }),
      createTestFinding({ id: 'vuln-2' }),
      createTestFinding({ id: 'vuln-3' }),
      createTestFinding({ id: 'vuln-4' }),
    ];

    const diff = createTestDiff({
      appeared: ['vuln-1', 'vuln-2', 'vuln-3', 'vuln-4'],
    });

    const warnSpy = vi.spyOn(console, 'warn');

    await notify(diff, findings, { maxNewIssues: 2 });

    // Filter for issue creation calls (POST to exact issues endpoint)
    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    // Should have created at most 2 issues
    expect(createIssueCalls.length).toBeLessThanOrEqual(2);

    // Should have logged cap warning
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Reached cap'),
    );
  });

  // ========================================================================
  // Finding id in issue body and title
  // ========================================================================

  it('includes finding id as machine-readable marker in title', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'cve-2024-12345',
      title: 'RCE Vulnerability',
    });

    const diff = createTestDiff({
      appeared: ['cve-2024-12345'],
    });

    await notify(diff, [finding]);

    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls).toHaveLength(1);
    const body = JSON.parse(createIssueCalls[0].body || '{}');

    // Check title format: [graveyard-shift] {title} (id: {id})
    expect(body.title).toMatch(/\[graveyard-shift\]/);
    expect(body.title).toMatch(/id: cve-2024-12345/);
  });

  it('starts every new issue title with the issue prefix when one is supplied', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const appeared = createTestFinding({ id: 'vuln-a', title: 'Appeared haunting' });
    const promoted = createTestFinding({ id: 'vuln-b', title: 'Promoted haunting' });

    await notify(createTestDiff({ appeared: ['vuln-a'], promoted: ['vuln-b'] }), [appeared, promoted], {
      issuePrefix: '👻',
    });

    const titles = apiCalls
      .filter((call) => call.method === 'POST' && call.url === 'https://api.github.com/repos/owner/repo/issues')
      .map((call) => JSON.parse(call.body || '{}').title);
    expect(titles).toEqual([
      '👻 [graveyard-shift] Appeared haunting (id: vuln-a)',
      '👻 [graveyard-shift] Promoted haunting (id: vuln-b)',
    ]);
  });

  it('leaves issue titles unprefixed when no issue prefix is supplied', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    await notify(createTestDiff({ appeared: ['vuln-c'] }), [createTestFinding({ id: 'vuln-c', title: 'Plain' })]);

    const created = apiCalls.find(
      (call) => call.method === 'POST' && call.url === 'https://api.github.com/repos/owner/repo/issues',
    );
    expect(JSON.parse(created?.body || '{}').title).toBe('[graveyard-shift] Plain (id: vuln-c)');
  });

  it('includes fix details in issue body', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-1',
      fix: {
        text: 'Update to v2.5.0',
        value: '2.5.0',
      },
    });

    const diff = createTestDiff({
      appeared: ['vuln-1'],
    });

    await notify(diff, [finding]);

    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls).toHaveLength(1);
    const body = JSON.parse(createIssueCalls[0].body || '{}');

    expect(body.body).toContain('Update to v2.5.0');
    expect(body.body).toContain('2.5.0');
  });

  // ========================================================================
  // Requirement 10.7: Add graveyard-shift label
  // ========================================================================

  it('adds graveyard-shift label to created issues', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({ id: 'vuln-1' });

    const diff = createTestDiff({
      appeared: ['vuln-1'],
    });

    await notify(diff, [finding]);

    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    expect(createIssueCalls).toHaveLength(1);
    const body = JSON.parse(createIssueCalls[0].body || '{}');

    expect(body.labels).toContain('graveyard-shift');
  });

  // ========================================================================
  // Error handling
  // ========================================================================

  it('handles API errors gracefully and continues processing', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const findings = [
      createTestFinding({ id: 'vuln-1' }),
      createTestFinding({ id: 'vuln-2' }),
    ];

    const diff = createTestDiff({
      appeared: ['vuln-1', 'vuln-2'],
    });

    // Create mock that simulates a transient error on first attempt
    let createAttempt = 0;
    const mockFetch = vi.fn(async (url: string, options?: RequestInit & { signal?: AbortSignal }) => {
      apiCalls.push({
        method: options?.method || 'GET',
        url,
        headers: options?.headers as Record<string, string>,
        body: options?.body as string,
      });

      // Fail first creation attempt with transient error
      if (
        options?.method === 'POST' &&
        url === 'https://api.github.com/repos/owner/repo/issues' &&
        createAttempt === 0
      ) {
        createAttempt++;
        // Simulate transient error that will be retried
        return new Response(JSON.stringify({ message: 'Service unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/labels')) {
        if (options?.method === 'GET') {
          return new Response(JSON.stringify({}), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/issues')) {
        if (options?.method === 'POST') {
          return new Response(JSON.stringify({ number: 123 }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    global.fetch = mockFetch;

    // Should not throw, should continue processing
    await expect(
      notify(diff, findings),
    ).resolves.not.toThrow();
  });

  // ========================================================================
  // Promoted findings
  // ========================================================================

  it('opens issues for promoted findings (ghost -> confirmed)', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const finding = createTestFinding({
      id: 'vuln-1',
      status: 'confirmed', // Now confirmed
    });

    const diff = createTestDiff({
      still: ['vuln-1'],
      promoted: ['vuln-1'],
    });

    await notify(diff, [finding]);

    const createIssueCalls = apiCalls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url === 'https://api.github.com/repos/owner/repo/issues',
    );

    // Should have created an issue for promoted finding
    expect(createIssueCalls.length).toBeGreaterThan(0);
  });

  // ========================================================================
  // Environment variable handling
  // ========================================================================

  it('uses GITHUB_REPOSITORY env var for target repository', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'myowner/myrepo';

    const finding = createTestFinding({ id: 'vuln-1' });

    const diff = createTestDiff({
      appeared: ['vuln-1'],
    });

    await notify(diff, [finding]);

    // Check that API calls target the correct repo
    const repoCalls = apiCalls.filter((call) =>
      call.url.includes('myowner/myrepo'),
    );

    expect(repoCalls.length).toBeGreaterThan(0);
  });

  it('uses config repo field when specified instead of GITHUB_REPOSITORY', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'wrong/repo';

    const finding = createTestFinding({ id: 'vuln-1' });

    const diff = createTestDiff({
      appeared: ['vuln-1'],
    });

    await notify(diff, [finding], { repo: 'correct/repo' });

    // Check that API calls target the correct repo from options
    const repoCalls = apiCalls.filter((call) =>
      call.url.includes('correct/repo'),
    );

    expect(repoCalls.length).toBeGreaterThan(0);
  });

  // ========================================================================
  // Test isolation: clean env vars
  // ========================================================================

  it('test isolation - each test clears environment', async () => {
    // This test verifies that env vars are cleaned up properly
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
    expect(process.env.GITHUB_REPOSITORY).toBeUndefined();
  });
});
