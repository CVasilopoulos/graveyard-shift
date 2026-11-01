# Design Document

## Introduction

This design describes the Poltergeist app built on the Graveyard Shift skeleton. It follows the skeleton contract: sources fetch and return `SourceResult`, rules consume `SourceResult[]` and return partial `Finding[]`, and the skeleton's runner, agreement rule, diff, store, and notifier handle the rest. Poltergeist supplies parsers (npm, Python), sources (OSV, GitHub Advisory Database), rules (canonicalisation, severity, fix version), config schema, and theme.

All shared code comes from the skeleton via `graveyard-shift` npm workspace package, never by relative path into `skeleton/`.

## Module Layout

```
apps/poltergeist/
  src/
    parsers/
      npm.ts      # parse package-lock.json v2/v3 → Set<{name, version}>
      pip.ts      # parse requirements.txt → Set<{name, version}>
    lockfiles.ts  # fetch+parse each lockfile, cache per run
    sources/
      osv.ts      # SourceResult from OSV.dev querybatch + vulns/{id}
      github.ts   # SourceResult from GitHub advisories pagination
    rules.ts      # canonicalise id, severity, fix; call mergeById
    config.ts     # zod schema for config.json
    theme.ts      # name, tagline, colour, labels, issuePrefix
    index.ts      # export AppDefinition with sources, rules, configSchema, theme
  test/
    parsers/      # property tests (round-trip, idempotence)
    fixtures/     # recorded OSV and GitHub responses
    sources/      # fixture-based tests
    rules/        # id canonicalisation, severity, fix version
  data/           # findings.json, history.json, runs.json (generated)
  config.json     # targets list (generated from demo config)
  demo/
    haunted-house/  # demo lockfiles with known-vulnerable versions
    README.md       # advisory ids for demo hauntings/ghosts
```

## Types and Interfaces

### SourceResult Findings Shape

Each source emits findings with `details` carrying raw advisory data:

- **OSV**: `{ id, aliases, severity, database_specific, ranges, withdrawn }`
- **GitHub**: `{ ghsa_id, cve_id, severity, fixed_versions }`

The rules function converts these into skeleton `Finding` objects with `id`, `title`, `summary`, `severity`, `status`, `sources`, `evidence`, `firstSeen`, `lastSeen`, `url`, and optional `fix`.

### Finding Id Structure

```
poltergeist:<owner>/<repo>:<ecosystem>:<package>@<version>:<canonical_advisory_id>
```

- `canonical_advisory_id` is GHSA when available (GHSA alias), else OSV id.
- GitHub advisory `ghsa_id` is always used as canonical if present.
- OSV advisory canonicalises: own id if starts with `GHSA-`, else lexicographically smallest GHSA alias, else GitHub advisory's `ghsa_id` if its `cve_id` is in OSV aliases.

## Core Components

### Parsers

**npm.ts** (`package-lock.json` v2/v3):

- Validate `lockfileVersion` is 2 or 3 and `packages` map exists.
- Skip `""` (root) and entries with `link: true`.
- Extract name from key: part after last `node_modules/` (supports scoped packages).
- Extract version from entry's `version` field (never from `resolved` URL).
- Deduplicate by returning `Set<{name, version}>`.

**pip.ts** (`requirements.txt`):

- Strip inline comments (` #...`), environment markers (`;`), extras (`[...]`).
- Join backslash-continued lines.
- Skip blank lines, comments, option lines (`-r`, `-e`, `--index-url`, `--hash`).
- Parse `name==version`; reject unpinned (`-`, `>=`, etc.).
- Normalise name: lowercase, replace runs of `_-.` with single `-` (PEP 503).
- Return `Set<{name, version}>`.

### lockfiles.ts

- Given config `targets[]`, construct URLs as `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`.
- Use skeleton `createHttpClient` with User-Agent `poltergeist`, 30s timeout, 3 retries, per-host limit 4.
- Fetch and parse each lockfile once per run; cache `Package_Version` sets by `{owner, repo, ref, path}`.
- On fetch/parse error, throw descriptive error naming target and path so the skeleton keeps the previous store.

### sources/osv.ts

