import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseNpmLockfile } from '../../src/parsers/npm.js';

describe('npm parser', () => {
  it('parses valid v3 lockfile with packages', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/express': { version: '4.18.2' },
        'node_modules/lodash': { version: '4.17.21' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(
      new Set([
        { name: 'express', version: '4.18.2' },
        { name: 'lodash', version: '4.17.21' },
      ]),
    );
  });

  it('parses valid v2 lockfile', () => {
    const content = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        'node_modules/axios': { version: '1.6.0' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(new Set([{ name: 'axios', version: '1.6.0' }]));
  });

  it('throws on missing packages', () => {
    const content = JSON.stringify({ lockfileVersion: 3 });

    expect(() => parseNpmLockfile(content)).toThrow('missing "packages" map');
  });

  it('throws on invalid lockfile version', () => {
    const content = JSON.stringify({
      lockfileVersion: 1,
      packages: {},
    });

    expect(() => parseNpmLockfile(content)).toThrow('Unsupported lockfile version: 1');
  });

  it('throws on invalid JSON', () => {
    const content = 'not json';

    expect(() => parseNpmLockfile(content)).toThrow('Invalid JSON');
  });

  it('throws on entry without version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/react': {},
      },
    });

    expect(() => parseNpmLockfile(content)).toThrow('Missing "version"');
  });

  it('skips empty string key (root)', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/react': { version: '18.2.0' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(new Set([{ name: 'react', version: '18.2.0' }]));
  });

  it('skips link entries', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/linked-pkg': { version: '1.0.0', link: true },
        'node_modules/regular-pkg': { version: '2.0.0' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(new Set([{ name: 'regular-pkg', version: '2.0.0' }]));
  });

  it('handles scoped packages', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/@types/node': { version: '20.10.0' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(new Set([{ name: '@types/node', version: '20.10.0' }]));
  });

  it('deduplicates packages at nested paths', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/express': { version: '4.18.2' },
        'node_modules/foo/node_modules/express': { version: '4.18.2' },
      },
    });

    const result = parseNpmLockfile(content);
    expect(result).toEqual(new Set([{ name: 'express', version: '4.18.2' }]));
  });
});

describe('npm parser property tests', () => {
  it('property 1: round-trip preserves packages', () => {
    const genName = fc.stringMatching(/^(@[a-z0-9-]{1,10}\/)?[a-z0-9][a-z0-9._-]{0,20}$/);
    const genVersion = fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50)).map((v) => v.join('.'));

    fc.assert(
      fc.property(
        fc.array(fc.tuple(genName, genVersion), { minLength: 1, maxLength: 10 }),
        (packages) => {
          const uniquePackages = Array.from(new Set(packages.map(([name]) => name))).map(
            (name) => {
              const pair = packages.find(([n]) => n === name);
              return pair as [string, string];
            },
          );

          const lockfile = {
            lockfileVersion: 3,
            packages: Object.fromEntries(
              uniquePackages.map(([name, version]) => [
                `node_modules/${name}`,
                { version },
              ]),
            ),
          };

          const content = JSON.stringify(lockfile);
          const result = parseNpmLockfile(content);

          const expected = new Set(
            uniquePackages.map(([name, version]) => ({
              name,
              version,
            })),
          );
          expect(result).toEqual(expected);
        },
      ),
    );
  });
});
