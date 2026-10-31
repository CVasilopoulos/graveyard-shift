# Requirements Document

## Introduction

The `skeleton/` workspace package (`graveyard-shift`) is the reusable core from which every watch-and-warn app is assembled. It provides the shared types, HTTP helper, runner, diff engine, JSON store, static dashboard, MCP stdio server, GitHub notifier, and a CLI entry point. An app author provides four files — sources, rules, config, and theme — and the skeleton handles everything else. The central invariant is that a finding is only **confirmed** when at least two independent sources agree; a finding seen by fewer sources is a **ghost** that is shown but never triggers an alert.

## Glossary

- **App**: A watch-and-warn application built on the skeleton by supplying sources, rules, config, and theme.
- **AppDefinition**: The typed contract an App exports: its sources array, rules function, zod config schema, and theme metadata.
- **Confirmed**: A finding status assigned when at least two independent sources agree on the finding.
- **Diff**: The computed delta between the previous `findings.json` and the current run's findings, expressed as appeared / still / resolved / promoted / demoted sets.
- **Edit**: A proposed file change carried by a `Finding`, consisting of a file path and new content, used by the Notifier to open pull requests.
- **Evidence**: One entry per source on a `Finding` that records what that source reported, consisting of a source name, a text description, an optional direct link from that source, and an optional `staleError` string that is present only when this source errored during the current run and its contribution was carried forward.
- **Finding**: A structured record of one detected issue, carrying an id, title, summary, severity, status (confirmed or ghost), sources, evidence, timestamps, and optional fix, url, edits, and stale fields; the `stale` field is derived from the finding's evidence entries and is not set independently.
- **Fix**: An optional object on a `Finding` that describes the recommended remediation, consisting of a human-readable text and an optional machine-readable value such as a first fixed version or replacement URL.
- **Ghost**: A finding status assigned when fewer than two independent sources agree.
- **Graveyard_Shift**: The skeleton npm workspace package (`graveyard-shift`).
- **History_Store**: The module that appends each run's diff to `history.json`.
- **HTTP_Helper**: The module in `src/sources/` that performs HTTP requests with timeout, bounded retry with backoff, per-host concurrency limit, and a project User-Agent.
- **MCP_Server**: The stdio Model Context Protocol server in `src/mcp/` that exposes findings to AI agents.
- **Notifier**: The module in `src/notify/` that manages GitHub issues and pull requests for confirmed findings.
- **Runner**: The orchestrating function in `src/core/` that executes a full app cycle: load config, fetch sources, apply rules, confirm or ghost each finding, manage timestamps, diff, and write store files.
- **Run_Record**: A summary written to `runs.json` for every completed runner execution, capturing timestamp, finding counts, and outcome.
- **Source**: An async adapter that fetches data from one external service and returns a `SourceResult`.
- **SourceResult**: The typed return value of a single source: a list of raw findings keyed by finding id (each optionally carrying a `details` record), source name, and fetch timestamp.
- **Stable_JSON**: JSON serialised with keys sorted alphabetically, two-space indentation, and a trailing newline.
- **Stale**: A boolean field set to `true` on a `Finding` when at least one of its evidence entries has a `staleError` field, indicating that at least one source that contributed to this finding errored during the current run and its contribution was carried forward from the previous store.
- **Store**: The module in `src/core/` that reads and writes `findings.json`, `history.json`, and `runs.json` as Stable_JSON.

---

## Requirements

### Requirement 1: Core Types

**User Story:** As an app author, I want a single import that gives me all shared types, so that my sources, rules, and config stay type-safe without redeclaring them.

#### Acceptance Criteria

1. THE Graveyard_Shift SHALL export a `Finding` type with the following fields:
   - `id` (string, required)
   - `title` (string, required)
   - `summary` (string, required): a one-sentence description of the issue
   - `severity` (`critical | high | medium | low | info`, required); apps with no meaningful severity SHALL use `info`
   - `status` (`confirmed | ghost`, required)
   - `sources` (array of source-name strings with minimum length 1, required)
   - `evidence` (array, required): each entry has `sourceName` (string), `text` (string), and optional `link` (string)
   - `firstSeen` (ISO 8601 string, required, managed by the Runner)
   - `lastSeen` (ISO 8601 string, required, managed by the Runner)
   - `resolvedAt` (ISO 8601 string, optional, present only when the finding has been resolved and absent otherwise, managed by the Runner)
   - `url` (string, optional): a canonical link to the issue
   - `fix` (object, optional): `text` (string) plus optional `value` (string — e.g. first fixed version, replacement URL)
   - `edits` (array, optional): proposed file edits, each with `path` (string) and `newContent` (string)
   - `stale` (boolean, optional): `true` when at least one evidence entry has a `staleError` field; derived from evidence entries by the Store and not set independently