- Build queries: `{ package: { name, ecosystem }, version }` for each `Package_Version`.
- POST `https://api.osv.dev/v1/querybatch` in chunks of 1000; follow `next_page_token`.
- On each advisory id returned, GET `https://api.osv.dev/v1/vulns/{id}` once per run (cached in memory).
- Exclude advisories with `withdrawn` field set.
- Emit finding per (Package_Version, advisory) with `details` containing id, aliases, severity, ranges.
- `sourceName: "osv"`.

### sources/github.ts

- For each Package_Version, GET `https://api.github.com/advisories?ecosystem=<npm|pip>&affects=<name>@<version>&per_page=100`.
- Follow `Link: rel="next"` pages until absent.
- If `GITHUB_TOKEN` present, add `Authorization: Bearer {token}`.
- Exclude advisories with `withdrawn_at` set.
- Emit finding per (Package_Version, advisory) with `details` containing `ghsa_id`, `cve_id`, `severity`, `first_patched_version`.
- `sourceName: "github"`.

### rules.ts

1. **Canonicalise advisory id**:

   - If GitHub finding: use `ghsa_id`.
   - If OSV finding:
     - If id starts with `GHSA-`: use it.
     - Else: find lexicographically smallest GHSA alias.
     - Else: if any GitHub finding for same Package_Version has a `cve_id` that is an OSV alias, use that GitHub `ghsa_id`.

2. **Build Finding_Id**: `poltergeist:<owner>/<repo>:<ecosystem>:<package>@<version>:<canonical id>`.

3. **Assign severity**:

   - Use GitHub `severity` if present (`critical`, `high`, `medium`, `low`).
   - Else use OSV `database_specific.severity` if present.
   - Else parse OSV `CVSS_V3` vector, compute score, band:
     - `critical` ≥ 9.0, `high` 7.0–8.9, `medium` 4.0–6.9, `low` 0.1–3.9.
   - Else `info`.

4. **Assign fix version**:

   - If both sources list fixed versions and share at least one: use lowest shared.
   - If both list versions but none shared: use higher of their lowest, with `fix.text` noting sources.
   - If only one lists: use its lowest, with `fix.text` noting source.
   - If neither lists: no `fix`.

5. **Call `mergeById`**: Pass partial findings from both sources; skeleton deduplicates by id, merges evidence arrays.

### theme.ts

- `name: "Poltergeist"`, `tagline: "Something is rattling in your lockfile"`, `accentColor: "#8b5cf6"`.
- Labels: `haunting`, `ghost`, `laid to rest`.
- **Skeleton change**: Add optional `issuePrefix: string` field. When set, notifier prefixes issue title with it (e.g. `👻 [graveyard-shift] ...`).

## Correctness Properties

### 3.6 npm lockfile round-trip

**Property**: For any set of (name, version) pairs, building a v3 lockfile and parsing it returns the same set.

**Test approach**: fast-check generates random sets of 0–100 packages; generate v3 lockfile via `packages` map; parse and compare sets.

### 4.4 Python normalisation idempotence

**Property**: `normalize(normalize(name)) === normalize(name)` for all names.

**Test approach**: fast-check generates 100 random package names with mixed case, underscores, dots, hyphens; verify idempotence.

### 4.5 Python requirements round-trip

**Property**: Writing parsed (name, version) as `name==version` (with random comments/markers/extras) and parsing returns original set.

**Test approach**: fast-check generates 100 random sets, adds formatting noise, parses, compares sets.

### 7.4 alias order independence

**Property**: Canonical id is unchanged when OSV aliases array is sorted differently.

**Test approach**: fast-check generates advisories with 0–10 aliases (mixed GHSA and non-GHSA); sort aliases in all permutations; canonical ids match.

## Fixture Layout

```
apps/poltergeist/test/fixtures/
  osv/
    querybatch-chunk.json      # batch response with multiple advisories
    querybatch-empty.json      # no advisories
    querybatch-page.json       # response with next_page_token
    vulns-GHSA.json            # GHSA-id advisory with aliases and ranges
    vulns-PYSEC.json           # PYSEC id with GHSA aliases
    vulns-CVE-only.json        # CVE-linked advisory, no GHSA
    vulns-withdrawn.json       # withdrawn advisory
    vulns-no-fixed.json        # advisory with no fixed versions
  github/
    advisories-npm.json        # paginated npm advisories
    advisories-pip.json        # paginated pip advisories
    advisories-empty.json      # no advisories
    advisories-GHSA.json       # GHSA advisory with severity
    advisories-CVE.json        # CVE-only advisory
    advisories-withdrawn.json  # withdrawn_at set
```

