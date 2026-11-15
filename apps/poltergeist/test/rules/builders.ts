import type { SourceResult } from 'graveyard-shift';
import { findingId, type PackageVersion } from '../../src/lockfiles.js';
import type { GithubDetails } from '../../src/sources/github.js';
import type { OsvDetails } from '../../src/sources/osv.js';

const FETCHED_AT = '2026-11-15T00:00:00.000Z';

export const pkg: PackageVersion = { owner: 'o', repo: 'r', ecosystem: 'npm', name: 'pkg', version: '1.0.0' };

export function osvDetails(overrides: Partial<OsvDetails> & { id: string }): OsvDetails {
  return { ...pkg, aliases: [], severity: [], fixed: [], ...overrides };
}

export function githubDetails(overrides: Partial<GithubDetails> & { ghsa_id: string }): GithubDetails {
  return { ...pkg, cve_id: null, fixed_versions: [], ...overrides };
}

export function osvResult(...advisories: OsvDetails[]): SourceResult {
  return {
    sourceName: 'osv',
    fetchedAt: FETCHED_AT,
    findings: advisories.map((details) => ({
      id: findingId(details, details.id),
      title: `OSV ${details.id}: ${details.summary ?? 'no summary'}`,
      details: details as unknown as Record<string, unknown>,
    })),
  };
}

export function githubResult(...advisories: GithubDetails[]): SourceResult {
  return {
    sourceName: 'github',
    fetchedAt: FETCHED_AT,
    findings: advisories.map((details) => ({
      id: findingId(details, details.ghsa_id),
      title: `GitHub ${details.ghsa_id}: ${details.summary ?? 'no summary'}`,
      details: details as unknown as Record<string, unknown>,
    })),
  };
}
