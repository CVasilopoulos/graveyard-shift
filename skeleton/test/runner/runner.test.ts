import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { runApp, type RunnerOptions } from '../../src/core/runner.js';
import { mergeById } from '../../src/core/mergeById.js';
import { notify } from '../../src/notify/notifier.js';
import type { AppDefinition, Finding, SourceResult } from '../../src/core/types.js';

vi.mock('../../src/notify/notifier.js', () => ({ notify: vi.fn(async () => {}) }));

const configSchema = z.object({
  items: z.record(z.string(), z.array(z.string())),
  failing: z.array(z.string()).default([]),
  repo: z.string().optional(),
  maxNewIssues: z.number().optional(),
  maxNewPRs: z.number().optional(),
});
type Config = z.infer<typeof configSchema>;

function source(name: string) {
  const fetch = async (config: Config): Promise<SourceResult> => {
    if (config.failing.includes(name)) throw new Error(`${name} is down`);
    return {
      sourceName: name,
      fetchedAt: new Date().toISOString(),
      findings: (config.items[name] ?? []).map((id) => ({ id, title: `${id} seen by ${name}` })),
    };
  };
  Object.defineProperty(fetch, 'name', { value: name });
  return fetch;
}

const app: AppDefinition<typeof configSchema> = {
  sources: [source('alpha'), source('beta')],
  rules: (results) =>
    mergeById(results).map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.title,
      severity: 'low' as const,
      status: 'ghost' as const,
      sources: m.sources,
      evidence: m.evidence,
    })),
  configSchema,
  theme: { name: 'Test', tagline: 'Test', accentColor: '#000000' },
};

const T1 = '2026-11-01T00:00:00.000Z';
const T2 = '2026-11-02T00:00:00.000Z';
const T3 = '2026-11-03T00:00:00.000Z';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runapp-'));
  vi.mocked(notify).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(config: Record<string, unknown>, at: string, extra: Partial<RunnerOptions> = {}) {
  vi.setSystemTime(new Date(at));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  await runApp(app, { appDir: dir, dataDir: path.join(dir, 'data'), configPath, dryRun: true, ...extra });
}

async function readData<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(dir, 'data', name), 'utf-8')) as T;
}

async function findingsById(): Promise<Record<string, Finding>> {
  const findings = await readData<Finding[]>('findings.json');
  return Object.fromEntries(findings.map((f) => [f.id, f]));
}

