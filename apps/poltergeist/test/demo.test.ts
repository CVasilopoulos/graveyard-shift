import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, readFileSync } from 'node:fs';
import { runApp, type Finding, type RunRecord } from 'graveyard-shift';
import poltergeist from '../src/index.js';
import { configSchema } from '../src/config.js';
import { loadFixture, mockFetch, serveLockfiles, demoFile } from './mockFetch.js';

const NPM_LOCK = 'apps/poltergeist/demo/haunted-house/package-lock.json';
const PIP_LOCK = 'apps/poltergeist/demo/haunted-house/requirements.txt';
const PREFIX = 'poltergeist:CVasilopoulos/graveyard-shift:';

let dir: string;
let savedToken: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poltergeist-demo-'));
  savedToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

async function runDemo(): Promise<{ findings: Finding[]; runs: RunRecord[] }> {
  const committed = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ ...committed, repo: 'CVasilopoulos/graveyard-shift' }));
  const config = configSchema.parse(committed);
  mockFetch([
    ...serveLockfiles(config, { [NPM_LOCK]: demoFile('package-lock.json'), [PIP_LOCK]: demoFile('requirements.txt') }),
    ...loadFixture('osv/querybatch-chunk.json'),
    ...loadFixture('github/advisories-npm.json'),
    ...loadFixture('github/advisories-pip.json'),
  ]);
  await runApp(poltergeist, { appDir: dir, dataDir: path.join(dir, 'data'), configPath, dryRun: true });
  const read = async <T>(name: string) => JSON.parse(await fs.readFile(path.join(dir, 'data', name), 'utf-8')) as T;
  return { findings: await read<Finding[]>('findings.json'), runs: await read<RunRecord[]>('runs.json') };
}

describe('haunted house demo against the recorded OSV and GitHub responses', () => {
  it('finds twelve hauntings and one ghost', async () => {
    const { findings, runs } = await runDemo();

    const hauntings = findings.filter((finding) => finding.status === 'confirmed').map((finding) => finding.id.slice(PREFIX.length));
    const ghosts = findings.filter((finding) => finding.status === 'ghost').map((finding) => finding.id.slice(PREFIX.length));
    expect(hauntings.sort()).toEqual([
      'PyPI:requests@2.25.0:GHSA-9hjg-9r4m-mvj7',
      'PyPI:requests@2.25.0:GHSA-9wx4-h78v-vm56',
      'PyPI:requests@2.25.0:GHSA-gc5v-m9x4-r6x2',
      'PyPI:requests@2.25.0:GHSA-j8r2-6x86-q33q',
      'npm:express@4.17.1:GHSA-qw6h-vgh9-j6wx',
      'npm:express@4.17.1:GHSA-rv95-896h-c2vc',
      'npm:lodash@4.17.15:GHSA-29mw-wpgm-hmr9',
      'npm:lodash@4.17.15:GHSA-35jh-r3h4-6jhm',
      'npm:lodash@4.17.15:GHSA-p6mc-m468-83gw',
      'npm:lodash@4.17.15:GHSA-r5fr-rjxr-66jc',
      'npm:lodash@4.17.15:GHSA-xxjr-mmjv-4gpg',
      'npm:minimist@1.2.5:GHSA-xvch-5gv4-984h',
    ]);
    expect(ghosts).toEqual(['PyPI:pandas@1.0.3:PYSEC-2020-73']);
    expect(runs.at(-1)).toMatchObject({ confirmedCount: 12, ghostCount: 1, errorSources: [] });
  });

  it('names the fix both sources agree on for every haunting', async () => {
    const { findings } = await runDemo();

    const fixes = Object.fromEntries(
      findings.filter((finding) => finding.status === 'confirmed').map((finding) => [finding.id.slice(PREFIX.length), finding.fix?.value]),
    );
    expect(fixes).toEqual({
      'PyPI:requests@2.25.0:GHSA-9hjg-9r4m-mvj7': '2.32.4',
      'PyPI:requests@2.25.0:GHSA-9wx4-h78v-vm56': '2.32.0',
      'PyPI:requests@2.25.0:GHSA-gc5v-m9x4-r6x2': '2.33.0',
      'PyPI:requests@2.25.0:GHSA-j8r2-6x86-q33q': '2.31.0',
      'npm:express@4.17.1:GHSA-qw6h-vgh9-j6wx': '4.20.0',
      'npm:express@4.17.1:GHSA-rv95-896h-c2vc': '4.19.2',
      'npm:lodash@4.17.15:GHSA-29mw-wpgm-hmr9': '4.17.21',
      'npm:lodash@4.17.15:GHSA-35jh-r3h4-6jhm': '4.17.21',
      'npm:lodash@4.17.15:GHSA-p6mc-m468-83gw': '4.17.19',
      'npm:lodash@4.17.15:GHSA-r5fr-rjxr-66jc': '4.18.0',
      'npm:lodash@4.17.15:GHSA-xxjr-mmjv-4gpg': '4.17.23',
      'npm:minimist@1.2.5:GHSA-xvch-5gv4-984h': '1.2.6',
    });
  });

  it('takes the severity from GitHub and links the GitHub advisory page', async () => {
    const { findings } = await runDemo();

    const minimist = findings.find((finding) => finding.id.endsWith(':GHSA-xvch-5gv4-984h'))!;
    expect(minimist).toMatchObject({
      severity: 'critical',
      title: 'minimist@1.2.5: Prototype Pollution in minimist',
      url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
      sources: expect.arrayContaining(['osv', 'github']),
    });
    expect(minimist.summary.length).toBeLessThanOrEqual(280);
  });

  it('shows the OSV-only advisory as a ghost with an OSV link and the OSV fix', async () => {
    const { findings } = await runDemo();

    const pandas = findings.find((finding) => finding.id.endsWith(':PYSEC-2020-73'))!;
    expect(pandas).toMatchObject({
      status: 'ghost',
      sources: ['osv'],
      url: 'https://osv.dev/vulnerability/PYSEC-2020-73',
      title: 'pandas@1.0.3: PYSEC-2020-73',
      fix: { value: '1.0.4' },
    });
    expect(pandas.fix?.text).toContain('OSV');
  });
});
