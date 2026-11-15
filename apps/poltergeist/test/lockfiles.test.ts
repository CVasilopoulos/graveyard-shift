import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '../src/config.js';
import { findingId, loadPackageVersions, rawLockfileUrl } from '../src/lockfiles.js';
import { demoFile, loadFixture, mockFetch, serveLockfiles } from './mockFetch.js';

const NPM_LOCK = 'apps/poltergeist/demo/haunted-house/package-lock.json';
const PIP_LOCK = 'apps/poltergeist/demo/haunted-house/requirements.txt';

function demoConfig() {
  return configSchema.parse({
    targets: [{ owner: 'CVasilopoulos', repo: 'graveyard-shift', lockfiles: [NPM_LOCK, PIP_LOCK] }],
  });
}

const demoContents = () => ({ [NPM_LOCK]: demoFile('package-lock.json'), [PIP_LOCK]: demoFile('requirements.txt') });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lockfiles', () => {
  it('reads lockfiles from raw.githubusercontent.com at the configured ref', () => {
    expect(rawLockfileUrl({ owner: 'o', repo: 'r', ref: 'release/2.x', lockfiles: [] }, 'web/package-lock.json')).toBe(
      'https://raw.githubusercontent.com/o/r/release/2.x/web/package-lock.json',
    );
  });

  it('lists every pinned package version of the demo lockfiles with its repository and ecosystem', async () => {
    const config = demoConfig();
    mockFetch(serveLockfiles(config, demoContents()));

    const packages = await loadPackageVersions(config);

    expect(packages).toEqual([
      { owner: 'CVasilopoulos', repo: 'graveyard-shift', ecosystem: 'npm', name: 'express', version: '4.17.1' },
      { owner: 'CVasilopoulos', repo: 'graveyard-shift', ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { owner: 'CVasilopoulos', repo: 'graveyard-shift', ecosystem: 'npm', name: 'minimist', version: '1.2.5' },
      { owner: 'CVasilopoulos', repo: 'graveyard-shift', ecosystem: 'PyPI', name: 'requests', version: '2.25.0' },
      { owner: 'CVasilopoulos', repo: 'graveyard-shift', ecosystem: 'PyPI', name: 'pandas', version: '1.0.3' },
    ]);
  });

  it('fetches each lockfile once per run and shares the result between both sources', async () => {
    const config = demoConfig();
    const requests = mockFetch([...serveLockfiles(config, demoContents()), ...serveLockfiles(config, demoContents())]);

    const [first, second] = await Promise.all([loadPackageVersions(config), loadPackageVersions(config)]);

    expect(second).toBe(first);
    expect(requests).toHaveLength(2);
  });

  it('fetches the lockfiles again for the next run', async () => {
    const requests = mockFetch([...serveLockfiles(demoConfig(), demoContents()), ...serveLockfiles(demoConfig(), demoContents())]);

    await loadPackageVersions(demoConfig());
    await loadPackageVersions(demoConfig());

    expect(requests).toHaveLength(4);
  });

  it('fetches a lockfile listed twice for the same repository and ref only once', async () => {
    const config = configSchema.parse({
      targets: [
        { owner: 'o', repo: 'r', lockfiles: ['requirements.txt'] },
        { owner: 'o', repo: 'r', ref: 'main', lockfiles: ['requirements.txt'] },
      ],
    });
    const requests = mockFetch(serveLockfiles(config, { 'requirements.txt': 'requests==2.25.0\n' }).slice(0, 1));

    const packages = await loadPackageVersions(config);

    expect(requests).toHaveLength(1);
    expect(packages).toHaveLength(1);
  });

  it('names the repository and path when a lockfile answers 404', async () => {
    const config = demoConfig();
    const notFound = loadFixture('raw/lockfile-404.json');
    mockFetch([...notFound, ...serveLockfiles(config, demoContents()).filter((exchange) => exchange.url !== notFound[0].url)]);

    await expect(loadPackageVersions(config)).rejects.toThrow(
      `Could not fetch lockfile ${NPM_LOCK} in CVasilopoulos/graveyard-shift@main: HTTP 404`,
    );
  });

  it('names the repository and path when a lockfile cannot be parsed', async () => {
    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', ref: 'dev', lockfiles: ['package-lock.json'] }] });
    mockFetch(serveLockfiles(config, { 'package-lock.json': '{"lockfileVersion": 1, "dependencies": {}}' }));

    await expect(loadPackageVersions(config)).rejects.toThrow(/^Could not parse lockfile package-lock.json in o\/r@dev: /);
  });

  it('builds finding ids from the repository, ecosystem, package, version and advisory', () => {
    expect(
      findingId({ owner: 'o', repo: 'r', ecosystem: 'PyPI', name: 'Flask_Login', version: '0.6.2' }, 'GHSA-xxxx-yyyy-zzzz'),
    ).toBe('poltergeist:o/r:PyPI:flask-login@0.6.2:GHSA-xxxx-yyyy-zzzz');
  });
});
