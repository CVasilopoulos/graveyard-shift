import { createHttpClient, type SourceResult } from 'graveyard-shift';
import type { Config, Ecosystem } from '../config.js';
import {
  distinctPackages,
  findingId,
  loadPackageVersions,
  packageKey,
  packageName,
  type PackageVersion,
} from '../lockfiles.js';

export const GITHUB_ADVISORIES_URL = 'https://api.github.com/advisories';

export interface GithubDetails extends PackageVersion {
  ghsa_id: string;
  cve_id: string | null;
  summary?: string;
  description?: string;
  severity?: string;
  fixed_versions: string[];
}

interface GithubAdvisory {
  ghsa_id: string;
  cve_id?: string | null;
  summary?: string;
  description?: string | null;
  severity?: string;
  withdrawn_at?: string | null;
  vulnerabilities?: Array<{
    package?: { ecosystem?: string; name?: string } | null;
    first_patched_version?: string | { identifier?: string } | null;
  }> | null;
}

type HttpClient = ReturnType<typeof createHttpClient>;

const githubEcosystem: Record<Ecosystem, string> = { npm: 'npm', PyPI: 'pip' };

export function advisoriesUrl(pkg: Pick<PackageVersion, 'ecosystem' | 'name' | 'version'>): string {
  const query = new URLSearchParams({
    ecosystem: githubEcosystem[pkg.ecosystem],
    affects: `${packageName(pkg)}@${pkg.version}`,
    per_page: '100',
  });
  return `${GITHUB_ADVISORIES_URL}?${query}`;
}

export async function github(config: Config): Promise<SourceResult> {
  const packages = await loadPackageVersions(config);
  const http = createHttpClient({});
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const queried = distinctPackages(packages);
  const lists = await Promise.all(queried.map((pkg) => listAdvisories(http, advisoriesUrl(pkg), headers)));
  const byPackage = new Map(queried.map((pkg, index) => [packageKey(pkg), lists[index]]));

  const findings: SourceResult['findings'] = [];
  for (const pkg of packages) {
    for (const advisory of byPackage.get(packageKey(pkg)) ?? []) {
      if (advisory.withdrawn_at) continue;
      const details: GithubDetails = {
        owner: pkg.owner,
        repo: pkg.repo,
        ecosystem: pkg.ecosystem,
        name: packageName(pkg),
        version: pkg.version,
        ghsa_id: advisory.ghsa_id,
        cve_id: advisory.cve_id ?? null,
        summary: advisory.summary,
        description: advisory.description ?? undefined,
        severity: advisory.severity,
        fixed_versions: patchedVersions(advisory, pkg),
      };
      findings.push({
        id: findingId(pkg, advisory.ghsa_id),
        title: `GitHub ${advisory.ghsa_id}${advisory.cve_id ? ` (${advisory.cve_id})` : ''}: ${advisory.summary ?? 'no summary'}`,
        details: details as unknown as Record<string, unknown>,
      });
    }
  }

  return { sourceName: 'github', findings, fetchedAt: new Date().toISOString() };
}

async function listAdvisories(http: HttpClient, firstPage: string, headers: Record<string, string>): Promise<GithubAdvisory[]> {
  const advisories: GithubAdvisory[] = [];
  let url: string | undefined = firstPage;
  while (url) {
    const response = await http.get(url, { headers });
    const page = (await response.json()) as unknown;
    if (!Array.isArray(page)) throw new Error(`GitHub advisories returned a non-list body for ${url}`);
    advisories.push(...(page as GithubAdvisory[]));
    url = nextLink(response.headers.get('link'));
  }
  return advisories;
}

export function nextLink(header: string | null): string | undefined {
  for (const part of header?.split(',') ?? []) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return undefined;
}

function patchedVersions(advisory: GithubAdvisory, pkg: PackageVersion): string[] {
  const fixed = new Set<string>();
  for (const vulnerability of advisory.vulnerabilities ?? []) {
    const affected = vulnerability.package;
    if (!affected || affected.ecosystem !== githubEcosystem[pkg.ecosystem]) continue;
    if (packageName({ ecosystem: pkg.ecosystem, name: affected.name ?? '' }) !== packageName(pkg)) continue;
    const patched = vulnerability.first_patched_version;
    const version = typeof patched === 'string' ? patched : patched?.identifier;
    if (version) fixed.add(version);
  }
  return [...fixed];
}
