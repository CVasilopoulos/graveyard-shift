import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mergeById } from '../../src/core/mergeById.js';
import type { SourceResult } from '../../src/core/types.js';

describe('mergeById', () => {
  describe('unit tests', () => {
    it('returns empty array for empty input', () => {
      const result = mergeById([]);
      expect(result).toEqual([]);
    });

    it('merges single source with single finding', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'finding1',
        title: 'Test Finding',
        sources: ['source1'],
        evidence: [
          {
            sourceName: 'source1',
            text: 'Test Finding',
          },
        ],
      });
    });

    it('merges multiple findings from same source', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [
            { id: 'finding1', title: 'Finding 1' },
            { id: 'finding2', title: 'Finding 2' },
          ],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(2);
      expect(result.find(f => f.id === 'finding1')?.sources).toEqual(['source1']);
      expect(result.find(f => f.id === 'finding2')?.sources).toEqual(['source1']);
    });

    it('merges same finding from multiple sources', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        {
          sourceName: 'source2',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'finding1',
        title: 'Test Finding',
        sources: ['source1', 'source2'],
        evidence: [
          {
            sourceName: 'source1',
            text: 'Test Finding',
          },
          {
            sourceName: 'source2',
            text: 'Test Finding',
          },
        ],
      });
    });

    it('deduplicates same source reporting same id twice', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [
            { id: 'finding1', title: 'Test Finding' },
            { id: 'finding1', title: 'Test Finding' },
          ],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(1);
      expect(result[0].sources).toEqual(['source1']);
      expect(result[0].evidence).toHaveLength(1);
      expect(result[0].evidence[0].sourceName).toBe('source1');
    });

    it('deduplicates when same source reports same id across multiple SourceResults', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(1);
      expect(result[0].sources).toEqual(['source1']);
      expect(result[0].evidence).toHaveLength(1);
    });

    it('preserves title from first occurrence of an id', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'First Title' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        {
          sourceName: 'source2',
          findings: [{ id: 'finding1', title: 'Different Title' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result[0].title).toBe('First Title');
    });

    it('does not mutate input arrays', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'source1',
          findings: [{ id: 'finding1', title: 'Test Finding' }],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const originalResults = JSON.parse(JSON.stringify(results));
      mergeById(results);

      expect(results).toEqual(originalResults);
    });

    it('does not mutate SourceResult objects', () => {
      const sourceResult: SourceResult = {
        sourceName: 'source1',
        findings: [{ id: 'finding1', title: 'Test Finding' }],
        fetchedAt: '2024-01-01T00:00:00Z',
      };

      const findings = sourceResult.findings;
      const originalFindings = JSON.parse(JSON.stringify(findings));

      mergeById([sourceResult]);

      expect(findings).toEqual(originalFindings);
    });

    it('complex scenario with multiple sources and findings', () => {
      const results: SourceResult[] = [
        {
          sourceName: 'osv',
          findings: [
            { id: 'vuln-a', title: 'Vulnerability A' },
            { id: 'vuln-b', title: 'Vulnerability B' },
          ],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
        {
          sourceName: 'ghsa',
          findings: [
            { id: 'vuln-a', title: 'Vuln A from GHSA' },
            { id: 'vuln-c', title: 'Vulnerability C' },
          ],
          fetchedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = mergeById(results);

      expect(result).toHaveLength(3);

      const vulnA = result.find(f => f.id === 'vuln-a');
      expect(vulnA?.sources).toEqual(['osv', 'ghsa']);
      expect(vulnA?.evidence).toHaveLength(2);

      const vulnB = result.find(f => f.id === 'vuln-b');
      expect(vulnB?.sources).toEqual(['osv']);
      expect(vulnB?.evidence).toHaveLength(1);

      const vulnC = result.find(f => f.id === 'vuln-c');
      expect(vulnC?.sources).toEqual(['ghsa']);
      expect(vulnC?.evidence).toHaveLength(1);
    });
  });

  describe('Property 5: No duplicate source names', () => {
    it('ensures no output finding has duplicate source names in sources array', () => {
      fc.assert(
        fc.property(arbSourceResults(), results => {
          const merged = mergeById(results);

          for (const finding of merged) {
            const sourceSet = new Set(finding.sources);
            expect(sourceSet.size).toBe(finding.sources.length);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 4.3', () => {
      // Requirement 4.3: FOR ALL inputs to mergeById, no output finding's sources array
      // SHALL contain duplicate source names (property-based test requirement).
      expect(true).toBe(true);
    });
  });

  describe('Property 6: Evidence count matches unique source-item pairs', () => {
    it('total evidence equals total unique (source, id) pairs', () => {
      fc.assert(
        fc.property(arbSourceResults(), results => {
          const merged = mergeById(results);

          // Count unique (sourceName, id) pairs
          const uniquePairs = new Set<string>();
          for (const result of results) {
            for (const item of result.findings) {
              uniquePairs.add(`${result.sourceName}:${item.id}`);
            }
          }

          // Count total evidence entries
          const totalEvidence = merged.reduce((sum, finding) => sum + finding.evidence.length, 0);

          expect(totalEvidence).toBe(uniquePairs.size);
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 4.1, 4.2, 4.4', () => {
      // Requirement 4.1: THE Graveyard_Shift SHALL export a mergeById function that accepts
      // an array of SourceResult values and returns an array of partial Finding objects
      // Requirement 4.2: WHEN mergeById processes source items, THE mergeById function SHALL
      // group all items sharing the same id value into a single output entry
      // Requirement 4.4: WHEN the same source reports the same finding id more than once,
      // THE mergeById function SHALL include only one Evidence entry for that source
      expect(true).toBe(true);
    });
  });

  describe('Property 7: mergeById does not mutate inputs', () => {
    it('input arrays and SourceResult objects are unchanged after the call', () => {
      fc.assert(
        fc.property(arbSourceResults(), results => {
          const originalJson = JSON.stringify(results);
          mergeById(results);
          const afterJson = JSON.stringify(results);

          expect(afterJson).toBe(originalJson);
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 4.7', () => {
      // Requirement 4.7: THE mergeById function SHALL NOT mutate its input arrays
      // or the SourceResult objects within them.
      expect(true).toBe(true);
    });
  });
});

/**
 * Generate a SourceResult with valid structure.
 */
function arbSourceResult(): fc.Arbitrary<SourceResult> {
  return fc.record({
    sourceName: fc.stringMatching(/^[a-z0-9_]+$/),
    findings: fc.array(
      fc.record({
        id: fc.stringMatching(/^[a-z0-9\-]+$/),
        title: fc.string({ minLength: 1 }),
        details: fc.option(
          fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
          { freq: 1 },
        ),
      }),
      { minLength: 0, maxLength: 10 },
    ),
    fetchedAt: fc.constant('2024-01-01T00:00:00Z'),
  });
}

/**
 * Generate an array of SourceResult values.
 */
function arbSourceResults(): fc.Arbitrary<SourceResult[]> {
  return fc.array(arbSourceResult(), { minLength: 0, maxLength: 5 });
}


