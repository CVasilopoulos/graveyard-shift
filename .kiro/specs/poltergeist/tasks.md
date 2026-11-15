# Implementation Plan: poltergeist

## Overview

Implement the `apps/poltergeist` workspace package — the Poltergeist app built on the Graveyard Shift skeleton. The implementation follows the dependency order of the modules: scaffolding first, then parsers, then lockfiles, then sources, then rules, then config/theme, and finally integration and demo.

All TypeScript is compiled with `tsc` in strict mode to `dist/` using ES module output. Runtime dependencies are none beyond the skeleton; Poltergeist imports from `graveyard-shift` workspace package only.

## Tasks

- [x] 1. Scaffold the workspace and Poltergeist package
  - Verify the repo root `package.json` declares `"workspaces": ["skeleton", "apps/*"]` and `"private": true`
  - Create `apps/poltergeist/package.json` with `"name": "poltergeist"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "./dist/index.js"`, `"dependencies": { "graveyard-shift": "*" }`, and pinned dev deps (`typescript`, `vitest`, `fast-check`, `@vitest/coverage-v8`)
  - Create `apps/poltergeist/tsconfig.json` with `"extends": "../../skeleton/tsconfig.json"`, `"compilerOptions": { "outDir": "./dist", "rootDir": "./src" }` and `"include": ["src"]` (corrected in review: `../skeleton` resolved to `apps/skeleton`, and the inherited `include` pointed at `skeleton/src`)
  - Create `apps/poltergeist/vitest.config.ts` with `coverage: { provider: "v8" }`
  - Do not create placeholder source or test files; later tasks create them (the verify hook checks every backticked path of a ticked task)
  - Add `"test": "vitest run"` and `"build": "tsc"` scripts to `apps/poltergeist/package.json`
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 2. Implement parsers with property tests
  - [x] 2.1 Write `apps/poltergeist/src/parsers/npm.ts`
    - Validate JSON with `lockfileVersion` 2 or 3 and `packages` map
    - Skip `""` (root) and entries with `link: true`
    - Extract name from key (part after last `node_modules/`); extract version from `version` field
    - Return `Set<{name: string, version: string}>`
    - Throw descriptive error on invalid input
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 2.2 Write `apps/poltergeist/src/parsers/pip.ts`
    - Strip inline comments, environment markers (`;`), extras (`[...]`)
    - Join backslash-continued lines
    - Skip blank lines, comments, options (`-r`, `-e`, `--index-url`, `--hash`)
    - Parse `name==version`; skip unpinned lines; return `{ packages, skipped: { blank, comment, option, unpinned } }`
    - Normalise name: lowercase, replace `_-.` runs with `-` (PEP 503)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 2.3 Write property tests for npm parser in `apps/poltergeist/test/parsers/npm.test.ts`
    - **Property 1: npm round-trip** — for any `Set<{name, version}>`, generating v3 lockfile and parsing returns same set
    - Generate names with `fc.stringMatching(/^(@[a-z0-9-]{1,10}\/)?[a-z0-9][a-z0-9._-]{0,20}$/)` and versions with `fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50))` joined by dots
    - _Requirements: 13.1, 3.6_
  - [x] 2.4 Write property tests for pip parser in `apps/poltergeist/test/parsers/pip.test.ts`
    - **Property 2: pip idempotence** — `normalise(normalise(name)) === normalise(name)`
    - **Property 3: pip round-trip** — writing a set of normalised (name, version) pairs as `name==version` lines with random comments, markers and extras, then parsing, returns the same package set
    - Generate names with `fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/)`
    - _Requirements: 13.1, 4.4, 4.5_
  - [x] 2.5 Write unit tests for parsers in `apps/poltergeist/test/parsers/npm.test.ts` and `apps/poltergeist/test/parsers/pip.test.ts`
    - npm: valid v2/v3 lockfiles, missing `packages`, empty, link entries, scoped packages
    - pip: pinned, extras, markers, comments, options, unpinned, blank lines
    - _Requirements: 13.1_

- [x] 3. Checkpoint — run `npm test` in `apps/poltergeist/` for parsers