2. THE Graveyard_Shift SHALL export a `SourceResult` type with fields: `sourceName` (string), `findings` (array of objects each carrying exactly an `id` string, a `title` string, and an optional `details` record of string keys to unknown values, with no additional required fields), and `fetchedAt` (ISO 8601 string).
3. THE Graveyard_Shift SHALL export an `AppDefinition` type parameterised over a zod schema type `TSchema extends z.ZodTypeAny`, with fields: `sources` (array of at least one function each accepting the inferred output of `TSchema` and returning a `Promise<SourceResult>`), `rules` (a function accepting an array of `SourceResult` and the inferred output of `TSchema` and returning an array of partial `Finding` objects without `firstSeen`, `lastSeen`, `resolvedAt`, or `stale` fields, as the Runner manages those), `configSchema` (a value of type `TSchema`), and `theme` (object with `name` string and `description` string).
4. THE Graveyard_Shift SHALL export all types from a single package entry point so that app authors import from `graveyard-shift` and not from internal paths.
5. THE Graveyard_Shift SHALL assign each `Finding` an `id` that is unique among all findings returned by a single `rules` call and identical across runs for the same underlying finding, so that the store can correlate findings between runs without duplication.
6. THE Graveyard_Shift SHALL export an `Edit` type with fields `path` (string) and `newContent` (string), an `Evidence` type with fields `sourceName` (string), `text` (string), optional `link` (string), and optional `staleError` (string), and a `Fix` type with fields `text` (string) and optional `value` (string).

---

### Requirement 2: HTTP Helper

**User Story:** As an app author, I want an HTTP helper that enforces timeouts, retries, rate limits, and a project User-Agent, so that my sources are polite and resilient without duplicating that logic.

#### Acceptance Criteria

1. WHEN the HTTP_Helper makes a request, THE HTTP_Helper SHALL attach a `User-Agent` header of the form `graveyard-shift/<version> (+https://github.com/<owner>/<repo>)`, where version, owner, and repo are read from package configuration at initialisation time.
2. WHEN a request does not complete within the configured timeout, THE HTTP_Helper SHALL abort the request using `AbortSignal.timeout`, treat the result as a transient failure eligible for retry, and count the timeout against the maximum number of attempts.
3. WHEN a request fails with a transient error (network error, timeout, HTTP 429, or HTTP 5xx response), THE HTTP_Helper SHALL retry the request up to the configured maximum total attempts (including the initial attempt) using exponential backoff with jitter.
4. WHEN the HTTP_Helper receives a 429 or 503 response that includes a `Retry-After` header, THE HTTP_Helper SHALL wait the number of seconds indicated by that header before the next retry attempt, instead of using the default exponential backoff delay for that attempt.
5. IF a request fails with an HTTP 4xx response other than 429, THEN THE HTTP_Helper SHALL not retry and SHALL immediately throw an error.
6. WHEN the number of in-flight requests to a given host reaches the configured per-host concurrency limit, THE HTTP_Helper SHALL queue additional requests to that host until a slot becomes available.
7. THE HTTP_Helper SHALL use the following defaults when not overridden per call: timeout 30 000 ms, maximum attempts 3, per-host concurrency limit 4.
8. IF all attempts are exhausted, THEN THE HTTP_Helper SHALL throw an error that includes the final HTTP status code or error message and the request URL.

---

### Requirement 3: Agreement Rule and Finding Status

**User Story:** As an app operator, I want the runner to mark a finding confirmed only when two or more independent sources agree, so that single-source noise never triggers an alert.

#### Acceptance Criteria

