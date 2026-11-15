export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_.\-]+/g, '-');
}

export function parsePipRequirements(content: string): {
  packages: Set<{ name: string; version: string }>;
  skipped: { blank: number; comment: number; option: number; unpinned: number };
} {
  const lines = content.split(/\r?\n/);
  const joinedLines: string[] = [];
  let currentLine = '';

  for (const line of lines) {
    if (line.endsWith('\\')) {
      currentLine += line.slice(0, -1);
    } else {
      currentLine += line;
      joinedLines.push(currentLine);
      currentLine = '';
    }
  }

  if (currentLine) {
    joinedLines.push(currentLine);
  }

  const packages = new Map<string, { name: string; version: string }>();
  const skipped = { blank: 0, comment: 0, option: 0, unpinned: 0 };

  for (const line of joinedLines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      skipped.blank++;
      continue;
    }

    if (trimmed.startsWith('#')) {
      skipped.comment++;
      continue;
    }

    if (trimmed.startsWith('-')) {
      skipped.option++;
      continue;
    }

    const semicolonIndex = trimmed.indexOf(';');
    const cleaned = semicolonIndex === -1 ? trimmed : trimmed.slice(0, semicolonIndex);

    const hashIndex = cleaned.indexOf('#');
    const withoutInlineComment = hashIndex === -1 ? cleaned : cleaned.slice(0, hashIndex).trim();

    const parts = withoutInlineComment.split('==');
    if (parts.length !== 2) {
      skipped.unpinned++;
      continue;
    }

    const rawName = parts[0].trim();
    const versionPart = parts[1].trim();

    const bracketIndex = rawName.indexOf('[');
    const name = bracketIndex === -1 ? rawName : rawName.slice(0, bracketIndex);

    const normalizedName = normalizeName(name);

    const version = versionPart.split(/\s+/)[0];

    if (normalizedName === '' || !/^[0-9A-Za-z][0-9A-Za-z.+!_-]*$/.test(version)) {
      skipped.unpinned++;
      continue;
    }

    packages.set(`${normalizedName}@${version}`, { name: normalizedName, version });
  }

  return { packages: new Set(packages.values()), skipped };
}
