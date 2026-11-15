import { mergeById, type PartialFinding, type SourceResult } from 'graveyard-shift';
import type { Config } from './config.js';
import type { GithubDetails } from './sources/github.js';
import type { OsvDetails } from './sources/osv.js';

function rules(results: SourceResult[], config: Config): PartialFinding[] {
  const githubResult = results.find((r) => r.sourceName === 'github');
  const osvResult = results.find((r) => r.sourceName === 'osv');

  const githubFindings = githubResult?.findings ?? [];
  const osvFindings = osvResult?.findings ?? [];

  const githubDetailsMap = new Map<string, GithubDetails>();
  for (const finding of githubFindings) {
    const details = finding.details as unknown as GithubDetails;
    const key = `${details.ecosystem}:${details.name}@${details.version}`;
    githubDetailsMap.set(key, details);
  }

  const osvDetailsById = new Map<string, OsvDetails>();
  for (const finding of osvFindings) {
    const details = finding.details as unknown as OsvDetails;
    osvDetailsById.set(finding.id, details);
  }

  const githubIdByPackageAndCve = new Map<string, Map<string, string>>();
  for (const [pkgKey, details] of githubDetailsMap) {
    const cveMap = new Map<string, string>();
    if (details.cve_id) {
      cveMap.set(details.cve_id, details.ghsa_id);
    }
    if (cveMap.size > 0) {
      githubIdByPackageAndCve.set(pkgKey, cveMap);
    }
  }

  function canonicalizeOsvId(osvDetails: OsvDetails, pkgKey: string): string {
    if (osvDetails.id.startsWith('GHSA-')) {
      return osvDetails.id;
    }

    const ghsaAliases = (osvDetails.aliases ?? []).filter((a) => a.startsWith('GHSA-'));
    if (ghsaAliases.length > 0) {
      return [...ghsaAliases].sort()[0];
    }

    const cveMap = githubIdByPackageAndCve.get(pkgKey);
    if (cveMap) {
      for (const alias of osvDetails.aliases ?? []) {
        if (alias.startsWith('CVE-')) {
          const ghsaId = cveMap.get(alias);
          if (ghsaId) {
            return ghsaId;
          }
        }
      }
    }

    return osvDetails.id;
  }

  const rekeyedGithub: SourceResult['findings'] = [];
  const githubDetailsByCanonical = new Map<string, GithubDetails>();

  for (const finding of githubFindings) {
    const details = finding.details as unknown as GithubDetails;
    const pkgKey = `${details.ecosystem}:${details.name}@${details.version}`;
    const canonicalId = `poltergeist:${details.owner}/${details.repo}:${details.ecosystem}:${details.name}@${details.version}:${details.ghsa_id}`;
    rekeyedGithub.push({ ...finding, id: canonicalId });
    githubDetailsByCanonical.set(canonicalId, details);
  }

  const rekeyedOsv: SourceResult['findings'] = [];
  const osvDetailsByCanonical = new Map<string, OsvDetails>();

  for (const finding of osvFindings) {
    const details = finding.details as unknown as OsvDetails;
    const pkgKey = `${details.ecosystem}:${details.name}@${details.version}`;
    const canonicalId = canonicalizeOsvId(details, pkgKey);
    const finalId = `poltergeist:${details.owner}/${details.repo}:${details.ecosystem}:${details.name}@${details.version}:${canonicalId}`;
    rekeyedOsv.push({ ...finding, id: finalId });
    osvDetailsByCanonical.set(finalId, details);
  }

  const merged = mergeById([
    { sourceName: 'github', findings: rekeyedGithub, fetchedAt: new Date().toISOString() },
    { sourceName: 'osv', findings: rekeyedOsv, fetchedAt: new Date().toISOString() },
  ]);

  const findings: PartialFinding[] = [];
  for (const mergedFinding of merged) {
    const githubDetails = githubDetailsByCanonical.get(mergedFinding.id);
    const osvDetails = osvDetailsByCanonical.get(mergedFinding.id);

    let title: string;
    let summary: string;
    let url: string | undefined;

    if (mergedFinding.id.includes(':GHSA-')) {
      const parts = mergedFinding.id.split(':');
      const ghsaId = parts[parts.length - 1];
      url = `https://github.com/advisories/${ghsaId}`;
      if (githubDetails) {
        title = `${githubDetails.name}@${githubDetails.version}: ${githubDetails.summary ?? 'no summary'}`;
        summary = (githubDetails.description ?? 'no description').slice(0, 280);
      } else if (osvDetails) {
        title = `${osvDetails.name}@${osvDetails.version}: ${osvDetails.summary ?? 'no summary'}`;
        summary = (osvDetails.description ?? 'no description').slice(0, 280);
      } else {
        title = mergedFinding.title;
        summary = 'no description';
      }
    } else {
      const parts = mergedFinding.id.split(':');
      const osvId = parts[parts.length - 1];
      url = `https://osv.dev/vulnerability/${osvId}`;
      if (osvDetails) {
        title = `${osvDetails.name}@${osvDetails.version}: ${osvDetails.summary ?? 'no summary'}`;
        summary = (osvDetails.description ?? 'no description').slice(0, 280);
      } else {
        title = mergedFinding.title;
        summary = 'no description';
      }
    }

    const severity = computeSeverity(githubDetails, osvDetails);
    const fix = computeFix(githubDetails, osvDetails);

    findings.push({
      id: mergedFinding.id,
      title,
      summary,
      url,
      severity,
      status: mergedFinding.sources.length >= 2 ? 'confirmed' : 'ghost',
      sources: mergedFinding.sources,
      evidence: mergedFinding.evidence,
      fix,
    });
  }

  return findings;
}

