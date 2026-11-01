# Requirements Document

## Introduction

Poltergeist is a "watch-and-warn" app built on the Graveyard Shift skeleton. It monitors dependency lockfiles (npm package-lock.json, Python requirements.txt) in public repositories for known vulnerabilities. A vulnerability is confirmed only when both the OSV.dev and GitHub Advisory Database list it for the exact installed version. Confirmed findings (hauntings) are reported via GitHub issues, while single-source findings (ghosts) are shown but not reported. This document specifies the requirements for the Poltergeist app.

## Glossary

- **Poltergeist**: The application described in this document
- **System**: The Poltergeist application
- **Source**: An external data provider (OSV.dev or GitHub Advisory Database)
- **Lockfile**: A dependency manifest file (package-lock.json or requirements.txt)
- **Vulnerability**: A security issue in a package version
- **Advisory**: A security advisory from OSV.dev or GitHub
- **HAUNTING**: A confirmed vulnerability reported by both sources
- **GHOST**: A single-source finding that is shown but not reported
- **Laid to rest**: A resolved vulnerability where the installed version is fixed
- **Ecosystem**: The package manager type (npm or pypi)
- **Package**: A software package with a normalized name
- **Version**: A specific release of a package
- **GHSA**: GitHub Security Advisory identifier
- **CVSS**: Common Vulnerability Scoring System

## Requirements

### Requirement 1: Configuration

**User Story:** As a maintainer, I want to configure Poltergeist to monitor specific repositories, so that I can protect my dependencies.

#### Acceptance Criteria

1. WHEN Poltergeist starts, THE System SHALL load configuration from `.kiro/specs/poltergeist/config.ts`
2. THE Config file SHALL define a list of targets, each with owner, repository, ref, and lockfile_paths
3. THE Lockfile_paths field SHALL accept an array of paths relative to the repository root
4. WHERE a target specifies a lockfile path ending in `package-lock.json`, THE System SHALL treat it as npm ecosystem
5. WHERE a target specifies a lockfile path ending in `requirements.txt`, THE System SHALL treat it as pypi ecosystem

### Requirement 2: Lockfile Fetching

**User Story:** As a user, I want Poltergeist to fetch lockfiles from GitHub repositories, so that I can monitor their dependencies without cloning them.

#### Acceptance Criteria

1. WHEN fetching a target repository, THE System SHALL construct a raw URL using the owner, repository, ref, and lockfile_path
2. WHEN the URL is constructed, THE System SHALL use the format `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`
3. WHEN a lockfile fetch fails with HTTP 404, THE System SHALL treat it as a missing file and record no packages
4. WHEN a lockfile fetch fails with HTTP 410, THE System SHALL treat it as a deleted file and record no packages
5. WHEN a lockfile fetch fails with a transient error (429 with retry-after, 5xx, timeout), THE System SHALL retry with exponential backoff up to 3 attempts
6. EACH lockfile fetch SHALL include a timeout of 30 seconds and a User-Agent header `poltergeist (https://github.com/graveyard-shift/poltergeist)`

### Requirement 3: npm Lockfile Parser

**User Story:** As a developer, I want Poltergeist to parse npm package-lock.json files, so that I can extract package dependencies for vulnerability checking.

#### Acceptance Criteria

1. WHEN a valid package-lock.json file is provided, THE Parser SHALL extract packages from the packages map
2. WHEN parsing the packages map, THE Parser SHALL skip entries with keys starting with `node_modules/` or `node_modules` alone
3. WHEN parsing the packages map, THE Parser SHALL skip link entries (entries with a `link` field)
4. WHEN a package entry has a `resolved` field, THE Parser SHALL extract the version from the resolved URL or from the key
5. WHEN parsing fails due to invalid JSON, THE Parser SHALL return a descriptive error
6. FOR ALL valid package-lock.json objects, parsing then printing then parsing SHALL produce an equivalent object (round-trip property)

### Requirement 4: Python Requirements Parser

**User Story:** As a developer, I want Poltergeist to parse Python requirements.txt files, so that I can extract package dependencies for vulnerability checking.

#### Acceptance Criteria

