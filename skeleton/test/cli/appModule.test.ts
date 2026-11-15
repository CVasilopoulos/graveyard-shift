import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { resolveAppModule } from '../../src/cli/appModule.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-module-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveAppModule', () => {
  it('loads the entry point named by main in the app package.json', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', main: './dist/index.js' }));
    expect(await resolveAppModule(dir)).toBe(path.join(dir, 'dist', 'index.js'));
  });

  it('falls back to index.js when the app has no package.json', async () => {
    expect(await resolveAppModule(dir)).toBe(path.join(dir, 'index.js'));
  });

  it('falls back to index.js when the package.json has no main', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
    expect(await resolveAppModule(dir)).toBe(path.join(dir, 'index.js'));
  });

  it('resolves a relative app directory against the working directory', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ main: 'lib/app.js' }));
    const relative = path.relative(process.cwd(), dir);
    expect(await resolveAppModule(relative)).toBe(path.join(dir, 'lib', 'app.js'));
  });
});
