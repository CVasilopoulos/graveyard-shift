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

describe('rules severity', () => {
  it('uses GitHub severity when present', () => {
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
            fixed: ['1.0.1'],
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
            severity: 'critical',
            fixed_versions: ['1.0.1'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].severity).toBe('critical');
  });

  it('uses OSV database_specific severity when GitHub has none', () => {
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
            database_specific: { severity: 'HIGH' },
            fixed: ['1.0.1'],
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
            fixed_versions: ['1.0.1'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].severity).toBe('high');
  });

  it('computes severity from OSV CVSS score', () => {
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
            severity: [{ type: 'CVSS_V3', score: '8.5' }],
            fixed: ['1.0.1'],
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
            fixed_versions: ['1.0.1'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].severity).toBe('high');
  });

  it('defaults to info when no severity data is available', () => {
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
            fixed: ['1.0.1'],
          }),
        ],
        fetchedAt: new Date().toISOString(),
      },
      { sourceName: 'github', findings: [], fetchedAt: new Date().toISOString() },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].severity).toBe('info');
  });
});
