# Implementation Plan: poltergeist

## Overview

Implement the `apps/poltergeist` workspace package — the Poltergeist app built on the Graveyard Shift skeleton. The implementation follows the dependency order of the modules: scaffolding first, then parsers, then lockfiles, then sources, then rules, then config/theme, and finally integration and demo.

All TypeScript is compiled with `tsc` in strict mode to `dist/` using ES module output. Runtime dependencies are none beyond the skeleton; Poltergeist imports from `graveyard-shift` workspace package only.

## Tasks

- [ ] 1. Scaffold the workspace and Poltergeist package
  - Verify the repo root `package.json` declares `"workspaces": ["skeleton", "apps/*"]` and `"private": true`
  - Create `apps/poltergeist/package.json` with `"name": "poltergeist"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "./dist/index.js"`, `files: ["dist", "src/dashboard"]`, `"dependencies": { "graveyard-shift": "workspace:*" }`, and pinned dev deps (`typescript`, `vitest`, `fast-check`, `@vitest/coverage-v8`)
  - Create `apps/poltergeist/tsconfig.json` with `"extends": "../skeleton/tsconfig.json"`, `"compilerOptions": { "outDir": "./dist", "rootDir": "./src" }`
  - Create `apps/poltergeist/vitest.config.ts` with `coverage: { provider: "v8" }`
  - Create directories: `apps/poltergeist/src/parsers/`, `apps/poltergeist/src/lockfiles.ts`, `apps/poltergeist/src/sources/`, `apps/poltergeist/src/rules.ts`, `apps/poltergeist/src/config.ts`, `apps/poltergeist/src/theme.ts`, `apps/poltergeist/src/index.ts`, `apps/poltergeist/test/parsers/`, `apps/poltergeist/test/fixtures/osv/`, `apps/poltergeist/test/fixtures/github/`, `apps/poltergeist/test/sources/`, `apps/poltergeist/test/rules/`, `apps/poltergeist/demo/haunted-house/`
  - Add `"test": "vitest run"` and `"build": "tsc"` scripts to `apps/poltergeist/package.json`
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 2. Implement parsers with property tests
  - [ ] 2.1 Write `apps/poltergeist/src/parsers/npm.ts`
    - Validate JSON with `lockfileVersion` 2 or 3 and `packages` map
    - Skip `""` (root) and entries with `link: true`
    - Extract name from key (part after last `node_modules/`); extract version from `version` field
    - Return `Set<{name: string, version: string}>`
    - Throw descriptive error on invalid input
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 2.2 Write `apps/poltergeist/src/parsers/pip.ts`
    - Strip inline comments, environment markers (`;`), extras (`[...]`)
    - Join backslash-continued lines
    - Skip blank lines, comments, options (`-r`, `-e`, `--index-url`, `--hash`)
    - Parse `name==version`; skip unpinned lines; return `{ packages, skipped: { blank, comment, option, unpinned } }`
    - Normalise name: lowercase, replace `_-.` runs with `-` (PEP 503)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 2.3 Write property tests for npm parser in `apps/poltergeist/test/parsers/npm.test.ts`
    - **Property 1: npm round-trip** — for any `Set<{name, version}>`, generating v3 lockfile and parsing returns same set
    - Use `fc.set(fpc.nat16(), { maxSize: 100 })` for names and versions; `fc.jsonValue()` for lockfile
    - _Requirements: 13.1, 3.6_
  - [ ] 2.4 Write property tests for pip parser in `apps/poltergeist/test/parsers/pip.test.ts`
    - **Property 2: pip idempotence** — `normalise(normalise(name)) === normalise(name)`
    - **Property 3: pip round-trip** — write then parse returns same `{ packages, skipped }`
    - Use `fc.stringOf(fc.oneof(fpc.alpha(), fc.constantFrom('_', '.', '-')), { minLength: 1, maxLength: 50 })` for names
    - _Requirements: 13.1, 4.4, 4.5_
  - [ ] 2.5 Write unit tests for parsers in `apps/poltergeist/test/parsers/npm.test.ts` and `apps/poltergeist/test/parsers/pip.test.ts`
    - npm: valid v2/v3 lockfiles, missing `packages`, empty, link entries, scoped packages
    - pip: pinned, extras, markers, comments, options, unpinned, blank lines
    - _Requirements: 13.1_

- [ ] 3. Checkpoint — run `npm test` in `apps/poltergeist/` for parsers

