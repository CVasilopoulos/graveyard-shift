---
inclusion: always
---

# Product: Graveyard Shift

Graveyard Shift is a skeleton for "watch-and-warn" apps that run entirely on GitHub, with no server and no paid service. It is our Kiroween 2026 entry in the Skeleton Crew category: one lean template and two different apps built from it.

## The idea

Many useful bots answer one question on a schedule: "did something out there go wrong for me?" Most of them are noisy because they trust a single source. Graveyard Shift bakes in one rule: a finding is only **confirmed** when two independent sources agree. A finding seen by one source is a **ghost**: it is shown, dimmed, and never triggers an alert.

Every app built on the skeleton has the same parts:

1. **Sources**: small adapters that fetch from free, keyless public APIs, with timeouts, retries and polite rate limits.
2. **Rules**: pure functions that turn source results into findings, and decide confirmed vs ghost.
3. **Store**: findings are written as JSON files in the repository (current state plus a history of what appeared and what was resolved). Git history is the audit trail.
4. **Dashboard**: a static page on GitHub Pages that reads the JSON. No build server, no database.
5. **MCP server**: a stdio Model Context Protocol server that exposes the same findings to AI agents (list, get, summary, explain why a finding is confirmed).
6. **Notifier**: opens or updates a GitHub issue or pull request for confirmed findings only.
7. **Schedule**: a GitHub Actions workflow runs the app on a cron and commits the JSON.

A new app is one sources file, one rules file, one config file and a theme. Everything else comes from the skeleton.

## The two apps

- **Poltergeist** watches dependency lockfiles (npm `package-lock.json`, Python pinned `requirements.txt`) in a list of public repositories. A vulnerability is confirmed only when OSV.dev and the GitHub Advisory Database both list it for the exact installed version. Confirmed findings name the first fixed version. It knocks (opens an issue) only for confirmed findings.
- **Seance** watches the links in Markdown documentation of a list of public repositories. A link is confirmed dead only when two checks spaced apart in time both fail (404, 410, DNS failure, or a redirect to a parked domain), and a replacement is offered only when the Wayback Machine availability API and the CDX API agree on a good snapshot from before the link died. It proposes the replacement in a pull request.

## Audience and judging

Judges look at: potential value, quality of the Kiro implementation, quality of the design, originality, and the demo. Keep the skeleton small enough to read in ten minutes, and make each app obviously different in purpose and look.

## Theme

Halloween, but useful first. Copy uses the theme lightly: confirmed findings are "hauntings", single-source ones are "ghosts", resolved ones are "laid to rest". Never let the theme hide a number, a link or a fix.

## Non-goals

- No hosted backend, no accounts, no paid APIs, no API keys beyond the `GITHUB_TOKEN` that Actions already provides.
- No machine learning. Rules are deterministic and explainable.
- No scraping of sites that forbid it; respect robots.txt for Seance's live checks.