describe('runApp', () => {
  it('confirms a finding two sources report and keeps a single-source finding as a ghost', async () => {
    await run({ items: { alpha: ['a', 'b'], beta: ['a'] } }, T1);
    const raw = await fs.readFile(path.join(dir, 'data', 'findings.json'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const f = await findingsById();
    expect(Object.keys(f)).toEqual(['a', 'b']);
    expect(f.a.status).toBe('confirmed');
    expect(f.a.sources.sort()).toEqual(['alpha', 'beta']);
    expect(f.b.status).toBe('ghost');
    expect(f.a.firstSeen).toBe(T1);
    expect(f.a.lastSeen).toBe(T1);
    expect('resolvedAt' in f.a).toBe(false);
  });

  it('keeps firstSeen and moves lastSeen on a later run', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T2);
    const f = await findingsById();
    expect(f.a.firstSeen).toBe(T1);
    expect(f.a.lastSeen).toBe(T2);
  });

  it('resolves a vanished finding once and keeps its resolvedAt on later runs', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: {} }, T2);
    expect((await findingsById()).a.resolvedAt).toBe(T2);
    await run({ items: {} }, T3);
    expect((await findingsById()).a.resolvedAt).toBe(T2);
    const history = await readData<Array<{ resolved: string[] }>>('history.json');
    expect(history.map((h) => h.resolved)).toEqual([[], ['a'], []]);
  });

  it('reports a resolved finding that comes back as appeared and clears its resolvedAt', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: {} }, T2);
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T3);
    const f = await findingsById();
    expect('resolvedAt' in f.a).toBe(false);
    expect(f.a.firstSeen).toBe(T1);
    expect(f.a.lastSeen).toBe(T3);
    const history = await readData<Array<{ appeared: string[] }>>('history.json');
    expect(history[2].appeared).toEqual(['a']);
  });

  it('purges resolved findings older than the retention window', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: {} }, T2);
    await run({ items: {} }, '2026-11-16T00:00:00.000Z');
    expect((await findingsById()).a).toBeDefined();
    await run({ items: {} }, '2026-11-16T00:00:01.000Z');
    expect((await findingsById()).a).toBeUndefined();
  });

  it('carries an erroring source previous evidence forward with its error', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: { alpha: ['a'] }, failing: ['beta'] }, T2);
    const f = await findingsById();
    expect(f.a.status).toBe('confirmed');
    expect(f.a.stale).toBe(true);
    const beta = f.a.evidence.find((e) => e.sourceName === 'beta');
    expect(beta?.text).toBe('a seen by beta');
    expect(beta?.staleError).toBe('beta is down');
    expect(f.a.evidence.find((e) => e.sourceName === 'alpha')?.staleError).toBeUndefined();
    const runs = await readData<Array<{ errorSources: string[] }>>('runs.json');
    expect(runs[1].errorSources).toEqual(['beta']);
  });

  it('does not revive a resolved finding from an erroring source', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    await run({ items: { alpha: ['x'], beta: ['x'] } }, T2);
    await run({ items: { alpha: ['x'] }, failing: ['beta'] }, T3);
    const f = await findingsById();
    expect(f.a.resolvedAt).toBe(T2);
    expect(f.x.status).toBe('confirmed');
  });

  it('writes only runs.json and throws when every source fails', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T1);
    const before = await fs.readFile(path.join(dir, 'data', 'findings.json'), 'utf-8');
    await expect(run({ items: {}, failing: ['alpha', 'beta'] }, T2)).rejects.toThrow(/All sources failed/);
    expect(await fs.readFile(path.join(dir, 'data', 'findings.json'), 'utf-8')).toBe(before);
    expect(await readData<unknown[]>('history.json')).toHaveLength(1);
    const runs = await readData<Array<{ errorSources: string[] }>>('runs.json');
    expect(runs).toHaveLength(2);
    expect(runs[1].errorSources.sort()).toEqual(['alpha', 'beta']);
  });

  it('passes repo and caps from the config to the notifier with the dry-run flag', async () => {
    await run({ items: { alpha: ['a'], beta: ['a'] }, repo: 'me/app', maxNewIssues: 2, maxNewPRs: 1 }, T1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][2]).toEqual({ dryRun: true, repo: 'me/app', maxNewIssues: 2, maxNewPRs: 1 });
    await run({ items: { alpha: ['a'], beta: ['a'] } }, T2, { dryRun: false });
    expect(vi.mocked(notify).mock.calls[1][2]).toEqual({ dryRun: false });
  });

  it('passes the theme issue prefix to the notifier', async () => {
    vi.setSystemTime(new Date(T1));
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ items: { alpha: ['a'], beta: ['a'] } }));
    const prefixed = { ...app, theme: { ...app.theme, issuePrefix: '👻' } };
    await runApp(prefixed, { appDir: dir, dataDir: path.join(dir, 'data'), configPath, dryRun: true });
    expect(vi.mocked(notify).mock.calls[0][2]).toEqual({ dryRun: true, issuePrefix: '👻' });
  });

  it('rejects an invalid config and names the failing field on stderr', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run({ items: 'nope' }, T1)).rejects.toThrow(/Config validation failed/);
    expect(stderr.mock.calls.flat().join('\n')).toContain('"items"');
    await expect(fs.access(path.join(dir, 'data', 'findings.json'))).rejects.toThrow();
  });
});