- [x] 4. Implement lockfiles
  - [x] 4.1 Write `apps/poltergeist/src/lockfiles.ts`
    - For each target in config, fetch from `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`
    - Use `createHttpClient({})` from skeleton (keep defaults)
    - Cache parsed `{ owner, repo, ecosystem, name, version }` by `{ owner, repo, ref, path }`
    - On error, throw descriptive error naming target and path
    - Return `PackageVersion[]` of `{ owner, repo, ecosystem, name, version }`, one entry per target occurrence (design review amendment 3)
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Implement the sources `apps/poltergeist/src/sources/osv.ts` and `apps/poltergeist/src/sources/github.ts` with recorded fixtures (source files named in review; the task listed only their tests)
  - [x] 5.1 Create OSV fixtures in `apps/poltergeist/test/fixtures/osv/`
    - `querybatch-chunk.json`: the querybatch for the five demo package versions and the 17 `vulns/{id}` responses it leads to (GHSA ids with aliases and ranges, PYSEC ids with GHSA aliases and GIT ranges, the CVE-only PYSEC-2020-73)
    - `vulns-withdrawn.json`: GHSA-pj86-cfqh-vqx6, withdrawn
    - `vulns-no-fixed.json`: querybatch for diskcache 5.6.3 and its two advisories, which list no fixed version
    - `vulns-404.json`: `vulns/{id}` for an id OSV does not know
    - Each fixture is a JSON array of recorded `{ name, recordedAt, method, url, requestBody?, respondWith: { status, headers, body, delayMs } }`
    - Changed in review: every fixture is a recorded live response (2026-11-15). OSV never paginates an npm or PyPI query (pagination starts above 1000 results per query; tensorflow 2.0.0 returns 745 without a token) and never lists withdrawn advisories in querybatch, so `querybatch-page.json` was dropped; the pagination and withdrawn tests build those two batch responses in the test and replay recorded `vulns` responses
    - _Requirements: 13.2, 5.2_
  - [x] 5.2 Create GitHub and lockfile fixtures in `apps/poltergeist/test/fixtures/github/` and `apps/poltergeist/test/fixtures/raw/`
    - `advisories-npm.json`: express 4.17.1 (lists the withdrawn GHSA-pj86-cfqh-vqx6), lodash 4.17.15 (lists the withdrawn GHSA-8p5q-j9m2-g8wr), minimist 1.2.5
    - `advisories-pip.json`: requests 2.25.0 and pandas 1.0.3 (empty list)
    - `advisories-paginated.json`: the two `Link: rel="next"` pages for tensorflow 2.9.0 (106 advisories), each advisory cut down to the fields the source reads
    - `raw/lockfile-404.json`: the demo package-lock.json while the repository is not public
    - Each fixture is a JSON array of recorded `{ name, recordedAt, method, url, respondWith: { status, headers, body, delayMs } }`
    - Changed in review: no npm package version has more than 100 GitHub advisories, so the paginated fixture is a PyPI one; withdrawn and CVE-only cases come from the demo recordings
    - _Requirements: 13.2, 6.2_
  - [x] 5.3 Write fixture-based tests for OSV source in `apps/poltergeist/test/sources/osv.test.ts`
    - Implement `mockFetch` helper replacing `globalThis.fetch` in `apps/poltergeist/test/mockFetch.ts`
    - Test: chunked querybatch (1000 per request), follow `next_page_token`
    - Test: GET `vulns/{id}` once per run (cache), skip withdrawn
    - Test: returns findings with `details` containing id, aliases, severity, ranges
    - _Requirements: 13.2, 5.2_
  - [x] 5.4 Write fixture-based tests for GitHub source in `apps/poltergeist/test/sources/github.test.ts`
    - Test: GET `advisories?ecosystem=<npm|pip>&affects=<name>@<version>&per_page=100`
    - Test: follow `Link: rel="next"` pages
    - Test: Bearer token when `GITHUB_TOKEN` present
    - Test: returns findings with `details` containing `ghsa_id`, `cve_id`, `severity`, `fixed_versions`
    - _Requirements: 13.2, 6.2_

- [ ] 6. Implement rules
  - [ ] 6.1 Write `apps/poltergeist/src/rules.ts`
    - Accept `SourceResult[]` and config; return `Array<Omit<Finding, 'firstSeen' | 'lastSeen' | 'resolvedAt' | 'stale'>>`
    - Build CVE-to-GHSA map from GitHub findings (keyed by `{ ecosystem, name, version }`)
    - Re-key each source's finding ids to canonical `poltergeist:<owner>/<repo>:<ecosystem>:<package>@<version>:<GHSA>` or OSV id
    - Keep side map `(sourceName, id) -> details`
    - Call `mergeById` on the re-keyed `SourceResult`s
    - Map merged findings to partial `Finding`:
      - `title`: `<package>@<version>: <advisory summary>`
      - `summary`: first 280 chars of advisory description
      - `url`: `https://github.com/advisories/<GHSA>` or `https://osv.dev/vulnerability/<id>`
      - `severity`: GitHub if present, else OSV `database_specific`, else CVSS banded, else `info`
      - `fix`: both share → lowest shared; else higher of two with note; else undefined
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4_
  - [ ] 6.2 Write tests for id canonicalisation in `apps/poltergeist/test/rules/ids.test.ts`
    - GHSA-id OSV entry → use own id
    - PYSEC with GHSA alias → use lexicographically smallest GHSA
    - CVE-linked OSV with GitHub GHSA → use GitHub GHSA
    - OSV-only advisory → use OSV id
    - **Property 4: alias-order independence** — permutations produce same canonical id
    - _Requirements: 13.1, 7.4_
  - [ ] 6.3 Write tests for severity and fix in `apps/poltergeist/test/rules/severity.test.ts` and `apps/poltergeist/test/rules/fix.test.ts`
    - GitHub severity → use it
    - OSV `database_specific` → use it
    - OSV CVSS → band correctly
    - Both fixed versions → lowest shared
    - Different versions → higher with note
    - One source → use its lowest with source name
    - _Requirements: 13.1, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4_

