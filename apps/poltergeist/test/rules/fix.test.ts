import { describe, expect, it } from 'vitest';
import { rules } from '../../src/rules.js';
import { githubDetails, githubResult, osvDetails, osvResult } from './builders.js';

const ADVISORY = 'GHSA-1234-5678-9abc';

function fixFor(osvFixed: string[] | undefined, githubFixed: string[] | undefined, pkg: { ecosystem?: 'npm' | 'PyPI'; version?: string } = {}) {
  const results = [];
  if (osvFixed) results.push(osvResult(osvDetails({ id: ADVISORY, fixed: osvFixed, ...pkg })));
  if (githubFixed) results.push(githubResult(githubDetails({ ghsa_id: ADVISORY, fixed_versions: githubFixed, ...pkg })));
  return rules(results)[0].fix;
}

describe('fix version', () => {
  it('uses the lowest version both sources list', () => {
    expect(fixFor(['1.0.3', '1.0.2', '1.0.1'], ['1.0.4', '1.0.2'])).toEqual({
      value: '1.0.2',
      text: 'Upgrade pkg to 1.0.2 or later (OSV and GitHub agree).',
    });
  });

  it('uses the higher of the two lowest versions and says which source named which when they share none', () => {
    expect(fixFor(['1.0.1'], ['1.0.2', '2.0.0'])).toEqual({
      value: '1.0.2',
      text: 'Upgrade pkg to 1.0.2 or later: GitHub names 1.0.2, OSV names 1.0.1.',
    });
  });

  it('names the only source that gives a fixed version', () => {
    expect(fixFor([], ['1.0.5', '1.0.2'])).toEqual({ value: '1.0.2', text: 'Upgrade pkg to 1.0.2 or later (GitHub only).' });
    expect(fixFor(['1.0.3'], undefined)).toEqual({ value: '1.0.3', text: 'Upgrade pkg to 1.0.3 or later (OSV only).' });
  });

  it('has no fix when no source gives a fixed version', () => {
    expect(fixFor([], [])).toBeUndefined();
  });

  it('ignores fixed versions of older release lines that are not above the installed version', () => {
    expect(fixFor(['1.2.6', '0.2.4'], ['0.2.4', '1.2.6'], { version: '1.2.5' })?.value).toBe('1.2.6');
    expect(fixFor(['1.0.0'], ['0.9.9'], { version: '1.0.0' })).toBeUndefined();
  });

  it('compares npm versions as semver, numerically and with prereleases before releases', () => {
    expect(fixFor(['4.20.0', '5.0.0'], ['4.20.0', '5.0.0'], { version: '5.0.0-beta.1' })?.value).toBe('5.0.0');
    expect(fixFor(['10.0.0', '9.1.0'], ['9.1.0'], { version: '9.0.0' })?.value).toBe('9.1.0');
  });

  it('compares PyPI versions with PEP 440 ordering', () => {
    expect(fixFor(['1.0.post1'], ['1.0.post1'], { ecosystem: 'PyPI', version: '1.0' })?.value).toBe('1.0.post1');
    expect(fixFor(['2.0', '2.0rc1'], ['2.0rc1'], { ecosystem: 'PyPI', version: '1.9' })?.value).toBe('2.0rc1');
    expect(fixFor(['2.32.4'], ['2.32.4'], { ecosystem: 'PyPI', version: '2.32.4.dev0' })?.value).toBe('2.32.4');
  });

  it('treats equal versions written differently as shared', () => {
    expect(fixFor(['2.0'], ['2.0.0'], { ecosystem: 'PyPI', version: '1.0' })).toEqual({
      value: '2.0.0',
      text: 'Upgrade pkg to 2.0.0 or later (OSV and GitHub agree).',
    });
  });

  it('collects fixed versions from every OSV copy of the advisory', () => {
    const findings = rules([
      osvResult(
        osvDetails({ id: ADVISORY, aliases: ['PYSEC-2023-74'], fixed: [] }),
        osvDetails({ id: 'PYSEC-2023-74', aliases: [ADVISORY], fixed: ['1.4.0'] }),
      ),
    ]);
    expect(findings[0].fix?.value).toBe('1.4.0');
  });
});
