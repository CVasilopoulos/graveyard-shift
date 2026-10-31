import type { z } from 'zod';

/**
 * One entry per source on a Finding that records what that source reported.
 */
export interface Evidence {
  sourceName: string;
  text: string;
  link?: string;
  staleError?: string;
}

/**
 * An optional object on a Finding that describes the recommended remediation.
 */
export interface Fix {
  text: string;
  value?: string;
}

/**
 * A proposed file change carried by a Finding.
 */
export interface Edit {
  path: string;
  newContent: string;
}

/**
 * The central data structure: a structured record of one detected issue.
 */
export interface Finding {
  id: string;
  title: string;
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'confirmed' | 'ghost';
  sources: string[];
  evidence: Evidence[];
  firstSeen: string;
  lastSeen: string;
  resolvedAt?: string;
  url?: string;
  fix?: Fix;
  edits?: Edit[];
  stale?: true;
}

/**
 * The typed return value of a single source.
 */
export interface SourceResult {
  sourceName: string;
  findings: Array<{
    id: string;
    title: string;
    details?: Record<string, unknown>;
  }>;
  fetchedAt: string;
}

/**
 * The typed contract an App exports: its sources array, rules function, zod config schema, and theme metadata.
 */
export interface AppDefinition<TSchema extends z.ZodTypeAny> {
  sources: Array<(config: z.infer<TSchema>) => Promise<SourceResult>>;
  rules: (
    results: SourceResult[],
    config: z.infer<TSchema>,
  ) => Array<Omit<Finding, 'firstSeen' | 'lastSeen' | 'resolvedAt' | 'stale'>>;
  configSchema: TSchema;
  theme: {
    name: string;
    tagline: string;
    accentColor: string;
    labels?: {
      confirmed?: string;
      ghost?: string;
      resolved?: string;
    };
  };
}

/**
 * The computed delta between the previous findings and the current run's findings.
 */
export interface DiffResult {
  appeared: string[];
  still: string[];
  resolved: string[];
  promoted: string[];
  demoted: string[];
}

/**
 * A summary written to runs.json for every completed runner execution.
 */
export interface RunRecord {
  runAt: string;
  confirmedCount: number;
  ghostCount: number;
  resolvedCount: number;
  errorSources: string[];
}

/**
 * One entry in the history.json append-only array.
 */
export interface HistoryRecord {
  runAt: string;
  appeared: string[];
  still: string[];
  resolved: string[];
  promoted: string[];
  demoted: string[];
}

/**
 * The full store data structure.
 */
export interface StoreData {
  findings: Finding[];
  history: HistoryRecord[];
  runs: RunRecord[];
}
