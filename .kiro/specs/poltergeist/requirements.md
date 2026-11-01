# Requirements Document

## Introduction

Poltergeist is a watch-and-warn app built on the Graveyard Shift skeleton. It reads dependency lockfiles (npm `package-lock.json` v2/v3 and pinned Python `requirements.txt`) from GitHub repositories and asks two independent advisory sources, OSV.dev and the GitHub Advisory Database, which installed versions have known vulnerabilities. An advisory is a haunting (confirmed) only when both sources list it for the exact installed version; an advisory only one source lists is a ghost, shown on the dashboard but never reported. Hauntings open GitHub issues through the skeleton notifier. Everything shared (runner, HTTP helper, agreement rule, diff, store, dashboard, MCP server, notifier, CLI) comes from the skeleton; Poltergeist supplies only its sources, rules, config schema and theme.

## Glossary

- **Target**: one repository to watch: owner, repo, ref and the lockfile paths inside it.
- **Package_Version**: an (ecosystem, normalised package name, exact version) triple read from a lockfile.
- **Ecosystem**: `npm` or `PyPI` (OSV spelling); the GitHub Advisory Database calls PyPI `pip`.
- **GHSA_Id**: a GitHub Security Advisory id (`GHSA-xxxx-xxxx-xxxx`).
- **Finding_Id**: `poltergeist:<owner>/<repo>:<ecosystem>:<package>@<version>:<advisory id>`.
- **Haunting**: a confirmed finding (both sources report the same Finding_Id).
- **Ghost**: a finding only one source reports.
- **Laid_To_Rest**: a resolved finding (the skeleton's resolved state).

## Requirements

### Requirement 1: Configuration

**User Story:** As a repository owner, I want to list the repositories and lockfiles Poltergeist watches in one config file, so that adding a target is a one-line change.

#### Acceptance Criteria

1. THE App SHALL export a zod schema for `apps/poltergeist/config.json`, which the skeleton runner reads and validates (`graveyard-shift run apps/poltergeist`).
2. THE Config SHALL contain `targets`: a non-empty array of `{ owner, repo, ref, lockfiles }`, where `ref` defaults to `main` and `lockfiles` is a non-empty array of paths relative to the repository root.
3. THE Config MAY contain the skeleton notifier fields `repo`, `maxNewIssues` and `maxNewPRs`, which the runner passes to the notifier unchanged.
4. WHEN a lockfile path ends in `package-lock.json`, THE App SHALL treat it as ecosystem `npm`; WHEN it ends in `.txt` and its file name starts with `requirements`, THE App SHALL treat it as ecosystem `PyPI`; any other path SHALL fail config validation with a message naming the path.

### Requirement 2: Lockfile Fetching

**User Story:** As an operator, I want lockfiles read straight from GitHub, so that Poltergeist needs no clone of the watched repository.

#### Acceptance Criteria

1. THE App SHALL fetch each lockfile from `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` through the skeleton HTTP helper, which owns timeouts, retries, Retry-After handling, per-host limits and the User-Agent.
2. THE App SHALL fetch and parse each lockfile at most once per run and share the resulting Package_Version list between both sources.
3. IF a lockfile cannot be fetched (any non-2xx status, including 404, after the helper's retries) or cannot be parsed, THEN every source SHALL fail for this run with an error naming the target and path, so that the skeleton keeps the previous store instead of reporting every finding of that target as laid to rest.

### Requirement 3: npm Lockfile Parser

**User Story:** As a developer, I want every installed npm package version extracted from a lockfile, so that each one can be checked.

#### Acceptance Criteria

1. WHEN given a `package-lock.json` with `lockfileVersion` 2 or 3, THE Parser SHALL read the `packages` map.
2. THE Parser SHALL skip the root entry (key `""`) and every entry with `link: true`.
3. FOR every other entry, THE Parser SHALL take the package name as the part of the key after the last `node_modules/` (so nested entries and scoped names such as `@scope/name` work) and the version from the entry's `version` field; it SHALL never derive versions from `resolved` URLs.
4. THE Parser SHALL return each distinct (name, version) pair once, even when the same pair is installed at several paths.
5. IF the input is not valid JSON, has no `packages` map (lockfile v1) or an entry has no `version`, THEN THE Parser SHALL return a descriptive error.
6. FOR ALL sets of (name, version) pairs, building a v3 lockfile from the set and parsing it SHALL return the same set (round-trip property).

### Requirement 4: Python Requirements Parser

**User Story:** As a developer, I want every pinned Python dependency extracted from a requirements file, so that each one can be checked.

#### Acceptance Criteria

1. THE Parser SHALL read lines of the form `name==version`, after stripping inline comments (` #...`), environment markers (from `;`), extras (`[...]`) and surrounding whitespace, and joining backslash continuation lines.
2. THE Parser SHALL skip blank lines, comment lines, option lines (starting with `-`, such as `-r`, `-e`, `--index-url`, `--hash`) and requirements not pinned with `==`, and SHALL return how many lines it skipped for each of those reasons.
3. THE Normaliser SHALL lowercase a package name and replace every run of `-`, `_` and `.` with a single `-` (PEP 503).
4. FOR ALL package names, normalising twice SHALL give the same result as normalising once (idempotence property).
5. FOR ALL sets of (normalised name, version) pairs, writing them as `name==version` lines (with random comments, markers and extras added) and parsing SHALL return the same set (round-trip property).

### Requirement 5: OSV.dev Source

**User Story:** As the agreement rule, I want OSV.dev's view of every Package_Version, so that it can be compared with GitHub's.

#### Acceptance Criteria

1. THE OSV_Source SHALL be a function named `osv` returning a skeleton `SourceResult` with `sourceName: "osv"`.
2. THE OSV_Source SHALL POST `https://api.osv.dev/v1/querybatch` with at most 1000 queries per request, one query per Package_Version (`{ package: { name, ecosystem }, version }`), and follow each query's `next_page_token` until it is absent.
3. THE OSV_Source SHALL GET `https://api.osv.dev/v1/vulns/{id}` once per distinct advisory id per run (cached in memory) to read aliases, severity, `database_specific.severity`, affected ranges and `withdrawn`.
4. THE OSV_Source SHALL exclude advisories whose `withdrawn` field is set.
5. FOR each remaining (Package_Version, advisory) pair, THE OSV_Source SHALL emit one finding whose `details` carry the OSV id, its aliases, its severity data and the fixed versions from the affected ranges for that package.

### Requirement 6: GitHub Advisory Database Source

**User Story:** As the agreement rule, I want GitHub's view of every Package_Version, so that it can be compared with OSV's.

#### Acceptance Criteria

1. THE GitHub_Source SHALL be a function named `github` returning a skeleton `SourceResult` with `sourceName: "github"`.
2. FOR each Package_Version, THE GitHub_Source SHALL GET `https://api.github.com/advisories?ecosystem=<npm|pip>&affects=<name>@<version>&per_page=100` and follow `Link: rel="next"` pages.
3. WHEN the `GITHUB_TOKEN` environment variable is set, THE GitHub_Source SHALL send it as a Bearer token; without it, requests are unauthenticated.
4. THE GitHub_Source SHALL exclude advisories whose `withdrawn_at` is set.
5. FOR each remaining (Package_Version, advisory) pair, THE GitHub_Source SHALL emit one finding whose `details` carry `ghsa_id`, `cve_id`, `severity` and the `first_patched_version` of the vulnerability entry for that package.

### Requirement 7: Advisory Id Canonicalisation

**User Story:** As the agreement rule, I want the same advisory to carry the same id from both sources, so that one advisory becomes one finding.

#### Acceptance Criteria

1. THE Rules SHALL canonicalise every advisory to a GHSA_Id when one is known: for a GitHub finding, its `ghsa_id`; for an OSV finding, its own id if it starts with `GHSA-`, else the lexicographically smallest `GHSA-` alias, else the `ghsa_id` of a GitHub finding for the same Package_Version whose `cve_id` is one of its aliases.
2. WHEN no GHSA_Id is known for an OSV advisory, THE Rules SHALL keep its OSV id (such a finding can only be a ghost).
3. THE Rules SHALL build each Finding_Id as `poltergeist:<owner>/<repo>:<ecosystem>:<package>@<version>:<canonical id>`.
4. FOR ALL advisories, permuting the order of their aliases SHALL not change the canonical id (alias-order independence property).

### Requirement 8: Confirmation

**User Story:** As a repository owner, I want only advisories both sources agree on to be treated as real, so that a single source's mistake never opens an issue.

#### Acceptance Criteria

1. THE App SHALL rely on the skeleton agreement rule: a finding reported under the same Finding_Id by both `osv` and `github` is a haunting (confirmed); a finding only one source reports is a ghost.
2. WHEN an advisory is withdrawn in one source and still listed by the other, THE finding SHALL be a ghost (follows from 5.4, 6.4 and 8.1).

### Requirement 9: Severity

**User Story:** As a repository owner, I want each finding to carry a severity, so that I can triage.

#### Acceptance Criteria

1. WHEN the GitHub finding has a severity, THE Rules SHALL use it (`critical`, `high`, `medium`, `low`).
2. OTHERWISE THE Rules SHALL use OSV `database_specific.severity` when present, else the CVSS v3.x base score computed from the OSV `CVSS_V3` vector, banded critical >= 9.0, high 7.0-8.9, medium 4.0-6.9, low 0.1-3.9.
3. WHEN no severity can be derived, THE severity SHALL be `info`.

### Requirement 10: Fix Version

**User Story:** As a repository owner, I want to know which version to upgrade to, so that the fix is one edit.

#### Acceptance Criteria

1. WHEN both sources give fixed versions and share at least one, THE Rules SHALL use the lowest shared version as `fix.value`.
2. WHEN both sources give fixed versions but share none, THE Rules SHALL use the higher of the two sources' lowest fixed versions and say in `fix.text` which source said what.
3. WHEN only one source gives a fixed version, THE Rules SHALL use its lowest one and name that source in `fix.text`.
4. WHEN no source gives a fixed version, THE finding SHALL have no `fix`.
5. Version comparison SHALL use semver for npm and PEP 440 ordering for PyPI.

### Requirement 11: Notifications

**User Story:** As a repository owner, I want one issue per haunting in my repository, so that confirmed advisories land in my tracker.

#### Acceptance Criteria

1. THE App SHALL use the skeleton notifier unchanged in behaviour: issues only for confirmed findings, one per Finding_Id, updated rather than duplicated, closed when the finding is laid to rest, opened in the repository running the workflow unless the config names another.
2. THE Skeleton SHALL gain an optional `theme.issuePrefix` string; WHEN it is set, the notifier SHALL prefix every issue title it creates with it.
3. THE Poltergeist theme SHALL set `issuePrefix` to the ghost emoji (👻).

### Requirement 12: Demo Target

**User Story:** As a judge, I want the live dashboard to always show hauntings and ghosts, so that I can see Poltergeist working.

#### Acceptance Criteria

1. THE Repository SHALL contain `apps/poltergeist/demo/haunted-house/package-lock.json` and `apps/poltergeist/demo/haunted-house/requirements.txt`, pinned to versions with published advisories.
2. THE Default config SHALL watch this repository itself (owner `CVasilopoulos`, repo `graveyard-shift`, ref `main`, both demo lockfiles).
3. THE Demo lockfiles SHALL produce at least three hauntings and at least one ghost, checked once against the live APIs while building the demo and listed with their advisory ids in `apps/poltergeist/demo/README.md`.

### Requirement 13: Testing

**User Story:** As a developer, I want offline, property-based tests, so that the parsers and canonicalisation are trustworthy.

#### Acceptance Criteria

1. THE Tests SHALL use vitest and fast-check for the properties in 3.6, 4.4, 4.5 and 7.4.
2. THE Source tests SHALL use recorded fixtures for OSV and GitHub responses (including a paginated response, a withdrawn advisory and a 404) and SHALL make no live network calls.
3. THE Rules tests SHALL cover a GHSA-id OSV entry, a PYSEC entry with a GHSA alias, an OSV entry linked only through a CVE alias, and an OSV-only advisory (ghost).
4. THE Tests SHALL live in `apps/poltergeist/test/`.

### Requirement 14: Theme

**User Story:** As a user, I want Poltergeist to look like itself, so that its dashboard is recognisable.

#### Acceptance Criteria

1. THE Theme SHALL have name `Poltergeist`, tagline `Something is rattling in your lockfile` and accent colour `#8b5cf6`.
2. THE Theme labels SHALL be `haunting` (confirmed), `ghost` (ghost) and `laid to rest` (resolved).

### Requirement 15: Architecture

**User Story:** As a maintainer, I want Poltergeist to be a thin app on the skeleton, so that the second app proves the skeleton is reusable.

#### Acceptance Criteria

1. THE App SHALL be the npm workspace package `apps/poltergeist` (the root `package.json` workspaces SHALL include `apps/*`) and SHALL import shared code from the `graveyard-shift` package, never by relative path into `skeleton/`.
2. THE App SHALL export an `AppDefinition` from `apps/poltergeist/src/index.ts` whose `sources` are the functions `osv` and `github` (the runner names an erroring source by its function name).
3. THE App code SHALL consist of the parsers, the two sources, the rules, the config schema and the theme; it SHALL not reimplement anything the skeleton provides.
4. THE Skeleton change in 11.2 SHALL come with its own skeleton test.