1. WHEN the Runner applies rules to source results, THE Runner SHALL set a finding's status to `confirmed` if and only if the finding's `sources` array contains at least two distinct source names.
2. WHEN a finding's `sources` array contains exactly one source name, THE Runner SHALL set the finding's status to `ghost`.
3. THE Runner SHALL treat source names as case-sensitive strings when determining source independence.
4. WHEN the same source name appears more than once in a finding's `sources` array, THE Runner SHALL count that source only once when evaluating the two-source agreement rule.
5. FOR ALL non-empty arrays of `SourceResult` values, applying the agreement rule twice SHALL produce the same set of finding statuses as applying it once (idempotence property).
6. FOR ALL `SourceResult` arrays where every finding id appears in at most one `SourceResult`, every resulting finding SHALL have status `ghost`.
7. IF a finding's `sources` array is empty, THEN THE Runner SHALL assign that finding a status of `ghost`.
8. WHEN the Runner assigns a status to a finding, THE Runner SHALL preserve all other finding fields (id, title, summary, severity, evidence, url, fix, edits) unchanged.

---

### Requirement 4: mergeById Helper

**User Story:** As an app author, I want a `mergeById` helper that groups source items by finding id, so that my rules function can receive pre-merged partial findings rather than writing boilerplate aggregation code.

#### Acceptance Criteria

1. THE Graveyard_Shift SHALL export a `mergeById` function that accepts an array of `SourceResult` values and returns an array of partial `Finding` objects, each containing: `id` (string), `title` (string taken from the first source item seen for that id), `sources` (array of distinct source names that reported this id), and `evidence` (array of `Evidence` entries, one per source item that reported this id).
2. WHEN `mergeById` processes source items, THE mergeById function SHALL group all items sharing the same `id` value into a single output entry regardless of which `SourceResult` they came from.
3. FOR ALL inputs to `mergeById`, no output finding's `sources` array SHALL contain duplicate source names (property-based test requirement).
4. WHEN the same source reports the same finding id more than once, THE mergeById function SHALL include only one `Evidence` entry for that source on the merged output finding and one occurrence of that source name in the `sources` array.
5. THE mergeById function SHALL NOT perform alias resolution; apps that map multiple external ids (such as a CVE id and a GHSA id) to one canonical id SHALL perform that mapping on the `SourceResult` items before calling `mergeById`.
6. FOR ALL `SourceResult` arrays where every finding id appears in at most one `SourceResult`, every finding returned by `mergeById` SHALL have a `sources` array of length 1, and the Runner's agreement rule SHALL subsequently assign those findings status `ghost`.
7. THE mergeById function SHALL NOT mutate its input arrays or the `SourceResult` objects within them.

---

### Requirement 5: Runner Lifecycle

**User Story:** As an app operator, I want the runner to execute a full app cycle reliably, so that each scheduled run produces an up-to-date, correct store without manual steps.

#### Acceptance Criteria

1. WHEN the Runner is invoked with a path to a config file, THE Runner SHALL parse and validate the config using the app's zod schema and, IF validation fails, THEN THE Runner SHALL write an error message identifying the failing field and its validation error to stderr and exit with a non-zero exit code.
2. WHEN config validation succeeds, THE Runner SHALL invoke each source function concurrently and collect all `SourceResult` values.
3. IF a source function throws or rejects, THEN THE Runner SHALL record the source name and error message in the run record for `runs.json` and SHALL exclude that source's fresh results from rule evaluation for this run.
4. WHEN applying the agreement rule and a source errored this run, THE Runner SHALL treat that source's contribution as the set of (id, evidence) pairs it contributed in the previous `findings.json`: for each finding id in the previous store that listed the errored source, THE Runner SHALL include that source name in the `sources` input to the agreement rule and SHALL carry forward that source's previous evidence entry, augmenting it with a `staleError` field containing the error message from this run. Findings that list only healthy sources are evaluated entirely from fresh results.
5. IF every source fails in a run, THEN THE Runner SHALL write only `runs.json` (with the full error list) and exit with a non-zero exit code; THE Runner SHALL NOT overwrite `findings.json` or `history.json`.
6. WHEN all source calls complete (with success or error), THE Runner SHALL merge fresh `SourceResult` values from healthy sources with the preserved stale contributions from errored sources, pass the combined inputs to the app's rules function and `mergeById` to produce partial findings, then apply the agreement rule to assign `confirmed` or `ghost` status.
7. WHEN producing the final `Finding` objects, THE Runner SHALL manage timestamps as follows: `firstSeen` is taken from the matching finding in the previous `findings.json` if it exists, otherwise set to the current run time; `lastSeen` is always set to the current run time; `resolvedAt` is set when a finding moves into the `resolved` diff set and cleared if a resolved finding reappears.
8. IF `findings.json` does not exist in the store, THEN THE Runner SHALL treat the previous findings list as empty when computing the Diff.
9. WHEN findings are status-assigned and timestamps are set, THE Runner SHALL read the previous `findings.json` from the store (or treat it as empty per criterion 8), compute the Diff, and write updated `findings.json`, `history.json`, and `runs.json` files.
10. WHEN writing store files, THE Runner SHALL write each file as Stable_JSON (keys sorted, two-space indent, trailing newline).

