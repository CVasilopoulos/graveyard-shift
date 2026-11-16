# Graveyard Shift

A template for watch-and-warn apps that run entirely on GitHub: no server, no database, no paid service and no API key beyond the `GITHUB_TOKEN` that Actions already provides. Our Kiroween 2026 entry in the Skeleton Crew category.

Live dashboards: https://cvasilopoulos.github.io/graveyard-shift/

## The idea: two sources must agree

Many useful bots answer one question on a schedule: did something out there go wrong for me? Most of them are noisy because they trust a single source. Graveyard Shift bakes in one rule:

- A finding is **confirmed** only when two independent sources report it under the same id.
- A finding only one source reports is a **ghost**. It is shown on the dashboard, but it never opens an issue.
- A finding that disappears is **resolved** and its issue is closed.
- If a source fails during a run, its evidence from the previous run is carried forward and marked stale, so an outage never turns every finding into a ghost or a resolution.

Findings are stable JSON files committed to the repository, so git history is the audit trail.

## The apps

| App | Question | The two sources | Status |
|-----|----------|-----------------|--------|
| [Poltergeist](apps/poltergeist) | Does a pinned dependency in these lockfiles have a known vulnerability? | OSV.dev and the GitHub Advisory Database, for the exact installed version | Built |
| Seance | Is a link in these docs dead, and is there a good archived copy? | Two checks spaced in time; the Wayback Machine availability and CDX APIs | Planned |

Poltergeist watches its own demo lockfiles in [apps/poltergeist/demo](apps/poltergeist/demo), so the live dashboard always has hauntings and a ghost. The demo README lists every advisory, checked against the live APIs.

## How a run works

```
sources (in parallel) -> rules -> agreement rule -> diff with the last run -> store -> notifier
                                                                               |
                                    GitHub Pages dashboard  <-  site builder <-+-> MCP server
```

The [skeleton](skeleton) package (`graveyard-shift`) provides everything except the sources and rules:

- `runApp`: config validation with zod, concurrent sources, stale carry-forward, timestamps, diff and store.
- Store: `findings.json`, `history.json` and `runs.json` in `apps/<app>/data/`, keys sorted, two-space indent.
- HTTP helper: timeouts, bounded retries with backoff, `Retry-After`, a per-host concurrency limit and a User-Agent naming this repository.
- Dashboard: one HTML file, one CSS file and one vanilla JS module that read the JSON from a GitHub Pages subpath.
- MCP server over stdio with `list_findings`, `get_finding`, `summary` and `explain_finding`, reading a local data folder or the published site.
- Notifier: opens one issue per confirmed finding that appeared or was promoted from ghost, updates instead of duplicating, closes it when the finding is resolved, caps new issues per run (default 5) and never touches ghosts.
- CLI: `graveyard-shift run <appDir>`, `site <appDir> <outDir>` and `mcp <dataDirOrUrl>`.

The skeleton's own [README](skeleton/README.md) documents the types and APIs.

## Make a new app

A new app is four small files on top of the skeleton: sources, rules, config and a theme, plus an entry point that wires them together. This example compiles with `tsc --strict` as an npm workspace under `apps/lantern/`.

`src/config.ts`: the zod schema for `apps/lantern/config.json`. The optional `repo`, `maxNewIssues` and `maxNewPRs` fields reach the notifier unchanged.

```ts
import { z } from "zod";

export const configSchema = z.object({
  primaryUrl: z.url(),
  secondaryUrl: z.url(),
  maxNewIssues: z.number().int().nonnegative().optional(),
});

export type Config = z.infer<typeof configSchema>;
```

`src/sources.ts`: one async function per source. Name each function after the `sourceName` it returns, because the runner names a failing source by its function name.

```ts
import { createHttpClient, type SourceResult } from "graveyard-shift";
import type { Config } from "./config.js";

const http = createHttpClient({});

async function list(url: string, sourceName: string): Promise<SourceResult> {
  const response = await http.get(url);
  const items = (await response.json()) as Array<{ id: string; title: string }>;
  return {
    sourceName,
    findings: items.map(({ id, title }) => ({ id, title })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function primary(config: Config): Promise<SourceResult> {
  return list(config.primaryUrl, "primary");
}

export async function secondary(config: Config): Promise<SourceResult> {
  return list(config.secondaryUrl, "secondary");
}
```

`src/rules.ts`: a pure function. Give the same problem the same id in every source (Poltergeist maps CVE and PYSEC ids to one GHSA id here), then let `mergeById` group the evidence. The runner's agreement rule sets the final status.

```ts
import { mergeById, type AppDefinition } from "graveyard-shift";
import type { configSchema } from "./config.js";

export const rules: AppDefinition<typeof configSchema>["rules"] = (results) =>
  mergeById(results).map((merged) => ({
    ...merged,
    summary: merged.evidence.map((entry) => entry.text).join(" / "),
    severity: "medium",
    status: "ghost",
  }));
```

