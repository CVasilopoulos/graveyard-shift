import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type Config } from '../../src/config.js';
import { osv, OSV_QUERYBATCH_URL, type OsvDetails } from '../../src/sources/osv.js';
import { demoFile, loadFixture, mockFetch, serveLockfiles, type Exchange } from '../mockFetch.js';

const NPM_LOCK = 'apps/poltergeist/demo/haunted-house/package-lock.json';
const PIP_LOCK = 'apps/poltergeist/demo/haunted-house/requirements.txt';

function demoConfig(repos: string[] = ['graveyard-shift']): Config {
  return configSchema.parse({
    targets: repos.map((repo) => ({ owner: 'CVasilopoulos', repo, lockfiles: [NPM_LOCK, PIP_LOCK] })),
  });
}

function demoLockfiles(config: Config): Exchange[] {
  return serveLockfiles(config, { [NPM_LOCK]: demoFile('package-lock.json'), [PIP_LOCK]: demoFile('requirements.txt') });
}

function singleNpmPackage(name: string, version: string): { config: Config; lockfiles: Exchange[] } {
  const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
  const lockfile = JSON.stringify({
    lockfileVersion: 3,
    packages: { '': { name: 'r' }, [`node_modules/${name}`]: { version } },
  });
  return { config, lockfiles: serveLockfiles(config, { 'package-lock.json': lockfile }) };
}

function vulnsFrom(fixture: Exchange[]): Exchange[] {
  return fixture.filter((exchange) => exchange.method === 'GET');
}

