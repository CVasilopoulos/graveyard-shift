/**
 * Recursively serialize a value as stable JSON with deterministic key ordering.
 * @param value - The value to serialize
 * @returns The serialized JSON string with sorted keys, 2-space indentation, and trailing newline
 */
export function stableStringify(value: unknown): string {
  return stableStringifyInner(value, 0) + '\n';
}

/**
 * Internal recursive serializer.
 * @param value - The value to serialize
 * @param indent - The current indentation level
 * @returns The serialized value without the trailing newline
 */
function stableStringifyInner(value: unknown, indent: number): string {
  // Handle null and non-objects (scalars)
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    const items = value.map((v) => {
      const indentStr = '  '.repeat(indent + 1);
      const serialized = stableStringifyInner(v, indent + 1);
      return indentStr + serialized;
    });

    const closingIndent = '  '.repeat(indent);
    return '[\n' + items.join(',\n') + '\n' + closingIndent + ']';
  }

  // Handle objects
  const keys = Object.keys(value as object).sort();

  if (keys.length === 0) {
    return '{}';
  }

  const entries = keys.map((k) => {
    const indentStr = '  '.repeat(indent + 1);
    const v = stableStringifyInner((value as Record<string, unknown>)[k], indent + 1);
    return indentStr + JSON.stringify(k) + ': ' + v;
  });

  const closingIndent = '  '.repeat(indent);
  return '{\n' + entries.join(',\n') + '\n' + closingIndent + '}';
}
