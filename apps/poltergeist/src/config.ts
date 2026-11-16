import { z } from 'zod';

export type Ecosystem = 'npm' | 'PyPI';

export function ecosystemOf(lockfilePath: string): Ecosystem | undefined {
  const fileName = lockfilePath.slice(lockfilePath.lastIndexOf('/') + 1);
  if (lockfilePath.endsWith('package-lock.json')) return 'npm';
  if (fileName.startsWith('requirements') && fileName.endsWith('.txt')) return 'PyPI';
  return undefined;
}

const lockfilePath = z.string().superRefine((path, ctx) => {
  if (path.startsWith('/') || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    ctx.addIssue({ code: 'custom', message: `Lockfile path ${JSON.stringify(path)} must be relative to the repository root` });
  } else if (!ecosystemOf(path)) {
    ctx.addIssue({
      code: 'custom',
      message: `Lockfile path ${JSON.stringify(path)} is neither a package-lock.json nor a requirements*.txt file`,
    });
  }
});

const target = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1).default('main'),
  lockfiles: z.array(lockfilePath).min(1),
});

export const configSchema = z.object({
  targets: z.array(target).min(1),
  repo: z.string().optional(),
  maxNewIssues: z.number().int().nonnegative().optional(),
  maxNewPRs: z.number().int().nonnegative().optional(),
  resolvedRetentionDays: z.number().int().nonnegative().optional(),
});

export type Config = z.infer<typeof configSchema>;
export type Target = Config['targets'][number];
