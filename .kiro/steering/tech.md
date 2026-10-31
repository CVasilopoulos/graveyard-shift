---
inclusion: always
---

# Tech

- TypeScript in strict mode, ES modules, Node.js 22. `tsc` for builds; no bundler.
- Runtime dependencies: none in the skeleton core except `@modelcontextprotocol/sdk` for the MCP server and `zod` for config and MCP input schemas. Apps may not add runtime dependencies without a reason written in their README.
- HTTP with the built-in `fetch` and `AbortSignal.timeout`. Every source call has a timeout, a bounded retry with backoff, a per-host concurrency limit and a User-Agent naming the project and its repository URL.
- Tests: `vitest` and `fast-check`. Rules, diffing and parsing get property-based tests; sources get tests against recorded fixtures, never the live network. `npm test` must pass offline.
- Pure core: rules, diff and rendering of issue or PR text are pure functions. Network and file I/O live only in sources, store and notifier modules.
- JSON files are stable: keys sorted, two-space indent, trailing newline, so git diffs stay readable.
- Dashboard: one static `index.html`, one CSS file, one small vanilla JS module that fetches `findings.json`. No framework. It must work from a subpath on GitHub Pages and meet WCAG AA contrast.
- GitHub Actions: pinned action versions, least-privilege `permissions`, `concurrency` to avoid overlapping runs.
- Code style: small modules, descriptive names, no explanatory comments unless the why is not obvious from the code.
- Licence: MIT.
