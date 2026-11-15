import { createHttpClient } from 'graveyard-shift';
import { ecosystemOf, type Config, type Ecosystem, type Target } from './config.js';
import { parseNpmLockfile } from './parsers/npm.js';
import { normalizeName, parsePipRequirements } from './parsers/pip.js';

export interface PackageVersion {
  owner: string;
  repo: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

type HttpClient = ReturnType<typeof createHttpClient>;

const runs = new WeakMap<Config, Promise<PackageVersion[]>>();

export function rawLockfileUrl(target: Target, path: string): string {
  const encode = (value: string) => value.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encode(target.owner)}/${encode(target.repo)}/${encode(target.ref)}/${encode(path)}`;
}

export function packageKey(pkg: Pick<PackageVersion, 'ecosystem' | 'name' | 'version'>): string {
  return `${pkg.ecosystem}:${packageName(pkg)}@${pkg.version}`;
}

export function packageName(pkg: Pick<PackageVersion, 'ecosystem' | 'name'>): string {
  return pkg.ecosystem === 'PyPI' ? normalizeName(pkg.name) : pkg.name;
}

export function findingId(pkg: PackageVersion, advisoryId: string): string {
  return `poltergeist:${pkg.owner}/${pkg.repo}:${pkg.ecosystem}:${packageName(pkg)}@${pkg.version}:${advisoryId}`;
}

export function distinctPackages<T extends PackageVersion>(packages: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const pkg of packages) {
    const key = packageKey(pkg);
    if (!seen.has(key)) seen.set(key, pkg);
  }
  return [...seen.values()];
}

export function loadPackageVersions(config: Config): Promise<PackageVersion[]> {
  let pending = runs.get(config);
  if (!pending) {
    pending = fetchAllLockfiles(config);
    runs.set(config, pending);
  }
  return pending;
}

async function fetchAllLockfiles(config: Config): Promise<PackageVersion[]> {
  const http = createHttpClient({});
  const files = new Map<string, Promise<PackageVersion[]>>();
  for (const target of config.targets) {
    for (const path of target.lockfiles) {
      const key = JSON.stringify([target.owner, target.repo, target.ref, path]);
      if (!files.has(key)) files.set(key, fetchLockfile(http, target, path));
    }
  }
  return (await Promise.all(files.values())).flat();
}

async function fetchLockfile(http: HttpClient, target: Target, path: string): Promise<PackageVersion[]> {
  const where = `${path} in ${target.owner}/${target.repo}@${target.ref}`;
  const ecosystem = ecosystemOf(path);
  if (!ecosystem) throw new Error(`Unsupported lockfile ${where}`);

  let text: string;
  try {
    text = await (await http.get(rawLockfileUrl(target, path))).text();
  } catch (err) {
    throw new Error(`Could not fetch lockfile ${where}: ${errorMessage(err)}`);
  }

  let pairs: Iterable<{ name: string; version: string }>;
  try {
    pairs = ecosystem === 'npm' ? parseNpmLockfile(text) : parsePipRequirements(text).packages;
  } catch (err) {
    throw new Error(`Could not parse lockfile ${where}: ${errorMessage(err)}`);
  }

  return [...pairs].map(({ name, version }) => ({ owner: target.owner, repo: target.repo, ecosystem, name, version }));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
