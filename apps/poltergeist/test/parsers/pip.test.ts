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

  it('returns a package listed twice only once', () => {
    const result = parsePipRequirements('requests==2.25.0\nRequests==2.25.0\nrequests==2.31.0');
    expect(result.packages).toEqual(
      new Set([
        { name: 'requests', version: '2.25.0' },
        { name: 'requests', version: '2.31.0' },
      ]),
    );
  });

  it('reads files with Windows line endings, continuations included', () => {
    const content = ['flask==2.0.1 \\', '    --hash=sha256:abc', 'requests==2.25.0', ''].join('\r\n');
    expect(parsePipRequirements(content).packages).toEqual(
      new Set([
        { name: 'flask', version: '2.0.1' },
        { name: 'requests', version: '2.25.0' },
      ]),
    );
  });

  it('counts arbitrary equality, wildcard and multi-clause requirements as unpinned', () => {
    const result = parsePipRequirements('legacy===1.0\nrange==1.0,<2\nprefix==1.4.*');
    expect(result.packages).toEqual(new Set());
    expect(result.skipped.unpinned).toBe(3);
  });

  it('counts every option line, not only -r, -e, --index-url and --hash', () => {
    const result = parsePipRequirements('-c constraints.txt\n--extra-index-url https://example.org/simple\n--requirement base.txt');
    expect(result.skipped).toEqual({ blank: 0, comment: 0, option: 3, unpinned: 0 });
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
    const genNoise = fc.record({
      extras: fc.constantFrom('', '[extra]', '[security,socks]'),
      marker: fc.constantFrom('', '; python_version >= "3.7"', ' ; sys_platform == "linux"'),
      comment: fc.constantFrom('', ' # pinned', '  # see issue 12'),
    });

    fc.assert(
      fc.property(
        fc.array(fc.tuple(genName, genVersion, genNoise), { minLength: 1, maxLength: 10 }),
        fc.array(fc.constantFrom('', '# comment', '-r base.txt', 'unpinned>=1.0'), { maxLength: 5 }),
        (packages, otherLines) => {
          const lines = packages.map(
            ([name, version, noise]) => `${name}${noise.extras}==${version}${noise.marker}${noise.comment}`,
          );
          const content = [...otherLines, ...lines].join('\n');

          const result = parsePipRequirements(content);
          const expected = new Map(
            packages.map(([name, version]) => [`${normalizeName(name)}@${version}`, { name: normalizeName(name), version }]),
          );
          expect(result.packages).toEqual(new Set(expected.values()));
        },
      ),
    );
  });
});
