import { describe, expect, it } from 'vitest';
import poltergeist, { poltergeist as named } from '../src/index.js';
import { configSchema } from '../src/config.js';
import { rules } from '../src/rules.js';
import { theme } from '../src/theme.js';

describe('app definition', () => {
  it('default-exports the app definition the CLI loads', () => {
    expect(poltergeist).toBe(named);
  });

  it('lists the sources as functions named osv and github, so the runner can name a failing source', () => {
    expect(poltergeist.sources.map((source) => source.name)).toEqual(['osv', 'github']);
  });

  it('wires the rules, the config schema and the theme', () => {
    expect(poltergeist.rules).toBe(rules);
    expect(poltergeist.configSchema).toBe(configSchema);
    expect(poltergeist.theme).toBe(theme);
  });
});
