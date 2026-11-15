import { createHttpClient, type SourceResult } from 'graveyard-shift';
import type { Config } from '../config.js';
import {
  distinctPackages,
  findingId,
  loadPackageVersions,
  packageKey,
  packageName,
  type PackageVersion,
} from '../lockfiles.js';

export const OSV_QUERYBATCH_URL = 'https://api.osv.dev/v1/querybatch';
export const OSV_VULNS_URL = 'https://api.osv.dev/v1/vulns/';
export const OSV_BATCH_SIZE = 1000;

export interface OsvSeverity {
  type: string;
  score: string;
}

export interface OsvDetails extends PackageVersion {
  id: string;
  aliases: string[];
  summary?: string;
  description?: string;
  severity: OsvSeverity[];
  database_specific?: { severity?: string };
  fixed: string[];
}

interface OsvQuery {
  package: { name: string; ecosystem: string };
  version: string;
  page_token?: string;
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: Array<{ id: string }>; next_page_token?: string }>;
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  withdrawn?: string;
  severity?: OsvSeverity[];
  database_specific?: { severity?: unknown };
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{ type?: string; events?: Array<Record<string, unknown>> }>;
  }>;
}

type HttpClient = ReturnType<typeof createHttpClient>;

export async function osv(config: Config): Promise<SourceResult> {
  const packages = await loadPackageVersions(config);
  const http = createHttpClient({});
  const queried = distinctPackages(packages);
  const idsByPackage = await queryAll(http, queried);

  const ids = [...new Set([...idsByPackage.values()].flat())];
  const fetched = await Promise.all(ids.map((id) => getVulnerability(http, id)));
  const resolved = new Map(ids.map((id, index) => [id, fetched[index]]));

  const findings: SourceResult['findings'] = [];
  for (const pkg of packages) {
    for (const id of idsByPackage.get(packageKey(pkg)) ?? []) {
      const advisory = resolved.get(id);
      if (!advisory || advisory.withdrawn) continue;
      const details: OsvDetails = {
        owner: pkg.owner,
        repo: pkg.repo,
        ecosystem: pkg.ecosystem,
        name: packageName(pkg),
        version: pkg.version,
        id: advisory.id,
        aliases: [...(advisory.aliases ?? [])],
        summary: advisory.summary,
        description: advisory.details,
        severity: [...(advisory.severity ?? [])],
        database_specific:
          typeof advisory.database_specific?.severity === 'string'
            ? { severity: advisory.database_specific.severity }
            : undefined,
        fixed: fixedVersions(advisory, pkg),
      };
      findings.push({
        id: findingId(pkg, advisory.id),
        title: `OSV ${advisory.id}: ${advisory.summary ?? firstLine(advisory.details) ?? 'no summary'}`,
        details: details as unknown as Record<string, unknown>,
      });
    }
  }

  return { sourceName: 'osv', findings, fetchedAt: new Date().toISOString() };
}

async function queryAll(http: HttpClient, packages: PackageVersion[]): Promise<Map<string, string[]>> {
  const ids = new Map<string, string[]>(packages.map((pkg) => [packageKey(pkg), []]));
  for (let start = 0; start < packages.length; start += OSV_BATCH_SIZE) {
    let pending = packages.slice(start, start + OSV_BATCH_SIZE).map((pkg) => ({
      key: packageKey(pkg),
      query: { package: { name: packageName(pkg), ecosystem: pkg.ecosystem }, version: pkg.version } as OsvQuery,
    }));
    while (pending.length > 0) {
      const response = await http.post(OSV_QUERYBATCH_URL, { queries: pending.map((item) => item.query) });
      const body = (await response.json()) as OsvBatchResponse;
      if (!Array.isArray(body.results) || body.results.length !== pending.length) {
        throw new Error(`OSV querybatch returned ${body.results?.length ?? 'no'} results for ${pending.length} queries`);
      }
      const next: typeof pending = [];
      body.results.forEach((result, index) => {
        const item = pending[index];
        const list = ids.get(item.key)!;
        for (const vuln of result.vulns ?? []) {
          if (!list.includes(vuln.id)) list.push(vuln.id);
        }
        if (result.next_page_token) {
          next.push({ key: item.key, query: { ...item.query, page_token: result.next_page_token } });
        }
      });
      pending = next;
    }
  }
  return ids;
}

async function getVulnerability(http: HttpClient, id: string): Promise<OsvVulnerability | undefined> {
  try {
    const response = await http.get(OSV_VULNS_URL + encodeURIComponent(id));
    return (await response.json()) as OsvVulnerability;
  } catch (err) {
    if ((err as { status?: unknown }).status === 404) {
      console.warn(`OSV has no advisory ${id} any more; skipping it`);
      return undefined;
    }
    throw err;
  }
}

function fixedVersions(advisory: OsvVulnerability, pkg: PackageVersion): string[] {
  const fixed = new Set<string>();
  for (const affected of advisory.affected ?? []) {
    if (affected.package?.ecosystem !== pkg.ecosystem) continue;
    if (packageName({ ecosystem: pkg.ecosystem, name: affected.package.name ?? '' }) !== packageName(pkg)) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;
      for (const event of range.events ?? []) {
        if (typeof event.fixed === 'string') fixed.add(event.fixed);
      }
    }
  }
  return [...fixed];
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.trim().split('\n')[0]?.trim();
  return line ? line : undefined;
}
