import type { AppDefinition } from 'graveyard-shift';
import { configSchema } from './config.js';
import { rules } from './rules.js';
import { github } from './sources/github.js';
import { osv } from './sources/osv.js';
import { theme } from './theme.js';

export const poltergeist: AppDefinition<typeof configSchema> = {
  sources: [osv, github],
  rules,
  configSchema,
  theme,
};

export default poltergeist;
