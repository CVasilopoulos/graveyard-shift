export function parseNpmLockfile(content: string): Set<{ name: string; version: string }> {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('Invalid JSON in lockfile');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('Lockfile must be a JSON object');
  }

  const lockfileVersion = (data as { lockfileVersion?: unknown }).lockfileVersion;
  if (lockfileVersion !== 2 && lockfileVersion !== 3) {
    throw new Error(`Unsupported lockfile version: ${lockfileVersion}`);
  }

  const packages = (data as { packages?: unknown }).packages;
  if (typeof packages !== 'object' || packages === null) {
    throw new Error('Lockfile missing "packages" map');
  }

  const byName = new Map<string, { name: string; version: string }>();

  for (const key of Object.keys(packages)) {
    if (key === '') {
      continue;
    }

    const pkg = packages[key] as { version?: string; link?: boolean };
    if (pkg.link) {
      continue;
    }

    const version = pkg.version;
    if (typeof version !== 'string') {
      throw new Error(`Missing "version" for package at ${key}`);
    }

    const parts = key.split('node_modules/');
    if (parts.length < 2) {
      continue;
    }

    const name = parts[parts.length - 1];
    byName.set(name, { name, version });
  }

  return new Set(byName.values());
}