---

### Requirement 6: Diff Engine

**User Story:** As an app operator, I want the diff to precisely track which findings appeared, persisted, resolved, or changed status between runs, so that the history log and notifier act only on genuine changes.

#### Acceptance Criteria

1. WHEN the Diff function receives a previous findings array and a current findings array, each containing findings with unique string `id` fields, THE Diff function SHALL return an object containing five string-array fields: `appeared` (ids present in current but not previous), `still` (ids present in both), `resolved` (ids present in previous but not current), `promoted` (ids in `still` whose status changed from `ghost` in the previous array to `confirmed` in the current array), and `demoted` (ids in `still` whose status changed from `confirmed` in the previous array to `ghost` in the current array); no id SHALL appear in more than one of `appeared`, `still`, and `resolved`.
2. THE Diff function SHALL not mutate the input arrays, and SHALL return an equivalent result when called again with inputs containing the same ids and statuses in any order.
3. THE Diff function SHALL produce output where the union of `appeared`, `still`, and `resolved` equals the union of all ids from the previous array and the current array.
4. THE Diff function SHALL produce empty `appeared` and `resolved` arrays when the previous and current arrays contain the same set of ids.
5. FOR ALL findings arrays A, B, and C where diff(A, B) and diff(B, C) are computed, the `resolved` set of diff(A, C) SHALL be a subset of the union of `resolved` sets of diff(A, B) and diff(B, C) (monotonicity property).
6. FOR ALL diff results, if a finding id is in `promoted`, it SHALL also be in `still`.
7. FOR ALL diff results, if a finding id is in `demoted`, it SHALL also be in `still`.
8. FOR ALL diff results, no finding id SHALL appear in both `promoted` and `demoted`.

---

### Requirement 7: Stable JSON Store

**User Story:** As an app operator, I want store files to be serialised deterministically, so that git diffs show only meaningful changes and not formatting noise.

#### Acceptance Criteria

1. THE Store SHALL serialise every JSON file with all object keys sorted by Unicode code point order at every nesting level.
2. THE Store SHALL serialise every JSON file with two-space indentation.
3. THE Store SHALL append a trailing newline character to every JSON file.
4. FOR ALL JSON-serialisable JavaScript objects O, serialising O to Stable_JSON and then parsing the result SHALL produce an object deeply equal to O (round-trip property).
5. FOR ALL JSON-serialisable JavaScript objects O, serialising O to Stable_JSON twice SHALL produce identical byte sequences (determinism property).
6. THE Store SHALL write `findings.json` containing the full array of current findings (including findings with status `resolved` that are within the retention window) sorted by `id` in ascending lexicographic order.
7. WHEN the Store writes `findings.json`, THE Store SHALL retain findings whose `resolvedAt` timestamp is within the configured `resolvedRetentionDays` days of the current run time and purge findings whose `resolvedAt` timestamp is older than that window; the default retention period is 14 days and the minimum is 0 days.
8. THE Store SHALL write `history.json` as an append-only array of run diff records, each containing `runAt` (ISO 8601), `appeared`, `still`, `resolved`, `promoted`, and `demoted` id arrays.
9. THE Store SHALL write `runs.json` as an append-only array of `Run_Record` objects, each containing `runAt` (ISO 8601), `confirmedCount`, `ghostCount`, `resolvedCount`, and `errorSources` (array of source names that errored).
10. IF `history.json` or `runs.json` does not exist or contains content that cannot be parsed as a JSON array, THEN THE Store SHALL initialise that file with an empty array before appending the new record.
11. WHEN THE Store writes a finding that has at least one evidence entry with a `staleError` field, THE Store SHALL set `stale: true` on that finding; WHEN THE Store writes a finding that has no evidence entries with a `staleError` field, THE Store SHALL omit the `stale` field entirely.

---

### Requirement 8: Static Dashboard

**User Story:** As a user browsing the GitHub Pages site, I want a dashboard that shows all current findings clearly, so that I can quickly understand what is confirmed, what is a ghost, and what has been resolved.

