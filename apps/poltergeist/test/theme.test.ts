import { describe, expect, it } from 'vitest';
import { theme } from '../src/theme.js';

describe('theme', () => {
  it('names the app, its tagline and its accent colour', () => {
    expect(theme).toMatchObject({
      name: 'Poltergeist',
      tagline: 'Something is rattling in your lockfile',
      accentColor: '#8b5cf6',
    });
  });

  it('calls confirmed findings hauntings, single-source findings ghosts and resolved ones laid to rest', () => {
    expect(theme.labels).toEqual({ confirmed: 'haunting', ghost: 'ghost', resolved: 'laid to rest' });
  });

  it('prefixes issue titles with the ghost emoji', () => {
    expect(theme.issuePrefix).toBe('👻');
  });
});
