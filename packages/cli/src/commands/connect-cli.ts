import type { Command } from 'commander';
import { runConnect } from '../connect.js';

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('Save credentials, merge env vars, wire Cursor MCP, optionally wait for SDK heartbeat')
    .option('--api-key <key>', 'Mushi API key (mushi_…) — or set MUSHI_API_KEY to keep it out of shell history')
    .requiredOption('--project-id <id>', 'Project UUID')
    .requiredOption('--endpoint <url>', 'Supabase edge function URL')
    .option('--cwd <path>', 'Target repo')
    .option('--write-env', 'Force-write SDK env vars to .env.local (default; overrides --no-env)')
    .option('--wire-ide', 'Force-wire Cursor MCP into .cursor/mcp.json (default; overrides --no-ide)')
    .option('--no-env', 'Skip writing .env.local')
    .option('--no-ide', 'Skip writing .cursor/mcp.json')
    .option('--wait', 'Poll ingest-setup until SDK heartbeat lands')
    .option('--wait-timeout <sec>', 'Max seconds for --wait', '120')
    .option('--json', 'Machine-readable output')
    .addHelpText('after', `
Examples:
  MUSHI_API_KEY=mushi_xxx mushi connect --project-id <uuid> --endpoint https://<ref>.supabase.co/functions/v1/api --wait
  mushi connect --api-key mushi_xxx --project-id <uuid> --endpoint <url> --no-ide`)
    .action(async (opts: {
      apiKey?: string
      projectId: string
      endpoint: string
      cwd?: string
      env?: boolean
      ide?: boolean
      writeEnv?: boolean
      wireIde?: boolean
      wait?: boolean
      waitTimeout: string
      json?: boolean
    }) => {
      const apiKey = process.env.MUSHI_API_KEY ?? opts.apiKey
      if (!apiKey) {
        console.error('Provide the API key via the MUSHI_API_KEY env var (recommended) or --api-key <key>.')
        process.exit(1)
      }
      const result = await runConnect({
        apiKey,
        projectId: opts.projectId,
        endpoint: opts.endpoint,
        cwd: opts.cwd,
        writeEnv: opts.writeEnv === true ? true : opts.env !== false,
        wireIde: opts.wireIde === true ? true : opts.ide !== false,
        wait: opts.wait,
        waitTimeoutSec: parseInt(opts.waitTimeout, 10) || 120,
        json: opts.json,
      })
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        for (const line of result.messages) console.log(line)
      }
      if (!result.ok) process.exit(1)
    })
}
