import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
  name: string;
  version: string;
  repository: { url: string };
};

export const projectUserAgent = `${pkg.name}/${pkg.version} (+${pkg.repository.url})`;
