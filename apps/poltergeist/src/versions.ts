import type { Ecosystem } from './config.js';

export function compareVersions(ecosystem: Ecosystem, a: string, b: string): number {
  return ecosystem === 'PyPI' ? comparePep440(a, b) : compareSemver(a, b);
}

export function lowestVersion(ecosystem: Ecosystem, versions: readonly string[]): string | undefined {
  return [...versions].sort((a, b) => compareVersions(ecosystem, a, b))[0];
}

interface Semver {
  release: number[];
  prerelease: string[];
}

function parseSemver(version: string): Semver {
  const withoutBuild = version.trim().replace(/^[v=]+/, '').split('+')[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prerelease = dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.');
  return { release: core.split('.').map((part) => Number.parseInt(part, 10) || 0), prerelease };
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  const release = compareNumberLists(left.release, right.release);
  if (release !== 0) return release;
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i];
    const y = right.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

interface Pep440 {
  epoch: number;
  release: number[];
  pre: [number, number] | undefined;
  post: number | undefined;
  dev: number | undefined;
  local: string;
}

const PEP440 =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/;

const PRE_RANK: Record<string, number> = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };

function parsePep440(version: string): Pep440 | undefined {
  const match = PEP440.exec(version.trim().toLowerCase());
  if (!match) return undefined;
  const [, epoch, release, preLabel, preNumber, implicitPost, postLabel, postNumber, devLabel, devNumber, local] = match;
  return {
    epoch: epoch ? Number(epoch) : 0,
    release: release.split('.').map(Number),
    pre: preLabel ? [PRE_RANK[preLabel], Number(preNumber || 0)] : undefined,
    post: implicitPost !== undefined ? Number(implicitPost) : postLabel ? Number(postNumber || 0) : undefined,
    dev: devLabel ? Number(devNumber || 0) : undefined,
    local: local ?? '',
  };
}

function preKey(version: Pep440): number[] {
  if (version.pre) return [0, ...version.pre];
  if (version.post === undefined && version.dev !== undefined) return [-1];
  return [1];
}

export function comparePep440(a: string, b: string): number {
  const left = parsePep440(a);
  const right = parsePep440(b);
  if (!left || !right) {
    if (left || right) return left ? 1 : -1;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return (
    Math.sign(left.epoch - right.epoch) ||
    compareNumberLists(trimZeros(left.release), trimZeros(right.release)) ||
    compareNumberLists(preKey(left), preKey(right)) ||
    Math.sign((left.post ?? -1) - (right.post ?? -1)) ||
    Math.sign((left.dev ?? Number.POSITIVE_INFINITY) - (right.dev ?? Number.POSITIVE_INFINITY)) ||
    compareLocal(left.local, right.local)
  );
}

function compareLocal(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  const left = a.split(/[-_.]/);
  const right = b.split(/[-_.]/);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric && Number(x) !== Number(y)) return Math.sign(Number(x) - Number(y));
    if (xNumeric !== yNumeric) return xNumeric ? 1 : -1;
    if (!xNumeric && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function trimZeros(release: number[]): number[] {
  const copy = [...release];
  while (copy.length > 1 && copy[copy.length - 1] === 0) copy.pop();
  return copy;
}

function compareNumberLists(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
