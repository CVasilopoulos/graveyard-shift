import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readStore, writeStore } from '../../src/core/store.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, DiffResult, RunRecord } from '../../src/core/types.js';

describe('store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tmpDir = path.join(os.tmpdir(), `store-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('readStore returns empty defaults on an empty directory', async () => {
    const result = await readStore(tmpDir);
    expect(result).toEqual({
      findings: [],
      history: [],
      runs: [],
    });
  });

  it('writeStore and readStore round-trip findings, history, and runs', async () => {
    const findings: Finding[] = [
      {
        id: 'finding-1',
        title: 'Test Finding 1',
        summary: 'This is a test',
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
    ];

    const diff: DiffResult = {
      appeared: ['finding-1'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 1,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings, diff, runRecord, 14);

    const result = await readStore(tmpDir);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(findings[0]);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toEqual({
      runAt: runRecord.runAt,
      appeared: diff.appeared,
      still: diff.still,
      resolved: diff.resolved,
      promoted: diff.promoted,
      demoted: diff.demoted,
    });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toEqual(runRecord);
  });

  it('writeStore filters out resolved findings older than retentionDays', async () => {
    const now = new Date();
    const oldResolved = new Date(now.getTime() - 20 * 86400000); // 20 days ago
    const recentResolved = new Date(now.getTime() - 5 * 86400000); // 5 days ago

    const findings: Finding[] = [
      {
        id: 'old-resolved',
        title: 'Old Resolved',
        summary: 'This is old',
        severity: 'low',
        status: 'confirmed',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
        resolvedAt: oldResolved.toISOString(),
      },
      {
        id: 'recent-resolved',
        title: 'Recent Resolved',
        summary: 'This is recent',
        severity: 'low',
        status: 'confirmed',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
        resolvedAt: recentResolved.toISOString(),
      },
      {
        id: 'unresolved',
        title: 'Unresolved',
        summary: 'This is active',
        severity: 'high',
        status: 'confirmed',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: now.toISOString(),
      },
    ];

    const diff: DiffResult = {
      appeared: [],
      still: ['unresolved'],
      resolved: ['old-resolved', 'recent-resolved'],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: now.toISOString(),
      confirmedCount: 1,
      ghostCount: 0,
      resolvedCount: 2,
      errorSources: [],
    };

    // 14 day retention
    await writeStore(tmpDir, findings, diff, runRecord, 14);

    const result = await readStore(tmpDir);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('unresolved');
    expect(ids).toContain('recent-resolved');
    expect(ids).not.toContain('old-resolved');
  });

  it('writeStore sets stale: true when evidence has staleError', async () => {
    const findings: Finding[] = [
      {
        id: 'finding-with-stale',
        title: 'Stale Finding',
        summary: 'This has stale evidence',
        severity: 'high',
        status: 'confirmed',
        sources: ['source1', 'source2'],
        evidence: [
          { sourceName: 'source1', text: 'Found by source 1' },
          {
            sourceName: 'source2',
            text: 'Found by source 2',
            staleError: 'Connection timeout',
          },
        ],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
    ];

    const diff: DiffResult = {
      appeared: [],
      still: ['finding-with-stale'],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 1,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources: ['source2'],
    };

    await writeStore(tmpDir, findings, diff, runRecord, 14);

    const result = await readStore(tmpDir);
    expect(result.findings[0].stale).toBe(true);
  });

  it('writeStore omits stale field when no evidence has staleError', async () => {
    const findings: Finding[] = [
      {
        id: 'finding-no-stale',
        title: 'Fresh Finding',
        summary: 'This has no stale evidence',
        severity: 'high',
        status: 'confirmed',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found by source 1' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
    ];

    const diff: DiffResult = {
      appeared: ['finding-no-stale'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 1,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings, diff, runRecord, 14);

    const result = await readStore(tmpDir);
    expect(result.findings[0].stale).toBeUndefined();
  });

  it('writeStore sorts findings by id in ascending order', async () => {
    const findings: Finding[] = [
      {
        id: 'zebra-finding',
        title: 'Z Finding',
        summary: 'Z',
        severity: 'low',
        status: 'ghost',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
      {
        id: 'apple-finding',
        title: 'A Finding',
        summary: 'A',
        severity: 'low',
        status: 'ghost',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
      {
        id: 'middle-finding',
        title: 'M Finding',
        summary: 'M',
        severity: 'low',
        status: 'ghost',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
    ];

    const diff: DiffResult = {
      appeared: ['zebra-finding', 'apple-finding', 'middle-finding'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 0,
      ghostCount: 3,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings, diff, runRecord, 14);

    const result = await readStore(tmpDir);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(['apple-finding', 'middle-finding', 'zebra-finding']);
  });

  it('writeStore appends to existing history and runs', async () => {
    // First write
    const findings1: Finding[] = [
      {
        id: 'finding-1',
        title: 'Finding 1',
        summary: 'First',
        severity: 'low',
        status: 'ghost',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
    ];

    const diff1: DiffResult = {
      appeared: ['finding-1'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord1: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 0,
      ghostCount: 1,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings1, diff1, runRecord1, 14);

    // Second write
    const findings2: Finding[] = [
      {
        id: 'finding-2',
        title: 'Finding 2',
        summary: 'Second',
        severity: 'low',
        status: 'ghost',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-03T00:00:00Z',
        lastSeen: '2024-01-04T00:00:00Z',
      },
    ];

    const diff2: DiffResult = {
      appeared: ['finding-2'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord2: RunRecord = {
      runAt: '2024-01-04T00:00:00Z',
      confirmedCount: 0,
      ghostCount: 1,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings2, diff2, runRecord2, 14);

    // Verify both history entries and run records exist
    const result = await readStore(tmpDir);
    expect(result.history).toHaveLength(2);
    expect(result.runs).toHaveLength(2);
    expect(result.history[0].runAt).toBe('2024-01-02T00:00:00Z');
    expect(result.history[1].runAt).toBe('2024-01-04T00:00:00Z');
    expect(result.runs[0].runAt).toBe('2024-01-02T00:00:00Z');
    expect(result.runs[1].runAt).toBe('2024-01-04T00:00:00Z');
  });

  it('readStore returns [] when files exist but contain unparseable JSON', async () => {
    // Write invalid JSON files
    await fs.writeFile(path.join(tmpDir, 'findings.json'), 'not valid json');
    await fs.writeFile(path.join(tmpDir, 'history.json'), 'invalid');
    await fs.writeFile(path.join(tmpDir, 'runs.json'), '{bad}');

    const result = await readStore(tmpDir);
    expect(result).toEqual({
      findings: [],
      history: [],
      runs: [],
    });
  });

  it('writeStore handles zero retention days', async () => {
    const now = new Date();
    const oldResolved = new Date(now.getTime() - 1000); // Just over 0 days ago

    const findings: Finding[] = [
      {
        id: 'resolved',
        title: 'Resolved',
        summary: 'This is resolved',
        severity: 'low',
        status: 'confirmed',
        sources: ['source1'],
        evidence: [{ sourceName: 'source1', text: 'Found' }],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
        resolvedAt: oldResolved.toISOString(),
      },
    ];

    const diff: DiffResult = {
      appeared: [],
      still: [],
      resolved: ['resolved'],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: now.toISOString(),
      confirmedCount: 0,
      ghostCount: 0,
      resolvedCount: 1,
      errorSources: [],
    };

    // 0 day retention
    await writeStore(tmpDir, findings, diff, runRecord, 0);

    const result = await readStore(tmpDir);
    expect(result.findings).toHaveLength(0);
  });

  it('files written by writeStore are valid JSON with sorted keys', async () => {
    const findings: Finding[] = [
      {
        id: 'finding-1',
        title: 'Test Finding',
        summary: 'Test',
        severity: 'high',
        status: 'confirmed',
        sources: ['source1', 'source2'],
        evidence: [
          { sourceName: 'source1', text: 'Found 1' },
          { sourceName: 'source2', text: 'Found 2' },
        ],
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-01-02T00:00:00Z',
      },
    ];

    const diff: DiffResult = {
      appeared: ['finding-1'],
      still: [],
      resolved: [],
      promoted: [],
      demoted: [],
    };

    const runRecord: RunRecord = {
      runAt: '2024-01-02T00:00:00Z',
      confirmedCount: 1,
      ghostCount: 0,
      resolvedCount: 0,
      errorSources: [],
    };

    await writeStore(tmpDir, findings, diff, runRecord, 14);

    // Verify files are valid JSON
    const findingsContent = await fs.readFile(
      path.join(tmpDir, 'findings.json'),
      'utf-8',
    );
    const historyContent = await fs.readFile(
      path.join(tmpDir, 'history.json'),
      'utf-8',
    );
    const runsContent = await fs.readFile(
      path.join(tmpDir, 'runs.json'),
      'utf-8',
    );

    expect(() => JSON.parse(findingsContent)).not.toThrow();
    expect(() => JSON.parse(historyContent)).not.toThrow();
    expect(() => JSON.parse(runsContent)).not.toThrow();

    // Verify trailing newlines
    expect(findingsContent).toMatch(/\n$/);
    expect(historyContent).toMatch(/\n$/);
    expect(runsContent).toMatch(/\n$/);
  });
});
