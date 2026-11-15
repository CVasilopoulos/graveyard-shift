import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type Config } from '../../src/config.js';
import { advisoriesUrl, github, nextLink, type GithubDetails } from '../../src/sources/github.js';
import { demoFile, loadFixture, mockFetch, serveLockfiles, type Exchange } from '../mockFetch.js';

const NPM_LOCK = 'apps/poltergeist/demo/haunted-house/package-lock.json';
const PIP_LOCK = 'apps/poltergeist/demo/haunted-house/requirements.txt';

function demoConfig(): Config {
  return configSchema.parse({
    targets: [{ owner: 'CVasilopoulos', repo: 'graveyard-shift', lockfiles: [NPM_LOCK, PIP_LOCK] }],
  });
}

function demoExchanges(config: Config): Exchange[] {
  return [
    ...serveLockfiles(config, { [NPM_LOCK]: demoFile('package-lock.json'), [PIP_LOCK]: demoFile('requirements.txt') }),
    ...loadFixture('github/advisories-npm.json'),
    ...loadFixture('github/advisories-pip.json'),
  ];
}

function details(finding: { details?: Record<string, unknown> }): GithubDetails {
  return finding.details as unknown as GithubDetails;
}

let savedToken: string | undefined;

beforeEach(() => {
  savedToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
  vi.unstubAllGlobals();
});