- [ ] 7. Checkpoint — run `npm test` in `apps/poltergeist/` for lockfiles, sources, rules

- [x] 8. Implement config and theme
  - [x] 8.1 Write `apps/poltergeist/src/config.ts`
    - Export zod schema with `targets` array: `{ owner, repo, ref?, lockfiles: string[] }`
    - `ref` defaults to `"main"`; `lockfiles` must be non-empty
    - Validate lockfile paths end in `package-lock.json` (npm) or `requirements.txt` (PyPI)
    - Export type `Config`
    - _Requirements: 1.1, 1.2, 1.4_
  - [x] 8.2 Write `apps/poltergeist/src/theme.ts`
    - Export the theme (typed as `AppDefinition["theme"]`, which gains `issuePrefix` in task 11) with `name: "Poltergeist"`, `tagline: "Something is rattling in your lockfile"`, `accentColor: "#8b5cf6"`, `labels: { confirmed: "haunting", ghost: "ghost", resolved: "laid to rest" }`, `issuePrefix: "👻"`
    - _Requirements: 14.1, 14.2, 11.2_

- [ ] 9. Implement index.ts
  - [ ] 9.1 Write `apps/poltergeist/src/index.ts`
    - Import `osv` and `github` source functions (names used for error reporting)
    - Import `rules` function
    - Import config schema and theme
    - Export `AppDefinition` with `sources: [osv, github]`, `rules`, `configSchema`, `theme`
    - _Requirements: 15.1, 15.2_

- [ ] 10. Create demo lockfiles and README
  - [ ] 10.1 Create `apps/poltergeist/demo/haunted-house/package-lock.json`
    - Pin `express@4.17.1` and `lodash@4.17.15` with known advisories
    - Include at least three packages to produce hauntings
    - _Requirements: 12.1_
  - [ ] 10.2 Create `apps/poltergeist/demo/haunted-house/requirements.txt`
    - Pin `requests==2.25.0` with known advisory
    - Include at least one package to produce a ghost
    - _Requirements: 12.1_
  - [ ] 10.3 Write `apps/poltergeist/demo/README.md`
    - List advisory IDs for hauntings and ghosts (checked against live APIs)
    - Include URLs and affected/fixed versions
    - _Requirements: 12.2_

- [x] 11. Update skeleton with issuePrefix change and test
  - [x] 11.1 Update `skeleton/src/core/types.ts`, `skeleton/src/notify/notifier.ts` and `skeleton/src/core/runner.ts`
    - Add optional `issuePrefix?: string` to the `AppDefinition` theme type and to `NotifierOptions`
    - Update `formatIssueTitleWithId` to prefix the title with `issuePrefix` when set
    - The runner passes `appDef.theme.issuePrefix` to `notify` when it is set
    - Do this before task 8.2, which uses the new theme field
    - _Requirements: 11.2, 15.4_
  - [x] 11.2 Add tests in `skeleton/test/notify/notifier.test.ts` and `skeleton/test/runner/runner.test.ts`
    - Issue titles start with the prefix when `issuePrefix` is supplied and are unchanged otherwise
    - The runner passes the theme prefix to the notifier
    - _Requirements: 11.2, 15.4_
  - [x] 11.3 Add `post` to the skeleton HTTP client in `skeleton/src/sources/http.ts` with tests in `skeleton/test/sources/http.test.ts`
    - Added in review: OSV querybatch is a POST and the helper only had `get`; the POST gets the same timeout, retries, Retry-After handling, per-host limit and User-Agent
    - Do this before task 5
    - _Requirements: 2.1, 5.2, 15.3_
  - [x] 11.4 Load the app entry point from the `main` field of the app package.json in `skeleton/src/cli/appModule.ts` with tests in `skeleton/test/cli/appModule.test.ts`
    - Added in review: the CLI imported `<appDir>/index.js`, which a TypeScript app built to `dist/` does not have, so task 12 could not run
    - _Requirements: 1.1, 15.2_

- [ ] 12. Final checkpoint — full test suite and dry run
  - Run `npm test` in `apps/poltergeist/` and verify all tests pass offline
  - Run `npm run build` to ensure `tsc` compiles with no errors
  - Run `npx graveyard-shift run apps/poltergeist --dry-run` from the repo root
  - Verify demo produces hauntings and ghosts as documented in `demo/README.md`
  - _Requirements: 12.1, 12.2, 13.1, 13.2, 13.3, 13.4, 15.1, 15.2, 15.3, 15.4_
