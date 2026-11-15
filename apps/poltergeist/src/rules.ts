import { mergeById, type PartialFinding, type SourceResult } from 'graveyard-shift';
import type { Config, Ecosystem } from './config.js';
import { cvss3BaseScore, severityFromScore } from './cvss.js';
import { findingId, packageKey } from './lockfiles.js';
import type { GithubDetails } from './sources/github.js';
import type { OsvDetails } from './sources/osv.js';
import { compareVersions, lowestVersion } from './versions.js';

type Severity = PartialFinding['severity'];
type Fix = NonNullable<PartialFinding['fix']>;

const SUMMARY_LENGTH = 280;

export function canonicalOsvId(
  id: string,
  aliases: readonly string[],
  ghsaByCve: ReadonlyMap<string, string> = new Map(),
): string {
  if (id.startsWith('GHSA-')) return id;
  const ghsaAlias = aliases.filter((alias) => alias.startsWith('GHSA-')).sort()[0];
  if (ghsaAlias) return ghsaAlias;
  const viaCve = aliases.flatMap((alias) => (alias.startsWith('CVE-') ? (ghsaByCve.get(alias) ?? []) : [])).sort()[0];
  return viaCve ?? id;
}

export function rules(results: SourceResult[], _config?: Config): PartialFinding[] {
  const ghsaByCve = githubCveIndex(results);
  const github = new Map<string, GithubDetails>();
  const osv = new Map<string, OsvDetails[]>();

  const rekeyed = results.map((result) => ({
    ...result,
    findings: result.findings.map((finding) => {
      if (result.sourceName === 'github' && isGithubDetails(finding.details)) {
        const id = findingId(finding.details, finding.details.ghsa_id);
        if (!github.has(id)) github.set(id, finding.details);
        return { id, title: finding.title };
      }
      if (result.sourceName === 'osv' && isOsvDetails(finding.details)) {
        const details = finding.details;
        const canonical = canonicalOsvId(details.id, details.aliases, ghsaByCve.get(packageKey(details)));
        const id = findingId(details, canonical);
        osv.set(id, [...(osv.get(id) ?? []), details]);
        return { id, title: finding.title };
      }
      return { id: finding.id, title: finding.title };
    }),
  }));

  return mergeById(rekeyed).map((merged) => {
    const advisory = merged.id.slice(merged.id.lastIndexOf(':') + 1);
    const gh = github.get(merged.id);
    const osvDetails = [...(osv.get(merged.id) ?? [])].sort(
      (a, b) => Number(b.id === advisory) - Number(a.id === advisory),
    );
    const pkg = gh ?? osvDetails[0] ?? parseFindingId(merged.id);
    const label = pkg ? `${pkg.name}@${pkg.version}` : merged.id;
    const description = gh?.description ?? osvDetails.find((d) => d.description)?.description;
    const advisorySummary = gh?.summary ?? osvDetails.find((d) => d.summary)?.summary;
    const evidenceText = merged.evidence.map((entry) => entry.text).join(' / ');

    return {
      id: merged.id,
      title: `${label}: ${advisorySummary ?? advisory}`,
      summary: truncate(description ?? advisorySummary ?? evidenceText),
      severity: severityOf(gh, osvDetails),
      status: new Set(merged.sources).size >= 2 ? 'confirmed' : 'ghost',
      sources: merged.sources,
      evidence: merged.evidence,
      url: advisory.startsWith('GHSA-')
        ? `https://github.com/advisories/${advisory}`
        : `https://osv.dev/vulnerability/${advisory}`,
      fix: pkg ? fixOf(pkg.ecosystem, pkg.name, pkg.version, gh, osvDetails) : undefined,
    };
  });
}

function githubCveIndex(results: SourceResult[]): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();
  for (const result of results) {
    if (result.sourceName !== 'github') continue;
    for (const finding of result.findings) {
      if (!isGithubDetails(finding.details) || !finding.details.cve_id) continue;
      const key = packageKey(finding.details);
      const byCve = index.get(key) ?? new Map<string, string>();
      const known = byCve.get(finding.details.cve_id);
      if (!known || finding.details.ghsa_id < known) byCve.set(finding.details.cve_id, finding.details.ghsa_id);
      index.set(key, byCve);
    }
  }
  return index;
}

function severityOf(gh: GithubDetails | undefined, osvDetails: OsvDetails[]): Severity {
  const fromGithub = normaliseSeverity(gh?.severity);
  if (fromGithub) return fromGithub;
  for (const details of osvDetails) {
    const fromDatabase = normaliseSeverity(details.database_specific?.severity);
    if (fromDatabase) return fromDatabase;
  }
  for (const details of osvDetails) {
    for (const entry of details.severity ?? []) {
      if (entry.type !== 'CVSS_V3') continue;
      const score = cvss3BaseScore(entry.score);
      if (score !== undefined) return severityFromScore(score);
    }
  }
  return 'info';
}

function normaliseSeverity(value: string | undefined): Exclude<Severity, 'info'> | undefined {
  switch (value?.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
    case 'moderate':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return undefined;
  }
}

function fixOf(
  ecosystem: Ecosystem,
  name: string,
  installed: string,
  gh: GithubDetails | undefined,
  osvDetails: OsvDetails[],
): Fix | undefined {
  const above = (versions: Iterable<string>) =>
    [...new Set(versions)].filter((version) => compareVersions(ecosystem, version, installed) > 0);
  const fromGithub = above(gh?.fixed_versions ?? []);
  const fromOsv = above(osvDetails.flatMap((details) => details.fixed ?? []));
  const lowestGithub = lowestVersion(ecosystem, fromGithub);
  const lowestOsv = lowestVersion(ecosystem, fromOsv);

  if (lowestGithub && lowestOsv) {
    const shared = fromGithub.filter((version) => fromOsv.some((other) => compareVersions(ecosystem, version, other) === 0));
    const lowestShared = lowestVersion(ecosystem, shared);
    if (lowestShared) {
      return { value: lowestShared, text: `Upgrade ${name} to ${lowestShared} or later (OSV and GitHub agree).` };
    }
    const higher = compareVersions(ecosystem, lowestGithub, lowestOsv) >= 0 ? lowestGithub : lowestOsv;
    return {
      value: higher,
      text: `Upgrade ${name} to ${higher} or later: GitHub names ${lowestGithub}, OSV names ${lowestOsv}.`,
    };
  }
  if (lowestGithub) return { value: lowestGithub, text: `Upgrade ${name} to ${lowestGithub} or later (GitHub only).` };
  if (lowestOsv) return { value: lowestOsv, text: `Upgrade ${name} to ${lowestOsv} or later (OSV only).` };
  return undefined;
}

function parseFindingId(id: string): { ecosystem: Ecosystem; name: string; version: string } | undefined {
  const match = /^poltergeist:[^:]+:(npm|PyPI):(.+)@([^@:]+):[^:]+$/.exec(id);
  return match ? { ecosystem: match[1] as Ecosystem, name: match[2], version: match[3] } : undefined;
}

function truncate(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_LENGTH);
}

function isGithubDetails(details: unknown): details is GithubDetails {
  const d = details as Partial<GithubDetails> | undefined;
  return typeof d?.ghsa_id === 'string' && typeof d.name === 'string' && typeof d.version === 'string';
}

function isOsvDetails(details: unknown): details is OsvDetails {
  const d = details as Partial<OsvDetails> | undefined;
  return typeof d?.id === 'string' && Array.isArray(d.aliases) && typeof d.name === 'string';
}
