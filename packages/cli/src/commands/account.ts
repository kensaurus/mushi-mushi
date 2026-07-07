/**
 * FILE: packages/cli/src/commands/account.ts
 * PURPOSE: CLI account commands — init, login, whoami, ping, status, config, migrate.
 */

import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { runInit } from '../init.js';
import { runLogin } from '../login.js';
import { runMigrate } from '../migrate.js';
import type { FrameworkId } from '../detect.js';
import { assertEndpoint } from '../endpoint.js';
import { apiCall, die, requireConfig, pad, probeEndpointHealth } from '../cli-shared.js';
import type { WhoamiData, StatsData } from '../cli-types.js';

export function registerAccountCommands(program: Command): void {
// ─── init ────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Set up the Mushi Mushi SDK in this project (auto-detects framework)')
  .option('--project-id <id>', 'Skip the prompt — pass UUID from the Projects page')
  .option('--api-key <key>', 'Skip the prompt — pass the API key (CI only)')
  .option('--framework <id>', 'Force a framework (next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla)')
  .option('--skip-install', "Print the install command instead of running it")
  .option('-y, --yes', 'Accept detected framework without prompting')
  .option('--cwd <path>', 'Run the wizard in a different directory')
  .option('--endpoint <url>', 'Override the Mushi API endpoint (self-hosted)')
  .option('--skip-test-report', 'Skip the end-of-wizard "send a test report" prompt')
  .action(async (opts: {
    projectId?: string
    apiKey?: string
    framework?: FrameworkId
    skipInstall?: boolean
    yes?: boolean
    cwd?: string
    endpoint?: string
    skipTestReport?: boolean
  }) => {
    await runInit({
      projectId: opts.projectId,
      apiKey: opts.apiKey,
      framework: opts.framework,
      skipInstall: opts.skipInstall,
      yes: opts.yes,
      cwd: opts.cwd,
      endpoint: opts.endpoint,
      sendTestReport: opts.skipTestReport ? false : undefined,
    })
  })

// ─── migrate ─────────────────────────────────────────────────────────────────
program
  .command('migrate')
  .description('Suggest the most relevant Mushi Mushi migration guide based on your package.json')
  .option('--cwd <path>', 'Run from a different directory')
  .option('--json', 'Machine-readable JSON output')
  .action((opts: { cwd?: string; json?: boolean }) => {
    const { matches } = runMigrate({ cwd: opts.cwd, json: opts.json })
    if (matches.length === 0) process.exit(1)
  })

// ─── login ───────────────────────────────────────────────────────────────────
program
  .command('login')
  .description('Authenticate the CLI via browser (zero copy-paste), or pass --api-key to skip')
  .option('--api-key <key>', 'API key (mushi_...) — non-interactive / CI path')
  .option('--endpoint <url>', 'Override the Mushi API endpoint (self-hosted)')
  .option('--project-id <id>', 'Project UUID — skip the project picker')
  .option('--no-browser', 'Print the verification URL instead of opening the browser')
  .option(
    '--upgrade-scope',
    'Re-authenticate and mint a new key with report:write + mcp:read + mcp:write scopes. ' +
    'Use this to upgrade an existing ingest-only key so MCP and admin commands ' +
    '(including writes like `mushi billing cap`) work.',
  )
  .addHelpText('after', `
Examples:
  mushi login                              # browser-guided (recommended)
  mushi login --api-key mushi_xxx         # non-interactive / CI
  mushi login --api-key mushi_xxx --project-id <uuid>
  mushi login --upgrade-scope             # re-auth to add mcp:read + mcp:write to your key`)
  .action(async (opts: { apiKey?: string; endpoint?: string; projectId?: string; browser?: boolean; upgradeScope?: boolean }) => {
    await runLogin(opts)
  })

// ─── whoami ──────────────────────────────────────────────────────────────────
program
  .command('whoami')
  .description('Verify API key and display project info')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Verifies that MUSHI_API_KEY is valid and shows which project it belongs to.
Useful after 'mushi login' to confirm credentials are correct.`)
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<WhoamiData>('/v1/sync/whoami', config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      const d = result.data
      console.log(`✓ Authenticated`)
      console.log(`  Project:  ${d.project_name} (${d.project_id})`)
      console.log(`  Endpoint: ${config.endpoint}`)
      console.log(`  Reports:  ${d.stats.total_reports} total · ${d.stats.open_reports} open`)
    }
  })

// ─── ping ─────────────────────────────────────────────────────────────────────
program
  .command('ping')
  .description('Check connectivity to the Mushi backend')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const t0 = Date.now()
    try {
      const probe = await probeEndpointHealth(config.endpoint)
      if (opts.json) {
        console.log(JSON.stringify({ ok: probe.ok, status: probe.status, latency_ms: probe.latencyMs }))
      } else {
        console.log(`${probe.ok ? 'OK' : 'FAIL'} — ${probe.status} (${probe.latencyMs}ms)`)
        if (!probe.ok) process.exit(1)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg, latency_ms: Date.now() - t0 }))
      } else {
        process.stderr.write(`FAIL Unreachable: ${msg}\n`)
      }
      process.exit(1)
    }
  })

// ─── status ──────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show project stats: report counts by severity and status')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<StatsData>('/v1/sync/stats', config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const d = result.data
    console.log(`Project: ${d.project_name}`)
    console.log('')
    console.log('Reports by status:')
    for (const [status, count] of Object.entries(d.by_status)) {
      console.log(`  ${pad(status, 14)} ${count}`)
    }
    console.log('')
    console.log('Reports by severity:')
    for (const [severity, count] of Object.entries(d.by_severity)) {
      console.log(`  ${pad(severity, 14)} ${count}`)
    }
    console.log('')
    console.log(`Fixes:   ${d.fixes_count} total · ${d.fixes_merged} merged`)
    console.log(`Lessons: ${d.lessons_count} active rules`)
  })

// ─── config ──────────────────────────────────────────────────────────────────
program
  .command('config')
  .description('View or update CLI config (stored in ~/.config/mushi/config.json)')
  .argument('[key]', 'Config key to set: apiKey | endpoint | projectId')
  .argument('[value]', 'New value')
  .addHelpText('after', `
Keys:
  apiKey     — Mushi API key (mushi_...)
  endpoint   — Supabase edge function URL
  projectId  — Project UUID

Examples:
  mushi config                        # show all config
  mushi config apiKey mushi_xxx       # set API key
  mushi config endpoint https://...   # set endpoint
  mushi config projectId <uuid>       # set project`)
  .action((key: string | undefined, value: string | undefined) => {
    const config = loadConfig()
    const ALLOWED_KEYS = new Set(['apiKey', 'endpoint', 'projectId', 'consoleUrl'])
    if (key && value) {
      if (!ALLOWED_KEYS.has(key)) {
        process.stderr.write(`error: unknown config key "${key}". Allowed: ${[...ALLOWED_KEYS].join(', ')}\n`)
        process.exit(2)
      }
      const safeValue = key === 'endpoint' ? assertEndpoint(value) : value
      ;(config as Record<string, unknown>)[key] = safeValue
      saveConfig(config)
      console.log(`✓ Set ${key}`)
    } else {
      // Never print the full API key value to the terminal
      const safe = { ...config, apiKey: config.apiKey ? `${config.apiKey.slice(0, 10)}…` : undefined }
      console.log(JSON.stringify(safe, null, 2))
    }
  })

}
