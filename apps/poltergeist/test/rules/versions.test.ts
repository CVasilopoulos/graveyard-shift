import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { comparePep440, compareSemver, lowestVersion } from '../../src/versions.js';

function isSorted(compare: (a: string, b: string) => number, ordered: string[]): void {
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      expect(Math.sign(compare(ordered[i], ordered[j])), `${ordered[i]} vs ${ordered[j]}`).toBe(Math.sign(i - j));
    }
  }
}

describe('semver ordering', () => {
  it('orders releases numerically and prereleases before their release', () => {
    isSorted(compareSemver, [
      '0.2.4',
      '1.2.5',
      '1.2.6',
      '1.10.0',
      '5.0.0-alpha',
      '5.0.0-alpha.1',
      '5.0.0-alpha.beta',
      '5.0.0-beta',
      '5.0.0-beta.2',
      '5.0.0-beta.11',
      '5.0.0-rc.1',
      '5.0.0',
    ]);
  });

  it('ignores build metadata and a leading v', () => {
    expect(compareSemver('v1.2.3', '1.2.3+build.5')).toBe(0);
  });
});

describe('PEP 440 ordering', () => {
  it('follows the ordering example of the specification', () => {
    isSorted(comparePep440, [
      '1.dev0',
      '1.0.dev456',
      '1.0a1',
      '1.0a2.dev456',
      '1.0a12.dev456',
      '1.0a12',
      '1.0b1.dev456',
      '1.0b2',
      '1.0b2.post345.dev456',
      '1.0b2.post345',
      '1.0rc1.dev456',
      '1.0rc1',
      '1.0',
      '1.0+abc.5',
      '1.0+abc.7',
      '1.0+5',
      '1.0.post456.dev34',
      '1.0.post456',
      '1.0.15',
      '1.1.dev1',
    ]);
  });

  it('normalises spellings and trailing zeros', () => {
    expect(comparePep440('2.0', '2.0.0')).toBe(0);
    expect(comparePep440('1.0-alpha-1', '1.0a1')).toBe(0);
    expect(comparePep440('1.0c1', '1.0rc1')).toBe(0);
    expect(comparePep440('1.0-1', '1.0.post1')).toBe(0);
    expect(comparePep440('1!0.1', '2024.1')).toBeGreaterThan(0);
  });

  it('picks the lowest of a list for each ecosystem', () => {
    expect(lowestVersion('PyPI', ['2.32.4', '2.4', '2.32.0'])).toBe('2.4');
    expect(lowestVersion('npm', ['4.17.21', '4.17.3', '4.18.0'])).toBe('4.17.3');
    expect(lowestVersion('npm', [])).toBeUndefined();
  });
});

describe('ordering properties', () => {
  const semver = fc
    .tuple(fc.nat(30), fc.nat(30), fc.nat(30), fc.option(fc.constantFrom('alpha', 'alpha.1', 'beta.2', 'rc.1'), { nil: undefined }))
    .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? `-${pre}` : ''}`);
  const pep440 = fc
    .tuple(
      fc.array(fc.nat(20), { minLength: 1, maxLength: 4 }),
      fc.option(fc.constantFrom('a1', 'b2', 'rc1'), { nil: undefined }),
      fc.option(fc.constantFrom('.post1', '.post2'), { nil: undefined }),
      fc.option(fc.constantFrom('.dev0', '.dev3'), { nil: undefined }),
    )
    .map(([release, pre, post, dev]) => `${release.join('.')}${pre ?? ''}${post ?? ''}${dev ?? ''}`);

  for (const [name, compare, versions] of [
    ['semver', compareSemver, semver],
    ['PEP 440', comparePep440, pep440],
  ] as const) {
    it(`${name} comparison is antisymmetric and transitive`, () => {
      fc.assert(
        fc.property(versions, versions, versions, (a, b, c) => {
          expect(Math.sign(compare(a, b))).toBe(-Math.sign(compare(b, a)));
          if (compare(a, b) <= 0 && compare(b, c) <= 0) expect(compare(a, c)).toBeLessThanOrEqual(0);
        }),
      );
    });
  }
});
