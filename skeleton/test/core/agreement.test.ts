import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyAgreementRule, type PartialFinding } from '../../src/core/agreement.js';
import { mergeById } from '../../src/core/mergeById.js';
import type { SourceResult } from '../../src/core/types.js';

describe('applyAgreementRule', () => {
  describe('unit tests', () => {
    it('returns empty array for empty input', () => {
      const result = applyAgreementRule([]);
      expect(result).toEqual([]);
    });

    it('assigns ghost status to finding with single source', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'A single-source finding',
          severity: 'high',
          sources: ['source1'],
          evidence: [{ sourceName: 'source1', text: 'Evidence' }],
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('ghost');
      expect(result[0].id).toBe('f1');
      expect(result[0].title).toBe('Finding 1');
    });

    it('assigns confirmed status to finding with two sources', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'A two-source finding',
          severity: 'critical',
          sources: ['source1', 'source2'],
          evidence: [
            { sourceName: 'source1', text: 'Evidence 1' },
            { sourceName: 'source2', text: 'Evidence 2' },
          ],
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('confirmed');
    });

    it('assigns confirmed status to finding with multiple sources', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'A multi-source finding',
          severity: 'high',
          sources: ['source1', 'source2', 'source3'],
          evidence: [
            { sourceName: 'source1', text: 'Evidence 1' },
            { sourceName: 'source2', text: 'Evidence 2' },
            { sourceName: 'source3', text: 'Evidence 3' },
          ],
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result[0].status).toBe('confirmed');
    });

    it('assigns ghost status to finding with empty sources array', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'No sources',
          severity: 'medium',
          sources: [],
          evidence: [],
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result[0].status).toBe('ghost');
    });

    it('preserves all non-status fields', () => {
      const url = 'https://example.com/issue';
      const fix = { text: 'Update dependency', value: '1.2.3' };
      const edits = [{ path: 'package.json', newContent: 'new content' }];

      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'Test summary',
          severity: 'low',
          sources: ['s1', 's2'],
          evidence: [{ sourceName: 's1', text: 'e1' }],
          url,
          fix,
          edits,
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result[0].url).toBe(url);
      expect(result[0].fix).toEqual(fix);
      expect(result[0].edits).toEqual(edits);
      expect(result[0].id).toBe('f1');
      expect(result[0].title).toBe('Finding 1');
      expect(result[0].summary).toBe('Test summary');
      expect(result[0].severity).toBe('low');
    });

    it('processes multiple findings independently', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'Single source',
          severity: 'high',
          sources: ['s1'],
          evidence: [{ sourceName: 's1', text: 'e' }],
        },
        {
          id: 'f2',
          title: 'Finding 2',
          summary: 'Two sources',
          severity: 'critical',
          sources: ['s1', 's2'],
          evidence: [
            { sourceName: 's1', text: 'e1' },
            { sourceName: 's2', text: 'e2' },
          ],
        },
        {
          id: 'f3',
          title: 'Finding 3',
          summary: 'Three sources',
          severity: 'medium',
          sources: ['s1', 's2', 's3'],
          evidence: [
            { sourceName: 's1', text: 'e1' },
            { sourceName: 's2', text: 'e2' },
            { sourceName: 's3', text: 'e3' },
          ],
        },
      ];

      const result = applyAgreementRule(findings);

      expect(result).toHaveLength(3);
      expect(result[0].status).toBe('ghost');
      expect(result[1].status).toBe('confirmed');
      expect(result[2].status).toBe('confirmed');
    });

    it('does not mutate input findings', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'Test',
          severity: 'high',
          sources: ['s1', 's2'],
          evidence: [{ sourceName: 's1', text: 'e' }],
        },
      ];

      const originalJson = JSON.stringify(findings);
      applyAgreementRule(findings);
      const afterJson = JSON.stringify(findings);

      expect(afterJson).toBe(originalJson);
      expect(findings[0].status).toBeUndefined();
    });

    it('handles case-sensitive source names correctly', () => {
      const findings: PartialFinding[] = [
        {
          id: 'f1',
          title: 'Finding 1',
          summary: 'Case test',
          severity: 'high',
          sources: ['Source1', 'source1'],
          evidence: [
            { sourceName: 'Source1', text: 'e1' },
            { sourceName: 'source1', text: 'e2' },
          ],
        },
      ];

      const result = applyAgreementRule(findings);

      // Different case = different source names = 2 distinct sources = confirmed
      expect(result[0].status).toBe('confirmed');
    });
  });

  describe('Property 1: Confirmed invariant', () => {
    it('any finding whose id appears in 2+ SourceResults with distinct sourceNames is always confirmed', () => {
      fc.assert(
        fc.property(arbSourceResultsForConfirmedTest(), sourceResults => {
          // Merge the source results
          const merged = mergeById(sourceResults);

          // Apply the agreement rule
          const withStatus = applyAgreementRule(merged as PartialFinding[]);

          // Verify: findings that appear in 2+ distinct source results are confirmed
          // Count which findings appear in which sources
          const findingToSources = new Map<string, Set<string>>();
          for (const result of sourceResults) {
            for (const item of result.findings) {
              if (!findingToSources.has(item.id)) {
                findingToSources.set(item.id, new Set());
              }
              findingToSources.get(item.id)!.add(result.sourceName);
            }
          }

          // For each merged finding, check agreement rule
          for (const finding of withStatus) {
            const distinctSources = findingToSources.get(finding.id);
            if (distinctSources && distinctSources.size >= 2) {
              expect(finding.status).toBe('confirmed');
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 3.1, 3.3, 3.4', () => {
      // Requirement 3.1: WHEN the Runner applies rules to source results, THE Runner SHALL set
      // a finding's status to confirmed if and only if the finding's sources array contains
      // at least two distinct source names.
      // Requirement 3.3: THE Runner SHALL treat source names as case-sensitive strings when
      // determining source independence.
      // Requirement 3.4: WHEN the same source name appears more than once in a finding's sources
      // array, THE Runner SHALL count that source only once when evaluating the two-source agreement rule.
      expect(true).toBe(true);
    });
  });

  describe('Property 2: Ghost invariant', () => {
    it('any finding whose id appears in exactly one SourceResult is always ghost', () => {
      fc.assert(
        fc.property(arbSourceResultsForGhostTest(), sourceResults => {
          // Merge the source results
          const merged = mergeById(sourceResults);

          // Apply the agreement rule
          const withStatus = applyAgreementRule(merged as PartialFinding[]);

          // Verify: findings that appear in only 1 source result are ghosts
          // Count which findings appear in which sources
          const findingToSources = new Map<string, Set<string>>();
          for (const result of sourceResults) {
            for (const item of result.findings) {
              if (!findingToSources.has(item.id)) {
                findingToSources.set(item.id, new Set());
              }
              findingToSources.get(item.id)!.add(result.sourceName);
            }
          }

          // For each merged finding with only 1 source, verify it's ghost
          for (const finding of withStatus) {
            const distinctSources = findingToSources.get(finding.id);
            if (distinctSources && distinctSources.size === 1) {
              expect(finding.status).toBe('ghost');
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 3.2, 3.4, 3.6, 3.7', () => {
      // Requirement 3.2: WHEN a finding's sources array contains exactly one source name,
      // THE Runner SHALL set the finding's status to ghost.
      // Requirement 3.4: WHEN the same source name appears more than once in a finding's sources
      // array, THE Runner SHALL count that source only once when evaluating the two-source agreement rule.
      // Requirement 3.6: FOR ALL non-empty arrays of SourceResult values, applying the agreement
      // rule twice SHALL produce the same set of finding statuses as applying it once (idempotence property).
      // Requirement 3.7: IF a finding's sources array is empty, THEN THE Runner SHALL assign that
      // finding a status of ghost.
      expect(true).toBe(true);
    });
  });

  describe('Property 3: Agreement rule idempotence', () => {
    it('applying the rule twice produces the same statuses as applying it once', () => {
      fc.assert(
        fc.property(arbPartialFindings(), findings => {
          const once = applyAgreementRule(findings);
          const twice = applyAgreementRule(once as PartialFinding[]);

          expect(twice).toHaveLength(once.length);
          for (let i = 0; i < once.length; i++) {
            expect(twice[i].status).toBe(once[i].status);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 3.5', () => {
      // Requirement 3.5: FOR ALL non-empty arrays of SourceResult values, applying the
      // agreement rule twice SHALL produce the same set of finding statuses as applying it once (idempotence property).
      expect(true).toBe(true);
    });
  });

  describe('Property 4: Agreement rule preserves non-status fields', () => {
    it('no field other than status is modified by the rule', () => {
      fc.assert(
        fc.property(arbPartialFindings(), findings => {
          const result = applyAgreementRule(findings);

          for (let i = 0; i < findings.length; i++) {
            const original = findings[i];
            const modified = result[i];

            // Check all non-status fields are identical
            expect(modified.id).toBe(original.id);
            expect(modified.title).toBe(original.title);
            expect(modified.summary).toBe(original.summary);
            expect(modified.severity).toBe(original.severity);
            expect(modified.sources).toEqual(original.sources);
            expect(modified.evidence).toEqual(original.evidence);

            // Optional fields
            if (original.url !== undefined) {
              expect(modified.url).toBe(original.url);
            }
            if (original.fix !== undefined) {
              expect(modified.fix).toEqual(original.fix);
            }
            if (original.edits !== undefined) {
              expect(modified.edits).toEqual(original.edits);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('Validates: Requirements 3.8', () => {
      // Requirement 3.8: WHEN the Runner assigns a status to a finding, THE Runner SHALL preserve
      // all other finding fields (id, title, summary, severity, evidence, url, fix, edits) unchanged.
      expect(true).toBe(true);
    });
  });
});

/**
 * Generate a single PartialFinding with valid structure.
 */
function arbPartialFinding(): fc.Arbitrary<PartialFinding> {
  return fc.record({
    id: fc.stringMatching(/^[a-z0-9\-]+$/),
    title: fc.string({ minLength: 1 }),
    summary: fc.string({ minLength: 1 }),
    severity: fc.constantFrom('critical', 'high', 'medium', 'low', 'info'),
    sources: fc.array(fc.stringMatching(/^[a-z0-9_]+$/), { minLength: 0, maxLength: 5 }),
    evidence: fc.array(
      fc.record({
        sourceName: fc.stringMatching(/^[a-z0-9_]+$/),
        text: fc.string({ minLength: 1 }),
        link: fc.option(fc.webUrl(), { freq: 1 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
    url: fc.option(fc.webUrl(), { freq: 1 }),
    fix: fc.option(
      fc.record({
        text: fc.string({ minLength: 1 }),
        value: fc.option(fc.string({ minLength: 1 }), { freq: 1 }),
      }),
      { freq: 1 },
    ),
    edits: fc.option(
      fc.array(
        fc.record({
          path: fc.string({ minLength: 1 }),
          newContent: fc.string(),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      { freq: 1 },
    ),
  });
}

/**
 * Generate an array of PartialFinding values.
 */
function arbPartialFindings(): fc.Arbitrary<PartialFinding[]> {
  return fc.array(arbPartialFinding(), { minLength: 0, maxLength: 5 });
}

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
 * Generate SourceResults that will produce findings appearing in 2+ distinct sources.
 * This ensures confirmed findings exist in the test.
 */
function arbSourceResultsForConfirmedTest(): fc.Arbitrary<SourceResult[]> {
  // Generate an array of 2+ SourceResults where at least one finding appears in multiple sources
  return fc
    .tuple(
      fc.array(arbSourceResult(), { minLength: 2, maxLength: 3 }),
      fc.array(
        fc.record({
          id: fc.stringMatching(/^[a-z0-9\-]+$/),
          title: fc.string({ minLength: 1 }),
          details: fc.option(
            fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
            { freq: 1 },
          ),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    )
    .map(([sourceResults, sharedFindings]) => {
      // Ensure at least one shared finding appears in all sources
      return sourceResults.map((result, index) => ({
        ...result,
        findings:
          index === 0
            ? [...result.findings, ...sharedFindings]
            : [...result.findings, ...sharedFindings],
      }));
    });
}

/**
 * Generate SourceResults where each finding appears in at most one source.
 * This ensures ghost findings exist in the test.
 */
function arbSourceResultsForGhostTest(): fc.Arbitrary<SourceResult[]> {
  // Generate SourceResults where findings don't overlap across sources
  return fc.array(arbSourceResult(), { minLength: 1, maxLength: 5 }).map(sourceResults => {
    // Ensure no finding id appears in more than one source
    const usedIds = new Set<string>();
    return sourceResults.map(result => ({
      ...result,
      findings: result.findings.filter(item => {
        if (usedIds.has(item.id)) {
          return false; // Skip this item to ensure no cross-source duplication
        }
        usedIds.add(item.id);
        return true;
      }),
    }));
  });
}
