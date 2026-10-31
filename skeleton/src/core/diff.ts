import type { Finding, DiffResult } from './types.js';

/**
 * Compute the delta between two findings arrays.
 *
 * Builds a map of id → status for each array, then computes five disjoint sets:
 * - appeared: ids in curr but not prev
 * - still: ids in both
 * - resolved: ids in prev but not curr
 * - promoted: ids in still where prev status was "ghost" and curr status is "confirmed"
 * - demoted: ids in still where prev status was "confirmed" and curr status is "ghost"
 *
 * Never mutates input arrays. Output arrays' order matches Map insertion order.
 * No sorting is applied to output arrays.
 *
 * @param prev The previous findings array
 * @param curr The current findings array
 * @returns A DiffResult containing the five disjoint id arrays
 */
export function computeDiff(prev: Finding[], curr: Finding[]): DiffResult {
  // Build maps from id to status
  const prevMap = new Map<string, 'confirmed' | 'ghost'>();
  for (const finding of prev) {
    prevMap.set(finding.id, finding.status);
  }

  const currMap = new Map<string, 'confirmed' | 'ghost'>();
  for (const finding of curr) {
    currMap.set(finding.id, finding.status);
  }

  // Compute the five disjoint sets
  const appeared: string[] = [];
  const still: string[] = [];
  const resolved: string[] = [];
  const promoted: string[] = [];
  const demoted: string[] = [];

  // Iterate through prevMap to identify 'still' and 'resolved'
  for (const [id, prevStatus] of prevMap) {
    if (currMap.has(id)) {
      // This id is in both maps: it's 'still'
      still.push(id);

      const currStatus = currMap.get(id)!;

      // Check for promotion or demotion
      if (prevStatus === 'ghost' && currStatus === 'confirmed') {
        promoted.push(id);
      } else if (prevStatus === 'confirmed' && currStatus === 'ghost') {
        demoted.push(id);
      }
    } else {
      // This id is in prevMap but not currMap: it's 'resolved'
      resolved.push(id);
    }
  }

  // Iterate through currMap to identify 'appeared'
  for (const id of currMap.keys()) {
    if (!prevMap.has(id)) {
      // This id is in currMap but not prevMap: it's 'appeared'
      appeared.push(id);
    }
  }

  return {
    appeared,
    still,
    resolved,
    promoted,
    demoted,
  };
}
