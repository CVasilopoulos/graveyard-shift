import { promises as fs } from 'fs';
import path from 'path';

export async function resolveAppModule(appDir: string): Promise<string> {
  const resolvedAppDir = path.resolve(appDir);
  let manifest: string;
  try {
    manifest = await fs.readFile(path.join(resolvedAppDir, 'package.json'), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return path.join(resolvedAppDir, 'index.js');
    throw err;
  }
  const main = (JSON.parse(manifest) as { main?: unknown }).main;
  return path.join(resolvedAppDir, typeof main === 'string' ? main : 'index.js');
}