#### Acceptance Criteria

1. THE Dashboard SHALL consist of exactly one `index.html` file, one CSS file, and one vanilla JavaScript module; no build step or framework is required.
2. WHEN the Dashboard JavaScript module loads, THE Dashboard SHALL fetch `findings.json` from a path relative to the page's base URL so that the dashboard works when served from a GitHub Pages subpath.
3. WHEN the Dashboard JavaScript module loads, THE Dashboard SHALL also fetch `runs.json` from a path relative to the page's base URL to display the last run time and any source errors.
4. WHEN the Dashboard JavaScript module loads, THE Dashboard SHALL attempt to fetch `theme.json` from a path relative to the page's base URL; IF `theme.json` is absent or cannot be fetched, THE Dashboard SHALL fall back to built-in defaults for all theme fields.
5. WHEN `theme.json` is fetched successfully, THE Dashboard SHALL apply the `name`, `tagline`, `accentColor` (CSS colour string), and status labels for confirmed, ghost, and resolved statuses defined in that file.
6. WHEN `findings.json` is fetched successfully, THE Dashboard SHALL render each finding with its title, severity, status (`confirmed`, `ghost`, or `resolved`), summary, and the list of contributing sources.
7. WHEN a finding has status `confirmed`, THE Dashboard SHALL visually distinguish it from `ghost` and `resolved` findings using both a distinct label or badge and a non-colour indicator (icon or border pattern), so that the distinction is perceivable without relying on colour alone.
8. THE Dashboard SHALL meet WCAG AA contrast requirements for all text and interactive elements, meaning a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text and UI components.
9. IF fetching `findings.json` fails, THEN THE Dashboard SHALL display a visible error message that includes either the HTTP status code returned or a description of the network failure.
10. WHEN the Dashboard renders severity labels, THE Dashboard SHALL use the same vocabulary as the `Finding` type: `critical`, `high`, `medium`, `low`, `info`.
11. WHEN `findings.json` is fetched successfully and contains no findings, THE Dashboard SHALL display a non-empty message indicating that no findings are currently recorded.
12. THE Dashboard SHALL display a status filter control (all / confirmed / ghost / resolved) that filters the rendered findings list client-side without re-fetching `findings.json`.
13. THE Dashboard SHALL display aggregate counts (total, confirmed, ghost, resolved) computed from the full `findings.json` contents, updated whenever the findings data changes.
14. WHEN `runs.json` is fetched successfully and contains at least one entry, THE Dashboard SHALL display the ISO 8601 timestamp of the most recent run and the names of any sources that errored in that run.

---

### Requirement 9: MCP stdio Server

**User Story:** As an AI agent consumer, I want an MCP server that exposes the current findings, so that I can query and reason about confirmed issues without parsing raw JSON.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement the Model Context Protocol over stdio using `@modelcontextprotocol/sdk`.
2. THE MCP_Server factory SHALL accept a data source parameter that is either a local directory path or an HTTPS base URL (the published GitHub Pages site).
3. WHEN the data source is an HTTPS URL, THE MCP_Server SHALL fetch `findings.json` and `runs.json` from that URL at query time.
4. WHEN the data source is a local directory path, THE MCP_Server SHALL read `findings.json` and `runs.json` from that directory on disk.
5. THE MCP_Server SHALL expose a `list_findings` tool that returns the full array of current findings from `findings.json`, accepting an optional `status` filter of `confirmed | ghost | all` (default `all`); an empty array is a valid nominal response when no findings match.
6. THE MCP_Server SHALL expose a `get_finding` tool that accepts a finding `id` and returns the matching `Finding` object, or an error object containing a `code` field set to `"NOT_FOUND"` and a `message` field describing the missing id if no match exists.
7. THE MCP_Server SHALL expose a `summary` tool that returns an object with the fields `total`, `confirmed`, `ghost`, and `lastRun`; `lastRun` SHALL be the ISO-8601 timestamp of the most recent entry in `runs.json`, or `null` if `runs.json` contains zero entries.
8. THE MCP_Server SHALL expose an `explain_finding` tool that accepts a finding `id` and returns a response containing the finding's `status` value (`confirmed` or `ghost`), the names of every source that reported the finding, and each source's `Evidence` entry, or an error object with `code` `"NOT_FOUND"` and a `message` field if the id does not exist.
9. THE MCP_Server SHALL validate all tool input arguments using zod schemas and, for any argument that fails validation, return an error object containing a `code` field set to `"VALIDATION_ERROR"` and a `message` field identifying the invalid argument.
10. IF `findings.json` or `runs.json` is absent or cannot be read, THEN THE MCP_Server SHALL return an error object containing a `code` field set to `"UNAVAILABLE"` and a `message` field for any tool call that requires the missing file, without terminating the process.

