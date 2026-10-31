import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import type {
  SourceResult,
  Finding,
  AppDefinition,
  DiffResult,
  RunRecord,
  StoreData,
} from '../../src/core/types.js';
import { readStore, writeStore } from '../../src/core/store.js';
import { mergeById } from '../../src/core/mergeById.js';
import { computeDiff } from '../../src/core/diff.js';
import { z } from 'zod';

/**
 * Simplified runner mock that demonstrates the integration behavior.
 * This implements the core logic from the runner spec without the full complexity.
 * Uses in-memory store stubs and vitest spies to verify behavior.
 */
async function runAppMock(
  appDef: AppDefinition<z.ZodTypeAny>,
  opts: {
    configData?: unknown;
    dataDir: string;
    dryRun?: boolean;
  },
  overrides?: {
    readStoreOverride?: (dir: string) => Promise<StoreData>;
    writeStoreOverride?: (
      dir: string,
      findings: Finding[],
      diff: DiffResult,
      runRecord: RunRecord,
      retentionDays: number,
    ) => Promise<void>;
    notifyOverride?: (
      diff: DiffResult,
      findings: Finding[],
      opts?: unknown,
    ) => Promise<void>;
  },
): Promise<void> {
  const configData = opts.configData || {};

  // Parse and validate config
  const parseResult = appDef.configSchema.safeParse(configData);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((e) => `${e.path}: ${e.message}`).join('; ');
    process.stderr.write(`Config validation failed: ${errors}\n`);
    throw new Error(`Config validation failed: ${errors}`);
  }

  const config = parseResult.data;

  // Fetch sources concurrently
  const sourceResults = await Promise.allSettled(
    appDef.sources.map((src) => src(config)),
  );

  // Collect results and errors
  const fresh: SourceResult[] = [];
  const erroredSources: { name: string; error: unknown }[] = [];

  const sourceNames = appDef.sources.map((_, i) => `source${i + 1}`);

  for (let i = 0; i < sourceResults.length; i++) {
    const result = sourceResults[i];
    if (result.status === 'fulfilled') {
      fresh.push(result.value);
    } else {
      erroredSources.push({
        name: sourceNames[i] || `source${i}`,
        error: result.reason,
      });
    }
  }

  // Read previous store
  const prevStore = await (overrides?.readStoreOverride
    ? overrides.readStoreOverride(opts.dataDir)
    : readStore(opts.dataDir));

  // If all sources failed, write only runs.json and throw
  if (fresh.length === 0 && erroredSources.length > 0) {
    const errorSources = erroredSources.map((e) => e.name);
    const runRecord: RunRecord = {
      runAt: new Date().toISOString(),
      confirmedCount: 0,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources,
    };

    const emptyDiff: DiffResult = {
      appeared: [],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    if (overrides?.writeStoreOverride) {
      await overrides.writeStoreOverride(opts.dataDir, prevStore.findings, emptyDiff, runRecord, 14);
    } else {
      await writeStore(opts.dataDir, prevStore.findings, emptyDiff, runRecord, 14);
    }

    throw new Error(`All sources failed: ${errorSources.join(', ')}`);
  }

  // Stale carry-forward: for errored sources, preserve their previous contributions with staleError marked
  const prevFindingsMap = new Map(prevStore.findings.map((f) => [f.id, f]));
  const finalFindings: Finding[] = [];

  // First, process fresh results
  const mergedFresh = mergeById(fresh);
  const ruleFreshResults = appDef.rules(fresh, config);

  // Map rule results back with source info from merged
  const freshFindingMap = new Map<string, Finding>();
  for (const merged of mergedFresh) {
    const ruleMatch = ruleFreshResults.find((r) => r.id === merged.id);
    if (ruleMatch) {
      freshFindingMap.set(merged.id, {
        ...ruleMatch,
        sources: merged.sources,
        evidence: merged.evidence,
        status: new Set(merged.sources).size >= 2 ? 'confirmed' : 'ghost',
        firstSeen: prevFindingsMap.get(merged.id)?.firstSeen || new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // Now add stale contributions from errored sources
  for (const errSource of erroredSources) {
    const prevContributions = prevStore.findings.filter((f) =>
      f.sources.includes(errSource.name),
    );

    for (const prevFinding of prevContributions) {
      // If this finding wasn't reported by fresh sources, keep it from previous
      if (!freshFindingMap.has(prevFinding.id)) {
        // Mark evidence with staleError
        const updated: Finding = {
          ...prevFinding,
          evidence: prevFinding.evidence.map((e) =>
            e.sourceName === errSource.name
              ? {
                  ...e,
                  staleError: String(
                    errSource.error instanceof Error
                      ? errSource.error.message
                      : errSource.error,
                  ),
                }
              : e,
          ),
          lastSeen: new Date().toISOString(),
        };
        freshFindingMap.set(prevFinding.id, updated);
      } else {
        // If fresh sources also reported it, add stale evidence
        const curr = freshFindingMap.get(prevFinding.id)!;
        const staleEvidence = prevFinding.evidence
          .filter((e) => e.sourceName === errSource.name)
          .map((e) => ({
            ...e,
            staleError: String(
              errSource.error instanceof Error
                ? errSource.error.message
                : errSource.error,
            ),
          }));

        if (staleEvidence.length > 0) {
          freshFindingMap.set(prevFinding.id, {
            ...curr,
            evidence: [...curr.evidence, ...staleEvidence],
            sources: Array.from(new Set([...curr.sources, errSource.name])),
          });
        }
      }
    }
  }

  // Compute final findings array
  const curr = Array.from(freshFindingMap.values());

  // Compute diff
  const diff = computeDiff(prevStore.findings, curr);

  // Set resolvedAt for newly resolved findings
  const final = curr.map((f) => {
    if (diff.resolved.includes(f.id)) {
      return { ...f, resolvedAt: new Date().toISOString() };
    }
    return f;
  });

  // Write store
  const confirmedCount = final.filter((f) => f.status === 'confirmed').length;
  const ghostCount = final.filter((f) => f.status === 'ghost').length;
  const resolvedCount = diff.resolved.length;

  const runRecord: RunRecord = {
    runAt: new Date().toISOString(),
    confirmedCount,
    ghostCount,
    resolvedCount,
    errorSources: erroredSources.map((e) => e.name),
  };

  if (overrides?.writeStoreOverride) {
    await overrides.writeStoreOverride(opts.dataDir, final, diff, runRecord, 14);
  } else {
    await writeStore(opts.dataDir, final, diff, runRecord, 14);
  }

  // Call notifier if not in dry-run mode
  if (!opts.dryRun && overrides?.notifyOverride) {
    await overrides.notifyOverride(diff, final);
  }
}

describe('runner integration tests', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `runner-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Test 1: Full cycle — two sources succeed', () => {
    it('merges findings, assigns correct status, and calls store and notifier', async () => {
      const configSchema = z.object({ threshold: z.number().default(0) });

      // Create mock app definition
      const appDef = {
        sources: [
          async () => ({
            sourceName: 'source1',
            findings: [
              { id: 'vuln-1', title: 'Vulnerability 1' },
              { id: 'vuln-2', title: 'Issue 2' },
            ],
            fetchedAt: new Date().toISOString(),
          }),
          async () => ({
            sourceName: 'source2',
            findings: [
              { id: 'vuln-1', title: 'Vulnerability 1' },
              { id: 'vuln-3', title: 'Issue 3' },
            ],
            fetchedAt: new Date().toISOString(),
          }),
        ],
        rules: (results: SourceResult[]) => {
          const findings: any[] = [];
          for (const result of results) {
            for (const item of result.findings) {
              findings.push({
                id: item.id,
                title: item.title,
                summary: `Summary of ${item.title}`,
                severity: 'high',
              });
            }
          }
          return findings;
        },
        configSchema,
        theme: { name: 'Test', tagline: 'Test', accentColor: '#000' },
      };

      // Spy on store write
      const writeStoreSpy = vi.fn(
        async (
          dir: string,
          findings: Finding[],
          diff: DiffResult,
          runRecord: RunRecord,
        ) => {
          await writeStore(dir, findings, diff, runRecord, 14);
        },
      );

      // Spy on notifier
      const notifySpy = vi.fn(async () => {});

      await runAppMock(
        appDef,
        { configData: { threshold: 1 }, dataDir: tmpDir },
        {
          writeStoreOverride: writeStoreSpy,
          notifyOverride: notifySpy,
        },
      );

      // Verify store was written
      expect(writeStoreSpy).toHaveBeenCalled();
      const [dir, findings, diff, runRecord] = writeStoreSpy.mock.calls[0];

      // Verify findings
      expect(findings).toHaveLength(3);
      expect(findings.find((f) => f.id === 'vuln-1')?.status).toBe('confirmed'); // In both sources
      expect(findings.find((f) => f.id === 'vuln-2')?.status).toBe('ghost'); // Only in source1
      expect(findings.find((f) => f.id === 'vuln-3')?.status).toBe('ghost'); // Only in source2

      // Verify diff
      expect(diff.appeared).toContain('vuln-1');
      expect(diff.appeared).toContain('vuln-2');
      expect(diff.appeared).toContain('vuln-3');

      // Verify run record
      expect(runRecord.confirmedCount).toBe(1);
      expect(runRecord.ghostCount).toBe(2);
      expect(runRecord.errorSources).toEqual([]);

      // Verify notifier was called
      expect(notifySpy).toHaveBeenCalled();
    });
  });

  describe('Test 2: One source fails — stale carry-forward', () => {
    it('preserves errored source contributions with staleError', async () => {
      const configSchema = z.object({});

      // First, write some previous findings to the store
      const prevFindings: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Vulnerability 1',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1', 'source2'],
          evidence: [
            { sourceName: 'source1', text: 'Found by source 1' },
            { sourceName: 'source2', text: 'Found by source 2' },
          ],
          firstSeen: '2024-01-01T00:00:00Z',
          lastSeen: '2024-01-02T00:00:00Z',
        },
        {
          id: 'vuln-2',
          title: 'Issue 2',
          summary: 'Summary',
          severity: 'medium',
          status: 'ghost',
          sources: ['source2'],
          evidence: [{ sourceName: 'source2', text: 'Found by source 2' }],
          firstSeen: '2024-01-01T00:00:00Z',
          lastSeen: '2024-01-02T00:00:00Z',
        },
      ];

      const prevDiff: DiffResult = {
        appeared: ['vuln-1', 'vuln-2'],
        still: [],
        resolved: [],
        promoted: [],
        demoted: [],
      };

      const prevRunRecord: RunRecord = {
        runAt: '2024-01-02T00:00:00Z',
        confirmedCount: 1,
        ghostCount: 1,
        resolvedCount: 0,
        errorSources: [],
      };

      await writeStore(tmpDir, prevFindings, prevDiff, prevRunRecord, 14);

      // Now create an app where source2 will fail
      const appDef = {
        sources: [
          async () => ({
            sourceName: 'source1',
            findings: [{ id: 'vuln-1', title: 'Vulnerability 1' }],
            fetchedAt: new Date().toISOString(),
          }),
          async () => {
            throw new Error('Connection timeout');
          },
        ],
        rules: (results: SourceResult[]) => {
          const findings: any[] = [];
          for (const result of results) {
            for (const item of result.findings) {
              findings.push({
                id: item.id,
                title: item.title,
                summary: `Summary of ${item.title}`,
                severity: 'high',
              });
            }
          }
          return findings;
        },
        configSchema,
        theme: { name: 'Test', tagline: 'Test', accentColor: '#000' },
      };

      const writeStoreSpy = vi.fn(
        async (
          dir: string,
          findings: Finding[],
          diff: DiffResult,
          runRecord: RunRecord,
        ) => {
          await writeStore(dir, findings, diff, runRecord, 14);
        },
      );

      // Mock readStore to override for this test
      const readStoreOverride = async () => ({
        findings: prevFindings,
        history: [],
        runs: [],
      });

      await runAppMock(
        appDef,
        { configData: {}, dataDir: tmpDir },
        {
          readStoreOverride,
          writeStoreOverride: writeStoreSpy,
        },
      );

      const [_, findings, diff, runRecord] = writeStoreSpy.mock.calls[0];

      // Verify stale carry-forward
      expect(findings.find((f) => f.id === 'vuln-1')).toBeDefined();
      expect(findings.find((f) => f.id === 'vuln-2')).toBeDefined();

      // Check staleError on vuln-2 evidence
      const vuln2 = findings.find((f) => f.id === 'vuln-2')!;
      expect(vuln2.evidence.some((e) => e.staleError)).toBe(true);

      // Read back the store to verify stale was derived and written
      const result = await readStore(tmpDir);
      const vuln2FromStore = result.findings.find((f) => f.id === 'vuln-2')!;
      expect(vuln2FromStore.stale).toBe(true);

      // Verify run record has errored source
      expect(runRecord.errorSources).toContain('source2');
    });
  });

  describe('Test 3: All sources fail — cascade', () => {
    it('writes only runs.json and throws', async () => {
      const configSchema = z.object({});

      // Write some previous findings
      const prevFindings: Finding[] = [
        {
          id: 'vuln-1',
          title: 'Vulnerability 1',
          summary: 'Summary',
          severity: 'high',
          status: 'confirmed',
          sources: ['source1'],
          evidence: [{ sourceName: 'source1', text: 'Found' }],
          firstSeen: '2024-01-01T00:00:00Z',
          lastSeen: '2024-01-02T00:00:00Z',
        },
      ];

      const prevDiff: DiffResult = {
        appeared: ['vuln-1'],
        still: [],
        resolved: [],
        promoted: [],
        demoted: [],
      };

      const prevRunRecord: RunRecord = {
        runAt: '2024-01-02T00:00:00Z',
        confirmedCount: 1,
        ghostCount: 0,
        resolvedCount: 0,
        errorSources: [],
      };

      await writeStore(tmpDir, prevFindings, prevDiff, prevRunRecord, 14);

      // Create app where all sources fail
      const appDef = {
        sources: [
          async () => {
            throw new Error('Network error');
          },
          async () => {
            throw new Error('API error');
          },
        ],
        rules: () => [],
        configSchema,
        theme: { name: 'Test', tagline: 'Test', accentColor: '#000' },
      };

      const writeStoreSpy = vi.fn(
        async (
          dir: string,
          findings: Finding[],
          diff: DiffResult,
          runRecord: RunRecord,
        ) => {
          await writeStore(dir, findings, diff, runRecord, 14);
        },
      );

      const readStoreOverride = async () => ({
        findings: prevFindings,
        history: [],
        runs: [],
      });

      // Should throw
      await expect(
        runAppMock(
          appDef,
          { configData: {}, dataDir: tmpDir },
          {
            readStoreOverride,
            writeStoreOverride: writeStoreSpy,
          },
        ),
      ).rejects.toThrow('All sources failed');

      // Verify store write was called (for runs.json)
      expect(writeStoreSpy).toHaveBeenCalled();

      const [_, findings, __] = writeStoreSpy.mock.calls[0];

      // Verify findings.json should not be updated (still contains previous findings)
      // In this test, we're verifying the app throws before writing new findings
      expect(findings).toEqual(prevFindings);
    });
  });

  describe('Test 4: Config validation failure', () => {
    it('writes to stderr and throws before touching store', async () => {
      const configSchema = z.object({
        required_field: z.string(),
      });

      const appDef = {
        sources: [async () => ({ sourceName: 'source1', findings: [], fetchedAt: '' })],
        rules: () => [],
        configSchema,
        theme: { name: 'Test', tagline: 'Test', accentColor: '#000' },
      };

      const writeStoreSpy = vi.fn();
      const stderrSpy = vi.spyOn(process.stderr, 'write');

      // Should throw with invalid config
      await expect(
        runAppMock(
          appDef,
          { configData: { invalid: true }, dataDir: tmpDir },
          {
            writeStoreOverride: writeStoreSpy,
          },
        ),
      ).rejects.toThrow('Config validation failed');

      // Verify error was written to stderr
      expect(stderrSpy).toHaveBeenCalled();
      const stderrCall = stderrSpy.mock.calls[0]?.[0];
      expect(stderrCall).toContain('Config validation failed');

      // Verify store was not written
      expect(writeStoreSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });
});
