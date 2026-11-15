import { describe, expect, it } from 'vitest';
import type { SourceResult } from 'graveyard-shift';
import { rules } from '../../src/rules.js';
import { configSchema } from '../../src/config.js';

function osvFinding(id: string, details: Record<string, unknown>): SourceResult['findings'][0] {
  return {
    id,
    title: `OSV ${id}: summary`,
    details,
  };
}

function githubFinding(id: string, details: Record<string, unknown>): SourceResult['findings'][0] {
  return {
    id,
    title: `GitHub ${details.ghsa_id}: summary`,
    details,
  };
}

describe('rules fix version', () => {
  it('uses lowest shared fixed version when both sources have shared versions', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: ['1.0.1', '1.0.2', '1.0.3'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceName: 'github',
        findings: [
          githubFinding('poltergeist:o/r:npm:pkg@1.0.0:GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            ghsa_id: 'GHSA-1234-5678-9abc',
            cve_id: 'CVE-2023-1234',
            fixed_versions: ['1.0.2', '1.0.4'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toEqual({ text: 'Fixed in version', value: '1.0.2' });
  });

  it('uses higher of two versions when sources have no shared versions', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: ['1.0.2'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceName: 'github',
        findings: [
          githubFinding('poltergeist:o/r:npm:pkg@1.0.0:GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            ghsa_id: 'GHSA-1234-5678-9abc',
            cve_id: 'CVE-2023-1234',
            fixed_versions: ['1.0.4'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toEqual({ text: 'GitHub: 1.0.4, OSV: 1.0.2', value: '1.0.4' });
  });

  it('uses source-specific fix when only one source lists versions', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: ['1.0.2'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      { sourceName: 'github', findings: [], fetchedAt: new Date().toISOString() },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toEqual({ text: 'OSV: 1.0.2', value: '1.0.2' });
  });

  it('no fix when neither source lists versions', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: [],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      { sourceName: 'github', findings: [], fetchedAt: new Date().toISOString() },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toBeUndefined();
  });

  it('filters out fixed versions not above installed version', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '2.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: ['1.0.2', '2.0.1', '2.1.0'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceName: 'github',
        findings: [
          githubFinding('poltergeist:o/r:npm:pkg@2.0.0:GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '2.0.0',
            ghsa_id: 'GHSA-1234-5678-9abc',
            cve_id: 'CVE-2023-1234',
            fixed_versions: ['2.0.1', '2.1.0'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toEqual({ text: 'Fixed in version', value: '2.0.1' });
  });

  it('handles multiple fixed versions from GitHub and OSV', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'GHSA-1234-5678-9abc',
            aliases: [],
            severity: [],
            fixed: ['1.0.1', '1.0.5', '1.1.0'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceName: 'github',
        findings: [
          githubFinding('poltergeist:o/r:npm:pkg@1.0.0:GHSA-1234-5678-9abc', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            ghsa_id: 'GHSA-1234-5678-9abc',
            cve_id: 'CVE-2023-1234',
            fixed_versions: ['1.0.3', '1.0.5', '1.2.0'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].fix).toEqual({ text: 'Fixed in version', value: '1.0.5' });
  });
});
