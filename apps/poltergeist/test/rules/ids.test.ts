import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { canonicalOsvId, rules } from '../../src/rules.js';
import { githubDetails, githubResult, osvDetails, osvResult, pkg } from './builders.js';

const ID = (advisory: string, version = '1.0.0', repo = 'r') => `poltergeist:o/${repo}:npm:pkg@${version}:${advisory}`;

describe('advisory id canonicalisation', () => {
  it('keeps the id of an OSV advisory that is itself a GHSA', () => {
    const findings = rules([osvResult(osvDetails({ id: 'GHSA-1234-5678-9abc', aliases: ['CVE-2026-1'] })), githubResult()]);
    expect(findings.map((finding) => finding.id)).toEqual([ID('GHSA-1234-5678-9abc')]);
  });

  it('uses the lexicographically smallest GHSA alias of a PYSEC advisory', () => {
    const findings = rules([
      osvResult(osvDetails({ id: 'PYSEC-2023-1', aliases: ['GHSA-zzzz-1234-5678', 'CVE-2023-9', 'GHSA-aaaa-1234-5678'] })),
    ]);
    expect(findings.map((finding) => finding.id)).toEqual([ID('GHSA-aaaa-1234-5678')]);
  });

  it('links an OSV advisory to the GitHub GHSA of the same package version through a shared CVE alias', () => {
    const findings = rules([
      osvResult(osvDetails({ id: 'PYSEC-2020-73', aliases: ['CVE-2020-13091'] })),
      githubResult(
        githubDetails({ ghsa_id: 'GHSA-bbbb-1111-2222', cve_id: 'CVE-2020-99999' }),
        githubDetails({ ghsa_id: 'GHSA-aaaa-1111-2222', cve_id: 'CVE-2020-13091' }),
      ),
    ]);
    const linked = findings.find((finding) => finding.id === ID('GHSA-aaaa-1111-2222'));
    expect(linked?.sources.sort()).toEqual(['github', 'osv']);
    expect(linked?.status).toBe('confirmed');
    expect(findings.map((finding) => finding.id)).not.toContain(ID('PYSEC-2020-73'));
  });

  it('does not link through a CVE that GitHub lists for another version of the package', () => {
    const findings = rules([
      osvResult(osvDetails({ id: 'PYSEC-2020-73', aliases: ['CVE-2020-13091'] })),
      githubResult(githubDetails({ ghsa_id: 'GHSA-aaaa-1111-2222', cve_id: 'CVE-2020-13091', version: '0.9.0' })),
    ]);
    expect(findings.map((finding) => finding.id).sort()).toEqual([ID('GHSA-aaaa-1111-2222', '0.9.0'), ID('PYSEC-2020-73')]);
  });

  it('keeps the OSV id of an advisory no GHSA is known for, which can only be a ghost', () => {
    const [finding] = rules([osvResult(osvDetails({ id: 'PYSEC-2020-73', aliases: ['CVE-2020-13091'] })), githubResult()]);
    expect(finding).toMatchObject({ id: ID('PYSEC-2020-73'), status: 'ghost', sources: ['osv'] });
    expect(finding.url).toBe('https://osv.dev/vulnerability/PYSEC-2020-73');
  });

  it('merges the GHSA and PYSEC copies OSV returns for one advisory into one finding', () => {
    const findings = rules([
      osvResult(
        osvDetails({ id: 'GHSA-j8r2-6x86-q33q', aliases: ['CVE-2023-32681', 'PYSEC-2023-74'] }),
        osvDetails({ id: 'PYSEC-2023-74', aliases: ['CVE-2023-32681', 'GHSA-j8r2-6x86-q33q'] }),
      ),
      githubResult(githubDetails({ ghsa_id: 'GHSA-j8r2-6x86-q33q', cve_id: 'CVE-2023-32681' })),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: ID('GHSA-j8r2-6x86-q33q'), status: 'confirmed' });
    expect(findings[0].evidence.map((entry) => entry.sourceName).sort()).toEqual(['github', 'osv']);
  });

  it('gives the same package version in two repositories separate findings', () => {
    const findings = rules([
      osvResult(osvDetails({ id: 'GHSA-1234-5678-9abc' }), osvDetails({ id: 'GHSA-1234-5678-9abc', repo: 'twin' })),
      githubResult(githubDetails({ ghsa_id: 'GHSA-1234-5678-9abc' })),
    ]);
    expect(findings.map((finding) => [finding.id, finding.status])).toEqual([
      [ID('GHSA-1234-5678-9abc'), 'confirmed'],
      [ID('GHSA-1234-5678-9abc', '1.0.0', 'twin'), 'ghost'],
    ]);
  });

  it('keeps the id of a finding the runner carries forward without details for a failed source', () => {
    const stale = {
      sourceName: 'github',
      fetchedAt: '2026-11-15T00:00:00.000Z',
      findings: [{ id: ID('GHSA-1234-5678-9abc'), title: 'GitHub GHSA-1234-5678-9abc: Prototype pollution' }],
    };
    const findings = rules([
      osvResult(osvDetails({ id: 'GHSA-1234-5678-9abc', summary: 'Prototype pollution', fixed: ['1.0.1'] })),
      stale,
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: ID('GHSA-1234-5678-9abc'),
      status: 'confirmed',
      title: 'pkg@1.0.0: Prototype pollution',
      fix: { value: '1.0.1' },
    });
  });

  it('keeps a finding whose every source was carried forward, using the package and advisory from its id', () => {
    const [finding] = rules([
      { sourceName: 'osv', fetchedAt: '2026-11-15T00:00:00.000Z', findings: [{ id: ID('PYSEC-2020-73'), title: 'OSV PYSEC-2020-73: old text' }] },
    ]);
    expect(finding).toMatchObject({ id: ID('PYSEC-2020-73'), title: 'pkg@1.0.0: PYSEC-2020-73', summary: 'OSV PYSEC-2020-73: old text' });
  });
});

