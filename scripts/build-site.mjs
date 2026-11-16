import { spawnSync } from 'node:child_process';
import { copyFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'skeleton', 'dist', 'cli', 'index.js');
const DATA_FILES = ['findings.json', 'history.json', 'runs.json'];
const DEFAULT_LABELS = { confirmed: 'confirmed', ghost: 'ghost', resolved: 'resolved' };

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeColor(value) {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#8b5cf6';
}

function tally(app) {
  const labels = { ...DEFAULT_LABELS, ...(app.theme.labels ?? {}) };
  const run = app.lastRun;
  if (!run) return '<p class="run">No runs recorded yet.</p>';
  const counts = [
    `${labels.confirmed}: ${Number(run.confirmedCount) || 0}`,
    `${labels.ghost}: ${Number(run.ghostCount) || 0}`,
    `${labels.resolved}: ${Number(run.resolvedCount) || 0}`,
  ].join(' · ');
  const errors = Array.isArray(run.errorSources) && run.errorSources.length > 0
    ? ` · failed sources: ${run.errorSources.join(', ')}`
    : '';
  return `<p class="run">${escapeHtml(counts)}${escapeHtml(errors)}<br>Last run <time datetime="${escapeHtml(run.runAt)}">${escapeHtml(run.runAt)}</time></p>`;
}

export function renderIndex(apps, repositoryUrl) {
  const cards = apps
    .map(
      (app) => `      <li class="app" style="--app-accent: ${safeColor(app.theme.accentColor)}">
        <h3><a href="${encodeURIComponent(app.slug)}/">${escapeHtml(app.theme.name ?? app.slug)}</a></h3>
        <p>${escapeHtml(app.theme.tagline ?? '')}</p>
        ${tally(app)}
      </li>`,
    )
    .join('\n');
  const repository = repositoryUrl
    ? `<p><a href="${escapeHtml(repositoryUrl)}">Source, specs and the template on GitHub</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Watch-and-warn apps that run entirely on GitHub and confirm a finding only when two independent sources agree.">
  <title>Graveyard Shift</title>
  <style>
    :root { color-scheme: light dark; --bg: #faf9fb; --surface: #ffffff; --text: #1c1a22; --muted: #55505f; --border: #d6d2dd; --focus: #1d4ed8; }
    @media (prefers-color-scheme: dark) { :root { --bg: #121016; --surface: #1c1a22; --text: #ede9f3; --muted: #b3adbf; --border: #3b3645; --focus: #93c5fd; } }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.55; }
    header { background: #15121d; color: #f5f3ff; border-bottom: 6px solid #8b5cf6; }
    header div, main { max-width: 960px; margin: 0 auto; padding: 1.75rem 1.5rem; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 2.25rem; line-height: 1.15; }
    header p { margin-top: 0.35rem; color: #c9c3db; font-size: 1.125rem; }
    main > * + * { margin-top: 1.25rem; }
    a { color: inherit; text-decoration-color: var(--focus); text-decoration-thickness: 2px; text-underline-offset: 3px; }
    a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .apps { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
    .app { padding: 1.1rem 1.25rem; background: var(--surface); border: 1px solid var(--border); border-top: 6px solid var(--app-accent); border-radius: 8px; }
    .app h3 { font-size: 1.35rem; }
    .app a { text-decoration-color: var(--app-accent); }
    .app p { margin-top: 0.4rem; }
    .run { color: var(--muted); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
    .muted { color: var(--muted); }
    @media (max-width: 640px) { header div, main { padding: 1.25rem 1rem; } h1 { font-size: 1.75rem; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Graveyard Shift</h1>
      <p>Watch-and-warn apps that run entirely on GitHub</p>
    </div>
  </header>
  <main>
    <p>Each app asks two independent public sources the same question on a schedule. A finding is confirmed only when both sources report it; a finding only one source reports is shown, but never raises an alert. Findings are JSON files committed to the repository, so git history is the audit trail.</p>
    <h2>Apps</h2>
    <ul class="apps">
${cards}
    </ul>
    <p class="muted">Every app is one sources file, one rules file, one config file and a theme on top of the same skeleton: runner, agreement rule, JSON store, dashboard, MCP server and GitHub issue notifier.</p>
    ${repository}
  </main>
</body>
</html>
`;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function appNames() {
  const appsDir = path.join(root, 'apps');
  const names = [];
  for (const entry of await readdir(appsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(path.join(appsDir, entry.name, 'package.json')))) names.push(entry.name);
  }
  return names.sort();
}

async function buildApp(name, outDir) {
  const appDir = path.join(root, 'apps', name);
  const appOut = path.join(outDir, name);
  const result = spawnSync(process.execPath, [cli, 'site', appDir, appOut], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`graveyard-shift site failed for ${name}: ${(result.stderr || result.stdout).trim()}`);
  }
  for (const file of DATA_FILES) {
    const source = path.join(appDir, 'data', file);
    if (await exists(source)) await copyFile(source, path.join(appOut, file));
    else await writeFile(path.join(appOut, file), '[]\n');
  }
  const theme = JSON.parse(await readFile(path.join(appOut, 'theme.json'), 'utf8'));
  const runs = JSON.parse(await readFile(path.join(appOut, 'runs.json'), 'utf8'));
  return { slug: name, theme, lastRun: Array.isArray(runs) && runs.length > 0 ? runs[runs.length - 1] : null };
}

export function isSafeOutDir(outDir) {
  const resolved = path.resolve(outDir);
  if (resolved === path.parse(resolved).root) return false;
  return resolved !== root && !root.startsWith(resolved + path.sep);
}

export async function buildPages(outDir) {
  if (!isSafeOutDir(outDir)) throw new Error(`Refusing to replace ${outDir}: it is the repository or one of its parents`);
  await rm(outDir, { recursive: true, force: true });
  const apps = [];
  for (const name of await appNames()) apps.push(await buildApp(name, outDir));
  const pkg = JSON.parse(await readFile(path.join(root, 'skeleton', 'package.json'), 'utf8'));
  await writeFile(path.join(outDir, 'index.html'), renderIndex(apps, pkg.repository?.url));
  return apps.map((app) => app.slug);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(root, 'site'));
  const built = await buildPages(outDir);
  console.log(`Built ${outDir} with ${built.length} app(s): ${built.join(', ')}`);
}
