import type { DiffResult, Finding } from '../core/types.js';
import { createHttpClient, HttpError } from '../sources/http.js';
import { projectUserAgent } from '../core/pkg.js';

// ============================================================================
// Types
// ============================================================================

export interface NotifierOptions {
  repo?: string;
  dryRun?: boolean;
  maxNewIssues?: number;
  maxNewPRs?: number;
}

interface GitHubSearchResult {
  items: Array<{
    number: number;
    state: 'open' | 'closed';
  }>;
}

interface GitHubCreateResponse {
  number: number;
  state: string;
}

// ============================================================================
// Utilities
// ============================================================================

function sanitizeBranchName(findingId: string): string {
  return findingId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatIssueTitleWithId(title: string, findingId: string): string {
  return `[graveyard-shift] ${title} (id: ${findingId})`;
}

function formatIssueBody(finding: Finding): string {
  const lines: string[] = [];

  lines.push(`**ID:** ${finding.id}`);
  lines.push(`**Severity:** ${finding.severity}`);
  lines.push(`**Summary:** ${finding.summary}`);

  if (finding.fix) {
    lines.push(`**Fix:** ${finding.fix.text}`);
    if (finding.fix.value) {
      lines.push(`**Fix Value:** ${finding.fix.value}`);
    }
  }

  return lines.join('\n\n');
}

// ============================================================================
// Notifier Implementation
// ============================================================================

/**
 * Main notifier function that manages GitHub issues and PRs for findings.
 *
 * @throws Descriptive error if GITHUB_TOKEN is absent for a real run (not dry-run)
 * @throws Errors from GitHub API calls (after retries exhausted)
 */
export async function notify(
  diff: DiffResult,
  findings: Finding[],
  opts?: NotifierOptions,
): Promise<void> {
  const dryRun = opts?.dryRun ?? false;
  const maxNewIssues = opts?.maxNewIssues ?? 5;
  const maxNewPRs = opts?.maxNewPRs ?? 5;

  // Determine repository
  const githubRepo = opts?.repo ?? process.env.GITHUB_REPOSITORY;
  if (!githubRepo) {
    throw new Error(
      'Repository not specified. Set GITHUB_REPOSITORY env var or config repo field.',
    );
  }

  if (dryRun) {
    console.log('[DRY RUN] Notifier would process:');
    console.log(`  Repository: ${githubRepo}`);
    console.log(
      `  Appeared (confirmed): ${diff.appeared.filter((id) => findingById(findings, id)?.status === 'confirmed').length}`,
    );
    console.log(`  Promoted: ${diff.promoted.length}`);
    console.log(`  Resolved: ${diff.resolved.length}`);
    return;
  }

  // Check GITHUB_TOKEN only for real runs
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN environment variable is required to run the notifier. ' +
        'Please set it before running the notifier.',
    );
  }

  // Create HTTP client with Bearer auth
  const httpClient = createHttpClient({
    userAgent: projectUserAgent,
    maxAttempts: 3,
    timeoutMs: 30000,
  });

  // Ensure graveyard-shift label exists
  try {
    await ensureLabel(token, githubRepo, 'graveyard-shift');
  } catch (err) {
    console.warn(
      `Warning: Failed to ensure graveyard-shift label exists: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Continue anyway — label is not critical
  }

  // Track how many issues and PRs we've opened
  let openedIssues = 0;
  let openedPRs = 0;

  // Process appeared (confirmed) findings
  const appearedFindingIds = diff.appeared
    .map((id) => findingById(findings, id))
    .filter((f): f is Finding => f !== undefined && f.status === 'confirmed');

  for (const finding of appearedFindingIds) {
    if (openedIssues >= maxNewIssues) {
      console.warn(
        `[NOTIFIER] Reached cap of ${maxNewIssues} new issues per run. ` +
          `Skipping remaining ${appearedFindingIds.length - openedIssues} findings.`,
      );
      break;
    }

    try {
      // Search for existing issue
      const existingIssueNumber = await searchForIssue(token, githubRepo, finding.id);

      if (existingIssueNumber) {
        // Update existing issue
        await updateIssue(token, githubRepo, existingIssueNumber, finding);
        console.log(`[NOTIFIER] Updated issue #${existingIssueNumber} for finding ${finding.id}`);
      } else {
        // Open new issue
        const issueNumber = await createIssue(token, githubRepo, finding);
        openedIssues++;
        console.log(`[NOTIFIER] Opened issue #${issueNumber} for finding ${finding.id}`);
      }

      // Open PR if the finding has edits and no open PR exists
      if (finding.edits && finding.edits.length > 0) {
        if (openedPRs >= maxNewPRs) {
          console.warn(
            `[NOTIFIER] Reached cap of ${maxNewPRs} new PRs per run. ` +
              `Skipping PR for finding ${finding.id}.`,
          );
        } else {
          const existingPRNumber = await searchForPR(token, githubRepo, finding.id);

          if (!existingPRNumber) {
            try {
              const prNumber = await createPR(token, githubRepo, finding);
              openedPRs++;
              console.log(`[NOTIFIER] Opened PR #${prNumber} for finding ${finding.id}`);
            } catch (err) {
              console.warn(
                `[NOTIFIER] Failed to open PR for finding ${finding.id}: ` +
                  `${err instanceof Error ? err.message : String(err)}`,
              );
              // Continue to next finding instead of throwing
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        `[NOTIFIER] Failed to process appeared finding ${finding.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // Continue to next finding
    }
  }

  // Process promoted findings
  const promotedFindings = diff.promoted
    .map((id) => findingById(findings, id))
    .filter((f): f is Finding => f !== undefined);

  for (const finding of promotedFindings) {
    if (openedIssues >= maxNewIssues) {
      console.warn(
        `[NOTIFIER] Reached cap of ${maxNewIssues} new issues per run. ` +
          `Skipping remaining promoted findings.`,
      );
      break;
    }

    try {
      // Search for existing issue
      const existingIssueNumber = await searchForIssue(token, githubRepo, finding.id);

      if (existingIssueNumber) {
        // Update existing issue
        await updateIssue(token, githubRepo, existingIssueNumber, finding);
        console.log(
          `[NOTIFIER] Updated issue #${existingIssueNumber} for promoted finding ${finding.id}`,
        );
      } else {
        // Open new issue
        const issueNumber = await createIssue(token, githubRepo, finding);
        openedIssues++;
        console.log(`[NOTIFIER] Opened issue #${issueNumber} for promoted finding ${finding.id}`);
      }
    } catch (err) {
      console.warn(
        `[NOTIFIER] Failed to process promoted finding ${finding.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // Continue to next finding
    }
  }

  // Process resolved findings
  const resolvedFindings = diff.resolved
    .map((id) => findingById(findings, id))
    .filter((f): f is Finding => f !== undefined);

  for (const finding of resolvedFindings) {
    try {
      // Search for open issue
      const existingIssueNumber = await searchForIssue(token, githubRepo, finding.id);

      if (existingIssueNumber) {
        // Close the issue
        await closeIssue(token, githubRepo, existingIssueNumber);
        console.log(
          `[NOTIFIER] Closed issue #${existingIssueNumber} for resolved finding ${finding.id}`,
        );
      }
    } catch (err) {
      console.warn(
        `[NOTIFIER] Failed to close issue for resolved finding ${finding.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // Continue to next finding
    }
  }
}

// ============================================================================
// GitHub API Helper Functions
// ============================================================================

function findingById(findings: Finding[], id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

async function searchForIssue(
  token: string,
  repo: string,
  findingId: string,
): Promise<number | null> {
  const query = `repo:${repo} is:issue is:open in:title "${findingId}"`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub search failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GitHubSearchResult;
    return data.items.length > 0 ? data.items[0].number : null;
  } catch (err) {
    throw new Error(
      `Failed to search for issue with id ${findingId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function searchForPR(
  token: string,
  repo: string,
  findingId: string,
): Promise<number | null> {
  const query = `repo:${repo} is:pr is:open in:title "${findingId}"`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub search failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GitHubSearchResult;
    return data.items.length > 0 ? data.items[0].number : null;
  } catch (err) {
    throw new Error(
      `Failed to search for PR with id ${findingId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function createIssue(
  token: string,
  repo: string,
  finding: Finding,
): Promise<number> {
  const [owner, repoName] = repo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repoName}/issues`;

  const title = formatIssueTitleWithId(finding.title, finding.id);
  const body = formatIssueBody(finding);

  const payload = {
    title,
    body,
    labels: ['graveyard-shift'],
  };

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to create issue: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GitHubCreateResponse;
    return data.number;
  } catch (err) {
    throw new Error(
      `Failed to create issue for finding ${finding.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function updateIssue(
  token: string,
  repo: string,
  issueNumber: number,
  finding: Finding,
): Promise<void> {
  const [owner, repoName] = repo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repoName}/issues/${issueNumber}`;

  const body = formatIssueBody(finding);

  const payload = {
    body,
  };

  try {
    const response = await fetchWithRetry(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to update issue: HTTP ${response.status}`);
    }
  } catch (err) {
    throw new Error(
      `Failed to update issue #${issueNumber} for finding ${finding.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function closeIssue(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const [owner, repoName] = repo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repoName}/issues/${issueNumber}`;

  const payload = {
    state: 'closed',
  };

  try {
    const response = await fetchWithRetry(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to close issue: HTTP ${response.status}`);
    }
  } catch (err) {
    throw new Error(
      `Failed to close issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function createPR(
  token: string,
  repo: string,
  finding: Finding,
): Promise<number> {
  // This is a placeholder implementation
  // Full PR creation would require:
  // 1. Create a branch from the default branch
  // 2. Commit the edits to that branch
  // 3. Open a PR against the default branch
  // For now, throw an informative error
  throw new Error(
    `PR creation not yet fully implemented for finding ${finding.id}`,
  );
}

async function ensureLabel(
  token: string,
  repo: string,
  labelName: string,
): Promise<void> {
  const [owner, repoName] = repo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repoName}/labels/${labelName}`;

  try {
    // Check if label exists
    const getResponse = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (getResponse.ok) {
      // Label already exists
      return;
    }

    if (getResponse.status === 404) {
      // Label doesn't exist, create it
      const createUrl = `https://api.github.com/repos/${owner}/${repoName}/labels`;
      const createResponse = await fetchWithRetry(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: labelName,
          color: 'ff0000',
          description: 'Finding tracked by Graveyard Shift',
        }),
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create label: HTTP ${createResponse.status}`);
      }
    }
  } catch (err) {
    throw new Error(
      `Failed to ensure label exists: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Fetch with automatic retry on transient errors (5xx, 429, timeout).
 * Uses exponential backoff with 3 max attempts.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit & { method?: string },
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const signal = AbortSignal.timeout(30000);
      const response = await fetch(url, {
        ...options,
        signal,
      });

      // Return if successful or non-retryable error
      if (response.ok) {
        return response;
      }

      // Non-retryable 4xx errors
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        return response;
      }

      // Retryable errors: 429, 503, 5xx
      if (
        response.status === 429 ||
        response.status === 503 ||
        response.status >= 500
      ) {
        lastError = new Error(`HTTP ${response.status}`);

        if (attempt < 3) {
          const delay = Math.min(
            500 * Math.pow(2, attempt - 1) + Math.random() * 500,
            30000,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      return response;
    } catch (err) {
      // Timeout or network error
      if (
        err instanceof DOMException &&
        (err.name === 'AbortError' || err.message.includes('timeout'))
      ) {
        lastError = new Error('Request timeout');

        if (attempt < 3) {
          const delay = Math.min(
            500 * Math.pow(2, attempt - 1) + Math.random() * 500,
            30000,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      // Other network errors
      lastError = err as Error;

      if (attempt < 3) {
        const delay = Math.min(
          500 * Math.pow(2, attempt - 1) + Math.random() * 500,
          30000,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Failed to fetch after retries');
}
