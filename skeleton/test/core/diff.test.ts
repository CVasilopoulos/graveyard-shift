import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeDiff } from '../../src/core/diff.js';
import type { Finding } from '../../src/core/types.js';

/**
 * Fast-check arbitrary for generating valid Finding arrays with unique ids and valid statuses.
 */
const arbFindingsArray = (uniqueIds?: string[]) => {
  if (uniqueIds && uniqueIds.length > 0) {
    return fc.tuple(
      fc.shuffledSubarray(uniqueIds),
    ).map(([ids]) =>
      ids.map((id) => ({
        id,
        title: `Finding ${id}`,
        summary: `Summary for ${id}`,
        severity: fc.sample(fc.oneof(
          fc.constant('critical'),
          fc.constant('high'),
          fc.constant('medium'),
          fc.constant('low'),
          fc.constant('info'),
        ), 1)[0] as Finding['severity'],
        status: fc.sample(fc.oneof(
          fc.constant('confirmed'),
          fc.constant('ghost'),
        ), 1)[0] as Finding['status'],
        sources: ['source1'],
        evidence: [],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      }))
    );
  }

  return fc.array(
    fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string({ minLength: 1 }),
      summary: fc.string({ minLength: 1 }),
      severity: fc.oneof(
        fc.constant('critical'),
        fc.constant('high'),
        fc.constant('medium'),
        fc.constant('low'),
        fc.constant('info'),
      ),
      status: fc.oneof(
        fc.constant('confirmed'),
        fc.constant('ghost'),
      ),
      sources: fc.constant(['source1']),
      evidence: fc.constant([]),
      firstSeen: fc.constant(new Date().toISOString()),
      lastSeen: fc.constant(new Date().toISOString()),
    }),
  ).map((findings) => {
    // Remove duplicates to ensure unique ids
    const seen = new Set<string>();
    return findings.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  });
};

