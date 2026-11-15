const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

const PRIVILEGES = {
  U: { N: 0.85, L: 0.62, H: 0.27 },
  C: { N: 0.85, L: 0.68, H: 0.5 },
} as const;

export function cvss3BaseScore(vector: string): number | undefined {
  const parts = vector.trim().split('/');
  if (!/^CVSS:3\.[01]$/.test(parts[0] ?? '')) return undefined;
  const metrics = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(':');
    if (key && value) metrics.set(key, value);
  }

  const pick = <T extends Record<string, number>>(table: T, key: string): number | undefined => {
    const value = metrics.get(key);
    return value !== undefined && value in table ? table[value as keyof T] : undefined;
  };

  const scope = metrics.get('S');
  if (scope !== 'U' && scope !== 'C') return undefined;
  const av = pick(WEIGHTS.AV, 'AV');
  const ac = pick(WEIGHTS.AC, 'AC');
  const pr = pick(PRIVILEGES[scope], 'PR');
  const ui = pick(WEIGHTS.UI, 'UI');
  const c = pick(WEIGHTS.CIA, 'C');
  const i = pick(WEIGHTS.CIA, 'I');
  const a = pick(WEIGHTS.CIA, 'A');
  if ([av, ac, pr, ui, c, i, a].some((value) => value === undefined)) return undefined;

  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scope === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const total = scope === 'U' ? impact + exploitability : 1.08 * (impact + exploitability);
  return roundUp(Math.min(total, 10));
}

export function severityFromScore(score: number): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score >= 0.1) return 'low';
  return 'info';
}

function roundUp(value: number): number {
  const scaled = Math.round(value * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}
