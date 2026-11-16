import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { z } from 'zod';
import { stableStringify } from '../core/stableJson.js';
import type { AppDefinition } from '../core/types.js';

export const dashboardDir = fileURLToPath(new URL('../../src/dashboard/', import.meta.url));

export async function buildSite(theme: AppDefinition<z.ZodTypeAny>['theme'], outDir: string): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const entry of await fs.readdir(dashboardDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await fs.copyFile(path.join(dashboardDir, entry.name), path.join(outDir, entry.name));
    written.push(entry.name);
  }
  const themeJson = {
    name: theme.name,
    tagline: theme.tagline,
    accentColor: theme.accentColor,
    labels: theme.labels,
  };
  await fs.writeFile(path.join(outDir, 'theme.json'), stableStringify(themeJson), 'utf-8');
  written.push('theme.json');
  return written.sort();
}
