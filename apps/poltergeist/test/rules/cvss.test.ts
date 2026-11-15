import { describe, expect, it } from 'vitest';
import { cvss3BaseScore, severityFromScore } from '../../src/cvss.js';
import { loadFixture } from '../mockFetch.js';

interface RecordedAdvisory {
  ghsa_id: string;
  cvss_severities?: { cvss_v3?: { vector_string: string | null; score: number } };
}

describe('CVSS v3 base score', () => {
  it('matches the score GitHub publishes for every CVSS v3 vector in the recorded advisories', () => {
    const advisories = [...loadFixture('github/advisories-npm.json'), ...loadFixture('github/advisories-pip.json')].flatMap(
      (exchange) => exchange.respondWith.body as RecordedAdvisory[],
    );
    const scored = advisories.filter((advisory) => advisory.cvss_severities?.cvss_v3?.vector_string);
    expect(scored.length).toBeGreaterThanOrEqual(10);
    for (const advisory of scored) {
      const { vector_string, score } = advisory.cvss_severities!.cvss_v3!;
      expect(cvss3BaseScore(vector_string!), advisory.ghsa_id).toBe(score);
    }
  });

  it('computes changed-scope, CVSS 3.0 and zero-impact vectors', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
    expect(cvss3BaseScore('CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H')).toBe(7.8);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N')).toBe(6.4);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
  });

  it('accepts metrics in any order and extra temporal metrics', () => {
    expect(cvss3BaseScore('CVSS:3.1/S:U/AV:N/AC:L/PR:N/UI:N/C:H/I:H/A:H/E:P/RL:O')).toBe(9.8);
  });

  it('returns nothing for CVSS v2 or v4 vectors and incomplete vectors', () => {
    expect(cvss3BaseScore('AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBeUndefined();
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeUndefined();
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H')).toBeUndefined();
    expect(cvss3BaseScore('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeUndefined();
  });

  it('bands scores as critical, high, medium, low and none', () => {
    expect([9.0, 8.9, 7.0, 6.9, 4.0, 3.9, 0.1, 0].map(severityFromScore)).toEqual([
      'critical',
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
      'info',
    ]);
  });
});