- [ ] 4. Implement lockfiles
  - [ ] 4.1 Write `apps/poltergeist/src/lockfiles.ts`
    - For each target in config, fetch from `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`
    - Use `createHttpClient({})` from skeleton (keep defaults)
    - Cache parsed `{ owner, repo, ecosystem, name, version }` by `{ owner, repo, ref, path }`
    - On error, throw descriptive error naming target and path
    - Return `Set<{ owner, repo, ecosystem, name, version }>`
    - _Requirements: 2.1, 2.2, 2.3_

- [ ] 5. Implement sources with recorded fixtures
  - [ ] 5.1 Create OSV fixtures in `apps/poltergeist/test/fixtures/osv/`
    - `querybatch-chunk.json`: batch response with multiple advisories
    - `querybatch-page.json`: response with `next_page_token`
    - `vulns-GHSA.json`: GHSA-id advisory with aliases, ranges, `withdrawn`
    - `vulns-PYSEC.json`: PYSEC id with GHSA aliases
    - `vulns-CVE-only.json`: CVE-linked advisory, no GHSA
    - `vulns-withdrawn.json`: withdrawn advisory
    - `vulns-no-fixed.json`: advisory with no fixed versions
    - Each fixture is JSON array of `{ method, url, respondWith: { status, headers, body, delayMs } }`
    - _Requirements: 13.2, 5.2_
  - [ ] 5.2 Create GitHub fixtures in `apps/poltergeist/test/fixtures/github/`
    - `advisories-npm.json`: paginated npm advisories
    - `advisories-pip.json`: paginated pip advisories
    - `advisories-GHSA.json`: GHSA advisory with `severity`
    - `advisories-CVE.json`: CVE-only advisory
    - `advisories-withdrawn.json`: `withdrawn_at` set
    - Each fixture is JSON array of `{ method, url, respondWith: { status, headers, body, delayMs } }`
    - _Requirements: 13.2, 6.2_
  - [ ] 5.3 Write fixture-based tests for OSV source in `apps/poltergeist/test/sources/osv.test.ts`
    - Implement `mockFetch` helper replacing `globalThis.fetch`
    - Test: chunked querybatch (1000 per request), follow `next_page_token`
    - Test: GET `vulns/{id}` once per run (cache), skip withdrawn
    - Test: returns findings with `details` containing id, aliases, severity, ranges
    - _Requirements: 13.2, 5.2_
  - [ ] 5.4 Write fixture-based tests for GitHub source in `apps/poltergeist/test/sources/github.test.ts`
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
    - Call `mergeById(results)`
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

- [ ] 8. Implement config and theme
  - [ ] 8.1 Write `apps/poltergeist/src/config.ts`
    - Export zod schema with `targets` array: `{ owner, repo, ref?, lockfiles: string[] }`
    - `ref` defaults to `"main"`; `lockfiles` must be non-empty
    - Validate lockfile paths end in `package-lock.json` (npm) or `requirements.txt` (PyPI)
    - Export type `Config`
    - _Requirements: 1.1, 1.2, 1.4_
  - [ ] 8.2 Write `apps/poltergeist/src/theme.ts`
    - Export `AppDefinition["theme"]` with `name: "Poltergeist"`, `tagline: "Something is rattling in your lockfile"`, `accentColor: "#8b5cf6"`, `labels: { confirmed: "haunting", ghost: "ghost", resolved: "laid to rest" }`, `issuePrefix: "👻"`
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

- [ ] 11. Update skeleton with issuePrefix change and test
  - [ ] 11.1 Update `skeleton/src/notify/notifier.ts`
    - Add optional `issuePrefix?: string` to notifier options
    - Update `formatIssueTitleWithId` to prefix title with `issuePrefix` when set
    - _Requirements: 11.2_
  - [ ] 11.2 Add test in `skeleton/test/notify/notifier.test.ts`
    - Verify `formatIssueTitleWithId` prefixes when `issuePrefix` supplied
    - _Requirements: 11.2_

- [ ] 12. Final checkpoint — full test suite and dry run
  - Run `npm test` in `apps/poltergeist/` and verify all tests pass offline
  - Run `npm run build` to ensure `tsc` compiles with no errors
  - Run `graveyard-shift run apps/poltergeist --dry-run` from repo root
  - Verify demo produces hauntings and ghosts as documented in `demo/README.md`
  - _Requirements: 12.1, 12.2, 13.1, 13.2, 13.3, 13.4, 15.1, 15.2, 15.3, 15.4_
