import { promises as fs } from 'fs';
import path from 'path';
import { stableStringify } from './stableJson.js';
import type {
  Finding,
  DiffResult,
  RunRecord,
  HistoryRecord,
  StoreData,
} from './types.js';

/**
 * Read the current store data from dataDir.
 * Returns empty defaults for any missing or unparseable files.
 */
export async function readStore(dataDir: string): Promise<StoreData> {
  const [findings, history, runs] = await Promise.all([
    readJsonFile<Finding[]>(path.join(dataDir, 'findings.json')),
    readJsonFile<HistoryRecord[]>(path.join(dataDir, 'history.json')),
    readJsonFile<RunRecord[]>(path.join(dataDir, 'runs.json')),
  ]);

  return {
    findings: findings || [],
    history: history || [],
    runs: runs || [],
  };
}

/**
 * Write updated store files atomically with retention, sorting, and stale derivation.
 */
export async function writeStore(
  dataDir: string,
  findings: Finding[],
  diff: DiffResult,
  runRecord: RunRecord,
  retentionDays: number,
): Promise<void> {
  // Ensure data directory exists
  await fs.mkdir(dataDir, { recursive: true });

  // 1. Filter out resolved findings older than retentionDays
  const now = Date.now();
  const retentionMs = retentionDays * 86400000;
  const retained = findings.filter((f) => {
    if (!f.resolvedAt) return true;
    const resolvedTime = new Date(f.resolvedAt).getTime();
    return now - resolvedTime <= retentionMs;
  });

  // 2. Sort by id ascending
  retained.sort((a, b) => a.id.localeCompare(b.id));

  // 3. Derive stale field: if any evidence entry has staleError, set stale: true
  const findingsWithStale = retained.map((f) => {
    const hasStaleError = f.evidence.some((e) => e.staleError);
    const result = { ...f };
    if (hasStaleError) {
      result.stale = true;
    } else {
      delete result.stale;
    }
    return result;
  });

  // 4. Read existing history and runs (or initialize to [])
  const existingStore = await readStore(dataDir);

  // 5. Append new HistoryRecord to history
  const newHistory = [...existingStore.history];
  const historyRecord: HistoryRecord = {
    runAt: runRecord.runAt,
    appeared: diff.appeared,
    still: diff.still,
    resolved: diff.resolved,
    promoted: diff.promoted,
    demoted: diff.demoted,
  };
  newHistory.push(historyRecord);

  // 6. Append new RunRecord to runs
  const newRuns = [...existingStore.runs];
  newRuns.push(runRecord);

  // 7. Write all three files atomically
  await writeFileAtomically(
    path.join(dataDir, 'findings.json'),
    stableStringify(findingsWithStale),
  );
  await writeFileAtomically(
    path.join(dataDir, 'history.json'),
    stableStringify(newHistory),
  );
  await writeFileAtomically(
    path.join(dataDir, 'runs.json'),
    stableStringify(newRuns),
  );
}

/**
 * Read and parse a JSON file, returning null if it doesn't exist or can't be parsed.
 */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    // Return null for ENOENT (file not found) or parse errors
    if (
      err instanceof Error &&
      (err.message.includes('ENOENT') ||
        err instanceof SyntaxError)
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Write a file atomically using a temp file and rename.
 */
async function writeFileAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);
  const tempPath = path.join(dir, `.${filename}.tmp`);

  // Write to temp file
  await fs.writeFile(tempPath, content, 'utf-8');

  // Atomically rename to final path
  await fs.rename(tempPath, filePath);
}
