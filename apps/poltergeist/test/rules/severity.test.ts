import { describe, expect, it } from 'vitest';
import { rules } from '../../src/rules.js';
import { githubDetails, githubResult, osvDetails, osvResult } from './builders.js';

const ADVISORY = 'GHSA-1234-5678-9abc';
const severityOf = (...results: Parameters<typeof rules>[0]) => rules(results)[0].severity;

describe('severity', () => {
  it('uses the GitHub severity when GitHub gives one', () => {
    expect(
      severityOf(
        osvResult(osvDetails({ id: ADVISORY, database_specific: { severity: 'LOW' } })),
        githubResult(githubDetails({ ghsa_id: ADVISORY, severity: 'critical' })),
      ),
    ).toBe('critical');
  });

  it('reads the GitHub moderate spelling as medium', () => {
    expect(severityOf(githubResult(githubDetails({ ghsa_id: ADVISORY, severity: 'moderate' })))).toBe('medium');
  });

  it('falls back to the OSV database severity and reads MODERATE as medium', () => {
    expect(severityOf(osvResult(osvDetails({ id: ADVISORY, database_specific: { severity: 'MODERATE' } })))).toBe('medium');
    expect(
      severityOf(
        osvResult(osvDetails({ id: ADVISORY, database_specific: { severity: 'HIGH' } })),
        githubResult(githubDetails({ ghsa_id: ADVISORY, severity: 'unknown' })),
      ),
    ).toBe('high');
  });

  it('bands the CVSS v3 base score computed from the OSV vector when no source names a severity', () => {
    const withVector = (score: string) => osvResult(osvDetails({ id: ADVISORY, severity: [{ type: 'CVSS_V3', score }] }));
    expect(severityOf(withVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))).toBe('critical');
    expect(severityOf(withVector('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H'))).toBe('high');
    expect(severityOf(withVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N'))).toBe('medium');
    expect(severityOf(withVector('CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N'))).toBe('low');
    expect(severityOf(withVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'))).toBe('info');
  });

  it('prefers the database severity of the OSV entry whose id is the canonical one', () => {
    expect(
      severityOf(
        osvResult(
          osvDetails({ id: 'PYSEC-2023-74', aliases: [ADVISORY], severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] }),
          osvDetails({ id: ADVISORY, database_specific: { severity: 'LOW' } }),
        ),
      ),
    ).toBe('low');
  });

  it('is info when there is only a CVSS v4 vector or nothing at all', () => {
    expect(
      severityOf(osvResult(osvDetails({ id: ADVISORY, severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N' }] }))),
    ).toBe('info');
    expect(severityOf(osvResult(osvDetails({ id: 'PYSEC-2020-73' })))).toBe('info');
  });
});
