import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  capitalise,
  countFindings,
  dateOf,
  filterFindings,
  labelsFor,
  lastRunOf,
  loadErrorMessage,
  runTally,
  safeUrl,
  severityOf,
  sortFindings,
  sourcesSentence,
  statusOf,
} from '../../src/dashboard/app.js';

type Status = 'confirmed' | 'ghost';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface DashboardFinding {
  id: string;
  title: string;
  status: Status;
  severity: Severity;
  resolvedAt?: string;
}

function finding(id: string, status: Status, severity: Severity, resolvedAt?: string): DashboardFinding {
  return { id, title: `title ${id}`, status, severity, ...(resolvedAt ? { resolvedAt } : {}) };
}

const findingArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  title: fc.string({ maxLength: 12 }),
  status: fc.constantFrom<Status>('confirmed', 'ghost'),
  severity: fc.constantFrom<Severity>('critical', 'high', 'medium', 'low', 'info'),
  resolvedAt: fc.option(fc.constant('2026-11-16T05:17:00.000Z'), { nil: undefined }),
});

describe('dashboard status', () => {
  it('treats a finding with resolvedAt as resolved whatever its status', () => {
    expect(statusOf(finding('a', 'confirmed', 'high', '2026-11-16T00:00:00.000Z'))).toBe('resolved');
    expect(statusOf(finding('b', 'ghost', 'low', '2026-11-16T00:00:00.000Z'))).toBe('resolved');
    expect(statusOf(finding('c', 'confirmed', 'high'))).toBe('confirmed');
    expect(statusOf(finding('d', 'ghost', 'high'))).toBe('ghost');
  });

  it('shows an unknown severity with the info style', () => {
    expect(severityOf({ severity: 'catastrophic' })).toBe('info');
    expect(severityOf({ severity: 'critical' })).toBe('critical');
  });
});

describe('dashboard counts and filters', () => {
  it('counts every finding once under its effective status', () => {
    fc.assert(
      fc.property(fc.array(findingArb), (findings) => {
        const counts = countFindings(findings);
        expect(counts.total).toBe(findings.length);
        expect(counts.confirmed + counts.ghost + counts.resolved).toBe(findings.length);
        expect(counts.confirmed).toBe(filterFindings(findings, 'confirmed').length);
        expect(counts.ghost).toBe(filterFindings(findings, 'ghost').length);
        expect(counts.resolved).toBe(filterFindings(findings, 'resolved').length);
      }),
    );
  });

  it('splits the findings into three disjoint status filters that together give the all filter', () => {
    fc.assert(
      fc.property(fc.array(findingArb), (findings) => {
        const parts = ['confirmed', 'ghost', 'resolved'].flatMap((status) => filterFindings(findings, status));
        expect(parts).toHaveLength(findings.length);
        expect(new Set(parts)).toEqual(new Set(filterFindings(findings, 'all')));
      }),
    );
  });

  it('does not reorder or mutate the input when filtering or sorting', () => {
    const findings = [finding('b', 'ghost', 'low'), finding('a', 'confirmed', 'critical')];
    const copy = structuredClone(findings);
    filterFindings(findings, 'all');
    sortFindings(findings);
    expect(findings).toEqual(copy);
  });
});

describe('dashboard order', () => {
  it('lists hauntings before ghosts before resolved findings, then by severity from critical to info, then by title', () => {
    const findings = [
      finding('resolved-critical', 'confirmed', 'critical', '2026-11-16T00:00:00.000Z'),
      finding('ghost-critical', 'ghost', 'critical'),
      finding('confirmed-low', 'confirmed', 'low'),
      finding('confirmed-critical-b', 'confirmed', 'critical'),
      finding('confirmed-critical-a', 'confirmed', 'critical'),
      finding('confirmed-medium', 'confirmed', 'medium'),
    ];

    expect(sortFindings(findings).map((f) => f.id)).toEqual([
      'confirmed-critical-a',
      'confirmed-critical-b',
      'confirmed-medium',
      'confirmed-low',
      'ghost-critical',
      'resolved-critical',
    ]);
  });

  it('gives the same order for any permutation of the same findings', () => {
    fc.assert(
      fc.property(fc.uniqueArray(findingArb, { selector: (f) => f.id }), fc.integer(), (findings, seed) => {
        const shuffled = [...findings].sort((a, b) => ((a.id.charCodeAt(0) * seed) % 7) - ((b.id.charCodeAt(0) * seed) % 7));
        expect(sortFindings(shuffled).map((f) => f.id)).toEqual(sortFindings(findings).map((f) => f.id));
      }),
    );
  });
});