function computeSeverity(githubDetails: GithubDetails | undefined, osvDetails: OsvDetails | undefined): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (githubDetails?.severity) {
    const severity = githubDetails.severity.toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(severity)) {
      return severity as 'critical' | 'high' | 'medium' | 'low';
    }
  }

  if (osvDetails?.database_specific?.severity) {
    const severity = osvDetails.database_specific.severity.toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(severity)) {
      return severity as 'critical' | 'high' | 'medium' | 'low';
    }
  }

  const cvss = osvDetails?.severity.find((s) => s.type === 'CVSS_V3');
  if (cvss) {
    const score = parseFloat(cvss.score);
    if (!isNaN(score)) {
      if (score >= 9.0) return 'critical';
      if (score >= 7.0) return 'high';
      if (score >= 4.0) return 'medium';
      if (score >= 0.1) return 'low';
    }
  }

  return 'info';
}

function compareVersions(ecosystem: string, a: string, b: string): number {
  if (ecosystem === 'npm' || ecosystem === 'PyPI') {
    return compareSemverLike(a, b);
  }
  return a.localeCompare(b);
}

function compareSemverLike(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }

  return 0;
}

function parseVersion(version: string): number[] {
  const parts = version.split('-')[0].split('.');
  return parts.map((p) => parseInt(p, 10));
}

function computeFix(githubDetails: GithubDetails | undefined, osvDetails: OsvDetails | undefined): { text: string; value?: string } | undefined {
  const githubFixed = githubDetails?.fixed_versions ?? [];
  const osvFixed = osvDetails?.fixed ?? [];

  if (githubFixed.length === 0 && osvFixed.length === 0) {
    return undefined;
  }

  const ecosystem = githubDetails?.ecosystem || osvDetails?.ecosystem || 'npm';
  const githubSorted = [...githubFixed].sort((a, b) => compareVersions(ecosystem, a, b));
  const osvSorted = [...osvFixed].sort((a, b) => compareVersions(ecosystem, a, b));

  const shared = githubSorted.filter((v) => osvSorted.includes(v));

  if (shared.length > 0) {
    const lowestShared = shared[0];
    return { text: 'Fixed in version', value: lowestShared };
  }

  if (githubFixed.length > 0 && osvFixed.length > 0) {
    const highest = compareVersions(ecosystem, githubSorted[0], osvSorted[0]) > 0 ? githubSorted[0] : osvSorted[0];
    return { text: `GitHub: ${githubSorted[0]}, OSV: ${osvSorted[0]}`, value: highest };
  }

  if (githubFixed.length > 0) {
    return { text: `GitHub: ${githubSorted[0]}`, value: githubSorted[0] };
  }

  return { text: `OSV: ${osvSorted[0]}`, value: osvSorted[0] };
}

export { rules };
