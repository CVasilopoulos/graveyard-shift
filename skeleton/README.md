# Skeleton: Building a Graveyard Shift App

This package provides the foundation for building a watch-and-warn app that runs entirely on GitHub. An app needs four files: sources, rules, config, and theme. The skeleton handles scheduling, storage, notifications, and the dashboard.

## Sources

A source is an async function that fetches from a public API and returns structured findings.

```typescript
import { createHttpClient } from 'graveyard-shift/sources/http';
import type { SourceResult } from 'graveyard-shift/core/types';

const http = createHttpClient({
  userAgent: 'my-app/1.0.0 (+https://github.com/user/my-app)',
});

export async function mySource(): Promise<SourceResult> {
  const response = await http.get('https://api.example.com/data');
  const data = await response.json() as unknown[];
  
  return {
    sourceName: 'example-api',
    findings: data.map(item => ({
      id: item.id,
      title: item.title,
    })),
    fetchedAt: new Date().toISOString(),
  };
}
```

## Rules

A rule is a pure function that transforms source results into partial findings, adding context and severity.

```typescript
import type { SourceResult, Finding } from 'graveyard-shift/core/types';
import { mergeById } from 'graveyard-shift/core/mergeById';

export function rules(results: SourceResult[]): Array<Omit<Finding, 'firstSeen' | 'lastSeen' | 'resolvedAt' | 'stale'>> {
  const merged = mergeById(results);
  
  return merged.map(m => ({
    id: m.id,
    title: m.title,
    sources: m.sources,
    evidence: m.evidence,
    summary: `Issue: ${m.title}`,
    severity: 'high' as const,
    status: m.sources.length >= 2 ? 'confirmed' as const : 'ghost' as const,
  }));
}
```

## Config

A config defines app-specific settings validated via Zod schema.

```typescript
import { z } from 'zod';

export const configSchema = z.object({
  apiUrl: z.string().url(),
  apiTimeout: z.number().int().min(1000),
  maxResults: z.number().int().default(100),
});

export const config = {
  apiUrl: 'https://api.example.com',
  apiTimeout: 30000,
  maxResults: 100,
};
```

## Theme

A theme defines the app's name, description, and dashboard appearance.

```typescript
import type { AppDefinition } from 'graveyard-shift/core/types';

const theme = {
  name: 'My Watch App',
  tagline: 'Watching for bad things',
  accentColor: '#ff6600',
  labels: {
    confirmed: 'Haunting',
    ghost: 'Ghost',
    resolved: 'Laid to rest',
  },
  issuePrefix: '👻',
};
```

`issuePrefix` is optional; when set, the notifier starts every issue title it opens with it.

## Type Reference

Core data types used throughout the skeleton.

| Field | Type | Required |
|-------|------|----------|
| **Finding** | | |
| id | `string` | ✓ |
| title | `string` | ✓ |
| summary | `string` | ✓ |
| severity | `'critical' \| 'high' \| 'medium' \| 'low' \| 'info'` | ✓ |
| status | `'confirmed' \| 'ghost'` | ✓ |
| sources | `string[]` | ✓ |
| evidence | `Evidence[]` | ✓ |
| firstSeen | `string` (ISO 8601) | ✓ |
| lastSeen | `string` (ISO 8601) | ✓ |
| url | `string` | |
| fix | `Fix` | |
| edits | `Edit[]` | |
| resolvedAt | `string` (ISO 8601) | |
| stale | `true` | |
| **SourceResult** | | |
| sourceName | `string` | ✓ |
| findings | `{ id: string; title: string; details?: Record<string, unknown> }[]` | ✓ |
| fetchedAt | `string` (ISO 8601) | ✓ |
| **AppDefinition** | | |
| sources | `(config: TSchema) => Promise<SourceResult>[]` | ✓ |
| rules | `(results: SourceResult[], config: TSchema) => PartialFinding[]` | ✓ |
| configSchema | `ZodTypeAny` | ✓ |
| theme | `{ name, tagline, accentColor, labels?, issuePrefix? }` | ✓ |
| **Evidence** | | |
| sourceName | `string` | ✓ |
| text | `string` | ✓ |
| link | `string` | |
| staleError | `string` | |
| **Fix** | | |
| text | `string` | ✓ |
| value | `string` | |
| **Edit** | | |
| path | `string` | ✓ |
| newContent | `string` | ✓ |

