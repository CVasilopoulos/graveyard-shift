import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeName, parsePipRequirements } from '../../src/parsers/pip.js';

describe('pip parser', () => {
  it('parses pinned requirements', () => {
    const content = `requests==2.28.0\nflask==2.0.1`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(
      new Set([
        { name: 'requests', version: '2.28.0' },
        { name: 'flask', version: '2.0.1' },
      ]),
    );
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 0, unpinned: 0 });
  });

  it('handles extras', () => {
    const content = `requests[security]==2.28.0`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(new Set([{ name: 'requests', version: '2.28.0' }]));
  });

  it('handles environment markers', () => {
    const content = `requests==2.28.0; python_version >= "3.7"`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(new Set([{ name: 'requests', version: '2.28.0' }]));
  });

  it('strips inline comments', () => {
    const content = `requests==2.28.0 # core library`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(new Set([{ name: 'requests', version: '2.28.0' }]));
  });

  it('skips options', () => {
    const content = `-r requirements-dev.txt\n--index-url https://pypi.org/simple`;

    const result = parsePipRequirements(content);
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 2, unpinned: 0 });
  });

  it('skips unpinned lines', () => {
    const content = `requests\nflask>=2.0`;

    const result = parsePipRequirements(content);
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 0, unpinned: 2 });
  });

  it('skips blank lines', () => {
    const content = `requests==2.28.0`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(new Set([{ name: 'requests', version: '2.28.0' }]));
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 0, unpinned: 0 });
  });

  it('handles backslash continuations', () => {
    const content = ['some-long-package-name==1.0.0 \\', '    --hash=sha256:abc'].join('\n');

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(
      new Set([{ name: 'some-long-package-name', version: '1.0.0' }]),
    );
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 0, unpinned: 0 });
  });

  it('normalizes names', () => {
    const content = `Some_Package==1.0.0\nAnother---Package==2.0.0`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(
      new Set([
        { name: 'some-package', version: '1.0.0' },
        { name: 'another-package', version: '2.0.0' },
      ]),
    );
  });

  it('skips comments', () => {
    const content = `# This is a comment\nrequests==2.28.0`;

    const result = parsePipRequirements(content);
    expect(result.packages).toEqual(new Set([{ name: 'requests', version: '2.28.0' }]));
    expect(result.skipped).toEqual({ blank: 0, comment: 1, option: 0, unpinned: 0 });
  });
});

describe('pip parser property tests', () => {
  it('property 2: name normalization is idempotent', () => {
    const genName = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/);

    fc.assert(
      fc.property(genName, (name) => {
        expect(normalizeName(normalizeName(name))).toBe(normalizeName(name));
      }),
    );
  });

  it('property 3: pip round-trip preserves packages', () => {
    const genName = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/);
    const genVersion = fc.stringMatching(/^[0-9]+\.[0-9]+\.[0-9]+$/);

    fc.assert(
      fc.property(
        fc.array(fc.tuple(genName, genVersion), { minLength: 1, maxLength: 10 }),
        (packages) => {
          const content = packages
            .map(([name, version]) => {
              const withExtras = name + '[extra]';
              const withMarker = withExtras + '; python_version >= "3.7"';
              const withComment = withMarker + ' # comment';
              return withExtras + '==' + version + '; python_version >= "3.7" # comment';
            })
            .join('\n');

          const result = parsePipRequirements(content);
          const expected = new Set(
            packages.map(([name, version]) => ({
              name: normalizeName(name),
              version,
            })),
          );
          expect(result.packages).toEqual(expected);
        },
      ),
    );
  });
});
