import type { Finding } from './types.js';

/**
 * A partial finding that lacks firstSeen, lastSeen, resolvedAt, and stale fields.
 * This is what the rules function returns; the runner adds those fields.
 */
export type PartialFinding = Omit<Finding, 'firstSeen' | 'lastSeen' | 'resolvedAt' | 'stale'>;

/**
 * Applies the agreement rule: a finding is confirmed if and only if its sources array
 * contains at least two distinct source names; otherwise it is a ghost.
 *
 * For each finding:
 * - If sources.length >= 2: set status to "confirmed"
 * - Otherwise: set status to "ghost"
 *
 * All other fields are preserved unchanged. Input objects are never mutated.
 */
export function applyAgreementRule(findings: PartialFinding[]): Finding[] {
  return findings.map(finding => {
    // Deduplicate source names (in case of duplicates) and count distinct sources
    const distinctSources = new Set(finding.sources);
    const status = distinctSources.size >= 2 ? 'confirmed' : 'ghost';

    // Return a new Finding object with status assigned, spreading all other fields
    return {
      ...finding,
      status,
    } as Finding;
  });
}
