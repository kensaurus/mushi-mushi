/**
 * FILE: packages/cli/src/commands/account.ts
 * PURPOSE: CLI account management commands: init, login, whoami, ping, status, config, migrate.
 *
 * OVERVIEW:
 *   - `mushi init`   — guided SDK setup wizard
 *   - `mushi login`  — RFC 8628 browser device-auth (zero copy-paste) or --api-key CI path
 *   - `mushi whoami` — verify key and show project info
 *   - `mushi ping`   — health-check connectivity
 *   - `mushi status` — show project report stats
 *   - `mushi config` — view/update CLI config
 *   - `mushi migrate`— suggest migration guide
 *
 * DEPENDENCIES:
 *   - config.ts (loadConfig / saveConfig)
 *   - init.ts (runInit)
 *   - console-url.ts (resolveConsoleUrl, openInBrowser, apiKeyHint, cliSetupDeepLink, etc.)
 *   - cli-shared.ts (apiCall, die, requireConfig, pad)
 *   - endpoint.ts (CLOUD_API_ENDPOINT, resolveCloudEndpoint)
 */

import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { runInit } from '../init.js';
import { runMigrate } from '../migrate.js';
import type { FrameworkId } from '../detect.js';
import { assertEndpoint } from '../endpoint.js';
import {
  apiKeyHint,
  cliSetupDeepLink,
  openInBrowser,
  resolveConsoleUrl,
} from '../console-url.js';
import { apiCall, die, requireConfig, pad, API_TIMEOUT_MS } from '../cli-shared.js';
import {
  createProject,
  listProjects,
  mintProjectKey,
  pollDeviceToken,
  startDeviceAuth,
} from '../device-auth.js';
import { printAuthBanner, printAuthApproved, printAuthFailed } from '../auth-ui.js';
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
    const { CLOUD_API_ENDPOINT, resolveCloudEndpoint } = await import('../endpoint.js')
    const endpoint = opts.endpoint ? resolveCloudEndpoint(opts.endpoint) : CLOUD_API_ENDPOINT
    const consoleBase = await resolveConsoleUrl()

    let apiKey = opts.apiKey
    let projectId = opts.projectId

    // ── Non-interactive / CI path ──────────────────────────────────────────
    if (apiKey) {
      const config = loadConfig()
      config.apiKey = apiKey
      config.endpoint = endpoint
      if (projectId) config.projectId = projectId
      config.consoleUrl = consoleBase
      saveConfig(config)

      console.log('')
      console.log('  ✓ Credentials saved.')

      const verifyResult = await apiCall<{ project_name: string; project_id: string; stats: Record<string, unknown> }>(
        '/v1/sync/whoami',
        { apiKey, endpoint, projectId },
      )
      if (!verifyResult.ok) {
        console.warn(`  ⚠  Key saved, but verification failed: ${verifyResult.error?.message ?? 'unknown error'}`)
        console.warn(`     Check your key at: ${cliSetupDeepLink(consoleBase)}`)
        return
      }
      const d = verifyResult.data
      if (d.project_name) {
        if (!projectId && d.project_id) {
          config.projectId = d.project_id
          saveConfig(config)
        }
        console.log(`  ✓ Project: ${d.project_name} (${d.project_id})`)
      }
      console.log(`  ✓ Endpoint: ${endpoint}`)
      console.log('')
      console.log("  Run 'mushi whoami' to verify · 'mushi init' to set up the SDK")
      return
    }

    // ── Browser device-auth path (RFC 8628) ────────────────────────────────
    console.log('')
    if (opts.upgradeScope) {
      console.log('  Mushi login — scope upgrade')
      console.log('  ───────────────────────────')
      console.log('  Re-authenticating to mint a new key with report:write + mcp:read + mcp:write scopes.')
      console.log('  This lets the CLI admin commands (including writes) and MCP server both work with a single key.')
      console.log('')
    } else {
      console.log('  Mushi login')
      console.log('  ───────────')
    }

    // Step 1: start device-auth session (RFC 8628 — shared with the init wizard)
    let deviceData: Awaited<ReturnType<typeof startDeviceAuth>>
    try {
      deviceData = await startDeviceAuth(endpoint)
    } catch (err) {
      process.stderr.write(`\nerror: Could not start login session: ${err instanceof Error ? err.message : String(err)}\n`)
      process.stderr.write(`  Fallback: mushi login --api-key <key> --project-id <uuid>\n`)
      process.exit(1)
    }

    // Step 2: show anti-paste banner and open browser
    const verifyUrl = deviceData.verification_uri
    if (opts.browser !== false) {
      try { await openInBrowser(verifyUrl) } catch { /* best-effort — URL is shown in banner */ }
    }
    printAuthBanner(deviceData.user_code, verifyUrl)

    // Step 3: poll for CLI token (shared poll classifier; keep login's UX —
    // a dot per pending poll and a precise error message per terminal state).
    let cliToken: string | null = null
    const pollIntervalMs = (deviceData.interval ?? 5) * 1000
    const deadline = Date.now() + (deviceData.expires_in ?? 600) * 1000
    // Poll immediately once, then sleep. A user who approves quickly shouldn't
    // wait a full 5-second interval before the wizard resumes.
    const MAX_CONSECUTIVE_ERRORS = 5
    let consecutiveErrors = 0
    let firstPoll = true

    while (Date.now() < deadline) {
      if (!firstPoll) {
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
      firstPoll = false
      const outcome = await pollDeviceToken(endpoint, deviceData.device_code)
      if (outcome.status === 'approved') {
        cliToken = outcome.cliToken
        break
      }
      if (outcome.status === 'pending') {
        consecutiveErrors = 0
        continue
      }
      if (outcome.status === 'error') {
        if (outcome.retryable) {
          consecutiveErrors += 1
          if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) continue
        }
        printAuthFailed('error', outcome.message)
        process.exit(1)
      }
      if (outcome.status === 'denied') {
        printAuthFailed('denied')
        process.exit(1)
      }
      if (outcome.status === 'expired') {
        printAuthFailed('timeout')
        process.exit(1)
      }
    }

    if (!cliToken) {
      printAuthFailed('timeout')
      process.exit(1)
    }

    printAuthApproved()

    // Step 4: list projects (CLI token auth)
    const projectsList = await listProjects(endpoint, cliToken)

    // Step 5: pick or create a project
    let chosenProjectId = projectId
    let chosenProjectName: string | undefined

    if (!chosenProjectId) {
      const { createInterface } = await import('node:readline')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const ask = (q: string): Promise<string> =>
        new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))

      if (projectsList.length > 0) {
        console.log('')
        console.log('  Your projects:')
        projectsList.forEach((p, i) => {
          console.log(`    ${i + 1}. ${p.name} (${p.id})`)
        })
        console.log(`    ${projectsList.length + 1}. Create a new project`)
        console.log('')

        const choice = await ask(`  Pick a project [1-${projectsList.length + 1}]: `)
        const num = parseInt(choice, 10)

        if (num >= 1 && num <= projectsList.length) {
          const picked = projectsList[num - 1]
          chosenProjectId = picked.id
          chosenProjectName = picked.name
        }
      }

      if (!chosenProjectId) {
        // Create a new project
        console.log('')
        const newName = await ask('  Project name: ')
        rl.close()

        if (!newName.trim()) {
          process.stderr.write('\nerror: Project name is required.\n')
          process.exit(2)
        }

        try {
          const created = await createProject(endpoint, cliToken, newName.trim())
          chosenProjectId = created.id
          chosenProjectName = created.name
          apiKey = created.apiKey ?? undefined
          console.log(`  ✓ Created project "${chosenProjectName}"`)
        } catch (err) {
          process.stderr.write(`\nerror: Could not create project: ${err instanceof Error ? err.message : String(err)}\n`)
          process.exit(1)
        }
      } else {
        rl.close()
      }
    }

    // Step 6: mint a report:write API key for the SDK (if not already minted by create).
    // Uses the CLI-token-authed endpoint (the /v1/admin/* keys route is JWT-only
    // and would reject the device-auth token).
    if (!apiKey && chosenProjectId) {
      try {
        apiKey = (await mintProjectKey(endpoint, cliToken, chosenProjectId)) ?? undefined
      } catch { /* non-fatal — user can copy from console */ }
    }

    // Step 7: save config
    const config = loadConfig()
    config.endpoint = endpoint
    config.consoleUrl = consoleBase
    if (chosenProjectId) config.projectId = chosenProjectId
    if (apiKey) config.apiKey = apiKey
    saveConfig(config)

    console.log('')
    if (chosenProjectName) console.log(`  ✓ Project: ${chosenProjectName}`)
    if (apiKey) {
      console.log(`  ✓ Full-scope CLI key saved (${apiKey.slice(0, 12)}…)`)
      console.log(`    Scopes: report:write · mcp:read · mcp:write — SDK + MCP + admin CLI (incl. writes) all work with this key`)
    } else {
      console.log(`  ℹ  Get an SDK key at: ${apiKeyHint(consoleBase)}`)
    }
    console.log('')
    if (opts.upgradeScope) {
      console.log("  Key upgraded! Re-run 'mushi setup' to update your .cursor/mcp.json, then restart Cursor.")
    } else {
      console.log("  Run 'mushi init' to set up the SDK in this project.")
    }
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
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
      const res = await fetch(`${config.endpoint}/health`, { signal: controller.signal })
      clearTimeout(timer)
      const latency = Date.now() - t0
      if (opts.json) {
        console.log(JSON.stringify({ ok: res.ok, status: res.status, latency_ms: latency }))
      } else {
        const symbol = res.ok ? '✓' : '✗'
        console.log(`${symbol} ${res.ok ? 'OK' : 'FAIL'} — ${res.status} (${latency}ms)`)
        if (!res.ok) process.exit(1)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg, latency_ms: Date.now() - t0 }))
      } else {
        process.stderr.write(`✗ Unreachable: ${msg}\n`)
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
