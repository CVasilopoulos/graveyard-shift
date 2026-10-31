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
          if (err instanceof SyntaxError || (err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
            return [];
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
          if (err instanceof SyntaxError || (err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
            return [];
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
      try {
        const response = await fetch(`${baseUrl}/findings.json`);
        if (!response.ok) {
          return [];
        }
        return (await response.json()) as Finding[];
      } catch {
        return [];
      }
    },

    async loadRuns(): Promise<RunRecord[]> {
      try {
        const response = await fetch(`${baseUrl}/runs.json`);
        if (!response.ok) {
          return [];
        }
        return (await response.json()) as RunRecord[];
      } catch {
        return [];
      }
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
export function createMcpServer(source: DataSource): McpServerHandle {
  const server = new McpServer({
    name: 'graveyard-shift',
    version: '0.1.0',
  });

  const dataLoader = makeDataLoader(source);

  // Tool: list_findings
  server.tool(
    'list_findings',
    listFindingsInputSchema,
    async (args: { status?: 'confirmed' | 'ghost' | 'all' }) => {
      try {
        const findings = await dataLoader.loadFindings();
        const status = args.status ?? 'all';

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
              isError: true,
            },
          ],
        };
      }
    },
  );

  // Tool: get_finding
  server.tool(
    'get_finding',
    getFindingInputSchema,
    async (args: { id: string }) => {
      try {
        const findings = await dataLoader.loadFindings();
        const finding = findings.find((f) => f.id === args.id);

        if (!finding) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'NOT_FOUND',
                  message: `Finding not found: ${args.id}`,
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
              isError: true,
            },
          ],
        };
      }
    },
  );

  // Tool: summary
  server.tool(
    'summary',
    summaryInputSchema,
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
              isError: true,
            },
          ],
        };
      }
    },
  );

  // Tool: explain_finding
  server.tool(
    'explain_finding',
    explainFindingInputSchema,
    async (args: { id: string }) => {
      try {
        const findings = await dataLoader.loadFindings();
        const finding = findings.find((f) => f.id === args.id);

        if (!finding) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'NOT_FOUND',
                  message: `Finding not found: ${args.id}`,
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
              isError: true,
            },
          ],
        };
      }
    },
  );

  // Connect to stdio transport
  const transport = new StdioServerTransport();

  // Start listening
  server.connect(transport);

  return {
    async close(): Promise<void> {
      await server.close();
    },
  };
}
