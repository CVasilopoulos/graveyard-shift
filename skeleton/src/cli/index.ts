#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stableStringify } from '../core/stableJson.js';
import { runApp } from '../core/runner.js';
import { createMcpServer } from '../mcp/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Print usage information
 */
function printUsage(): void {
  const usage = `
graveyard-shift CLI

Usage:
  graveyard-shift run <appDir> [--config CONFIG] [--data DATA] [--dry-run]
  graveyard-shift site <appDir> <outDir>
  graveyard-shift mcp <dataDirOrUrl>

Commands:
  run <appDir>
    Execute a full app cycle.
    --config CONFIG   Path to config file (default: <appDir>/config.json)
    --data DATA       Path to data directory (default: <appDir>/data)
    --dry-run         Run without notifying

  site <appDir> <outDir>
    Generate static site assets from app theme.

  mcp <dataDirOrUrl>
    Start MCP stdio server.
    dataDirOrUrl: local directory path or https:// URL
`;
  console.error(usage);
}

/**
 * Parse command-line flags from an arguments array
 */
function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // Check if next arg is a value or another flag
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++; // Skip next arg as it's the value
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/**
 * Run command: graveyard-shift run <appDir> [--config CONFIG] [--data DATA] [--dry-run]
 */
async function cmdRun(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);

  if (positional.length < 1) {
    console.error('Error: run requires <appDir>');
    printUsage();
    process.exit(1);
  }

  const appDir = positional[0];

  try {
    // Dynamic import of app definition
    const resolvedAppDir = path.resolve(appDir);
    const appModulePath = path.join(resolvedAppDir, 'index.js');
    const appModule = await import(appModulePath);
    const appDef = appModule.default;

    if (!appDef) {
      throw new Error('App module does not export default AppDefinition');
    }

    // Determine config path
    const configPath =
      typeof flags['config'] === 'string'
        ? flags['config']
        : path.join(resolvedAppDir, 'config.json');

    // Determine data directory
    const dataDir =
      typeof flags['data'] === 'string'
        ? flags['data']
        : path.join(resolvedAppDir, 'data');

    const dryRun = flags['dry-run'] === true;

    // Call runner
    await runApp(appDef, {
      appDir: resolvedAppDir,
      configPath,
      dataDir,
      dryRun,
    });

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * Site command: graveyard-shift site <appDir> <outDir>
 */
async function cmdSite(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);

  if (positional.length < 2) {
    console.error('Error: site requires <appDir> and <outDir>');
    printUsage();
    process.exit(1);
  }

  const appDir = positional[0];
  const outDir = positional[1];

  try {
    // Dynamic import of app definition
    const resolvedAppDir = path.resolve(appDir);
    const appModulePath = path.join(resolvedAppDir, 'index.js');
    const appModule = await import(appModulePath);
    const appDef = appModule.default;

    if (!appDef || !appDef.theme) {
      throw new Error('App module does not export default AppDefinition with theme');
    }

    // Create output directory
    const resolvedOutDir = path.resolve(outDir);
    await fs.mkdir(resolvedOutDir, { recursive: true });

    // Copy dashboard files from skeleton
    const dashboardDir = path.join(
      path.dirname(__dirname),
      'dashboard'
    );

    const files = await fs.readdir(dashboardDir);
    for (const file of files) {
      const srcPath = path.join(dashboardDir, file);
      const destPath = path.join(resolvedOutDir, file);

      // Check if it's a file (not a directory)
      const stat = await fs.stat(srcPath);
      if (stat.isFile()) {
        const content = await fs.readFile(srcPath);
        await fs.writeFile(destPath, content);
      }
    }

    // Write theme.json
    const themeData = {
      name: appDef.theme.name,
      tagline: appDef.theme.tagline,
      accentColor: appDef.theme.accentColor,
      labels: appDef.theme.labels,
    };

    const themeJsonPath = path.join(resolvedOutDir, 'theme.json');
    await fs.writeFile(themeJsonPath, stableStringify(themeData), 'utf-8');

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * MCP command: graveyard-shift mcp <dataDirOrUrl>
 */
async function cmdMcp(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);

  if (positional.length < 1) {
    console.error('Error: mcp requires <dataDirOrUrl>');
    printUsage();
    process.exit(1);
  }

  const dataDirOrUrl = positional[0];

  try {
    // Determine data source type
    let dataSource;
    if (dataDirOrUrl.startsWith('https://')) {
      dataSource = {
        type: 'remote' as const,
        baseUrl: dataDirOrUrl,
      };
    } else {
      dataSource = {
        type: 'local' as const,
        dir: path.resolve(dataDirOrUrl),
      };
    }

    // Create and start MCP server
    const handle = await createMcpServer(dataSource);

    // Register signal handlers
    const cleanup = async (): Promise<void> => {
      await handle.close();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process alive; stdio server handles stdin
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const [command, ...commandArgs] = args;

  try {
    switch (command) {
      case 'run':
        await cmdRun(commandArgs);
        break;
      case 'site':
        await cmdSite(commandArgs);
        break;
      case 'mcp':
        await cmdMcp(commandArgs);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
