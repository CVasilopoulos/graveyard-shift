import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configSchema, ecosystemOf } from '../src/config.js';

const target = (lockfiles: string[], extra: Record<string, unknown> = {}) => ({
  targets: [{ owner: 'o', repo: 'r', lockfiles, ...extra }],
});

function issues(input: unknown): string[] {
  const result = configSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('config', () => {
  it('defaults the ref of a target to main', () => {
    expect(configSchema.parse(target(['package-lock.json'])).targets[0].ref).toBe('main');
  });

  it('keeps an explicit ref and the notifier fields', () => {
    const config = configSchema.parse({ ...target(['requirements.txt'], { ref: 'v2' }), repo: 'me/tracker', maxNewIssues: 3 });
    expect(config.targets[0].ref).toBe('v2');
    expect(config.repo).toBe('me/tracker');
    expect(config.maxNewIssues).toBe(3);
  });

  it('treats package-lock.json as npm and requirements*.txt as PyPI', () => {
    expect(ecosystemOf('web/package-lock.json')).toBe('npm');
    expect(ecosystemOf('requirements.txt')).toBe('PyPI');
    expect(ecosystemOf('backend/requirements-dev.txt')).toBe('PyPI');
    expect(ecosystemOf('yarn.lock')).toBeUndefined();
    expect(ecosystemOf('docs/requirements.in')).toBeUndefined();
    expect(ecosystemOf('requirements/base.txt')).toBeUndefined();
  });

  it('rejects an unsupported lockfile and names its path', () => {
    expect(issues(target(['package-lock.json', 'yarn.lock'])).join('\n')).toContain('"yarn.lock"');
  });

  it('rejects absolute paths and parent directory segments', () => {
    expect(issues(target(['/etc/requirements.txt']))).toHaveLength(1);
    expect(issues(target(['../requirements.txt']))).toHaveLength(1);
  });

  it('requires at least one target and at least one lockfile per target', () => {
    expect(issues({ targets: [] })).not.toEqual([]);
    expect(issues(target([]))).not.toEqual([]);
  });

  it('accepts the committed default config, which watches the demo lockfiles of this repository', () => {
    const raw = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf-8')) as unknown;
    const config = configSchema.parse(raw);
    expect(config.targets).toEqual([
      {
        owner: 'CVasilopoulos',
        repo: 'graveyard-shift',
        ref: 'main',
        lockfiles: [
          'apps/poltergeist/demo/haunted-house/package-lock.json',
          'apps/poltergeist/demo/haunted-house/requirements.txt',
        ],
      },
    ]);
  });
});