## HTTP Helper

The [`createHttpClient`](./src/sources/http.ts) factory builds an HTTP client with timeout, retry, and per-host concurrency.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userAgent` | `string` | — | Required. Identifies your app and links to its repository. |
| `timeoutMs` | `number` | `30000` | Timeout per request in milliseconds. |
| `maxAttempts` | `number` | `3` | Total attempts (including retries) before giving up. |
| `concurrencyPerHost` | `number` | `4` | Maximum concurrent requests per hostname. |

Use the returned client's `get(url, opts?)` or `post(url, body, opts?)` method; `post` sends `body` as JSON. Both handle 429, 503, and 5xx with exponential backoff (reads `Retry-After` header if present). Non-retryable 4xx errors throw immediately.

## MCP Server

The [`createMcpServer`](./src/mcp/server.ts) factory exposes findings to AI agents via the Model Context Protocol.

```typescript
import { createMcpServer } from 'graveyard-shift/mcp/server';

// Data source: local directory or HTTPS URL
const handle = createMcpServer({
  type: 'local',
  dir: '/path/to/data',
});

// Or:
const handle = createMcpServer({
  type: 'remote',
  baseUrl: 'https://example.com/findings',
});
```

Four tools are exposed:
- **list_findings** — list all findings, optionally filtered by status (`confirmed`, `ghost`, `all`)
- **get_finding** — fetch a single finding by id
- **summary** — total/confirmed/ghost counts and last run timestamp
- **explain_finding** — return status, sources, and evidence for a finding

Local data sources read `findings.json` and `runs.json` from disk. Remote sources fetch from HTTPS URLs; if the remote is unavailable, an empty list is returned.

## Notifier

The [`notify`](./src/notify/notifier.ts) function manages GitHub issues and PRs for confirmed findings only.

```typescript
import { notify } from 'graveyard-shift/notify/notifier';
import type { DiffResult, Finding } from 'graveyard-shift/core/types';

await notify(diff, findings, {
  dryRun: false,
  maxNewIssues: 5,
  maxNewPRs: 5,
});
```

**Required**: `GITHUB_TOKEN` environment variable must be set before calling `notify()`. It throws immediately if absent. For GitHub Actions, the token is provided automatically; the function also reads `GITHUB_REPOSITORY` from the environment by default.

## mergeById

The [`mergeById`](./src/core/mergeById.ts) function groups source results by finding id, deduplicating sources.

```typescript
import { mergeById } from 'graveyard-shift/core/mergeById';

const merged = mergeById(results);
// merged[0] = {
//   id: 'abc-123',
//   title: 'CVE-2024-...',
//   sources: ['osv-dev', 'github-advisory'],
//   evidence: [...]
// }
```

Returns an array of `MergedFinding` objects. When the same source reports the same id twice, only one `Evidence` entry is kept. Rules are responsible for mapping these merged findings to domain-specific identifiers and aliases; `mergeById` does not perform alias resolution.

## CLI

The [`graveyard-shift`](./src/cli/index.ts) CLI provides three commands.

| Command | Arguments | Description | Exit Code |
|---------|-----------|-------------|-----------|
| **run** | `<appDir> [--config FILE] [--data DIR] [--dry-run]` | Execute the full app cycle: fetch sources, apply rules, diff, store, notify. The app module is the `main` of `<appDir>/package.json`, else `<appDir>/index.js`, and must default-export its `AppDefinition`. `--config` defaults to `<appDir>/config.json`. `--data` defaults to `<appDir>/data`. `--dry-run` runs without notifying. | `0` on success; `1` on error |
| **site** | `<appDir> <outDir>` | Generate static dashboard assets from the app's theme. Copies skeleton dashboard files and writes `theme.json` to `<outDir>`. | `0` on success; `1` on error |
| **mcp** | `<dataDirOrUrl>` | Start the MCP stdio server. `<dataDirOrUrl>` is either a local path or an `https://` URL to findings/runs JSON. | `0` on clean shutdown; `1` on error |
