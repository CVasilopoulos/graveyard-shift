import type { AppDefinition } from 'graveyard-shift';
import type { configSchema } from './config.js';

export const theme: AppDefinition<typeof configSchema>['theme'] = {
  name: 'Poltergeist',
  tagline: 'Something is rattling in your lockfile',
  accentColor: '#8b5cf6',
  labels: {
    confirmed: 'haunting',
    ghost: 'ghost',
    resolved: 'laid to rest',
  },
  issuePrefix: '👻',
};