describe('computeDiff', () => {
  describe('unit tests', () => {
    it('handles empty arrays', () => {
      const result = computeDiff([], []);
      expect(result.appeared).toEqual([]);
      expect(result.still).toEqual([]);
      expect(result.resolved).toEqual([]);
      expect(result.promoted).toEqual([]);
      expect(result.demoted).toEqual([]);
    });

    it('identifies appeared findings', () => {
      const prev: Finding[] = [];
      const curr: Finding[] = [
        {
          id: 'new-1',
          title: 'New Finding 1',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1', 'source2'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toEqual(['new-1']);
      expect(result.still).toEqual([]);
      expect(result.resolved).toEqual([]);
      expect(result.promoted).toEqual([]);
      expect(result.demoted).toEqual([]);
    });

    it('identifies resolved findings', () => {
      const prev: Finding[] = [
        {
          id: 'old-1',
          title: 'Old Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      const curr: Finding[] = [];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toEqual([]);
      expect(result.still).toEqual([]);
      expect(result.resolved).toEqual(['old-1']);
      expect(result.promoted).toEqual([]);
      expect(result.demoted).toEqual([]);
    });

    it('identifies still findings', () => {
      const prev: Finding[] = [
        {
          id: 'same-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      const curr: Finding[] = [
        {
          id: 'same-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toEqual([]);
      expect(result.still).toEqual(['same-1']);
      expect(result.resolved).toEqual([]);
      expect(result.promoted).toEqual([]);
      expect(result.demoted).toEqual([]);
    });

    it('identifies promoted findings (ghost -> confirmed)', () => {
      const prev: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'ghost',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      const curr: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1', 'source2'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toEqual([]);
      expect(result.still).toEqual(['vuln-1']);
      expect(result.resolved).toEqual([]);
      expect(result.promoted).toEqual(['vuln-1']);
      expect(result.demoted).toEqual([]);
    });

    it('identifies demoted findings (confirmed -> ghost)', () => {
      const prev: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1', 'source2'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      const curr: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Finding',
          summary: 'Summary',
          severity: 'high',
          status: 'ghost',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toEqual([]);
      expect(result.still).toEqual(['vuln-1']);
      expect(result.resolved).toEqual([]);
      expect(result.promoted).toEqual([]);
      expect(result.demoted).toEqual(['vuln-1']);
    });

    it('handles complex scenario with all types', () => {
      const prev: Finding[] = [
        { id: 'a', title: 'A', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'b', title: 'B', summary: 'S', severity: 'high', status: 'ghost', sources: ['s1'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'c', title: 'C', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'd', title: 'D', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
      ];

      const curr: Finding[] = [
        { id: 'a', title: 'A', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'b', title: 'B', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'c', title: 'C', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
        { id: 'e', title: 'E', summary: 'S', severity: 'high', status: 'confirmed', sources: ['s1', 's2'], evidence: [], firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-01T00:00:00Z' },
      ];

      const result = computeDiff(prev, curr);
      expect(result.appeared).toContainEqual('e');
      expect(result.still).toContain('a');
      expect(result.still).toContain('b');
      expect(result.still).toContain('c');
      expect(result.resolved).toContainEqual('d');
      expect(result.promoted).toContainEqual('b');
    });

    it('does not mutate input arrays', () => {
      const prev: Finding[] = [
        {
          id: 'test-1',
          title: 'Test',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1'],
          evidence: [],
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      const curr: Finding[] = [];

      const prevOriginal = JSON.stringify(prev);
      const currOriginal = JSON.stringify(curr);

      computeDiff(prev, curr);

      expect(JSON.stringify(prev)).toEqual(prevOriginal);
      expect(JSON.stringify(curr)).toEqual(currOriginal);
    });
  });

  describe('property-based tests', () => {
    it('Property 8: Diff completeness - union of appeared+still+resolved equals union of all ids', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 20 }),
          (idList) => {
            const uniqueIds = [...new Set(idList)];
            const prevIds = uniqueIds.slice(0, Math.floor(uniqueIds.length / 2));
            const currIds = uniqueIds.slice(Math.floor(uniqueIds.length / 2));

            const prev = prevIds.map((id) => ({
              id,
              title: 'T',
              summary: 'S',
              severity: 'high' as const,
              status: 'confirmed' as const,
              sources: ['s1'],
              evidence: [],
              firstSeen: '2024-01-01T00:00:00Z',
              lastSeen: '2024-01-01T00:00:00Z',
            }));

            const curr = currIds.map((id) => ({
              id,
              title: 'T',
              summary: 'S',
              severity: 'high' as const,
              status: 'confirmed' as const,
              sources: ['s1'],
              evidence: [],
              firstSeen: '2024-01-01T00:00:00Z',
              lastSeen: '2024-01-01T00:00:00Z',
            }));

            const result = computeDiff(prev, curr);

            const allPrevIds = new Set(prevIds);
            const allCurrIds = new Set(currIds);
            const expectedUnion = new Set([...allPrevIds, ...allCurrIds]);

            const resultUnion = new Set([
              ...result.appeared,
              ...result.still,
              ...result.resolved,
            ]);

            expect(resultUnion).toEqual(expectedUnion);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Property 9: Diff stability - computeDiff(A, A) returns empty arrays except still', () => {
      fc.assert(
        fc.property(arbFindingsArray(), (findings) => {
          const result = computeDiff(findings, findings);

          expect(result.appeared).toEqual([]);
          expect(result.resolved).toEqual([]);
          expect(result.promoted).toEqual([]);
          expect(result.demoted).toEqual([]);
          expect(result.still).toEqual(findings.map((f) => f.id));
        }),
        { numRuns: 50 },
      );
    });

    it('Property 10: Promoted and demoted are subsets of still', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }),
          (idList) => {
            const uniqueIds = [...new Set(idList)];

            const prev = uniqueIds.map((id) => ({
              id,
              title: 'T',
              summary: 'S',
              severity: 'high' as const,
              status: fc.sample(
                fc.oneof(fc.constant('confirmed'), fc.constant('ghost')),
                1,
              )[0] as 'confirmed' | 'ghost',
              sources: ['s1'],
              evidence: [],
              firstSeen: '2024-01-01T00:00:00Z',
              lastSeen: '2024-01-01T00:00:00Z',
            }));

            const curr = uniqueIds.map((id) => ({
              id,
              title: 'T',
              summary: 'S',
              severity: 'high' as const,
              status: fc.sample(
                fc.oneof(fc.constant('confirmed'), fc.constant('ghost')),
                1,
              )[0] as 'confirmed' | 'ghost',
              sources: ['s1'],
              evidence: [],
              firstSeen: '2024-01-01T00:00:00Z',
              lastSeen: '2024-01-01T00:00:00Z',
            }));

            const result = computeDiff(prev, curr);

            const stillSet = new Set(result.still);
            const promotedSet = new Set(result.promoted);
            const demotedSet = new Set(result.demoted);

            // promoted should be subset of still
            for (const id of promotedSet) {
              expect(stillSet.has(id)).toBe(true);
            }

            // demoted should be subset of still
            for (const id of demotedSet) {
              expect(stillSet.has(id)).toBe(true);
            }

            // promoted and demoted should be disjoint
            for (const id of promotedSet) {
              expect(demotedSet.has(id)).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Property 12: Order-independence and no mutation', () => {
      fc.assert(
        fc.property(arbFindingsArray(), (findings) => {
          // Create two arrays with same findings but different order
          const shuffledFindings = [...findings].sort((a, b) =>
            Math.random() - 0.5,
          );

          const result1 = computeDiff(findings, []);
          const result2 = computeDiff(shuffledFindings, []);

          // Results should be equivalent (same ids, potentially different order)
          expect(new Set(result1.appeared)).toEqual(new Set(result2.appeared));
          expect(new Set(result1.still)).toEqual(new Set(result2.still));
          expect(new Set(result1.resolved)).toEqual(new Set(result2.resolved));
          expect(new Set(result1.promoted)).toEqual(new Set(result2.promoted));
          expect(new Set(result1.demoted)).toEqual(new Set(result2.demoted));

          // Input arrays should not be mutated
          const original = JSON.stringify(findings);
          expect(JSON.stringify(findings)).toEqual(original);
          expect(JSON.stringify(shuffledFindings)).toBeDefined();
        }),
        { numRuns: 50 },
      );
    });
  });
});