## Skeleton Change for Theme

**File**: `skeleton/src/notify/notifier.ts`

**Change**: Add optional `issuePrefix?: string` to notifier options and use it:

```typescript
function formatIssueTitleWithId(title: string, findingId: string, issuePrefix?: string): string {
  const prefix = issuePrefix ? `${issuePrefix} ` : '';
  return `${prefix}[graveyard-shift] ${title} (id: ${findingId})`;
}
```

Pass `theme.issuePrefix` from config when calling `notify`.

**Test**: In `skeleton/test/notify/notifier.test.ts`, verify issue title includes prefix when supplied.

## Testing Strategy

- **Property tests** (fast-check, vitest): parsers round-trip, normalisation idempotence, alias-order independence.
- **Fixture tests** (vitest): sources hit recorded OSV/GitHub responses only.
- **Rules tests**: GHSA-id OSV entry, PYSEC with GHSA alias, CVE-linked OSV, OSV-only ghost.

All tests run offline via fixtures.

## Next Steps

After this design is approved, the `tasks.md` will list:

1. Implement parsers (npm, pip) with property tests.
2. Implement lockfiles fetch/cache.
3. Implement sources (osv, github) with fixture tests.
4. Implement rules (canonicalise, severity, fix, mergeById).
5. Implement config schema and theme.
6. Export AppDefinition from index.ts.
7. Create demo lockfiles and README.
8. Run `graveyard-shift run apps/poltergeist` to verify hauntings and ghosts.

## Review Amendments

These override the sections above where they differ.

1. **HTTP client.** `lockfiles.ts` and both sources call `createHttpClient({})` and keep the skeleton defaults (User-Agent `graveyard-shift/<version> (+<repository url>)`, timeout, retries, Retry-After, per-host limit). No Poltergeist-specific User-Agent or retry settings (requirement 2.1).
2. **Unpinned requirements.** `pip.ts` skips lines not pinned with `==` and counts them; it does not reject them. It returns `{ packages, skipped: { blank, comment, option, unpinned } }` (requirement 4.2).
3. **Targets travel with packages.** `lockfiles.ts` returns `PackageVersion[]` of `{ owner, repo, ecosystem, name, version }`. Each source queries every distinct `(ecosystem, name, version)` once (OSV batch query, one GitHub `affects=` query) and emits one finding per target occurrence, so the same package version in two repositories gives two Finding_Ids. The GitHub source's per-package queries also stay within the unauthenticated limit of 60 requests per hour for the demo; under Actions `GITHUB_TOKEN` raises it.
4. **Rules data flow.** `mergeById` takes `SourceResult[]` and drops `details`, so `rules(results)`:
   1. builds a CVE-to-GHSA map from the GitHub findings (keyed by Package_Version);
   2. rewrites each source's finding ids to the canonical Finding_Id and keeps a side map `(sourceName, Finding_Id) -> details`;
   3. calls `mergeById` on the re-keyed `SourceResult`s;
   4. maps each merged finding to a partial `Finding`, reading severity and fix inputs from the side map.
   A source carried forward as stale by the runner has no `details`; severity and fix then come from the other source only.
5. **Finding text.** `title` is `<package>@<version>: <advisory summary>` (GitHub `summary`, else OSV `summary`, else the canonical id). `summary` is the first 280 characters of the advisory description. `url` is `https://github.com/advisories/<GHSA>` for a GHSA id, else `https://osv.dev/vulnerability/<id>`. Both sources put `summary`/`description` in `details`.
6. **Issue prefix.** `theme.issuePrefix` lives on the `AppDefinition` theme, not in `config.json`. The skeleton runner passes `appDef.theme.issuePrefix` to `notify` as the `issuePrefix` option, and `formatIssueTitleWithId` prefixes the title with it. Skeleton tests cover the runner pass-through and the title.
7. **Store location.** The CLI's `--data` defaults to `apps/poltergeist/data/`, which the Pages workflow publishes. `config.json` is committed, not generated.
