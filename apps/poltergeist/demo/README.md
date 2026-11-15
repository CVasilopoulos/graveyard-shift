# Haunted house demo

`haunted-house/` pins five package versions with published advisories so that the Poltergeist dashboard always has something to show. The default `config.json` watches these two files in this repository.

- `haunted-house/package-lock.json`: express 4.17.1, lodash 4.17.15 and minimist 1.2.5. It is a hand-trimmed v3 lockfile with the three top-level packages only (real `resolved` and `integrity` values from the npm registry, no transitive dependencies), so one run stays far below GitHub's unauthenticated limit of 60 requests per hour.
- `haunted-house/requirements.txt`: requests 2.25.0 and pandas 1.0.3.

Checked against the live APIs on 2026-11-15 (OSV.dev querybatch and `vulns/{id}`, GitHub `GET /advisories?affects=`). Advisory databases change, so later runs can show more.

## Hauntings (both sources list the advisory)

| Package | Advisory | CVE | Severity | Fixed in |
|---------|----------|-----|----------|----------|
| express 4.17.1 | [GHSA-rv95-896h-c2vc](https://github.com/advisories/GHSA-rv95-896h-c2vc) Express.js Open Redirect in malformed URLs | CVE-2024-29041 | medium | 4.19.2 |
| express 4.17.1 | [GHSA-qw6h-vgh9-j6wx](https://github.com/advisories/GHSA-qw6h-vgh9-j6wx) express vulnerable to XSS via response.redirect() | CVE-2024-43796 | low | 4.20.0 |
| lodash 4.17.15 | [GHSA-p6mc-m468-83gw](https://github.com/advisories/GHSA-p6mc-m468-83gw) Prototype Pollution in lodash | CVE-2020-8203 | high | 4.17.19 |
| lodash 4.17.15 | [GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm) Command Injection in lodash | CVE-2021-23337 | high | 4.17.21 |
| lodash 4.17.15 | [GHSA-29mw-wpgm-hmr9](https://github.com/advisories/GHSA-29mw-wpgm-hmr9) Regular Expression Denial of Service (ReDoS) in lodash | CVE-2020-28500 | medium | 4.17.21 |
| lodash 4.17.15 | [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) Prototype Pollution in `_.unset`, `_.omit` and `_.pullAt` | CVE-2025-13465 | medium | 4.17.23 |
| lodash 4.17.15 | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) Code Injection via `_.template` imports key names | CVE-2026-4800 | high | 4.18.0 |
| minimist 1.2.5 | [GHSA-xvch-5gv4-984h](https://github.com/advisories/GHSA-xvch-5gv4-984h) Prototype Pollution in minimist | CVE-2021-44906 | critical | 1.2.6 |
| requests 2.25.0 | [GHSA-j8r2-6x86-q33q](https://github.com/advisories/GHSA-j8r2-6x86-q33q) Unintended leak of Proxy-Authorization header (OSV also as PYSEC-2023-74) | CVE-2023-32681 | medium | 2.31.0 |
| requests 2.25.0 | [GHSA-9wx4-h78v-vm56](https://github.com/advisories/GHSA-9wx4-h78v-vm56) `Session` does not verify requests after a first request with verify=False (OSV also as PYSEC-2026-1873) | CVE-2024-35195 | medium | 2.32.0 |
| requests 2.25.0 | [GHSA-9hjg-9r4m-mvj7](https://github.com/advisories/GHSA-9hjg-9r4m-mvj7) .netrc credentials leak via malicious URLs (OSV also as PYSEC-2026-1872) | CVE-2024-47081 | medium | 2.32.4 |
| requests 2.25.0 | [GHSA-gc5v-m9x4-r6x2](https://github.com/advisories/GHSA-gc5v-m9x4-r6x2) Insecure temp file reuse in `extract_zipped_paths()` (OSV also as PYSEC-2026-2275) | CVE-2026-25645 | medium | 2.33.0 |

The four requests advisories show the canonicalisation: OSV returns each one twice (GHSA and PYSEC ids), and both become the same GHSA finding.

## Ghosts (one source only, never reported)

| Package | Advisory | Listed by | Why only one source |
|---------|----------|-----------|---------------------|
| pandas 1.0.3 | [PYSEC-2020-73](https://osv.dev/vulnerability/PYSEC-2020-73) unsafe `read_pickle()` (disputed) | OSV only | CVE-2020-13091 is disputed; the GitHub Advisory Database lists no advisory for pandas 1.0.3. OSV gives 1.0.4 as fixed. |

## Withdrawn, so neither

- express: [GHSA-pj86-cfqh-vqx6](https://github.com/advisories/GHSA-pj86-cfqh-vqx6) (CVE-2024-51999) was withdrawn on 2025-12-02. GitHub still lists it for express 4.17.1 with `withdrawn_at` set; OSV no longer returns it.
- lodash: [GHSA-8p5q-j9m2-g8wr](https://github.com/advisories/GHSA-8p5q-j9m2-g8wr) (CVE-2021-41720) was withdrawn on 2021-10-01. GitHub lists it with `withdrawn_at` set; OSV does not.
