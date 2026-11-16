import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, isSafeOutDir, renderIndex, safeColor } from './build-site.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const poltergeist = {
  slug: 'poltergeist',
  theme: {
    name: 'Poltergeist',
    tagline: 'Something is rattling in your lockfile',
    accentColor: '#8b5cf6',
    labels: { confirmed: 'haunting', ghost: 'ghost', resolved: 'laid to rest' },
  },
  lastRun: { runAt: '2026-11-16T05:17:00.000Z', confirmedCount: 12, ghostCount: 1, resolvedCount: 0, errorSources: [] },
};

describe('landing page', () => {
  it('links every app to its own dashboard folder with its name, tagline and last run', () => {
    const html = renderIndex([poltergeist], 'https://github.com/CVasilopoulos/graveyard-shift');

    expect(html).toContain('<a href="poltergeist/">Poltergeist</a>');
    expect(html).toContain('Something is rattling in your lockfile');
    expect(html).toContain('haunting: 12 · ghost: 1 · laid to rest: 0');
    expect(html).toContain('<time datetime="2026-11-16T05:17:00.000Z">2026-11-16T05:17:00.000Z</time>');
    expect(html).toContain('href="https://github.com/CVasilopoulos/graveyard-shift"');
  });

  it('names the sources that failed in the last run', () => {
    const failing = { ...poltergeist, lastRun: { ...poltergeist.lastRun, errorSources: ['osv', 'github'] } };

    expect(renderIndex([failing])).toContain('failed sources: osv, github');
  });

  it('says when an app has not run yet and falls back to the default status words', () => {
    const fresh = { slug: 'seance', theme: { name: 'Seance', tagline: 'Calling dead links back', accentColor: '#f59e0b' }, lastRun: null };

    const html = renderIndex([fresh]);

    expect(html).toContain('No runs recorded yet.');
    expect(html).not.toContain('undefined');
  });

  it('escapes theme text so an app name cannot inject markup', () => {
    const hostile = {
      slug: 'x"><script>',
      theme: { name: '<img src=x onerror=alert(1)>', tagline: '"quoted" & <b>', accentColor: 'red;background:url(x)' },
      lastRun: null,
    };

    const html = renderIndex([hostile]);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
    expect(html).toContain('--app-accent: #8b5cf6');
  });
});

describe('landing page helpers', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('accepts only hex colours for the accent', () => {
    expect(safeColor('#F59E0B')).toBe('#F59E0B');
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('rgb(1,2,3)')).toBe('#8b5cf6');
    expect(safeColor(undefined)).toBe('#8b5cf6');
  });

  it('refuses to replace the repository, its parents or the filesystem root', () => {
    expect(isSafeOutDir(repoRoot)).toBe(false);
    expect(isSafeOutDir(path.dirname(repoRoot))).toBe(false);
    expect(isSafeOutDir(path.parse(repoRoot).root)).toBe(false);
    expect(isSafeOutDir(path.join(repoRoot, 'site'))).toBe(true);
  });
});
