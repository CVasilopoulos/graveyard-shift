# Implementation Plan: skeleton-core

## Overview

Implement the `skeleton/` workspace package (`graveyard-shift`) — the reusable Node.js 22 TypeScript library that every watch-and-warn app is built on. The implementation follows the dependency order of the modules: scaffolding first, then pure-core functions (types → stableJson → mergeById → agreement → diff), then I/O modules (store → http → runner), then the user-facing surfaces (dashboard → MCP server → notifier → CLI → package entry point).

All TypeScript is compiled with `tsc` in strict mode to `dist/` using ES module output. The only runtime dependencies are `@modelcontextprotocol/sdk` and `zod`.

## Tasks

- [x] 1. Scaffold the workspace and skeleton package
  - Create the npm workspace root `package.json` at the repo root declaring `"workspaces": ["skeleton", "apps/*"]` and setting `"private": true`
  - Create `skeleton/package.json` with `"name": "graveyard-shift"`, `"version": "0.1.0"`, `"type": "module"`, `exports` pointing to `./dist/index.js`, `bin` pointing to `./dist/cli/index.js`, `files: ["dist", "src/dashboard"]`, pinned runtime deps (`@modelcontextprotocol/sdk`, `zod`), and pinned dev deps (`typescript`, `vitest`, `fast-check`, `@vitest/coverage-v8`)
  - Create `skeleton/tsconfig.json` targeting ES2022, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"outDir": "dist"`, `"rootDir": "src"`, `"declaration": true`, `"sourceMap": true`
  - Create `skeleton/vitest.config.ts` enabling coverage with `@vitest/coverage-v8` and setting `provider: "v8"`
  - Create the directory skeleton: `skeleton/src/core/`, `skeleton/src/sources/`, `skeleton/src/mcp/`, `skeleton/src/notify/`, `skeleton/src/cli/`, `skeleton/src/dashboard/`, `skeleton/test/core/`, `skeleton/test/sources/`, `skeleton/test/mcp/`, `skeleton/test/notify/`, `skeleton/test/runner/`, `skeleton/test/fixtures/http/`
  - Add `"test": "vitest run"` and `"build": "tsc"` scripts to `skeleton/package.json`
  - _Requirements: 1.4, 11.1, 13.1_

- [x] 2. Implement core types
  - [x] 2.1 Write `skeleton/src/core/types.ts` exporting all shared interfaces
    - Export `Evidence` with `sourceName: string`, `text: string`, optional `link: string`, optional `staleError: string`
    - Export `Fix` with `text: string`, optional `value: string`
    - Export `Edit` with `path: string`, `newContent: string`
    - Export `Finding` with all required and optional fields as specified: `id`, `title`, `summary`, `severity` union, `status` union, `sources`, `evidence`, `firstSeen`, `lastSeen`, optional `resolvedAt`, optional `url`, optional `fix`, optional `edits`, optional `stale: true`
    - Export `SourceResult` with `sourceName`, `findings` (array of `{ id, title, details? }`), `fetchedAt`
    - Export `AppDefinition<TSchema extends z.ZodTypeAny>` with `sources`, `rules`, `configSchema`, `theme` fields
    - Export `DiffResult` with five string-array fields: `appeared`, `still`, `resolved`, `promoted`, `demoted`
    - Export `RunRecord` with `runAt`, `confirmedCount`, `ghostCount`, `resolvedCount`, `errorSources`
    - Export `HistoryRecord` with `runAt` and all five diff id arrays
    - Export `StoreData` with `findings`, `history`, `runs`
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

- [x] 3. Implement Stable JSON serialiser and property tests
  - [x] 3.1 Write `skeleton/src/core/stableJson.ts`
    - Implement recursive `stableStringify` that sorts object keys by Unicode code point at every nesting level
    - Format with 2-space indentation; handle scalars, arrays, and objects
    - Top-level export appends a trailing `\n`
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 3.2 Write property tests for Stable JSON in `skeleton/test/core/stableJson.test.ts`
    - **Property 13: Stable JSON round-trip** — for any JSON-serialisable value, `JSON.parse(stableStringify(v))` deeply equals `v`
    - **Validates: Requirements 7.4**
    - **Property 14: Stable JSON determinism** — `stableStringify(v)` called twice produces identical byte sequences
    - **Validates: Requirements 7.5**
    - Use `fc.jsonValue()` as the arbitrary; configure `{ numRuns: 100 }`
    - _Requirements: 11.6, 11.9_

- [x] 4. Implement mergeById and property tests
  - [x] 4.1 Write `skeleton/src/core/mergeById.ts`
    - Accept `SourceResult[]`; build a `Map<id, { title, sources: Set<string>, evidence: Evidence[] }>`
    - First occurrence of an id sets the title; subsequent occurrences from a new source name add one Evidence entry and one source name
    - Same source reporting same id more than once: add only one Evidence entry and keep sources de-duplicated
    - Return `Array<{ id, title, sources: string[], evidence: Evidence[] }>`; never mutate inputs
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_
  - [x] 4.2 Write property tests for mergeById in `skeleton/test/core/mergeById.test.ts`
    - Define fast-check arbitrary `arbSourceResults` producing `SourceResult[]` with valid ids, titles, and source names
    - **Property 5: No duplicate source names** — no output finding's `sources` contains duplicates
    - **Validates: Requirements 4.3**
    - **Property 6: Evidence count equals source item count** — when each source reports each id at most once, total evidence entries across all output findings equals total source items across all inputs
    - **Validates: Requirements 4.1, 4.2, 4.4**
    - **Property 7: mergeById does not mutate inputs** — input arrays and SourceResult objects are deeply equal before and after the call
    - **Validates: Requirements 4.7**
    - _Requirements: 11.5_

- [x] 5. Implement agreement rule and property tests
  - [x] 5.1 Write `skeleton/src/core/agreement.ts`
    - Accept `PartialFinding[]` (findings with `id`, `title`, `sources: string[]`, `evidence`, and pass-through fields)
    - For each finding compute `new Set(sources).size`; if ≥ 2 set `status: "confirmed"`, else set `status: "ghost"`
    - Return new objects via spread; never mutate input objects
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8_
  - [x] 5.2 Write property tests for the agreement rule in `skeleton/test/core/agreement.test.ts`
    - Define fast-check arbitraries `arbSourceResults` and `arbPartialFindings`
    - **Property 1: Confirmed invariant** — any finding whose id appears in ≥ 2 SourceResult objects with distinct sourceNames is always assigned `confirmed` after `mergeById` + `applyAgreementRule`
    - **Validates: Requirements 3.1, 3.3, 3.4**
    - **Property 2: Ghost invariant** — any finding whose id appears in exactly one SourceResult is always assigned `ghost`
    - **Validates: Requirements 3.2, 3.4, 3.6, 3.7**
    - **Property 3: Agreement rule idempotence** — applying the rule twice produces the same statuses as once
    - **Validates: Requirements 3.5**
    - **Property 4: Agreement rule preserves non-status fields** — no field other than `status` is modified by the rule
    - **Validates: Requirements 3.8**
    - _Requirements: 11.2_

- [x] 6. Implement diff engine and property tests
  - [x] 6.1 Write `skeleton/src/core/diff.ts`
    - Accept `prev: Finding[]` and `curr: Finding[]`
    - Build `prevMap: Map<id, status>` and `currMap: Map<id, status>`
    - Compute `appeared` (in curr not prev), `still` (in both), `resolved` (in prev not curr)
    - Compute `promoted` (ids in still where prev status was `ghost` and curr status is `confirmed`) and `demoted` (reverse)
    - Return new arrays; never mutate inputs; output order matches Map insertion order
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8_
  - [x] 6.2 Write property tests for the diff engine in `skeleton/test/core/diff.test.ts`
    - Define fast-check arbitrary `arbFindingsArray` producing arrays of findings with unique ids and valid statuses
    - **Property 8: Diff completeness** — union of appeared+still+resolved equals union of all ids from prev and curr
    - **Validates: Requirements 6.1, 6.3**
    - **Property 9: Diff stability** — `computeDiff(A, A)` returns empty arrays for appeared, resolved, promoted, demoted
    - **Validates: Requirements 6.4**
    - **Property 10: Promoted and demoted are subsets of still** — every id in promoted is in still, every id in demoted is in still, no id in both
    - **Validates: Requirements 6.6, 6.7, 6.8**
    - **Property 11: Diff monotonicity** — resolved(A,C) ⊆ resolved(A,B) ∪ resolved(B,C)
    - **Validates: Requirements 6.5**
    - **Property 12: Order-independence and no mutation** — result is equivalent for any input ordering; input arrays unchanged after call
    - **Validates: Requirements 6.2**
    - _Requirements: 11.3, 11.4_

- [x] 7. Checkpoint — run `npm test` in `skeleton/`
  - Ensure all property-based tests for stableJson, mergeById, agreement, and diff pass with `vitest run`; ensure all four modules achieve 100% branch coverage; ask the user if any questions arise

- [x] 8. Implement the store
  - [x] 8.1 Write `skeleton/src/core/store.ts`
    - Implement `readStore(dataDir)`: read `findings.json`, `history.json`, `runs.json` with `fs/promises`; return empty defaults on `ENOENT`
    - Implement `writeStore(dataDir, findings, diff, runRecord, retentionDays)`:
      - Filter out resolved findings whose `resolvedAt` is older than `retentionDays` days
      - Sort remaining findings by `id` lexicographically
      - Derive `stale: true` on findings that have any evidence entry with `staleError`; omit `stale` entirely when not applicable
      - Append `HistoryRecord` to existing history array and `RunRecord` to existing runs array
      - Write all three files atomically (write to temp file in same dir, then `fs.rename`)
      - Serialise every file with `stableStringify`
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 5.9, 5.10_
  - [x] 8.2 Write unit tests for the store in `skeleton/test/core/store.test.ts`
    - Use a temporary directory (`os.tmpdir()` + random suffix) created per test; clean up in `afterEach`
    - Test: `readStore` on an empty directory returns empty defaults
    - Test: `writeStore` then `readStore` round-trips findings, history entry, and run record correctly
    - Test: retention filter removes findings with `resolvedAt` older than the window
    - Test: `stale` is set when any evidence has `staleError`; `stale` is omitted when no evidence has `staleError`
    - Test: atomic write (rename) means a second `writeStore` call does not corrupt existing data
    - Test: history and runs initialise from empty when files are absent
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_

- [x] 9. Implement the HTTP helper and fixture-based tests
  - [x] 9.1 Write `skeleton/src/sources/http.ts`
    - Implement `Semaphore` class with `acquire(): Promise<void>` and `release(): void`; use a `Map<hostname, Semaphore>` for per-host concurrency
    - Implement `createHttpClient(opts: HttpClientOptions): HttpClient` returning a `{ get(url, opts?) }` object
    - Read package version from `package.json` once at module load using `import.meta.url` + `fs.readFileSync`; build `User-Agent` string
    - Implement the retry loop: `AbortSignal.timeout` per attempt; retry on network errors, timeouts, 429, and 5xx; no retry on other 4xx
    - Implement `Retry-After` header parsing (integer seconds and RFC 7231 date strings)
    - Implement backoff: `min(500 * 2^(attempt-1) + random()*500, 30000)` ms
    - Throw `HttpError extends Error` with `status` and `url` when all attempts exhausted or on non-retryable 4xx
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [x] 9.2 Create HTTP test fixtures in `skeleton/test/fixtures/http/`
    - `successful-response.json`: single request → 200 response with body
    - `timeout-then-success.json`: first attempt times out; second attempt returns 200
    - `retry-exhausted.json`: three consecutive 500 responses; helper throws after third
    - `429-retry-after.json`: 429 with `Retry-After: 2` header; then 200 on second attempt
    - `concurrent-queue.json`: four requests to same host; fifth request queued and released when a slot frees
    - `404-no-retry.json`: single 404 response; helper throws immediately without retry
    - `500-two-retries.json`: 500 twice then 200; helper succeeds on third attempt
    - Each fixture is a JSON array of `{ method, url, respondWith: { status, headers, body, delayMs } }`
    - _Requirements: 11.7_
  - [x] 9.3 Write fixture-based tests for the HTTP helper in `skeleton/test/sources/http.test.ts`
    - Implement a `mockFetch` helper that replaces `globalThis.fetch` for the duration of each test and serves responses from a fixture sequence
    - Test each fixture scenario from 9.2 as a separate `it` block
    - Restore `globalThis.fetch` in `afterEach`
    - _Requirements: 11.7, 11.8_

- [x] 10. Implement the runner and integration tests
  - [x] 10.1 Write `skeleton/src/core/runner.ts`
    - Implement `runApp(appDef: AppDefinition<z.ZodTypeAny>, opts: RunnerOptions): Promise<void>`
    - Parse config with `appDef.configSchema.safeParse`; on failure write field errors to stderr and throw
    - Run all sources concurrently with `Promise.allSettled`; collect fulfilled `SourceResult[]` and rejected `{ name, error }[]`
    - Implement stale carry-forward: for each errored source, find its previous contributions from `readStore`, inject a stale `SourceResult` with `staleError` on each evidence entry
    - If every source fails: write only `runs.json` (with full error list) and throw; do not overwrite `findings.json` or `history.json`
    - Pass combined results to `appDef.rules`, then `mergeById`, then `applyAgreementRule`
    - Manage timestamps: `firstSeen` from previous store or now; `lastSeen` always now; `resolvedAt` set on newly resolved ids
    - Call `computeDiff(prev, curr)`, then `writeStore`, then `notify` (unless `dryRun`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - [x] 10.2 Write integration tests for the runner in `skeleton/test/runner/runner.test.ts`
    - Use an in-memory store stub (spy on `readStore`/`writeStore`) and a notify stub
    - Test: full cycle — two sources succeed, merged findings have correct confirmed/ghost status, store is written, notifier is called
    - Test: one source fails — stale carry-forward preserves its previous contributions; `staleError` present on evidence; `stale: true` on finding
    - Test: all sources fail — only `runs.json` written; `findings.json` and `history.json` not touched; runner exits with error
    - Test: config validation failure — runner exits before touching store
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 11. Checkpoint — run `npm test` in `skeleton/`
  - Ensure store, HTTP helper, and runner tests pass; verify no test makes a live network call; ask the user if any questions arise

- [ ] 12. Implement the static dashboard
  - [-] 12.1 Write `skeleton/src/dashboard/index.html`
    - Structural skeleton only: `<head>` with charset and viewport meta, link to `style.css`, title placeholder
    - `<body>` with header, main landmarks, filter `<fieldset>` with four radio inputs (`all`, `confirmed`, `ghost`, `resolved`), aggregate counts region, findings list region, last-run info region
    - Load `app.js` as `<script type="module">`; no inline scripts or styles
    - _Requirements: 8.1, 8.12, 8.13_
  - [-] 12.2 Write `skeleton/src/dashboard/style.css`
    - Define CSS custom properties on `:root`: `--accent-color`, `--label-confirmed`, `--label-ghost`, `--label-resolved`, `--bg`, `--text`, `--border`
    - Provide default values meeting WCAG AA contrast (≥ 4.5:1 for normal text, ≥ 3:1 for large text / UI components) for both light and dark schemes using `@media (prefers-color-scheme: dark)`
    - Style severity badges using both a background colour and a text label so distinction does not rely on colour alone
    - Style confirmed/ghost/resolved findings with both a distinct label/badge AND a left border pattern
    - _Requirements: 8.7, 8.8, 8.10_
  - [-] 12.3 Write `skeleton/src/dashboard/app.js`
    - Resolve all fetch paths relative to `document.baseURI` so the dashboard works from any GitHub Pages subpath
    - Load `findings.json`, `runs.json`, and optionally `theme.json` (catch failure → fall back to defaults); apply theme tokens as CSS custom properties on `:root`
    - Render findings list filtered by the active radio; re-render on filter change without re-fetching
    - Display aggregate counts (total, confirmed, ghost, resolved) computed from the full unfiltered findings array
    - Display last run timestamp and errorSources from `runs.json`
    - Display visible error banners with HTTP status or network failure description on `findings.json` fetch failure; show empty-state message when findings array is empty
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.11, 8.12, 8.13, 8.14_

- [ ] 13. Implement the MCP server and tests
  - [ ] 13.1 Write `skeleton/src/mcp/server.ts`
    - Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp` and `serveStdio` from `@modelcontextprotocol/sdk/server/stdio`
    - Implement `makeDataLoader(source: DataSource): DataLoader` — local path reads files with `fs/promises`; HTTPS URL fetches with the built-in `fetch`
    - Register four tools using zod input schemas: `list_findings` (optional `status` filter), `get_finding` (required `id`), `summary` (no params), `explain_finding` (required `id`)
    - Each tool call invokes the data loader fresh; returns error objects (not throws) for `NOT_FOUND`, `VALIDATION_ERROR`, `UNAVAILABLE`
    - Export `createMcpServer(source: DataSource): McpServerHandle` starting `serveStdio` and returning `{ close() }`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_
  - [~] 13.2 Write unit tests for the MCP server in `skeleton/test/mcp/server.test.ts`
    - Use in-memory data stubs (no file I/O, no network)
    - Test `list_findings`: returns all findings with `status: "all"`; filters correctly for `"confirmed"` and `"ghost"`
    - Test `get_finding`: returns the matching Finding; returns `NOT_FOUND` error for unknown id
    - Test `summary`: returns correct counts and `lastRun` from runs; returns `null` for `lastRun` when runs array is empty
    - Test `explain_finding`: returns status, sources, and evidence for a known id; returns `NOT_FOUND` for unknown id
    - Test `UNAVAILABLE`: all tools return `UNAVAILABLE` error when data files cannot be loaded
    - _Requirements: 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [ ] 14. Implement the notifier and tests
  - [~] 14.1 Write `skeleton/src/notify/notifier.ts`
    - Read `GITHUB_TOKEN` from env; throw a descriptive error if absent before making any API call
    - Create a shared `HttpClient` (via `createHttpClient`) with Bearer auth and project User-Agent
    - Implement `searchForIssue(repo, findingId)` and `searchForPR(repo, findingId)` using GitHub search API with `in:title "<findingId>"` query
    - Implement `notify(diff, findings, opts?)`:
      - For each finding in `diff.appeared` with `status: "confirmed"` and each in `diff.promoted`: open new issue or update existing
      - For each finding in `diff.resolved` with an open issue: close the issue
      - For each confirmed appeared finding with `edits` and no open PR: create branch + PR
      - Enforce `maxNewIssues` and `maxNewPRs` per-run caps (default 5 each); log and skip when cap reached
      - If `dryRun: true`: log all actions without making any API call
    - Create `graveyard-shift` label in repo if absent; add it to all created issues and PRs
    - Sanitise finding id to branch name: replace non-alphanumeric chars with `-`; prefix `graveyard-shift/`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15_
  - [~] 14.2 Write unit tests for the notifier in `skeleton/test/notify/notifier.test.ts`
    - Mock `createHttpClient` to return a stub client capturing API calls
    - Set `GITHUB_TOKEN` and `GITHUB_REPOSITORY` in the test environment via `process.env`
    - Test: opens new issue for a confirmed appeared finding
    - Test: updates existing issue body when issue already exists for a finding id
    - Test: closes open issue for a resolved confirmed finding
    - Test: opens PR with edits for a confirmed appeared finding that has `edits`
    - Test: dry-run mode logs but makes zero API calls
    - Test: cap enforcement — only `maxNewIssues` issues opened when more confirmed findings appear
    - Test: throws descriptive error when `GITHUB_TOKEN` is absent
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.11, 10.12, 10.13_