describe('github source', () => {
  it('asks the advisory database once per package version with ecosystem, affects and per_page', async () => {
    const config = demoConfig();
    const requests = mockFetch(demoExchanges(config));

    await github(config);

    const advisoryUrls = requests.map((request) => request.url).filter((url) => url.startsWith('https://api.github.com/'));
    expect(advisoryUrls.sort()).toEqual([
      'https://api.github.com/advisories?ecosystem=npm&affects=express%404.17.1&per_page=100',
      'https://api.github.com/advisories?ecosystem=npm&affects=lodash%404.17.15&per_page=100',
      'https://api.github.com/advisories?ecosystem=npm&affects=minimist%401.2.5&per_page=100',
      'https://api.github.com/advisories?ecosystem=pip&affects=pandas%401.0.3&per_page=100',
      'https://api.github.com/advisories?ecosystem=pip&affects=requests%402.25.0&per_page=100',
    ]);
  });

  it('emits every advisory GitHub lists except withdrawn ones', async () => {
    const config = demoConfig();
    mockFetch(demoExchanges(config));

    const result = await github(config);

    expect(result.sourceName).toBe('github');
    const ghsaIds = result.findings.map((finding) => details(finding).ghsa_id).sort();
    expect(ghsaIds).toEqual([
      'GHSA-29mw-wpgm-hmr9',
      'GHSA-35jh-r3h4-6jhm',
      'GHSA-9hjg-9r4m-mvj7',
      'GHSA-9wx4-h78v-vm56',
      'GHSA-gc5v-m9x4-r6x2',
      'GHSA-j8r2-6x86-q33q',
      'GHSA-p6mc-m468-83gw',
      'GHSA-qw6h-vgh9-j6wx',
      'GHSA-r5fr-rjxr-66jc',
      'GHSA-rv95-896h-c2vc',
      'GHSA-xvch-5gv4-984h',
      'GHSA-xxjr-mmjv-4gpg',
    ]);
    expect(ghsaIds).not.toContain('GHSA-pj86-cfqh-vqx6');
    expect(ghsaIds).not.toContain('GHSA-8p5q-j9m2-g8wr');
  });

  it('carries ghsa_id, cve_id, severity and the patched versions of the installed package', async () => {
    const config = demoConfig();
    mockFetch(demoExchanges(config));

    const result = await github(config);

    const express = result.findings.find((finding) => details(finding).ghsa_id === 'GHSA-qw6h-vgh9-j6wx')!;
    expect(express.id).toBe('poltergeist:CVasilopoulos/graveyard-shift:npm:express@4.17.1:GHSA-qw6h-vgh9-j6wx');
    expect(details(express)).toMatchObject({
      ecosystem: 'npm',
      name: 'express',
      version: '4.17.1',
      cve_id: 'CVE-2024-43796',
      severity: 'low',
    });
    expect(details(express).fixed_versions.sort()).toEqual(['4.20.0', '5.0.0']);
    expect(details(express).summary).toBeTruthy();
    expect(details(express).description).toBeTruthy();
  });

  it('ignores patched versions listed for other packages in the same advisory', async () => {
    const config = demoConfig();
    mockFetch(demoExchanges(config));

    const result = await github(config);

    const lodash = result.findings.find((finding) => details(finding).ghsa_id === 'GHSA-p6mc-m468-83gw')!;
    expect(details(lodash).fixed_versions).toEqual(['4.17.19']);
  });

  it('follows Link rel="next" pages until the last one', async () => {
    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['requirements.txt'] }] });
    const pages = loadFixture('github/advisories-paginated.json');
    const requests = mockFetch([...serveLockfiles(config, { 'requirements.txt': 'tensorflow==2.9.0\n' }), ...pages]);

    const result = await github(config);

    expect(requests.slice(1).map((request) => request.url)).toEqual(pages.map((page) => page.url));
    const listed = pages.flatMap((page) => page.respondWith.body as Array<{ ghsa_id: string; withdrawn_at: string | null }>);
    expect(listed.length).toBeGreaterThan(100);
    expect(result.findings.map((finding) => details(finding).ghsa_id).sort()).toEqual(
      listed.filter((advisory) => !advisory.withdrawn_at).map((advisory) => advisory.ghsa_id).sort(),
    );
  });

  it('sends GITHUB_TOKEN as a Bearer token when it is set', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const config = demoConfig();
    const requests = mockFetch(demoExchanges(config));

    await github(config);

    const advisoryRequests = requests.filter((request) => request.url.startsWith('https://api.github.com/'));
    expect(advisoryRequests.every((request) => request.headers.Authorization === 'Bearer test-token')).toBe(true);
    expect(advisoryRequests[0].headers.Accept).toBe('application/vnd.github+json');
  });

  it('sends no Authorization header without GITHUB_TOKEN', async () => {
    const config = demoConfig();
    const requests = mockFetch(demoExchanges(config));

    await github(config);

    expect(requests.some((request) => 'Authorization' in request.headers)).toBe(false);
  });

  it('fails with the repository and path when a lockfile cannot be fetched', async () => {
    const config = demoConfig();
    const notFound = loadFixture('raw/lockfile-404.json');
    mockFetch([...notFound, ...demoExchanges(config).filter((exchange) => exchange.url !== notFound[0].url)]);

    await expect(github(config)).rejects.toThrow(
      `Could not fetch lockfile ${NPM_LOCK} in CVasilopoulos/graveyard-shift@main: HTTP 404`,
    );
  });
});

describe('advisory query helpers', () => {
  it('uses pip as the GitHub name of the PyPI ecosystem and normalises the package name', () => {
    expect(advisoriesUrl({ ecosystem: 'PyPI', name: 'Django_Rest.Framework', version: '3.0' })).toBe(
      'https://api.github.com/advisories?ecosystem=pip&affects=django-rest-framework%403.0&per_page=100',
    );
  });

  it('encodes scoped npm package names', () => {
    expect(advisoriesUrl({ ecosystem: 'npm', name: '@scope/pkg', version: '1.0.0' })).toBe(
      'https://api.github.com/advisories?ecosystem=npm&affects=%40scope%2Fpkg%401.0.0&per_page=100',
    );
  });

  it('reads the next page from a Link header and stops when there is none', () => {
    expect(
      nextLink('<https://api.github.com/advisories?after=abc>; rel="next", <https://api.github.com/advisories>; rel="first"'),
    ).toBe('https://api.github.com/advisories?after=abc');
    expect(nextLink('<https://api.github.com/advisories?before=abc>; rel="prev"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
});
