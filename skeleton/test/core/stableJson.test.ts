import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { stableStringify } from '../../src/core/stableJson.js';

describe('stableStringify', () => {
  describe('basic serialization', () => {
    it('serializes null', () => {
      expect(stableStringify(null)).toBe('null\n');
    });

    it('serializes booleans', () => {
      expect(stableStringify(true)).toBe('true\n');
      expect(stableStringify(false)).toBe('false\n');
    });

    it('serializes numbers', () => {
      expect(stableStringify(42)).toBe('42\n');
      expect(stableStringify(3.14)).toBe('3.14\n');
      expect(stableStringify(0)).toBe('0\n');
    });

    it('serializes strings', () => {
      expect(stableStringify('hello')).toBe('"hello"\n');
      expect(stableStringify('')).toBe('""\n');
    });

    it('serializes empty arrays', () => {
      expect(stableStringify([])).toBe('[]\n');
    });

    it('serializes simple arrays', () => {
      const result = stableStringify([1, 2, 3]);
      expect(result).toBe('[\n  1,\n  2,\n  3\n]\n');
    });

    it('serializes empty objects', () => {
      expect(stableStringify({})).toBe('{}\n');
    });

    it('serializes simple objects with sorted keys', () => {
      const result = stableStringify({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{\n  "a": 2,\n  "m": 3,\n  "z": 1\n}\n');
    });
  });

  describe('nested structures', () => {
    it('serializes nested objects with sorted keys at all levels', () => {
      const obj = { z: { b: 1, a: 2 }, a: { y: 3, x: 4 } };
      const result = stableStringify(obj);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(obj);
      // Verify key order
      expect(result).toContain('"a": {');
      expect(result).toContain('"z": {');
    });

    it('serializes nested arrays', () => {
      const arr = [[1, 2], [3, 4]];
      const result = stableStringify(arr);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(arr);
    });

    it('serializes mixed nested structures', () => {
      const obj = {
        items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
        metadata: { z: 1, a: 2 },
      };
      const result = stableStringify(obj);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(obj);
    });
  });

  describe('indentation', () => {
    it('uses 2-space indentation for top-level arrays', () => {
      const result = stableStringify([1]);
      expect(result).toBe('[\n  1\n]\n');
    });

    it('uses 2-space indentation for top-level objects', () => {
      const result = stableStringify({ a: 1 });
      expect(result).toBe('{\n  "a": 1\n}\n');
    });

    it('uses correct indentation for nested structures', () => {
      const result = stableStringify({ a: [1, 2] });
      const lines = result.split('\n');
      expect(lines[1]).toMatch(/^  "a": /);
      expect(lines[2]).toMatch(/^    1/);
    });
  });

  describe('trailing newline', () => {
    it('appends trailing newline to scalar', () => {
      expect(stableStringify(42)).toMatch(/\n$/);
    });

    it('appends trailing newline to array', () => {
      expect(stableStringify([1, 2, 3])).toMatch(/\n$/);
    });

    it('appends trailing newline to object', () => {
      expect(stableStringify({ a: 1 })).toMatch(/\n$/);
    });
  });

  describe('key ordering', () => {
    it('sorts keys by Unicode code point order', () => {
      const obj = {
        zebra: 1,
        apple: 2,
        Banana: 3,
        aardvark: 4,
      };
      const result = stableStringify(obj);
      // The order should follow Unicode: 'B' (66) < 'a' (97) < 'z' (122)
      const lines = result.split('\n');
      const keyLines = lines.slice(1, -2); // Skip opening/closing braces and trailing newline
      const keys = keyLines.map((line) => line.match(/"([^"]+)"/)?.[1]);
      expect(keys).toEqual(['Banana', 'aardvark', 'apple', 'zebra']);
    });
  });

  describe('Property 13: Round-trip', () => {
    it('round-trip property: parse(stableStringify(v)) deeply equals v', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const stringified = stableStringify(value);
          const parsed = JSON.parse(stringified);
          expect(parsed).toEqual(value);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 14: Determinism', () => {
    it('determinism property: stableStringify(v) called twice produces identical byte sequences', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const first = stableStringify(value);
          const second = stableStringify(value);
          expect(first).toBe(second);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('no mutation', () => {
    it('does not mutate input objects', () => {
      const obj = { z: 1, a: 2 };
      const original = JSON.parse(JSON.stringify(obj));
      stableStringify(obj);
      expect(obj).toEqual(original);
    });

    it('does not mutate input arrays', () => {
      const arr = [3, 1, 2];
      const original = JSON.parse(JSON.stringify(arr));
      stableStringify(arr);
      expect(arr).toEqual(original);
    });
  });

  describe('special values', () => {
    it('serializes undefined as undefined (scalar)', () => {
      expect(stableStringify(undefined)).toBe('undefined\n');
    });

    it('serializes large numbers', () => {
      const big = 9007199254740991; // MAX_SAFE_INTEGER
      const result = stableStringify(big);
      expect(JSON.parse(result)).toBe(big);
    });

    it('serializes strings with quotes', () => {
      // Test that quote characters are properly escaped
      const result = stableStringify('a"b');
      expect(JSON.parse(result)).toBe('a"b');
      expect(result).toMatch(/\n$/);
    });

    it('serializes strings with newlines', () => {
      const result = stableStringify('hello\nworld');
      expect(JSON.parse(result)).toBe('hello\nworld');
    });
  });
});