describe('alias-order independence', () => {
  const ghsa = fc.stringMatching(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  const cve = fc.stringMatching(/^CVE-20[0-9]{2}-[0-9]{4,6}$/);
  const other = fc.stringMatching(/^(PYSEC|SNYK|BIT)-[A-Z0-9-]{1,12}$/);
  const aliases = fc.array(fc.oneof(ghsa, cve, other), { maxLength: 10 });
  const ownId = fc.oneof(ghsa, fc.stringMatching(/^(PYSEC|OSV)-20[0-9]{2}-[0-9]{1,4}$/));

  it('gives the same canonical id for every order of the aliases', () => {
    const aliasesAndShuffle = aliases.chain((list) =>
      fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length })),
    );
    fc.assert(
      fc.property(ownId, aliasesAndShuffle, fc.array(fc.tuple(cve, ghsa), { maxLength: 4 }), (id, [list, shuffled], links) => {
        const ghsaByCve = new Map(links);
        expect(canonicalOsvId(id, shuffled, ghsaByCve)).toBe(canonicalOsvId(id, list, ghsaByCve));
      }),
    );
  });

  it('gives the same finding ids from rules for every order of the aliases', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^PYSEC-20[0-9]{2}-[0-9]{1,4}$/), aliases, (id, list) => {
        const forward = rules([osvResult(osvDetails({ id, aliases: list }))]).map((finding) => finding.id);
        const backward = rules([osvResult(osvDetails({ id, aliases: [...list].reverse() }))]).map((finding) => finding.id);
        expect(backward).toEqual(forward);
      }),
    );
  });

  it('always prefers a GHSA id over any other alias', () => {
    fc.assert(
      fc.property(ghsa, fc.array(fc.oneof(cve, other), { maxLength: 5 }), (ghsaAlias, rest) => {
        expect(canonicalOsvId('PYSEC-2024-1', [...rest, ghsaAlias])).toBe(ghsaAlias);
      }),
    );
  });
});

describe('finding text', () => {
  it('titles a finding with the package, version and the GitHub summary and links the GitHub advisory', () => {
    const [finding] = rules([
      osvResult(osvDetails({ id: 'GHSA-xvch-5gv4-984h', summary: 'OSV summary', description: 'OSV description' })),
      githubResult(
        githubDetails({ ghsa_id: 'GHSA-xvch-5gv4-984h', summary: 'Prototype Pollution in minimist', description: 'GitHub   description\n\nwith lines' }),
      ),
    ]);
    expect(finding).toMatchObject({
      title: 'pkg@1.0.0: Prototype Pollution in minimist',
      summary: 'GitHub description with lines',
      url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
    });
  });

  it('cuts the summary to the first 280 characters of the description', () => {
    const [finding] = rules([osvResult(osvDetails({ id: 'GHSA-1234-5678-9abc', description: 'x'.repeat(1000) }))]);
    expect(finding.summary).toBe('x'.repeat(280));
  });

  it('falls back to the OSV summary, then to the advisory id, for the title', () => {
    const [withSummary] = rules([osvResult(osvDetails({ id: 'GHSA-1234-5678-9abc', summary: 'From OSV' }))]);
    const [withoutSummary] = rules([osvResult(osvDetails({ id: 'PYSEC-2020-73', description: 'Details' }))]);
    expect(withSummary.title).toBe(`${pkg.name}@${pkg.version}: From OSV`);
    expect(withoutSummary.title).toBe(`${pkg.name}@${pkg.version}: PYSEC-2020-73`);
  });
});