- [ ] 15. Implement the CLI and tests
  - [~] 15.1 Write `skeleton/src/cli/index.ts`
    - Parse `process.argv.slice(2)` with a hand-written switch dispatcher on `command`
    - `run <appDir>`: dynamic import `<appDir>/index.js`; locate config and data dir (with `--config` and `--data` overrides); call `runApp`; pass `resolvedRetentionDays` from parsed config or default 14; exit 0 on success, exit 1 with stderr message on error
    - `site <appDir> <outDir>`: dynamic import for theme; copy all `src/dashboard/` files to `<outDir>`; write `theme.json` via `stableStringify`; exit 0 on success, exit 1 on error
    - `mcp <dataDirOrUrl>`: detect HTTPS URL vs. local path; call `createMcpServer`; register `SIGINT`/`SIGTERM` handlers calling `handle.close()`; keep process alive via stdio
    - Unrecognised command or missing args: print usage message listing all three commands with arguments; exit 1
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
  - [~] 15.2 Write unit tests for the CLI in `skeleton/test/cli/cli.test.ts`
    - Stub `runApp`, `createMcpServer`, and file copy operations
    - Test: `run` command invokes `runApp` with correct appDir, configPath, dataDir, and retentionDays; exits 0
    - Test: `run` command writes to stderr and exits 1 when `runApp` throws
    - Test: `site` command writes `theme.json` with correct fields and exits 0
    - Test: `mcp` command creates the MCP server with local path for a directory arg and remote source for an HTTPS URL arg
    - Test: unknown command prints usage and exits 1; missing required args print usage and exit 1
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

