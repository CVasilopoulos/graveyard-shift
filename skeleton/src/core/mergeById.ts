import type { Evidence, SourceResult } from './types.js';

/**
 * A partial finding output from merging source results.
 * This is the minimal set of fields produced by mergeById; rules functions
 * add additional fields like summary, severity, url, fix, and edits.
 */
export interface MergedFinding {
  id: string;
  title: string;
  sources: string[];
  evidence: Evidence[];
}

/**
 * Groups SourceResult items by finding id and deduplicates source names.
 *
 * Accepts an array of SourceResult values and returns an array of partial Finding objects.
 * Each output finding contains:
 * - id: the finding identifier
 * - title: taken from the first source item seen for that id
 * - sources: array of distinct source names that reported this id
 * - evidence: array of Evidence entries, one per source item that reported this id
 *
 * When the same source reports the same finding id more than once, only one Evidence entry
 * is included for that source on the merged output finding.
 *
 * The function never mutates its input arrays or the SourceResult objects within them.
 */
export function mergeById(results: SourceResult[]): MergedFinding[] {
  // Map from id to { title, sources: Set<string>, evidence: Evidence[] }
  const map = new Map<
    string,
    {
      title: string;
      sources: Set<string>;
      evidence: Evidence[];
    }
  >();

  // Process each SourceResult
  for (const result of results) {
    const { sourceName, findings } = result;

    // Process each finding in this source
    for (const item of findings) {
      const { id, title, details } = item;

      if (!map.has(id)) {
        // First time seeing this id: insert with title, one source name, and one Evidence entry
        const evidence: Evidence[] = [
          {
            sourceName,
            text: title,
          },
        ];

        map.set(id, {
          title,
          sources: new Set([sourceName]),
          evidence,
        });
      } else {
        // id already in map
        const entry = map.get(id)!;

        if (!entry.sources.has(sourceName)) {
          // New source reporting this id: add sourceName and one Evidence entry
          entry.sources.add(sourceName);
          entry.evidence.push({
            sourceName,
            text: title,
          });
        }
        // If sourceName already in sources: skip (de-duplicate)
      }
    }
  }

  // Convert map to array: { id, title, sources: Array, evidence }
  const output: MergedFinding[] = [];

  for (const [id, entry] of map.entries()) {
    output.push({
      id,
      title: entry.title,
      sources: Array.from(entry.sources),
      evidence: entry.evidence,
    });
  }

  return output;
}
