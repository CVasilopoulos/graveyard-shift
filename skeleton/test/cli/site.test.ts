import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { buildSite, dashboardDir } from '../../src/cli/site.js';

const theme = {
  name: 'Test App',
  tagline: 'Watching test things',
  accentColor: '#123456',
  labels: { confirmed: 'haunting', ghost: 'ghost', resolved: 'laid to rest' },
  issuePrefix: '👻',
};

describe('buildSite', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-site-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('finds the dashboard assets in the skeleton source tree', async () => {
    expect(dashboardDir.endsWith(path.join('skeleton', 'src', 'dashboard') + path.sep)).toBe(true);
    expect((await fs.readdir(dashboardDir)).sort()).toEqual(['app.js', 'index.html', 'style.css']);
  });

  it('copies every dashboard file byte for byte and writes theme.json next to them', async () => {
    const outDir = path.join(workDir, 'site', 'test-app');

    const written = await buildSite(theme, outDir);

    expect(written).toEqual(['app.js', 'index.html', 'style.css', 'theme.json']);
    for (const file of ['app.js', 'index.html', 'style.css']) {
      const copied = await fs.readFile(path.join(outDir, file));
      const original = await fs.readFile(path.join(dashboardDir, file));
      expect(copied.equals(original)).toBe(true);
    }
  });

  it('writes the theme name, tagline, accent colour and labels as stable JSON without the issue prefix', async () => {
    await buildSite(theme, workDir);

    const themeJson = await fs.readFile(path.join(workDir, 'theme.json'), 'utf-8');
    expect(themeJson).toBe(
      [
        '{',
        '  "accentColor": "#123456",',
        '  "labels": {',
        '    "confirmed": "haunting",',
        '    "ghost": "ghost",',
        '    "resolved": "laid to rest"',
        '  },',
        '  "name": "Test App",',
        '  "tagline": "Watching test things"',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('omits labels from theme.json when the theme has none', async () => {
    await buildSite({ name: 'Bare', tagline: 'No labels', accentColor: '#000000' }, workDir);

    const parsed = JSON.parse(await fs.readFile(path.join(workDir, 'theme.json'), 'utf-8'));
    expect(parsed).toEqual({ name: 'Bare', tagline: 'No labels', accentColor: '#000000' });
  });

  it('rejects when the output path is an existing file', async () => {
    const blocker = path.join(workDir, 'not-a-dir');
    await fs.writeFile(blocker, 'x');

    await expect(buildSite(theme, blocker)).rejects.toThrow();
  });
});