describe('dashboard theme labels', () => {
  it('uses the theme labels for each status', () => {
    expect(labelsFor({ labels: { confirmed: 'haunting', ghost: 'ghost', resolved: 'laid to rest' } })).toEqual({
      confirmed: 'haunting',
      ghost: 'ghost',
      resolved: 'laid to rest',
    });
  });

  it('falls back to confirmed, ghost and resolved for missing, blank or non-text labels', () => {
    expect(labelsFor({})).toEqual({ confirmed: 'confirmed', ghost: 'ghost', resolved: 'resolved' });
    expect(labelsFor(undefined)).toEqual({ confirmed: 'confirmed', ghost: 'ghost', resolved: 'resolved' });
    expect(labelsFor({ labels: { confirmed: '  ', ghost: 3, resolved: 'at peace' } })).toEqual({
      confirmed: 'confirmed',
      ghost: 'ghost',
      resolved: 'at peace',
    });
  });

  it('capitalises only the first letter of a label', () => {
    expect(capitalise('laid to rest')).toBe('Laid to rest');
    expect(capitalise('')).toBe('');
  });
});

describe('dashboard text helpers', () => {
  it('accepts only http and https links', () => {
    expect(safeUrl('https://github.com/advisories/GHSA-xvch-5gv4-984h')).toBe('https://github.com/advisories/GHSA-xvch-5gv4-984h');
    expect(safeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  it('takes the date part of an ISO 8601 timestamp and nothing from other text', () => {
    expect(dateOf('2026-11-15T18:01:51.262Z')).toBe('2026-11-15');
    expect(dateOf('yesterday')).toBe('');
    expect(dateOf(undefined)).toBe('');
  });

  it('picks the last entry of runs.json as the most recent run', () => {
    const runs = [{ runAt: '2026-11-15T05:17:00.000Z' }, { runAt: '2026-11-16T05:17:00.000Z' }];
    expect(lastRunOf(runs)).toEqual({ runAt: '2026-11-16T05:17:00.000Z' });
    expect(lastRunOf([])).toBeNull();
    expect(lastRunOf({})).toBeNull();
  });

  it('names the HTTP status code when a file cannot be loaded', () => {
    expect(loadErrorMessage('findings.json', { status: 404, statusText: 'Not Found' })).toBe(
      'Could not load findings.json: HTTP 404 Not Found',
    );
    expect(loadErrorMessage('runs.json', { status: 500, statusText: '' })).toBe('Could not load runs.json: HTTP 500');
  });

  it('describes a network failure when no response arrives', () => {
    expect(loadErrorMessage('findings.json', { message: 'Failed to fetch' })).toBe(
      'Could not load findings.json: network failure (Failed to fetch)',
    );
  });

  it('sums up the last run with the theme labels and treats missing counts as zero', () => {
    const labels = { confirmed: 'haunting', ghost: 'ghost', resolved: 'laid to rest' };
    expect(runTally({ confirmedCount: 12, ghostCount: 1, resolvedCount: 0 }, labels)).toBe('haunting: 12 · ghost: 1 · laid to rest: 0');
    expect(runTally({}, labels)).toBe('haunting: 0 · ghost: 0 · laid to rest: 0');
  });

  it('says how many sources reported a finding', () => {
    expect(sourcesSentence(1)).toBe('Reported by 1 source');
    expect(sourcesSentence(2)).toBe('Reported by 2 sources');
  });
});