function details(finding: { details?: Record<string, unknown> }): OsvDetails {
  return finding.details as unknown as OsvDetails;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('osv source', () => {
  it('sends every distinct package version in one querybatch and emits one finding per listed advisory', async () => {
    const config = demoConfig();
    const chunk = loadFixture('osv/querybatch-chunk.json');
    const requests = mockFetch([...demoLockfiles(config), ...chunk]);

    const result = await osv(config);

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(OSV_QUERYBATCH_URL);
    expect(posts[0].body).toEqual(chunk[0].requestBody);
    expect(result.sourceName).toBe('osv');
    expect(result.findings).toHaveLength(17);
    expect(result.findings.map((finding) => finding.id)).toContain(
      'poltergeist:CVasilopoulos/graveyard-shift:npm:express@4.17.1:GHSA-qw6h-vgh9-j6wx',
    );
    expect(result.findings.map((finding) => finding.id)).toContain(
      'poltergeist:CVasilopoulos/graveyard-shift:PyPI:pandas@1.0.3:PYSEC-2020-73',
    );
  });

  it('carries the OSV id, aliases, severity data and fixed versions for the installed package', async () => {
    const config = demoConfig();
    mockFetch([...demoLockfiles(config), ...loadFixture('osv/querybatch-chunk.json')]);

    const result = await osv(config);

    const express = details(result.findings.find((finding) => finding.id.endsWith(':GHSA-qw6h-vgh9-j6wx'))!);
    expect(express).toMatchObject({
      owner: 'CVasilopoulos',
      repo: 'graveyard-shift',
      ecosystem: 'npm',
      name: 'express',
      version: '4.17.1',
      id: 'GHSA-qw6h-vgh9-j6wx',
      aliases: ['CVE-2024-43796'],
      database_specific: { severity: 'LOW' },
    });
    expect(express.fixed.sort()).toEqual(['4.20.0', '5.0.0']);
    expect(express.severity.map((entry) => entry.type)).toContain('CVSS_V3');
    expect(express.summary).toBeTruthy();
    expect(express.description).toBeTruthy();
  });

  it('ignores commit hashes from GIT ranges when listing fixed versions', async () => {
    const config = demoConfig();
    mockFetch([...demoLockfiles(config), ...loadFixture('osv/querybatch-chunk.json')]);

    const result = await osv(config);

    const pysec = details(result.findings.find((finding) => finding.id.endsWith(':PYSEC-2023-74'))!);
    expect(pysec.aliases).toContain('GHSA-j8r2-6x86-q33q');
    expect(pysec.fixed).toEqual(['2.31.0']);
  });

  it('keeps a CVE-only advisory under its own OSV id with its CVE alias', async () => {
    const config = demoConfig();
    mockFetch([...demoLockfiles(config), ...loadFixture('osv/querybatch-chunk.json')]);

    const result = await osv(config);

    const pandas = details(result.findings.find((finding) => finding.id.endsWith(':PYSEC-2020-73'))!);
    expect(pandas.aliases).toEqual(['CVE-2020-13091']);
    expect(pandas.fixed).toEqual(['1.0.4']);
    expect(pandas.database_specific).toBeUndefined();
  });

  it('fetches each advisory once per run and emits it for every repository that installs the version', async () => {
    const config = demoConfig(['graveyard-shift', 'haunted-twin']);
    const requests = mockFetch([...demoLockfiles(config), ...loadFixture('osv/querybatch-chunk.json')]);

    const result = await osv(config);

    const vulnGets = requests.filter((request) => request.url.startsWith('https://api.osv.dev/v1/vulns/'));
    expect(vulnGets).toHaveLength(17);
    expect(new Set(vulnGets.map((request) => request.url)).size).toBe(17);
    expect(requests.filter((request) => request.method === 'POST')[0].body).toEqual(
      loadFixture('osv/querybatch-chunk.json')[0].requestBody,
    );
    expect(result.findings).toHaveLength(34);
    expect(result.findings.filter((finding) => finding.id.includes('/haunted-twin:'))).toHaveLength(17);
  });

  it('follows next_page_token until OSV stops returning one', async () => {
    const { config, lockfiles } = singleNpmPackage('lodash', '4.17.15');
    const chunk = loadFixture('osv/querybatch-chunk.json');
    const lodashIds = (chunk[0].respondWith.body as { results: Array<{ vulns: Array<{ id: string; modified: string }> }> })
      .results[1].vulns;
    const firstPage: Exchange = {
      method: 'POST',
      url: OSV_QUERYBATCH_URL,
      respondWith: { status: 200, body: { results: [{ vulns: lodashIds.slice(0, 3), next_page_token: 'page-2' }] } },
    };
    const secondPage: Exchange = {
      method: 'POST',
      url: OSV_QUERYBATCH_URL,
      respondWith: { status: 200, body: { results: [{ vulns: lodashIds.slice(3) }] } },
    };
    const requests = mockFetch([...lockfiles, firstPage, secondPage, ...vulnsFrom(chunk)]);

    const result = await osv(config);

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((request) => request.body)).toEqual([
      { queries: [{ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' }] },
      { queries: [{ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15', page_token: 'page-2' }] },
    ]);
    expect(result.findings.map((finding) => details(finding).id).sort()).toEqual(lodashIds.map((vuln) => vuln.id).sort());
  });

  it('splits more than 1000 package versions into several querybatch requests', async () => {
    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['requirements.txt'] }] });
    const requirements = Array.from({ length: 1001 }, (_, index) => `package-${index}==1.0.0`).join('\n');
    const empty = (count: number): Exchange => ({
      method: 'POST',
      url: OSV_QUERYBATCH_URL,
      respondWith: { status: 200, body: { results: Array.from({ length: count }, () => ({})) } },
    });
    const requests = mockFetch([
      ...serveLockfiles(config, { 'requirements.txt': requirements }),
      empty(1000),
      empty(1),
    ]);

    const result = await osv(config);

    const sizes = requests
      .filter((request) => request.method === 'POST')
      .map((request) => (request.body as { queries: unknown[] }).queries.length);
    expect(sizes).toEqual([1000, 1]);
    expect(result.findings).toEqual([]);
  });

  it('skips an advisory that OSV marks as withdrawn', async () => {
    const { config, lockfiles } = singleNpmPackage('express', '4.17.1');
    const batch: Exchange = {
      method: 'POST',
      url: OSV_QUERYBATCH_URL,
      respondWith: { status: 200, body: { results: [{ vulns: [{ id: 'GHSA-pj86-cfqh-vqx6' }] }] } },
    };
    mockFetch([...lockfiles, batch, ...loadFixture('osv/vulns-withdrawn.json')]);

    const result = await osv(config);

    expect(result.findings).toEqual([]);
  });

  it('skips an advisory id that OSV answers with 404', async () => {
    const { config, lockfiles } = singleNpmPackage('express', '4.17.1');
    const batch: Exchange = {
      method: 'POST',
      url: OSV_QUERYBATCH_URL,
      respondWith: { status: 200, body: { results: [{ vulns: [{ id: 'GHSA-0000-0000-0000' }] }] } },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch([...lockfiles, batch, ...loadFixture('osv/vulns-404.json')]);

    const result = await osv(config);

    expect(result.findings).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toContain('GHSA-0000-0000-0000');
  });

  it('reports no fixed versions when OSV lists none', async () => {
    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['requirements.txt'] }] });
    mockFetch([
      ...serveLockfiles(config, { 'requirements.txt': 'diskcache==5.6.3\n' }),
      ...loadFixture('osv/vulns-no-fixed.json'),
    ]);

    const result = await osv(config);

    expect(result.findings.map((finding) => details(finding).id).sort()).toEqual(['GHSA-w8v5-vhqr-4h9v', 'PYSEC-2026-2447']);
    expect(result.findings.every((finding) => details(finding).fixed.length === 0)).toBe(true);
  });

  it('fails with the repository and path when a lockfile cannot be fetched', async () => {
    const config = demoConfig();
    const notFound = loadFixture('raw/lockfile-404.json');
    mockFetch([...notFound, ...demoLockfiles(config).filter((exchange) => exchange.url !== notFound[0].url)]);

    await expect(osv(config)).rejects.toThrow(
      `Could not fetch lockfile ${NPM_LOCK} in CVasilopoulos/graveyard-shift@main: HTTP 404`,
    );
  });
});
