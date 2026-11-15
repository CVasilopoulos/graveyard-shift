export function parseNpmLockfile(content: string): Set<{ name: string; version: string }> {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
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

  const byNameAndVersion = new Map<string, { name: string; version: string }>();

  for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
    if (key === '') {
      continue;
    }

    const pkg = (typeof entry === 'object' && entry !== null ? entry : {}) as { version?: unknown; link?: unknown };
    if (pkg.link === true) {
      continue;
    }

    const parts = key.split('node_modules/');
    if (parts.length < 2) {
      continue;
    }

    const version = pkg.version;
    if (typeof version !== 'string' || version === '') {
      throw new Error(`Missing "version" for package at ${key}`);
    }

    const name = parts[parts.length - 1];
    byNameAndVersion.set(`${name}@${version}`, { name, version });
  }

  return new Set(byNameAndVersion.values());
}