---

### Requirement 10: GitHub Notifier

**User Story:** As an app operator, I want the notifier to open or update a GitHub issue for each confirmed finding and optionally open a pull request with proposed file edits, so that confirmed findings surface automatically in the repository's issue tracker.

#### Acceptance Criteria

1. WHEN a confirmed finding has no corresponding open issue in the repository, THE Notifier SHALL open a new GitHub issue whose title contains the finding id as a unique, machine-readable marker, and whose body includes the finding id, severity, summary, and the fix text and value if present.
2. WHEN an open issue whose title contains the finding id already exists, THE Notifier SHALL update the issue body to include the finding id, severity, summary, and the fix text and value if present, without opening a duplicate issue.
3. THE Notifier SHALL open or update issues for findings in the `appeared` set with status `confirmed` and findings in the `promoted` set; THE Notifier SHALL NOT open or update issues for ghost findings that merely appeared.
4. THE Notifier SHALL NOT open or update issues for ghost findings.
5. IF a confirmed finding is present in the `resolved` set of the current Diff AND an open issue whose title contains that finding id exists, THEN THE Notifier SHALL close that issue.
6. WHEN a confirmed finding carries proposed `edits` and no open pull request whose title contains the finding id already exists, THE Notifier SHALL open a pull request targeting the repository's default branch, on a branch named deterministically from the finding id, containing only those proposed edits.
7. THE Notifier SHALL add a `graveyard-shift` label to every issue and pull request it creates.
8. THE Notifier SHALL use the `GITHUB_TOKEN` environment variable for GitHub API authentication and SHALL NOT require any other credential.
9. THE Notifier SHALL target the repository identified by the `GITHUB_REPOSITORY` environment variable (format `owner/repo`) by default; WHERE the app config specifies a `repo` field, THE Notifier SHALL use that value instead.
10. THE Notifier SHALL NEVER write to a repository other than the one identified by `GITHUB_REPOSITORY` or the config-specified `repo` field without explicit operator configuration.
11. IF the `GITHUB_TOKEN` environment variable is absent, THEN THE Notifier SHALL throw a descriptive error before making any API call.
12. THE Notifier SHALL cap new issues opened per run at a configurable limit (default 5) and SHALL cap new pull requests opened per run at a configurable limit (default 5).
13. WHERE the dry-run mode is enabled, THE Notifier SHALL log what it would do without making any GitHub API call.
14. IF a GitHub API call fails with a transient error (5xx response or network timeout), THEN THE Notifier SHALL retry that call at most 3 times with exponential backoff before throwing an error that identifies the failed operation and the finding id involved.
15. THE Notifier SHALL be a pure-interface module: all GitHub API calls SHALL be confined to the Notifier module, with no GitHub API calls in the Runner or rules.

---

### Requirement 11: Property-Based and Offline Tests

**User Story:** As a contributor, I want a test suite that validates correctness properties and runs entirely offline, so that `npm test` is reliable in CI without network access.

#### Acceptance Criteria

1. THE test suite SHALL use `vitest` as the test runner and `fast-check` for property-based tests.
2. THE test suite SHALL include property-based tests for the agreement rule covering: idempotence (applying the rule twice yields the same statuses as applying it once), the ghost invariant (any finding whose id appears in only one SourceResult is always assigned `ghost`), and the confirmed invariant (any finding whose id appears in two or more distinct SourceResults is always assigned `confirmed`).
3. THE test suite SHALL include property-based tests for the Diff engine covering: completeness (every id from either input appears exactly once across appeared, still, and resolved), stability (when both input arrays contain the same id set with the same statuses, appeared, resolved, promoted, and demoted are all empty), and round-trip (applying diff then reconstructing current from previous + appeared − resolved yields the same id set as the current array).
4. THE test suite SHALL include property-based tests for the `promoted` and `demoted` diff sets covering: promoted findings are always a subset of `still`, demoted findings are always a subset of `still`, and no id appears in both promoted and demoted.
5. THE test suite SHALL include property-based tests for `mergeById` covering: no output finding's `sources` array contains duplicate source names, and the total number of `evidence` entries across all output findings equals the total number of source items across all input `SourceResult` values (when each source reports each id at most once).
6. THE test suite SHALL include property-based tests for Stable_JSON covering: round-trip (serialise then parse produces a deeply equal JSON-serialisable object) and determinism (serialising the same object twice yields identical output).
7. THE test suite SHALL include unit tests for the HTTP_Helper using recorded fixtures covering at minimum: a successful response, a timeout that triggers retry, retry exhaustion returning a final error, a request queued by the per-host concurrency limit, and a 429 response with a `Retry-After` header that causes the helper to wait the indicated delay before retrying.
8. WHEN `npm test` is executed with no network access, THE test suite SHALL complete without errors or skipped tests.
9. THE test suite SHALL achieve 100% branch coverage of the agreement rule, Diff engine, `mergeById` helper, and Stable_JSON serialiser, as measured by vitest's built-in coverage reporter.