- [ ] 16. Write the package entry point and README
  - [~] 16.1 Write `skeleton/src/index.ts`
    - Re-export all public types from `./core/types.js`
    - Re-export `mergeById` from `./core/mergeById.js`
    - Re-export `applyAgreementRule` from `./core/agreement.js`
    - Re-export `computeDiff` from `./core/diff.js`
    - Re-export `stableStringify` from `./core/stableJson.js`
    - Re-export `createHttpClient` from `./sources/http.js`
    - Re-export `createMcpServer` from `./mcp/server.js`
    - Re-export `notify` from `./notify/notifier.js`
    - Re-export `runApp` from `./core/runner.js`
    - _Requirements: 1.4_
  - [~] 16.2 Write `skeleton/README.md`
    - Section: **Sources** — one-sentence purpose; required imports; code example that compiles with `tsc --strict`
    - Section: **Rules** — one-sentence purpose; required imports; code example that compiles with `tsc --strict`
    - Section: **Config** — one-sentence purpose; required imports; code example using `z.object(...)` that compiles with `tsc --strict`
    - Section: **Theme** — one-sentence purpose; code example that compiles with `tsc --strict`
    - Section: **Type reference** — table with columns `field`, `type`, `required/optional` for all exported types (`Finding`, `SourceResult`, `AppDefinition`, `Evidence`, `Fix`, `Edit`)
    - Section: **HTTP Helper** — table with columns `option`, `type`, `default`, `description`
    - Section: **MCP Server** — factory function signature, data source parameter types, four tool names, note on local vs. HTTPS data source
    - Section: **Notifier** — function signature, parameter types, note that `GITHUB_TOKEN` is read from env and throws if absent
    - Section: **mergeById** — function signature, return type, note that alias resolution is the app's responsibility
    - Section: **CLI** — table of the three commands (`run`, `site`, `mcp`) with arguments and exit codes
    - Each section must be under 40 lines; write in English
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