1. WHEN a valid requirements.txt file is provided, THE Parser SHALL parse lines with `name==version` format
2. WHEN parsing a line, THE Parser SHALL extract the package name and exact version
3. WHEN a line is a comment (starts with #), THE Parser SHALL skip it
4. WHEN a line contains extras (e.g., `package[extra]==version`), THE Parser SHALL normalize the name per PEP 503 and ignore the extras
5. WHEN a line contains options (e.g., `-r`, `--index-url`), THE Parser SHALL skip it
6. WHEN parsing fails due to malformed input, THE Parser SHALL return a descriptive error
7. THE Normalizer SHALL convert package names to lowercase and replace underscores/dots with hyphens per PEP 503
8. FOR ALL normalized package names, normalizing twice SHALL produce the same result (idempotence property)

### Requirement 5: OSV.dev Source

**User Story:** As a monitoring system, I want to query OSV.dev for vulnerabilities, so that I can identify security issues in dependencies.

#### Acceptance Criteria

1. WHEN querying vulnerabilities, THE System SHALL POST to `/v1/querybatch` with chunks of up to 1000 package-version pairs
2. WHEN a chunk exceeds 1000 pairs, THE System SHALL split into multiple requests
3. WHEN the OSV.dev API returns an error, THE System SHALL retry with exponential backoff up to 3 attempts
4. WHEN a vulnerability is returned, THE System SHALL extract the advisory ID, package name, affected versions, and severity
5. WHEN fetching detailed vulnerability information, THE System SHALL GET `/v1/vulns/{id}` for each unique advisory ID
6. WHEN fetching detailed information, THE System SHALL cache results per run to avoid duplicate requests
7. WHEN a vulnerability has no fixed version in the response, THE System SHALL record null for fix version
8. EACH OSV.dev request SHALL include a User-Agent header `poltergeist (https://github.com/graveyard-shift/poltergeist)`

### Requirement 6: GitHub Advisory Database Source

**User Story:** As a monitoring system, I want to query the GitHub Advisory Database for vulnerabilities, so that I can identify security issues in dependencies.

#### Acceptance Criteria

1. WHEN querying vulnerabilities, THE System SHALL GET `/advisories?ecosystem=npm|pip` with pagination
2. WHEN the ecosystem is npm, THE System SHALL filter advisories where `affected.ecosystem` is `npm`
3. WHEN the ecosystem is pypi, THE System SHALL filter advisories where `affected.ecosystem` is `pip`
4. WHEN a GitHub advisory has a `ghsa_id`, THE System SHALL use it as the advisory ID
5. WHEN a GitHub advisory has a `cve_id` but no `ghsa_id`, THE System SHALL construct a GHSA-like ID using the CVE
6. WHEN authenticated with a GITHUB_TOKEN, THE System SHALL include the token in the Authorization header
7. WHEN a GitHub advisory is withdrawn or disputed, THE System SHALL record its status
8. EACH GitHub request SHALL include a User-Agent header `poltergeist (https://github.com/graveyard-shift/poltergeist)`

### Requirement 7: ID Canonicalisation

**User Story:** As a deduplication system, I want to canonicalise advisory IDs across both sources, so that I can merge duplicate advisories.

#### Acceptance Criteria

1. WHEN an OSV advisory has aliases, THE System SHALL extract GHSA IDs from the aliases array
2. WHEN a GitHub advisory has both ghsa_id and cve_id, THE System SHALL create a pair identifier
3. WHEN canonicalising, THE System SHALL use the GHSA ID as the primary identifier when available
4. WHEN two advisories from different sources refer to the same vulnerability, THE System SHALL merge them
5. THE Final finding ID SHALL follow the format `poltergeist:<repo>:<ecosystem>:<package>@<version>:<GHSA>`
6. WHEN the GHSA ID is not available, THE System SHALL use the CVE ID in the finding ID
7. FOR ALL advisory IDs, using different alias orders SHALL produce the same canonical ID (order independence property)

### Requirement 8: Confirmation Logic

**User Story:** As a reporting system, I want to confirm vulnerabilities only when both sources agree, so that I reduce false positives.

#### Acceptance Criteria

1. WHEN both sources list the same vulnerability for the exact installed version, THE System SHALL mark it as a HUNTING
2. WHEN only one source lists the vulnerability, THE System SHALL mark it as a GHOST
3. WHEN a withdrawn or disputed advisory is seen by only one source, THE System SHALL keep it as a GHOST
4. WHEN a vulnerability is marked as Laid to rest, THE System SHALL record the resolved state
5. THE Confirmation SHALL require exact version match, not version range

### Requirement 9: Severity Reporting

**User Story:** As a user, I want to see the severity of vulnerabilities, so that I can prioritize remediation.

#### Acceptance Criteria

1. WHEN the GitHub advisory has a severity field, THE System SHALL use it as the primary severity
2. WHEN the GitHub advisory has no severity, THE System SHALL extract CVSS score from OSV advisory
3. WHEN using CVSS score, THE System SHALL band it into Low (<7), Medium (7-8.9), High (9-10)
4. WHEN both sources provide severity, THE System SHALL prefer GitHub's severity

### Requirement 10: Fix Version

**User Story:** As a user, I want to know which version fixes the vulnerability, so that I can upgrade.

#### Acceptance Criteria

1. WHEN both sources provide a fixed version, THE System SHALL use the lowest first-patched version both agree on
2. WHEN sources provide different fixed versions, THE System SHALL use the higher of the two and record a note
3. WHEN a source provides no fixed version, THE System SHALL record null for that source
4. WHEN both sources provide null, THE System SHALL record null for the finding

### Requirement 11: Notifying

**User Story:** As a repository owner, I want GitHub issues for confirmed vulnerabilities, so that I can track and remediate them.

#### Acceptance Criteria

1. WHEN a HUNTING is detected, THE System SHALL open or update a GitHub issue in the repository running the workflow
2. THE Issue title SHALL be prefixed with a spirit emoji (👻 for ghost, 💀 for haunting)
3. THE Issue title SHALL include the finding ID in the format `poltergeist:<repo>:<ecosystem>:<package>@<version>:<GHSA>`
4. THE Issue body SHALL include severity, affected version, fix version, and links to advisories
5. WHEN a HUNTING is resolved, THE System SHALL update the issue with a resolution comment and close it
6. WHEN a GHOST is resolved, THE System SHALL mark it as Laid to rest in the store

### Requirement 12: Demo Targets

**User Story:** As a demonstrator, I want to show Poltergeist with vulnerable test targets, so that judges can see it working.

#### Acceptance Criteria

1. WHEN the demo target is processed, THE System SHALL parse `apps/poltergeist/demo/haunted-house/package-lock.json`
2. WHEN the demo target is processed, THE System SHALL parse `apps/poltergeist/demo/haunted-house/requirements.txt`
3. THE Demo lockfiles SHALL be pinned to known-vulnerable package versions
4. THE Demo lockfiles SHALL include vulnerabilities that trigger both HUNTING and GHOST states

### Requirement 13: Testing

**User Story:** As a developer, I want thorough tests, so that I can trust Poltergeist's output.

#### Acceptance Criteria

1. WHEN testing parsers, THE Tests SHALL use property-based testing with fast-check
2. WHEN testing npm parser, THE Tests SHALL verify round-trip of generated package-lock.json files
3. WHEN testing Python parser, THE Tests SHALL verify name normalisation idempotence
4. WHEN testing id canonicalisation, THE Tests SHALL verify alias order independence
5. WHEN testing sources, THE Tests SHALL use recorded fixtures, never live network calls
6. EACH source test SHALL include fixtures for successful responses, 404, 429 with retry-after, and timeout scenarios

### Requirement 14: Theme and Branding

**User Story:** As a user, I want a consistent theme, so that I can recognize Poltergeist's output.

#### Acceptance Criteria

1. THE Application name SHALL be "Poltergeist"
2. THE Tagline SHALL be "Something is rattling in your lockfile"
3. THE Accent color SHALL be Violet
4. THE Labels SHALL be: haunting (confirmed), ghost (single-source), laid to rest (resolved)

### Requirement 15: Architecture

**User Story:** As a maintainer, I want Poltergeist to follow the skeleton pattern, so that I can maintain consistency across apps.

#### Acceptance Criteria

1. THE Poltergeist app SHALL be built as a workspace package at `apps/poltergeist`
2. THE App SHALL import from the graveyard-shift skeleton via npm workspace, not relative paths
3. THE App code SHALL consist only of sources, rules, config, and theme modules
4. THE Core modules (runner, rules helpers, diff, store, notifier, MCP) SHALL come from the skeleton
5. THE Tests SHALL live in `apps/poltergeist/test/` and follow the skeleton's test structure