---

### Requirement 12: App Author README

**User Story:** As an app author, I want a README that shows me exactly how to build a new watch-and-warn app with four files, so that I can start without reading the skeleton source code.

#### Acceptance Criteria

1. THE README SHALL contain a dedicated named section for each of the four files an app author must provide (sources, rules, config, theme), where each section opens with a one-sentence statement of the file's purpose and lists its required imports from `graveyard-shift`.
2. THE README SHALL include a code example for each of the four files that, when compiled in isolation with `tsc --strict`, passes with no errors.
3. THE README SHALL document all exported types (`Finding`, `SourceResult`, `AppDefinition`, `Evidence`, `Fix`, `Edit`) in a table with columns: field name, type, required/optional.
4. THE README SHALL document the `HTTP_Helper` API in a table with columns: option, type, default, description.
5. THE README SHALL document the MCP_Server factory function with its parameter names, types, and return type, and SHALL list the names of the four tools it exposes; the documentation SHALL note that the data source parameter accepts either a local directory path or an HTTPS base URL.
6. THE README SHALL document the Notifier's exported function with its parameter names and types, state that it reads `GITHUB_TOKEN` from the environment, and specify that it throws if `GITHUB_TOKEN` is absent.
7. THE README SHALL document the `mergeById` helper function with its parameter names, return type, and a note that it does not perform alias resolution.
8. THE README SHALL document the three CLI commands (`run`, `site`, `mcp`) with their arguments and exit codes.
9. THE README SHALL be written in English and each section, defined as content between consecutive `##` headings, SHALL contain no more than 40 lines.

---

### Requirement 13: CLI

**User Story:** As an app operator, I want a CLI that runs the app, builds the site, and starts the MCP server from the command line, so that I can invoke each function without writing custom scripts.

#### Acceptance Criteria

1. THE Graveyard_Shift SHALL expose a `graveyard-shift` binary (configured in `package.json` `bin`) that is invokable via `npx graveyard-shift` after the package is installed.
2. WHEN `graveyard-shift run <appDir>` is invoked, THE CLI SHALL load the app's `AppDefinition` from `<appDir>`, execute one full runner cycle (sources → rules → agree → diff → store → notify), and exit with code 0 on success.
3. IF the `run` command encounters an unrecoverable error (config validation failure, every source failing, or an unhandled exception), THEN THE CLI SHALL write a descriptive message to stderr and exit with a non-zero exit code.
4. WHEN `graveyard-shift site <appDir> <outDir>` is invoked, THE CLI SHALL copy the skeleton dashboard assets into `<outDir>` and write a `theme.json` file alongside the assets populated from the app's theme metadata, then exit with code 0.
5. IF the `site` command cannot read the app's `AppDefinition` or cannot write to `<outDir>`, THEN THE CLI SHALL write a descriptive message to stderr and exit with a non-zero exit code.
6. WHEN `graveyard-shift mcp <dataDirOrUrl>` is invoked, THE CLI SHALL start the MCP stdio server pointed at the given local directory or HTTPS URL and keep the process alive until stdin closes or a signal is received.
7. WHEN the CLI is called with an unrecognised command or with missing required arguments, THE CLI SHALL print a usage message listing all three commands with their required arguments and exit with a non-zero exit code.
8. THE CLI SHALL pass the `resolvedRetentionDays` value from the app config to the Store when executing the `run` command; IF the config does not specify `resolvedRetentionDays`, THE CLI SHALL use the default value of 14 days.