`src/theme.ts`: the name, tagline, accent colour and status words the dashboard uses.

```ts
import type { AppDefinition } from "graveyard-shift";
import type { configSchema } from "./config.js";

export const theme: AppDefinition<typeof configSchema>["theme"] = {
  name: "Lantern",
  tagline: "Two watchers, one alarm",
  accentColor: "#f59e0b",
  labels: { confirmed: "lit", ghost: "flicker", resolved: "out" },
};
```

`src/index.ts` default-exports the `AppDefinition`; `package.json` points `main` at `./dist/index.js` and depends on `graveyard-shift` and `zod` (copy [apps/poltergeist/package.json](apps/poltergeist/package.json) and [tsconfig.json](apps/poltergeist/tsconfig.json)).

```ts
import type { AppDefinition } from "graveyard-shift";
import { configSchema } from "./config.js";
import { rules } from "./rules.js";
import { primary, secondary } from "./sources.js";
import { theme } from "./theme.js";

const lantern: AppDefinition<typeof configSchema> = { sources: [primary, secondary], rules, configSchema, theme };

export default lantern;
```

To schedule it, copy [.github/workflows/poltergeist.yml](.github/workflows/poltergeist.yml) to `lantern.yml` and change the workflow name, `APP`, the concurrency group and the cron minute. An app that opens pull requests also needs `pull-requests: write` on the run job. The site builder finds every folder under `apps/` with a `package.json`, so the new dashboard appears at `/lantern/` and on the landing page without further changes.

## Run it locally

Node.js 22.12 or newer.

```sh
npm ci
npm run build
npm test
npm run graveyard-shift -- run apps/poltergeist --dry-run
npm run site
python3 -m http.server --directory site 8000
```

Then open http://localhost:8000/poltergeist/. `--dry-run` writes the store but opens no issues; without it the notifier needs `GITHUB_TOKEN` and `GITHUB_REPOSITORY`. Poltergeist reads the demo lockfiles from `raw.githubusercontent.com`, so its default config only works once this repository is public; before that every source fails with HTTP 404 and only `runs.json` is written. Point `config.json` at any public repository to try it on real lockfiles.

To query the findings from an AI agent, start the MCP server on the data folder or on the published dashboard:

```sh
npm run --silent graveyard-shift -- mcp apps/poltergeist/data
npm run --silent graveyard-shift -- mcp https://cvasilopoulos.github.io/graveyard-shift/poltergeist
```

## GitHub Actions

| Workflow | Trigger | What it does | Permissions |
|----------|---------|--------------|-------------|
| [poltergeist.yml](.github/workflows/poltergeist.yml) | daily 05:23 UTC, manual | `npm ci`, build, `graveyard-shift run apps/poltergeist`, commit `apps/poltergeist/data/`, then deploy Pages | run: `contents: write`, `issues: write` |
| [pages.yml](.github/workflows/pages.yml) | called by app workflows, push to `main`, manual | builds every app's dashboard and the landing page with `npm run site` and deploys them with `actions/upload-pages-artifact` and `actions/deploy-pages` | build: `contents: read`; deploy: `pages: write`, `id-token: write` |
| [ci.yml](.github/workflows/ci.yml) | push to `main`, pull requests | build, tests and a site build | `contents: read` |

Every action is pinned to the full commit SHA of its current release: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-pages-artifact` v5.0.0 and `actions/deploy-pages` v5.0.1. Runs of the same app never overlap and Pages deployments are serialised.

What keeps the notifier quiet: issues are opened only for confirmed findings that appeared or were promoted since the last committed run, at most five per run, never for ghosts, and only on the default branch. The workflow commits the store after every run, so the next run compares against it and an unchanged demo opens nothing. A manual run with `dry_run` records findings and deploys the dashboard without touching issues; findings recorded that way count as already seen.

## Built with Kiro

Everything Kiro used lives in [.kiro](.kiro):

- [steering](.kiro/steering): product, structure and tech rules that every Kiro session loaded (`inclusion: always`), including pinned dependency versions after Kiro first reached for 2023 releases.
- [specs](.kiro/specs): `skeleton-core` and `poltergeist`, each with requirements in EARS form, a design with correctness properties, and a task list. Review changes are marked in the specs where they happened.
- [hooks/verify-task.json](.kiro/hooks/verify-task.json): a `PostTaskExec` hook that runs [verify-task.mjs](.kiro/hooks/verify-task.mjs) after every spec task. A ticked task fails the hook unless every file it names exists and `npm test` passes. It was added after a Kiro run ticked tasks without writing their files.

The work is AI-assisted and human-directed. Kiro drafted the specs and wrote the first versions of most of the skeleton and parts of Poltergeist; the rest, and the review fixes, were written with Claude Code under the author's direction. The commit messages and the specs say which is which.

## Licence

[MIT](LICENSE)
