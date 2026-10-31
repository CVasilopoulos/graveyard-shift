---
inclusion: always
---

# Structure

```
skeleton/                 the Graveyard Shift template (an npm workspace package)
  src/core/               types, runner, rules helpers, diff, store
  src/sources/            http helpers (timeout, retry, rate limit)
  src/mcp/                MCP server factory
  src/notify/             GitHub issue and pull request notifier
  src/dashboard/          static dashboard assets copied into each app's site
  test/                   unit and property-based tests
  README.md               how to build a new app in four files
apps/poltergeist/         app 1: sources, rules, config, theme, tests, README
apps/seance/              app 2: sources, rules, config, theme, tests, README
site/                     generated GitHub Pages output (one subfolder per app)
.github/workflows/        one scheduled workflow per app plus CI
.kiro/                    steering, specs, hooks and agents used to build this repo
```

- Apps import the skeleton through the npm workspace (`graveyard-shift`), never by relative paths into `skeleton/src`.
- Each app keeps its data in `apps/<app>/data/` (`findings.json`, `history.json`, `runs.json`).
- Fixtures for tests live next to the tests in `test/fixtures/`.