- [~] 17. Final checkpoint — full test suite and build
  - Run `npm test` in `skeleton/` and verify all tests pass offline; run `npm run build` to ensure `tsc` compiles with no errors; ask the user if any questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; the minimal viable skeleton is tasks 1–11 (scaffolding through runner)
- Property tests (tasks 3.2, 4.2, 5.2, 6.2) are required — they validate correctness properties that are core to the product's central invariant
- Each task references specific requirement numbers for traceability
- The stale carry-forward model (Requirement 5.4) is the most complex piece of the runner; read the design's Data Flows section carefully before implementing
- All `.js` import extensions must be used in TypeScript source files because the project targets NodeNext module resolution
- Atomic writes in the store (`write-temp → rename`) are required to prevent data corruption on partial writes
- The dashboard must work from a GitHub Pages subpath — all fetch calls use `new URL('.', document.baseURI).href` as the base
- HTTP fixtures describe request/response sequences, not just single round-trips; the mock must track request index per URL

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "4.1", "6.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.2", "8.1"] },
    { "id": 5, "tasks": ["8.2", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "10.1"] },
    { "id": 7, "tasks": ["10.2"] },
    { "id": 8, "tasks": ["12.1", "12.2", "12.3", "13.1"] },
    { "id": 9, "tasks": ["13.2", "14.1"] },
    { "id": 10, "tasks": ["14.2", "15.1"] },
    { "id": 11, "tasks": ["15.2", "16.1"] },
    { "id": 12, "tasks": ["16.2"] }
  ]
}
```
