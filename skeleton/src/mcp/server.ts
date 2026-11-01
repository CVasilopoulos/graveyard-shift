import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Finding, RunRecord } from '../core/types.js';

/**
 * Data source: either a local directory or a remote HTTPS URL
 */
export type DataSource =
  | { type: 'local'; dir: string }
  | { type: 'remote'; baseUrl: string };

/**
 * Handle returned by createMcpServer
 */
export interface McpServerHandle {
  close(): Promise<void>;
}

/**
 * Data loader abstraction for fetching findings and runs
 */
interface DataLoader {
  loadFindings(): Promise<Finding[]>;
  loadRuns(): Promise<RunRecord[]>;
}

/**
 * MCP error response
 */
type McpError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'VALIDATION_ERROR'; message: string }
  | { code: 'UNAVAILABLE'; message: string };

/**
 * Create a data loader for the given source
 */
function makeDataLoader(source: DataSource): DataLoader {
  if (source.type === 'local') {
    const dir = source.dir;
    return {
      async loadFindings(): Promise<Finding[]> {
        try {
          const content = await fs.readFile(
            path.join(dir, 'findings.json'),
            'utf-8',
          );
          return JSON.parse(content) as Finding[];
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw new Error(`Invalid JSON in findings.json`);
          }
          throw err;
        }
      },

      async loadRuns(): Promise<RunRecord[]> {
        try {
          const content = await fs.readFile(
            path.join(dir, 'runs.json'),
            'utf-8',
          );
          return JSON.parse(content) as RunRecord[];
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw new Error(`Invalid JSON in runs.json`);
          }
          throw err;
        }
      },
    };
  }

  // Remote: HTTPS URL
  const baseUrl = source.baseUrl.replace(/\/$/, ''); // Remove trailing slash
  return {
    async loadFindings(): Promise<Finding[]> {
      const response = await fetch(`${baseUrl}/findings.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as Finding[];
    },

    async loadRuns(): Promise<RunRecord[]> {
      const response = await fetch(`${baseUrl}/runs.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as RunRecord[];
    },
  };
}

/**
 * Input validation schemas using zod - use raw shape for MCP SDK compatibility
 */
const listFindingsInputSchema = {
  status: z
    .enum(['confirmed', 'ghost', 'all'])
    .default('all')
    .describe('Filter findings by status: confirmed | ghost | all'),
} as const;

const getFindingInputSchema = {
  id: z.string().describe('The finding id'),
} as const;

const summaryInputSchema = {} as const;

const explainFindingInputSchema = {
  id: z.string().describe('The finding id'),
} as const;

/**
 * Create and start the MCP stdio server
 */
export async function createMcpServer(source: DataSource): Promise<McpServerHandle> {
  const server = new McpServer({
    name: 'graveyard-shift',
    version: '0.1.0',
  });

  const dataLoader = makeDataLoader(source);

  // Tool: list_findings
  server.tool(
    'list_findings',
    {
      status: z
        .enum(['confirmed', 'ghost', 'all'])
        .default('all')
        .describe('Filter findings by status: confirmed | ghost | all'),
    },
    async (args: unknown) => {
      // Validate status argument
      const parseResult = z
        .object({ status: z.enum(['confirmed', 'ghost', 'all']).optional() })
        .safeParse(args);
      if (!parseResult.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'VALIDATION_ERROR',
                message: `Invalid arguments: ${parseResult.error.issues[0]?.message || 'validation failed'}`,
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }

      try {
        const findings = await dataLoader.loadFindings();
        const status = (args as { status?: 'confirmed' | 'ghost' | 'all' })?.status ?? 'all';

        const filtered =
          status === 'all'
            ? findings
            : findings.filter((f) => f.status === status);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(filtered),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'UNAVAILABLE',
                message: 'Unable to load findings.json',
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool: get_finding
  server.tool(
    'get_finding',
    {
      id: z.string().describe('The finding id'),
    },
    async (args: unknown) => {
      // Validate id argument
      const parseResult = z.object({ id: z.string() }).safeParse(args);
      if (!parseResult.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'VALIDATION_ERROR',
                message: `Invalid id: ${parseResult.error.issues[0]?.message || 'must be a string'}`,
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }

      try {
        const findings = await dataLoader.loadFindings();
        const finding = findings.find((f) => f.id === (args as { id: string }).id);

        if (!finding) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'NOT_FOUND',
                  message: `Finding not found: ${(args as { id: string }).id}`,
                } satisfies McpError),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(finding),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'UNAVAILABLE',
                message: 'Unable to load findings.json',
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool: summary
  server.tool(
    'summary',
    {},
    async () => {
      try {
        const [findings, runs] = await Promise.all([
          dataLoader.loadFindings(),
          dataLoader.loadRuns(),
        ]);

        const total = findings.length;
        const confirmed = findings.filter((f) => f.status === 'confirmed').length;
        const ghost = findings.filter((f) => f.status === 'ghost').length;

        let lastRun: string | null = null;
        if (runs.length > 0) {
          lastRun = runs[runs.length - 1].runAt;
        }

        const result = {
          total,
          confirmed,
          ghost,
          lastRun,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'UNAVAILABLE',
                message: 'Unable to load findings.json or runs.json',
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool: explain_finding
  server.tool(
    'explain_finding',
    {
      id: z.string().describe('The finding id'),
    },
    async (args: unknown) => {
      // Validate id argument
      const parseResult = z.object({ id: z.string() }).safeParse(args);
      if (!parseResult.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'VALIDATION_ERROR',
                message: `Invalid id: ${parseResult.error.issues[0]?.message || 'must be a string'}`,
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }

      try {
        const findings = await dataLoader.loadFindings();
        const finding = findings.find((f) => f.id === (args as { id: string }).id);

        if (!finding) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'NOT_FOUND',
                  message: `Finding not found: ${(args as { id: string }).id}`,
                } satisfies McpError),
              },
            ],
            isError: true,
          };
        }

        const result = {
          status: finding.status,
          sources: finding.sources,
          evidence: finding.evidence,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'UNAVAILABLE',
                message: 'Unable to load findings.json',
              } satisfies McpError),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Connect to stdio transport and start listening
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    async close(): Promise<void> {
      await server.close();
    },
  };
}
