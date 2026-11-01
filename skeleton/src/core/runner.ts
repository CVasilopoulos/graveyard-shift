import { promises as fs } from 'fs';
import path from 'path';
import type { z } from 'zod';
import type { AppDefinition, Finding, SourceResult, RunRecord } from './types.js';
import { mergeById } from './mergeById.js';
import { applyAgreementRule } from './agreement.js';
import { computeDiff } from './diff.js';
import { readStore, writeStore } from './store.js';

/**
 * Options for the runner.
 */
export interface RunnerOptions {
  appDir: string;
  dataDir: string;
  configPath: string;
  dryRun?: boolean;
  resolvedRetentionDays?: number;
}

/**
 * Options passed to the notifier.
 */
interface NotifierOptions {
  repo?: string;
  dryRun?: boolean;
  maxNewIssues?: number;
  maxNewPRs?: number;
}

function notifierConfig(config: unknown): Omit<NotifierOptions, 'dryRun'> {
  if (typeof config !== 'object' || config === null) return {};
  const c = config as Record<string, unknown>;
  return {
    ...(typeof c.repo === 'string' ? { repo: c.repo } : {}),
    ...(typeof c.maxNewIssues === 'number' ? { maxNewIssues: c.maxNewIssues } : {}),
    ...(typeof c.maxNewPRs === 'number' ? { maxNewPRs: c.maxNewPRs } : {}),
  };
}

/**
 * Orchestrates the full app cycle:
 * 1. Config validation
 * 2. Fetch sources concurrently
 * 3. Stale carry-forward for errored sources
 * 4. Error cascade (all sources failed → throw)
 * 5. Rules application with agreement rule
 * 6. Timestamp management
 * 7. Diff and store
 * 8. Notify
 *
 * @throws On config validation failure, when all sources fail, or on any I/O error
 */
