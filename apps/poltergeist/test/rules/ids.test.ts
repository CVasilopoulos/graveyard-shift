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

describe('rules id canonicalisation', () => {
  it('uses GHSA id when OSV advisory id starts with GHSA-', () => {
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

    expect(findings[0].id).toBe('poltergeist:o/r:npm:pkg@1.0.0:GHSA-1234-5678-9abc');
  });

  it('uses lexicographically smallest GHSA alias when OSV has multiple aliases', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('PYSEC-2023-1', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'PYSEC-2023-1',
            aliases: ['GHSA-zzzz-1234-5678', 'GHSA-aaaa-1234-5678', 'GHSA-bbbb-1234-5678'],
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

    expect(findings[0].id).toBe('poltergeist:o/r:npm:pkg@1.0.0:GHSA-aaaa-1234-5678');
  });

  it('uses GitHub GHSA id when OSV is CVE-linked and GitHub has matching CVE', () => {
    const osvDetails = {
      owner: 'o',
      repo: 'r',
      ecosystem: 'npm',
      name: 'pkg',
      version: '1.0.0',
      id: 'PYSEC-2023-1',
      aliases: ['CVE-2023-1234'],
      severity: [],
      fixed: ['1.0.1'],
    };
    const githubDetails = {
      owner: 'o',
      repo: 'r',
      ecosystem: 'npm',
      name: 'pkg',
      version: '1.0.0',
      ghsa_id: 'GHSA-29mw-wpgm-hmr9',
      cve_id: 'CVE-2023-1234',
      fixed_versions: ['1.0.1'],
    };

    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [osvFinding('PYSEC-2023-1', osvDetails)],
        fetchedAt: new Date().toISOString(),
      },
      {
        sourceName: 'github',
        findings: [githubFinding('poltergeist:o/r:npm:pkg@1.0.0:GHSA-29mw-wpgm-hmr9', githubDetails)],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const config = configSchema.parse({ targets: [{ owner: 'o', repo: 'r', lockfiles: ['package-lock.json'] }] });
    const findings = rules(results, config);

    expect(findings[0].id).toBe('poltergeist:o/r:npm:pkg@1.0.0:GHSA-29mw-wpgm-hmr9');
  });

  it('uses OSV id when no GitHub advisory exists for the CVE', () => {
    const results: SourceResult[] = [
      {
        sourceName: 'osv',
        findings: [
          osvFinding('PYSEC-2023-1', {
            owner: 'o',
            repo: 'r',
            ecosystem: 'npm',
            name: 'pkg',
            version: '1.0.0',
            id: 'PYSEC-2023-1',
            aliases: ['CVE-2023-1234'],
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

    expect(findings[0].id).toBe('poltergeist:o/r:npm:pkg@1.0.0:PYSEC-2023-1');
  });

  it('handles OSV-only advisory with its own id', () => {
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

    expect(findings[0].id).toBe('poltergeist:o/r:npm:pkg@1.0.0:GHSA-1234-5678-9abc');
  });
});
