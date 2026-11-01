// Package entry point: re-exports all public types and functions

export type {
  Finding,
  SourceResult,
  AppDefinition,
  Evidence,
  Fix,
  Edit,
  DiffResult,
  HistoryRecord,
  RunRecord,
  StoreData,
} from './core/types.js';

export { mergeById } from './core/mergeById.js';
export { applyAgreementRule } from './core/agreement.js';
export { computeDiff } from './core/diff.js';
export { stableStringify } from './core/stableJson.js';
export { createHttpClient } from './sources/http.js';
export { createMcpServer } from './mcp/server.js';
export { notify } from './notify/notifier.js';
export { runApp } from './core/runner.js';
export { readStore, writeStore } from './core/store.js';