export async function runApp<TSchema extends z.ZodTypeAny>(
  appDef: AppDefinition<TSchema>,
  opts: RunnerOptions,
): Promise<void> {
  const retentionDays = opts.resolvedRetentionDays ?? 14;
  const now = new Date().toISOString();

  // 1. Config validation
  let config: z.infer<TSchema>;
  try {
    const configContent = await fs.readFile(opts.configPath, 'utf-8');
    const configData = JSON.parse(configContent) as unknown;
    const parseResult = appDef.configSchema.safeParse(configData);

    if (!parseResult.success) {
      // Write validation errors to stderr
      for (const fieldError of parseResult.error.issues) {
        const fieldPath = fieldError.path.join('.');
        const message = fieldError.message;
        console.error(`Config validation error at "${fieldPath}": ${message}`);
      }
      throw new Error('Config validation failed');
    }

    config = parseResult.data;
  } catch (err) {
    throw new Error(
      `Failed to load and validate config from ${opts.configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Fetch all sources concurrently
  const sourceResults: SourceResult[] = [];
  const erroredSources: Array<{ name: string; error: string }> = [];

  const sourcePromises = appDef.sources.map(async (sourceFunc, index) => {
    try {
      const result = await sourceFunc(config);
      return { success: true as const, index, result };
    } catch (err) {
      // Capture the source name from the function or use index
      const sourceName = sourceFunc.name || `source_${index}`;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false as const, sourceName, errorMsg };
    }
  });

  const results = await Promise.allSettled(sourcePromises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const value = result.value;
      if (value.success) {
        sourceResults.push(value.result);
      } else {
        erroredSources.push({ name: value.sourceName, error: value.errorMsg });
      }
    } else {
      // Promise rejected directly (shouldn't happen, but handle it)
      const sourceName = `source_unknown`;
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      erroredSources.push({ name: sourceName, error: errorMsg });
    }
  }

  // 5. If every source failed, write only runs.json and throw
  if (sourceResults.length === 0 && erroredSources.length > 0) {
    const runRecord: RunRecord = {
      runAt: now,
      confirmedCount: 0,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources: erroredSources.map((e) => e.name),
    };

    // Ensure data directory exists
    await fs.mkdir(opts.dataDir, { recursive: true });

    // Write only runs.json
    const existingStore = await readStore(opts.dataDir);
    const newRuns = [...existingStore.runs];
    newRuns.push(runRecord);

    // Write runs.json with stable formatting
    const { stableStringify } = await import('./stableJson.js');
    const runsPath = path.join(opts.dataDir, 'runs.json');
    const tempPath = path.join(opts.dataDir, `.runs.json.tmp`);
    await fs.writeFile(tempPath, stableStringify(newRuns), 'utf-8');
    await fs.rename(tempPath, runsPath);

    throw new Error(`All sources failed in run: ${erroredSources.map((e) => `${e.name}: ${e.error}`).join('; ')}`);
  }

  // Read previous store for stale carry-forward and timestamp management
  const prevStore = await readStore(opts.dataDir);
  const prevActive = prevStore.findings.filter((f) => !f.resolvedAt);

  // 3. Stale carry-forward
  const erroredSourceMap = new Map(erroredSources.map((e) => [e.name, e.error]));
  const staleResults: SourceResult[] = [];

  for (const { name: erroredName } of erroredSources) {
    const staleFindings: Array<{ id: string; title: string }> = [];

    for (const prevFinding of prevActive) {
      if (prevFinding.sources.includes(erroredName)) {
        // Find the evidence entry from this source in the previous finding
        const prevEvidence = prevFinding.evidence.find((e) => e.sourceName === erroredName);

        if (prevEvidence) {
          staleFindings.push({
            id: prevFinding.id,
            title: prevEvidence.text, // Use the previous evidence text as the title for carry-forward
          });
        }
      }
    }

    if (staleFindings.length > 0) {
      staleResults.push({
        sourceName: erroredName,
        findings: staleFindings,
        fetchedAt: now,
      });
    }
  }

  // Combine fresh and stale results
  const combinedResults = [...sourceResults, ...staleResults];

  // 4. Apply rules and agreement
  const partialFindings = appDef.rules(combinedResults, config);

  // Apply agreement rule to assign status
  const agreedFindings = applyAgreementRule(partialFindings);

  // 6. Build final findings with timestamps
  const currentFindings: Finding[] = agreedFindings.map((finding) => {
    // Find previous version of this finding
    const prevFinding = prevStore.findings.find((f) => f.id === finding.id);

    // Determine firstSeen: from previous store or now
    const firstSeen = prevFinding?.firstSeen ?? now;

    // Build evidence entries with staleError for errored sources
    const evidence = finding.evidence.map((e) => {
      const staleError = erroredSourceMap.get(e.sourceName);
      if (staleError) {
        return {
          ...e,
          staleError,
        };
      }
      return e;
    });

    return {
      id: finding.id,
      title: finding.title,
      summary: finding.summary,
      severity: finding.severity,
      status: finding.status,
      sources: finding.sources,
      evidence,
      firstSeen,
      lastSeen: now,
      url: finding.url,
      fix: finding.fix,
      edits: finding.edits,
    };
  });

  // 7. Diff and store
  // Compute diff between prev and current findings
  const diff = computeDiff(prevActive, currentFindings);

  // For findings that moved into the resolved set, set resolvedAt to now
  const resolvedIds = new Set(diff.resolved);
  const currentIds = new Set(currentFindings.map((f) => f.id));
  const stillResolved = prevStore.findings.filter((f) => f.resolvedAt && !currentIds.has(f.id));
  const resolvedFindings = prevActive
    .filter((f) => resolvedIds.has(f.id))
    .map((f) => ({
      ...f,
      resolvedAt: now,
      lastSeen: f.lastSeen, // Keep previous lastSeen for resolved findings
    }));

  // Combine current and resolved findings for storage
  const allFinalFindings = [...currentFindings, ...resolvedFindings, ...stillResolved];

  // Count statuses for run record
  const confirmedCount = currentFindings.filter((f) => f.status === 'confirmed').length;
  const ghostCount = currentFindings.filter((f) => f.status === 'ghost').length;
  const resolvedCount = resolvedFindings.length;

  const runRecord: RunRecord = {
    runAt: now,
    confirmedCount,
    ghostCount,
    resolvedCount,
    errorSources: erroredSources.map((e) => e.name),
  };

  await writeStore(opts.dataDir, allFinalFindings, diff, runRecord, retentionDays);

  // 8. Notify
  try {
    const { notify } = await import('../notify/notifier.js');
    const notifierOptions: NotifierOptions = { dryRun: opts.dryRun ?? false, ...notifierConfig(config) };
    await notify(diff, allFinalFindings, notifierOptions);
  } catch (err) {
    // Notifier errors should not fail the run, but log them
    console.error(`Notifier error: ${err instanceof Error ? err.message : String(err)}`);
    // Don't throw — the store has already been written
  }
}
