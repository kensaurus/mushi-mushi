/* eslint-disable no-console */
/**
 * FILE: packages/cli/src/index.ts
 * PURPOSE: @mushi-mushi/cli — full CLI for managing Mushi Mushi bug-intelligence
 *          from the terminal and CI pipelines.
 *
 * AUTH MODEL
 * ----------
 * All network commands use the project's SDK API key (MUSHI_API_KEY), validated
 * server-side via `apiKeyAuth` middleware. The CLI never needs an interactive
 * Supabase JWT — the API key alone is sufficient for every operation here.
 *
 * Auth precedence (highest wins):
 *   1. Explicit flags (--api-key, --endpoint, --project-id)
 *   2. Environment variables (MUSHI_API_KEY, MUSHI_API_ENDPOINT, MUSHI_PROJECT_ID)
 *   3. ~/.mushirc config file (written by `mushi login`)
 *
 * EXIT CODES
 * ----------
 *   0  — success
 *   1  — API or runtime error
 *   2  — configuration error (missing credentials / bad endpoint)
 *   3  — not found (report/lesson ID does not exist)
 */

import { Command } from 'commander'
import { loadConfig, saveConfig } from './config.js'
import type { CliConfig } from './config.js'
import { runInit } from './init.js'
import { runMigrate } from './migrate.js'
import type { FrameworkId } from './detect.js'
import { MUSHI_CLI_VERSION } from './version.js'
import { assertEndpoint } from './endpoint.js'
import { runSourcemapsUpload } from './sourcemaps.js'
import { installSignalHandlers, getAbortSignal } from './signals.js'
import { renderNudgeSnippet, renderNudgeExplainer, type NudgePhase } from './nudge.js'
import { runDoctor, formatDoctorResult } from './doctor.js'
import { runUpgrade } from './upgrade.js'
import { runConnect } from './connect.js'

// Wire SIGINT/SIGTERM into a process-wide AbortController on first import.
// Long-running commands (`mushi index`, `mushi sourcemaps upload`) can
// then plumb the shared `getAbortSignal()` into their fetch calls and
// inner walks — Ctrl-C aborts the in-flight HTTP request immediately
// instead of waiting for its 15 s timeout, and Docker's SIGTERM kills
// behave the same way for clean container shutdowns.
installSignalHandlers()

// ─── API client ─────────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 15_000

/**
 * Typed API response envelope. Every Mushi sync endpoint returns
 * `{ ok: true, data: T }` or `{ ok: false, error: { code, message } }`.
 */
interface ApiOk<T> { ok: true; data: T; meta?: Record<string, unknown> }
interface ApiError { ok: false; error: { code: string; message: string }; httpStatus?: number }
type ApiResult<T> = ApiOk<T> | ApiError

/**
 * Make an authenticated request to a Mushi sync endpoint.
 *
 * - Always resolves (never throws on HTTP errors) — callers inspect `result.ok`.
 * - Handles non-JSON responses gracefully (router 404s, Supabase gateway errors).
 * - Enforces a 15 s timeout so CI pipelines don't hang forever.
 * - Sends `X-Mushi-Api-Key` header; sync endpoints use `apiKeyAuth` which
 *   reads that header and resolves the project from the API key's DB row.
 */
async function apiCall<T = unknown>(
  path: string,
  config: CliConfig,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const endpoint = config.endpoint
  if (!endpoint) {
    return {
      ok: false,
      error: {
        code: 'NO_ENDPOINT',
        message:
          'No API endpoint configured.\n' +
          '  Run: mushi login --api-key <key> --endpoint <url> --project-id <id>\n' +
          '  Or:  export MUSHI_API_ENDPOINT=https://<project-ref>.supabase.co/functions/v1/api',
      },
    }
  }

  // Per-request timeout AND process-wide SIGINT/SIGTERM abort: combine
  // the two signals so whichever fires first wins. AbortSignal.any was
  // standardised in Node 20 — matches the CLI's `engines.node: ">=20"`.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const signals = [controller.signal, getAbortSignal()]
  const compositeSignal = AbortSignal.any
    ? AbortSignal.any(signals)
    : controller.signal

  try {
    const res = await fetch(`${endpoint}${path}`, {
      ...options,
      signal: compositeSignal,
      headers: {
        'Content-Type': 'application/json',
        // `apiKeyAuth` reads X-Mushi-Api-Key; the Authorization header is a
        // fallback accepted by some older middleware. Both are sent.
        'Authorization': `Bearer ${config.apiKey ?? ''}`,
        'X-Mushi-Api-Key': config.apiKey ?? '',
        'X-Mushi-Project': config.projectId ?? '',
        'X-Mushi-Cli-Version': MUSHI_CLI_VERSION,
        ...options.headers,
      },
    })

    clearTimeout(timer)

    // Safe JSON parse — gateway 404s and Deno edge runtime cold-start errors
    // return plain text. Wrapping protects callers from an unhandled exception.
    let body: unknown
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try { body = await res.json() } catch { body = null }
    } else {
      const text = await res.text()
      try { body = JSON.parse(text) } catch {
        // Non-JSON body — surface as a structured error.
        body = {
          ok: false,
          error: {
            code: `HTTP_${res.status}`,
            message: text.trim().slice(0, 300) || `HTTP ${res.status}`,
          },
        }
      }
    }

    // Normalise: if the server returned a bare error object without `ok: false`
    if (
      !res.ok &&
      typeof body === 'object' &&
      body !== null &&
      !('ok' in body)
    ) {
      const b = body as Record<string, unknown>
      return {
        ok: false,
        httpStatus: res.status,
        error: {
          code: (b['code'] as string) ?? `HTTP_${res.status}`,
          message: (b['message'] as string) ?? `Request failed (${res.status})`,
        },
      }
    }

    return body as ApiResult<T>
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${API_TIMEOUT_MS / 1000}s. Check your network or endpoint.`,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Print an API error and exit with the appropriate code. */
function die(result: ApiError, exitCode = 1): never {
  const { code, message } = result.error
  const status = result.httpStatus ? ` [${result.httpStatus}]` : ''
  process.stderr.write(`error${status}: ${code} — ${message}\n`)
  process.exit(exitCode)
}

/**
 * Load config and assert that api key + endpoint are present.
 * Exits with code 2 (config error) if either is missing.
 */
function requireConfig(opts: { needsProject?: boolean } = {}): Required<Pick<CliConfig, 'apiKey' | 'endpoint'>> & CliConfig {
  const config = loadConfig()
  if (!config.apiKey) {
    process.stderr.write(
      'error: API key not configured.\n' +
      '  Run:  mushi login --api-key <key> --endpoint <url>\n' +
      '  Or:   export MUSHI_API_KEY=<key>\n',
    )
    process.exit(2)
  }
  if (!config.endpoint) {
    process.stderr.write(
      'error: API endpoint not configured.\n' +
      '  Run:  mushi login --endpoint https://<ref>.supabase.co/functions/v1/api\n' +
      '  Or:   export MUSHI_API_ENDPOINT=<url>\n',
    )
    process.exit(2)
  }
  if (opts.needsProject && !config.projectId) {
    process.stderr.write(
      'error: Project ID not configured.\n' +
      '  Run:  mushi login --project-id <uuid>\n' +
      '  Or:   export MUSHI_PROJECT_ID=<uuid>\n' +
      '  Find your project ID: https://kensaur.us/mushi-mushi/projects\n',
    )
    process.exit(2)
  }
  return config as Required<Pick<CliConfig, 'apiKey' | 'endpoint'>> & CliConfig
}

/** Format a UTC date string to a compact local date+time string. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/** Right-pad a string to a fixed width (for aligned table output). */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

// ─── CLI program ─────────────────────────────────────────────────────────────

const program = new Command()
  .name('mushi')
  .description('Mushi Mushi CLI — set up the SDK, manage bug reports, monitor pipeline')
  .version(MUSHI_CLI_VERSION)
  .addHelpText('after', `
Environment variables:
  MUSHI_API_KEY        Project API key (from Settings → API Keys in the console)
  MUSHI_PROJECT_ID     Project UUID    (from the Projects page in the console)
  MUSHI_API_ENDPOINT   Supabase edge function URL
                       e.g. https://<ref>.supabase.co/functions/v1/api

Exit codes:
  0  success
  1  API / runtime error
  2  configuration error (missing credentials or endpoint)
  3  not found (resource does not exist)

Console: https://kensaur.us/mushi-mushi/
Docs:    https://github.com/kensaurus/mushi-mushi`)

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
  .description('Save API credentials to ~/.mushirc (mode 0o600)')
  .requiredOption('--api-key <key>', 'Mushi API key (mushi_...)')
  .option('--endpoint <url>', 'Supabase edge function URL')
  .option('--project-id <id>', 'Project UUID (from the Projects page)')
  .addHelpText('after', `
Examples:
  mushi login --api-key mushi_xxx --endpoint https://xyz.supabase.co/functions/v1/api
  mushi login --api-key mushi_xxx --project-id 542b34e0-019e-41fe-b900-7b637717bb86`)
  .action((opts: { apiKey: string; endpoint?: string; projectId?: string }) => {
    const config = loadConfig()
    config.apiKey = opts.apiKey
    if (opts.endpoint) config.endpoint = assertEndpoint(opts.endpoint)
    if (opts.projectId) config.projectId = opts.projectId
    saveConfig(config)
    console.log('✓ Credentials saved to ~/.mushirc (mode 0o600)')
    console.log("  Run 'mushi whoami' to verify the connection.")
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
  .description('View or update CLI config (stored in ~/.mushirc)')
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

// ─── deploy ───────────────────────────────────────────────────────────────────
const deploy = program.command('deploy').description('Deployment management')

deploy
  .command('check')
  .description('Check edge function health and measure latency')
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
      const body: Record<string, unknown> = res.headers.get('content-type')?.includes('json')
        ? await res.json().catch(() => ({}))
        : {}
      if (opts.json) {
        console.log(JSON.stringify({ ok: res.ok, status: res.status, latency_ms: latency, ...body }))
      } else {
        console.log(`Health: ${res.status === 200 ? 'OK' : 'FAIL'} (${res.status}) — ${latency}ms`)
        if (body['version']) console.log(`  Version: ${body['version']}`)
        if (body['region']) console.log(`  Region:  ${body['region']}`)
      }
      if (!res.ok) process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }))
      } else {
        process.stderr.write(`error: ${msg}\n`)
      }
      process.exit(1)
    }
  })

// ─── reports ──────────────────────────────────────────────────────────────────
const reports = program.command('reports').description('Manage bug reports')

reports
  .command('list')
  .description('List recent reports for the current project')
  .option('--limit <n>', 'Max results (1–100)', '20')
  .option('--status <status>', 'Filter by status: new|triaged|in_progress|resolved|dismissed')
  .option('--severity <severity>', 'Filter by severity: critical|high|medium|low')
  .option('--search <query>', 'Full-text search in summary and description')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Examples:
  mushi reports list
  mushi reports list --status new --severity critical
  mushi reports list --search "button not working" --limit 5 --json`)
  .action(async (opts: { limit: string; status?: string; severity?: string; search?: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 20), 100)
    const params = new URLSearchParams({ limit: String(limit) })
    if (opts.status) params.set('status', opts.status)
    if (opts.severity) params.set('severity', opts.severity)
    if (opts.search) params.set('search', opts.search)
    const result = await apiCall<ReportListData>(`/v1/sync/reports?${params}`, config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const rows = result.data.reports
    if (rows.length === 0) {
      console.log('No reports found.')
      return
    }
    console.log(`${pad('ID', 38)} ${pad('SEV', 9)} ${pad('STATUS', 12)} ${pad('CREATED', 17)} SUMMARY`)
    console.log('─'.repeat(110))
    for (const r of rows) {
      const sev = r.severity ?? 'unset'
      const status = r.status ?? 'new'
      const summary = (r.summary ?? r.description ?? '').slice(0, 50)
      console.log(`${pad(r.id, 38)} ${pad(sev, 9)} ${pad(status, 12)} ${pad(fmtDate(r.created_at), 17)} ${summary}`)
    }
    if (result.data.total > rows.length) {
      console.log(`\n  … ${result.data.total - rows.length} more. Use --limit to see more.`)
    }
  })

reports
  .command('show <id>')
  .description('Show full details for a single report')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config)
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const r = result.data
    console.log(`Report: ${r.id}`)
    console.log(`  Status:   ${r.status ?? 'new'}`)
    console.log(`  Severity: ${r.severity ?? 'unset'}`)
    console.log(`  Category: ${r.category ?? '—'}`)
    console.log(`  Created:  ${fmtDate(r.created_at)}`)
    if (r.summary) console.log(`  Summary:  ${r.summary}`)
    if (r.description) {
      console.log(`  Description:`)
      console.log(`    ${r.description.replace(/\n/g, '\n    ')}`)
    }
    if (r.environment?.url) console.log(`  URL:      ${r.environment.url}`)
    if (r.component) console.log(`  Component: ${r.component}`)
    if (r.sentry_event_id) console.log(`  Sentry:   ${r.sentry_event_id}`)
    if (r.fix_id) console.log(`  Fix:      ${r.fix_id}`)
    if (r.tags && Object.keys(r.tags).length > 0) {
      console.log(`  Tags:     ${JSON.stringify(r.tags)}`)
    }
  })

reports
  .command('triage <id>')
  .description('Update the status and/or severity of a report')
  .option('--status <status>', 'New status: new|triaged|in_progress|resolved|dismissed')
  .option('--severity <severity>', 'New severity: critical|high|medium|low')
  .option('--note <text>', 'Internal triage note')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Examples:
  mushi reports triage <id> --status triaged --severity high
  mushi reports triage <id> --status in_progress --note "assigned to @alice"`)
  .action(async (id: string, opts: { status?: string; severity?: string; note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = {}
    if (opts.status) body['status'] = opts.status
    if (opts.severity) body['severity'] = opts.severity
    if (opts.note) body['note'] = opts.note
    if (Object.keys(body).length === 0) {
      process.stderr.write('error: provide at least one of --status, --severity, or --note\n')
      process.exit(2)
    }
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.log(`✓ Updated report ${id}`)
      if (opts.status) console.log(`  Status:   ${opts.status}`)
      if (opts.severity) console.log(`  Severity: ${opts.severity}`)
      if (opts.note) console.log(`  Note:     ${opts.note}`)
    }
  })

reports
  .command('resolve <id>')
  .description('Mark a report as resolved (shorthand for triage --status resolved)')
  .option('--note <text>', 'Resolution note')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'resolved' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.log(`✓ Resolved report ${id}`)
      if (opts.note) console.log(`  Note: ${opts.note}`)
    }
  })

reports
  .command('reopen <id>')
  .description('Reopen a resolved or dismissed report')
  .option('--note <text>', 'Note explaining the reopen')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'new' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.log(`✓ Reopened report ${id}`)
    }
  })

reports
  .command('dismiss <id>')
  .description('Dismiss a report (not a real bug / out of scope)')
  .option('--note <text>', 'Reason for dismissal')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'dismissed' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.log(`✓ Dismissed report ${id}`)
    }
  })

reports
  .command('reply <id> <message>')
  .description('Send a visible reply to the reporter widget for a report')
  .option('--author <name>', 'Display name for the sender (default: "Mushi Admin")')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Examples:
  mushi reports reply abc123 "Thanks for reporting — fixing this in the next release."
  mushi reports reply abc123 "Can you share a screenshot?" --author "Alice"`)
  .action(async (id: string, message: string, opts: { author?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { message }
    if (opts.author) body['author_name'] = opts.author
    const result = await apiCall<{ comment: unknown }>(`/v1/sync/reports/${id}/reply`, config, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.log(`✓ Reply sent to reporter for report ${id}`)
    }
  })

reports
  .command('search <query>')
  .description('Search reports by keyword in summary and description')
  .option('--limit <n>', 'Max results (1–50)', '10')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Examples:
  mushi reports search "login button"
  mushi reports search "404 error" --status new --limit 20`)
  .action(async (query: string, opts: { limit: string; status?: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 10), 50)
    const params = new URLSearchParams({ search: query, limit: String(limit) })
    if (opts.status) params.set('status', opts.status)
    const result = await apiCall<ReportListData>(`/v1/sync/reports?${params}`, config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const rows = result.data.reports
    if (rows.length === 0) {
      console.log(`No reports matching "${query}".`)
      return
    }
    console.log(`${rows.length} result${rows.length === 1 ? '' : 's'} for "${query}":`)
    console.log('')
    for (const r of rows) {
      console.log(`  ${r.id}`)
      console.log(`    ${r.severity ?? 'unset'} · ${r.status ?? 'new'} · ${fmtDate(r.created_at)}`)
      const text = r.summary ?? r.description ?? ''
      if (text) console.log(`    ${text.slice(0, 80)}`)
      console.log('')
    }
  })

// ─── lessons ─────────────────────────────────────────────────────────────────
const lessons = program.command('lessons').description('Manage learned mistake rules')

lessons
  .command('list')
  .description('List active lessons (mistake rules) for the current project')
  .option('--severity <sev>', 'Filter: info|warn|critical')
  .option('--limit <n>', 'Max results (1–200)', '50')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Lessons are mistake rules extracted from past bug reports by the clustering
pipeline. They are injected into AI code-review context via the MCP server.`)
  .action(async (opts: { severity?: string; limit: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 50), 200)
    const params = new URLSearchParams({ limit: String(limit) })
    if (opts.severity) params.set('severity', opts.severity)
    const result = await apiCall<LessonListData>(`/v1/sync/lessons?${params}`, config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const rows = result.data
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log('No active lessons yet. Reports are clustered nightly.')
      return
    }
    console.log(`${pad('SEV', 9)} ${pad('FREQ', 6)} RULE`)
    console.log('─'.repeat(90))
    for (const l of rows as LessonRow[]) {
      const sev = l.severity ?? 'info'
      const freq = String(l.frequency ?? 0)
      const rule = (l.rule_text ?? '').slice(0, 70)
      console.log(`${pad(sev, 9)} ${pad(freq, 6)} ${rule}`)
    }
    console.log(`\n  ${rows.length} active lesson${rows.length === 1 ? '' : 's'}`)
  })

lessons
  .command('show <id>')
  .description('Show full detail for a single lesson (rule text, anti-pattern, source reports)')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<LessonRow>(`/v1/sync/lessons/${id}`, config)
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: lesson "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const l = result.data
    console.log(`Lesson: ${l.id}`)
    console.log(`  Severity:  ${l.severity}`)
    console.log(`  Frequency: ${l.frequency} reports`)
    if (l.last_reinforced_at) console.log(`  Updated:   ${fmtDate(l.last_reinforced_at)}`)
    console.log('')
    console.log(`Rule:`)
    console.log(`  ${l.rule_text}`)
    if (l.anti_pattern) {
      console.log('')
      console.log(`Anti-pattern:`)
      console.log(`  ${l.anti_pattern}`)
    }
    if (l.summary_paragraph) {
      console.log('')
      console.log(`Summary:`)
      console.log(`  ${l.summary_paragraph}`)
    }
  })

// ─── sync-lessons ─────────────────────────────────────────────────────────────
program
  .command('sync-lessons')
  .description('Pull promoted lessons from Mushi and write .mushi/lessons.json into this repo')
  .option('--cwd <path>', 'Target directory (default: current working dir)')
  .option('--dry-run', 'Print the JSON that would be written without writing anything')
  .option('--json', 'Machine-readable output: { ok, path, count }')
  .addHelpText('after', `
Used in CI to keep .mushi/lessons.json up to date so the Mushi MCP server
and Cursor rules can inject the latest project-specific mistake rules into
AI code review context.

Typical CI usage:
  MUSHI_API_KEY=$KEY MUSHI_PROJECT_ID=$PID MUSHI_API_ENDPOINT=$URL \\
    npx @mushi-mushi/cli sync-lessons --cwd .`)
  .action(async (opts: { cwd?: string; dryRun?: boolean; json?: boolean }) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const config = requireConfig()

    const cwd = opts.cwd ?? process.cwd()
    const target = nodePath.join(cwd, '.mushi', 'lessons.json')

    const result = await apiCall<LessonRow[]>('/v1/sync/lessons?limit=500', config)
    if (!result.ok) die(result)

    const rows = Array.isArray(result.data) ? result.data : []
    const lessons: LessonsJson['lessons'] = rows.map((l) => ({
      id: l.id,
      rule: l.rule_text,
      anti_pattern: l.anti_pattern ?? undefined,
      severity: l.severity,
      frequency: l.frequency,
      last_reinforced: l.last_reinforced_at?.slice(0, 10) ?? '',
      cluster_id: l.cluster_id ?? undefined,
    }))

    const output: LessonsJson = {
      schema_version: '1',
      project_id: config.projectId ?? '',
      generated_at: new Date().toISOString(),
      lessons,
    }

    if (opts.dryRun) {
      console.log(JSON.stringify(output, null, 2))
      return
    }

    await mkdir(nodePath.dirname(target), { recursive: true })
    await writeFile(target, JSON.stringify(output, null, 2) + '\n', 'utf8')

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, path: target, count: lessons.length }))
    } else {
      console.log(`✓ Wrote ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} to ${target}`)
    }
  })

// ─── test ─────────────────────────────────────────────────────────────────────
program
  .command('test')
  .description('Submit a synthetic test report to verify the ingestion pipeline end-to-end')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<{ reportId: string; status: string }>('/v1/reports', config, {
      method: 'POST',
      body: JSON.stringify({
        projectId: config.projectId,
        description: 'CLI test report — verifying ingestion pipeline',
        category: 'other',
        reporterToken: `cli-test-${Date.now()}`,
        createdAt: new Date().toISOString(),
        environment: {
          url: 'cli://test',
          userAgent: `mushi-cli/${MUSHI_CLI_VERSION}`,
          platform: process.platform,
          language: 'en',
          viewport: { width: 0, height: 0 },
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    })
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      const d = result.data
      console.log(`✓ Test report submitted`)
      console.log(`  ID:     ${d.reportId}`)
      console.log(`  Status: ${d.status}`)
      console.log(`  View:   https://kensaur.us/mushi-mushi/reports/${d.reportId}`)
    }
  })

// ─── index ────────────────────────────────────────────────────────────────────
program
  .command('index <path>')
  .description('Walk a local repo and upload code chunks to the Mushi RAG indexer')
  .option('--language <lang>', 'Limit to one language: ts, tsx, js, py, go, rs')
  .option('--dry-run', 'Show what would be uploaded without sending')
  .option('--json', 'Machine-readable summary: { files, bytes }')
  .addHelpText('after', `
Uploads source code into the Mushi vector index so the fix-worker can
retrieve relevant context when generating patches. Only needed for private
repos that cannot be auto-indexed via GitHub App.

Examples:
  mushi index ./src
  mushi index ./src --language ts --dry-run`)
  .action(async (path: string, opts: { language?: string; dryRun?: boolean; json?: boolean }) => {
    const config = requireConfig({ needsProject: true })

    const { readdir, readFile, stat } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const SKIP = /node_modules|\.git|dist|build|\.next|\.turbo|coverage/
    const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'])
    const MAX_FILE_BYTES = 500_000

    async function* walk(dir: string): AsyncGenerator<string> {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = nodePath.join(dir, e.name)
        if (SKIP.test(full)) continue
        if (e.isDirectory()) yield* walk(full)
        else if (EXTS.has(nodePath.extname(e.name))) yield full
      }
    }

    let count = 0; let bytes = 0; let errors = 0
    const root = nodePath.resolve(path)

    for await (const file of walk(root)) {
      const lang = nodePath.extname(file).slice(1)
      if (opts.language && opts.language !== lang) continue
      const stats = await stat(file)
      if (stats.size > MAX_FILE_BYTES) {
        if (!opts.json) process.stdout.write(`  skip  ${nodePath.relative(root, file)} (>${MAX_FILE_BYTES / 1000}KB)\n`)
        continue
      }
      const source = await readFile(file, 'utf8')
      const relative = nodePath.relative(root, file).replaceAll('\\', '/')
      count++; bytes += source.length
      if (opts.dryRun) {
        if (!opts.json) process.stdout.write(`  ${relative} (${source.length} bytes)\n`)
        continue
      }
      const result = await apiCall<{ chunks: number }>('/v1/sync/codebase/upload', config, {
        method: 'POST',
        body: JSON.stringify({ projectId: config.projectId, filePath: relative, source }),
      })
      if (!result.ok) {
        errors++
        process.stderr.write(`  FAIL  ${relative}: ${result.error.message}\n`)
      } else if (!opts.json) {
        process.stdout.write(`  ok    ${relative} → ${result.data.chunks} chunks\n`)
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ ok: errors === 0, files: count, bytes, errors }))
    } else {
      const kb = (bytes / 1024).toFixed(1)
      console.log(`\nIndexed ${count} files (${kb} KB) into project ${config.projectId}${errors ? ` — ${errors} failed` : ''}`)
    }
    if (errors > 0) process.exit(1)
  })

// ─── sourcemaps ───────────────────────────────────────────────────────────────
const sourcemaps = program.command('sourcemaps').description('Source map management')

sourcemaps
  .command('upload')
  .description('Upload source maps to Mushi (idempotent, SHA256-keyed) for stack trace symbolication')
  .requiredOption('--release <version>', 'Release identifier, e.g. 1.0.0 or a git SHA')
  .option('--dir <path>', 'Directory containing .map files', './dist')
  .option('--dry-run', 'List files that would be uploaded without uploading')
  .option('-e, --endpoint <url>', 'API endpoint (overrides MUSHI_API_ENDPOINT)')
  .option('--api-key <key>', 'API key (overrides MUSHI_API_KEY)')
  .option('--silent', 'Suppress progress output')
  .addHelpText('after', `
Examples:
  mushi sourcemaps upload --release 1.0.0
  mushi sourcemaps upload --release $(git rev-parse --short HEAD) --dir ./dist`)
  .action(async (opts: {
    release: string; dir: string; dryRun?: boolean
    endpoint?: string; apiKey?: string; silent?: boolean
  }) => {
    await runSourcemapsUpload({
      release: opts.release, dir: opts.dir, dryRun: opts.dryRun,
      endpoint: opts.endpoint, apiKey: opts.apiKey, silent: opts.silent,
    })
  })

// ─── project ──────────────────────────────────────────────────────────────────
const project = program.command('project').description('Project management')

project
  .command('create')
  .description('Create a new Mushi project, mint an API key, and write config files')
  .option('--name <name>', 'Project name (skip the prompt)')
  .option('--no-browser', 'Skip opening the browser for the sign-up / magic-link step')
  .option('--endpoint <url>', 'Override API endpoint (self-hosted)')
  .addHelpText('after', `
Creates a project on app.mushimushi.dev, mints an API key with mcp:read+write scope,
and writes the following to the current directory:
  .env.local            — MUSHI_API_KEY, MUSHI_PROJECT_ID, MUSHI_API_ENDPOINT
  .cursor/mcp.json      — pre-filled mcpServers.mushi block for Cursor

Typical first-time flow:
  npx mushi-mushi project create
  # Browser opens → sign up / magic-link → come back to terminal
  # CLI writes .env.local and .cursor/mcp.json
  # mushi whoami to confirm`)
  .action(async (opts: { name?: string; browser?: boolean; endpoint?: string }) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')

    const endpoint = opts.endpoint ?? loadConfig().endpoint ?? 'https://api.mushimushi.dev'
    const signUpUrl = 'https://kensaur.us/mushi-mushi/sign-up'

    console.log('')
    console.log('  Mushi project create')
    console.log('  ─────────────────────')
    console.log('')

    if (opts.browser !== false) {
      console.log('  1. Opening the Mushi sign-up page in your browser...')
      try {
        const { exec } = await import('node:child_process')
        const openCmd = process.platform === 'win32'
          ? `start "" "${signUpUrl}"`
          : process.platform === 'darwin'
            ? `open "${signUpUrl}"`
            : `xdg-open "${signUpUrl}"`
        exec(openCmd)
      } catch { /* ignore */ }
    } else {
      console.log(`  1. Sign up or log in at: ${signUpUrl}`)
    }

    console.log('')
    console.log('  2. Create a project in the console, then paste your credentials below.')
    console.log('     (Settings → API Keys → New key → Copy as .env.local)')
    console.log('')

    // Interactive prompts for credentials
    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q: string): Promise<string> =>
      new Promise(resolve => rl.question(q, (a) => resolve(a.trim())))

    const projectId = await ask('  Project ID (uuid): ')
    const apiKey = await ask('  API key (mushi_...): ')
    rl.close()

    if (!projectId || !apiKey) {
      process.stderr.write('\nerror: Project ID and API key are required.\n')
      process.exit(2)
    }

    // Save to ~/.mushirc
    const config = loadConfig()
    config.apiKey = apiKey
    config.endpoint = endpoint
    config.projectId = projectId
    saveConfig(config)

    const cwd = process.cwd()

    // Write .env.local
    const envPath = nodePath.join(cwd, '.env.local')
    const envLines = [
      '# Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.',
      `MUSHI_API_ENDPOINT=${endpoint}`,
      `MUSHI_PROJECT_ID=${projectId}`,
      `MUSHI_API_KEY=${apiKey}`,
      '',
    ]
    const envExisting = existsSync(envPath)
    await writeFile(envPath, envLines.join('\n'), 'utf8')
    console.log(`\n  ✓ ${envExisting ? 'Updated' : 'Created'} .env.local`)

    // Write .cursor/mcp.json
    const mcpDir = nodePath.join(cwd, '.cursor')
    await mkdir(mcpDir, { recursive: true })
    const mcpPath = nodePath.join(mcpDir, 'mcp.json')
    const mcpJson = {
      mcpServers: {
        mushi: {
          command: 'npx',
          args: ['-y', '@mushi-mushi/mcp@latest'],
          env: {
            MUSHI_API_ENDPOINT: endpoint,
            MUSHI_PROJECT_ID: projectId,
            MUSHI_API_KEY: apiKey,
          },
        },
      },
    }
    const mcpExisting = existsSync(mcpPath)
    if (mcpExisting) {
      // Merge rather than overwrite — preserve other mcpServers entries
      try {
        const { readFile } = await import('node:fs/promises')
        const raw = JSON.parse(await readFile(mcpPath, 'utf8')) as Record<string, unknown>
        const existing = raw as { mcpServers?: Record<string, unknown> }
        existing.mcpServers = { ...(existing.mcpServers ?? {}), mushi: mcpJson.mcpServers.mushi }
        await writeFile(mcpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8')
      } catch {
        await writeFile(mcpPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf8')
      }
    } else {
      await writeFile(mcpPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf8')
    }
    console.log(`  ✓ ${mcpExisting ? 'Updated' : 'Created'} .cursor/mcp.json`)

    console.log('')
    console.log('  Done! Restart Cursor and ask: "list mushi tools"')
    console.log('  Run `mushi whoami` to verify the connection.')
    console.log('')
  })

// ─── setup ────────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Wire Mushi into your IDE with one command')
  .option('--ide <ide>', 'Target IDE: cursor | claude | continue | zed', 'cursor')
  .option('--project-slug <slug>', 'Override the project slug in the server name (default: project ID prefix)')
  .option('--with-rules', 'Also write the .cursorrules / .claude/rules/mushi.md lesson-library hook')
  .option('--dry-run', 'Print what would be written without making changes')
  .addHelpText('after', `
Examples:
  mushi setup                         # wire Cursor (default)
  mushi setup --ide claude            # wire Claude Code
  mushi setup --ide cursor --with-rules  # also write .cursorrules

Supported IDEs:
  cursor    — writes .cursor/mcp.json
  claude    — writes .claude/mcp.json (Claude Code / Claude Desktop)
  continue  — writes .continue/mcp.json
  zed       — writes ~/.config/zed/settings.json mcpServers block

The command reads credentials from ~/.mushirc (run \`mushi login\` first).`)
  .action(async (opts: { ide: string; projectSlug?: string; withRules?: boolean; dryRun?: boolean }) => {
    const { writeFile, mkdir, readFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const os = await import('node:os')

    const config = requireConfig({ needsProject: true })

    const IDE_CONFIG: Record<string, { dir: string; file: string; format: 'mcp-json' | 'zed' }> = {
      cursor:   { dir: '.cursor',                       file: 'mcp.json', format: 'mcp-json' },
      claude:   { dir: '.claude',                        file: 'mcp.json', format: 'mcp-json' },
      continue: { dir: '.continue',                      file: 'mcp.json', format: 'mcp-json' },
      zed:      { dir: nodePath.join(os.homedir(), '.config', 'zed'), file: 'settings.json', format: 'zed' },
    }

    const ideEntry = IDE_CONFIG[opts.ide]
    if (!ideEntry) {
      process.stderr.write(`error: unsupported IDE "${opts.ide}". Supported: ${Object.keys(IDE_CONFIG).join(', ')}\n`)
      process.exit(2)
    }

    const cwd = process.cwd()
    const slug = opts.projectSlug ?? (config.projectId?.slice(0, 8) ?? 'mushi')
    const serverName = `mushi-${slug}`

    const mcpServerBlock = {
      command: 'npx',
      args: ['-y', '@mushi-mushi/mcp@latest'],
      env: {
        MUSHI_API_ENDPOINT: config.endpoint,
        MUSHI_PROJECT_ID: config.projectId ?? '',
        MUSHI_API_KEY: config.apiKey,
      },
    }

    const configDir = ideEntry.dir.startsWith('/')
      ? ideEntry.dir
      : nodePath.join(cwd, ideEntry.dir)
    const configPath = nodePath.join(configDir, ideEntry.file)

    if (ideEntry.format === 'mcp-json') {
      let merged: Record<string, unknown> = { mcpServers: {} }
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf8')
          merged = JSON.parse(raw) as Record<string, unknown>
        } catch { /* start fresh */ }
      }
      const servers = (merged.mcpServers as Record<string, unknown>) ?? {}
      servers[serverName] = mcpServerBlock
      merged.mcpServers = servers

      const output = JSON.stringify(merged, null, 2) + '\n'
      if (opts.dryRun) {
        console.log(`[dry-run] Would write ${configPath}:`)
        console.log(output)
      } else {
        await mkdir(configDir, { recursive: true })
        await writeFile(configPath, output, 'utf8')
        console.log(`✓ Written ${configPath}`)
      }
    } else if (ideEntry.format === 'zed') {
      let settings: Record<string, unknown> = {}
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf8')
          settings = JSON.parse(raw) as Record<string, unknown>
        } catch { /* start fresh */ }
      }
      const servers = (settings.context_servers as Record<string, unknown>) ?? {}
      // Zed context-server spec: `command.env` passes env vars to the spawned process.
      // `settings: {}` is kept for Zed UI (it maps to settings the extension can expose)
      // but env vars are the actual credential delivery mechanism for MCP servers.
      servers[serverName] = {
        command: {
          path: 'npx',
          args: ['-y', '@mushi-mushi/mcp@latest'],
          env: {
            MUSHI_API_ENDPOINT: config.endpoint,
            MUSHI_PROJECT_ID: config.projectId ?? '',
            MUSHI_API_KEY: config.apiKey,
          },
        },
        settings: {},
      }
      settings.context_servers = servers
      const output = JSON.stringify(settings, null, 2) + '\n'
      if (opts.dryRun) {
        console.log(`[dry-run] Would write ${configPath}:`)
        console.log(output)
      } else {
        await mkdir(configDir, { recursive: true })
        await writeFile(configPath, output, 'utf8')
        console.log(`✓ Written ${configPath}`)
      }
    }

    if (opts.withRules) {
      const rulesContent = [
        '# Mushi Mushi — evolution-loop coding rules',
        '#',
        '# These rules are generated from your project\'s live lesson library.',
        '# Run `mushi sync-lessons` to refresh .mushi/lessons.json',
        '# The MCP server (mushi tools) also injects lessons dynamically at fix time.',
        '',
        '## Before writing a fix',
        '',
        '1. Call `get_fix_context` (MCP) for the report — get root cause + blast radius first.',
        '2. Call `lessons.query` (MCP) or read .mushi/lessons.json — apply every matching rule.',
        '3. Prefer the smallest change that makes the test pass. Don\'t refactor unrelated code.',
        '',
        '## After writing a fix',
        '',
        '1. Call `submit_fix_result` (MCP) with the branch, PR URL, and files changed.',
        '2. The judge batch will score the fix overnight — high-frequency lessons surface in /admin/lessons.',
        '',
        '## Mushi lesson library (auto-updated by `mushi sync-lessons`)',
        '',
        '<!-- lessons synced from .mushi/lessons.json -->',
        '<!-- run `mushi sync-lessons` to refresh -->',
        '',
      ].join('\n')

      if (opts.ide === 'cursor') {
        const rulesPath = nodePath.join(cwd, '.cursorrules')
        if (opts.dryRun) {
          console.log(`[dry-run] Would write ${rulesPath}`)
        } else {
          await writeFile(rulesPath, rulesContent, 'utf8')
          console.log(`✓ Written .cursorrules`)
        }
      } else if (opts.ide === 'claude') {
        const rulesDir = nodePath.join(cwd, '.claude', 'rules')
        const rulesPath = nodePath.join(rulesDir, 'mushi.md')
        if (opts.dryRun) {
          console.log(`[dry-run] Would write ${rulesPath}`)
        } else {
          await mkdir(rulesDir, { recursive: true })
          await writeFile(rulesPath, rulesContent, 'utf8')
          console.log(`✓ Written .claude/rules/mushi.md`)
        }
      }
    }

    if (!opts.dryRun) {
      console.log('')
      console.log(`Done! Restart ${opts.ide === 'cursor' ? 'Cursor' : opts.ide === 'claude' ? 'Claude Code' : opts.ide} and ask: "list mushi tools"`)
      if (!opts.withRules) {
        console.log(`Tip: run with --with-rules to also write the lesson-library coding hook.`)
      }
      // Security reminder — the config file contains the API key in plaintext.
      const configRelPath = ideEntry.dir.startsWith('/')
        ? configPath
        : nodePath.relative(cwd, configPath)
      console.log(`\nNote: ${configRelPath} contains your Mushi API key — add it to .gitignore if this is a shared repo.`)
    }
  })

// ─── mushi fix ───────────────────────────────────────────────────────────────

const fixCmd = program.command('fix').description('Dispatch an agentic fix for a report')

fixCmd
  .argument('<reportId>', 'Report UUID to fix')
  .option(
    '--agent <name>',
    'Agent adapter: claude_code (default), cursor_cloud, codex, mcp',
    'claude_code',
  )
  .option(
    '--model <slug>',
    'Model override for cursor_cloud (e.g. composer-latest)',
  )
  .option(
    '--no-auto-pr',
    'For cursor_cloud: skip automatic PR creation (branch only)',
  )
  .option(
    '--wait',
    'Poll until terminal state and exit non-zero on error/cancelled (CI-friendly)',
  )
  .option('-e, --endpoint <url>', 'API endpoint (overrides MUSHI_API_ENDPOINT)')
  .option('--api-key <key>', 'API key (overrides MUSHI_API_KEY)')
  .option('--project-id <id>', 'Project ID (overrides MUSHI_PROJECT_ID)')
  .addHelpText('after', `
Examples:
  mushi fix abc123 --agent cursor_cloud --wait
  mushi fix abc123 --agent cursor_cloud --model composer-latest --no-auto-pr
  mushi fix abc123 --agent claude_code

  # CI: fail the pipeline if the fix errors
  mushi fix $REPORT_ID --agent cursor_cloud --wait && echo "Fix PR opened"`)
  .action(async (reportId: string, opts: {
    agent: string
    model?: string
    autoPr: boolean
    wait?: boolean
    endpoint?: string
    apiKey?: string
    projectId?: string
  }) => {
    const cfg = loadConfig()
    if (opts.endpoint) cfg.endpoint = opts.endpoint
    if (opts.apiKey) cfg.apiKey = opts.apiKey
    if (opts.projectId) cfg.projectId = opts.projectId

    const isTTY = process.stdout.isTTY

    const emitEvent = (type: string, data: Record<string, unknown>) => {
      if (isTTY) {
        const ts = new Date().toISOString()
        console.log(`[${ts}] ${type}`, JSON.stringify(data))
      } else {
        process.stdout.write(JSON.stringify({ type, ...data }) + '\n')
      }
    }

    emitEvent('dispatch.start', { reportId, agent: opts.agent, model: opts.model ?? null })

    const body: Record<string, unknown> = {
      reportId,
      projectId: cfg.projectId,
      agent: opts.agent,
    }
    if (opts.agent === 'cursor_cloud') {
      if (opts.model) body.cursorModel = opts.model
      if (!opts.autoPr) body.cursorAutoCreatePR = false
    }

    const result = await apiCall<{
      fixId?: string; status?: string; agentId?: string; runId?: string; prUrl?: string
    }>('/v1/admin/fixes/dispatch', cfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!result.ok) {
      console.error('Error dispatching fix:', result.error.message)
      process.exit(1)
    }

    const { fixId, status, agentId, runId, prUrl } = result.data
    emitEvent('dispatch.ok', { fixId, status, agentId, runId, prUrl })

    if (!opts.wait) {
      process.exit(0)
    }

    if (!fixId) {
      console.error('No fixId returned — cannot poll.')
      process.exit(1)
    }

    // Poll until terminal state.
    const POLL_MS = 5_000
    const MAX_POLLS = 120 // 10 min max
    const TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'skipped', 'skipped_unsupported_agent', 'skipped_no_sandbox'])

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const pollResult = await apiCall<{ status?: string; pr_url?: string; error?: string; cursor_agent_id?: string }>(
        `/v1/admin/fixes/${fixId}`,
        cfg,
      )
      if (!pollResult.ok) {
        emitEvent('poll.error', { error: pollResult.error.message })
        continue
      }
      const s = pollResult.data.status
      emitEvent('fix.status', { status: s, pr_url: pollResult.data.pr_url, cursor_agent_id: pollResult.data.cursor_agent_id })

      if (s && TERMINAL.has(s)) {
        const success = s === 'completed'
        if (!success) {
          console.error(`Fix ended with status: ${s}${pollResult.data.error ? ` — ${pollResult.data.error}` : ''}`)
          process.exit(1)
        }
        process.exit(0)
      }
    }

    console.error('Polling timed out after 10 minutes. The fix may still be running.')
    process.exit(1)
  })

program
  .command('nudge')
  .description(
    'Generate a Mushi.init() snippet tuned for your release phase ' +
      '(alpha, beta, ga). Customises proactive triggers, cooldowns, ' +
      'feature-request card, and beta-mode UI.',
  )
  .option('--phase <phase>', 'Release phase: alpha | beta | ga', 'beta')
  .option('--explain', 'Print a human-readable summary of what the preset does')
  .option('--max <n>', 'Override maxProactivePerSession')
  .option('--cooldown <hours>', 'Override dismissCooldownHours')
  .option('--dwell <minutes>', 'Override page-dwell threshold (0 disables)')
  .option('--welcome <seconds>', 'Override first-session welcome delay (0 disables)')
  .action((opts: {
    phase: string
    explain?: boolean
    max?: string
    cooldown?: string
    dwell?: string
    welcome?: string
  }) => {
    const validPhases: NudgePhase[] = ['alpha', 'beta', 'ga']
    if (!validPhases.includes(opts.phase as NudgePhase)) {
      console.error(`Unknown phase "${opts.phase}". Use one of: ${validPhases.join(', ')}`)
      process.exit(1)
    }
    const phase = opts.phase as NudgePhase
    const overrides: Record<string, number> = {}
    // Parse + validate each numeric override; reject NaN / negative / Infinity
    // so the generated snippet never silently emits a broken value.
    const parseNumericFlag = (flag: string, raw: string, min: number): number => {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < min) {
        console.error(
          `error: --${flag} must be a finite number >= ${min} (got "${raw}")`,
        )
        process.exit(1)
      }
      return n
    }
    if (opts.max !== undefined) overrides.maxProactivePerSession = parseNumericFlag('max', opts.max, 1)
    if (opts.cooldown !== undefined) overrides.dismissCooldownHours = parseNumericFlag('cooldown', opts.cooldown, 0)
    if (opts.dwell !== undefined) overrides.pageDwellMinutes = parseNumericFlag('dwell', opts.dwell, 0)
    if (opts.welcome !== undefined) overrides.firstSessionSeconds = parseNumericFlag('welcome', opts.welcome, 0)
    if (opts.explain) {
      console.log(renderNudgeExplainer(phase))
    }
    console.log(renderNudgeSnippet({ phase, overrides }))
  })

program
  .command('upgrade')
  .description('Bump installed @mushi-mushi/* packages to the latest stable npm release')
  .option('--cwd <path>', 'Target repo (default: cwd)')
  .option('--dry-run', 'Print the install command without running it')
  .option('--json', 'Machine-readable plan + result')
  .addHelpText('after', `
Examples:
  mushi upgrade
  mushi upgrade --dry-run
  mushi upgrade --cwd ../glot.it`)
  .action(async (opts: { cwd?: string; dryRun?: boolean; json?: boolean }) => {
    const result = await runUpgrade({ cwd: opts.cwd, dryRun: opts.dryRun, json: opts.json })
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(result.message)
      for (const e of result.plan.entries) {
        const tag = e.willUpgrade && e.latest ? `→ v${e.latest}` : '(current)'
        console.log(`  ${e.name}@${e.current} ${tag}`)
      }
    }
    if (!result.upgraded && result.plan.entries.some((e) => e.willUpgrade) && !opts.dryRun) {
      process.exit(1)
    }
    if (result.plan.entries.length === 0) process.exit(1)
  })

program
  .command('connect')
  .description('Save credentials, merge env vars, wire Cursor MCP, optionally wait for SDK heartbeat')
  .option('--api-key <key>', 'Mushi API key (mushi_…) — or set MUSHI_API_KEY to keep it out of shell history')
  .requiredOption('--project-id <id>', 'Project UUID')
  .requiredOption('--endpoint <url>', 'Supabase edge function URL')
  .option('--cwd <path>', 'Target repo')
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
    wait?: boolean
    waitTimeout: string
    json?: boolean
  }) => {
    // Prefer the env var so the key isn't captured in shell history / `ps`.
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
      writeEnv: opts.env !== false,
      wireIde: opts.ide !== false,
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

program
  .command('doctor')
  .description(
    'Run pre-flight checks: CLI config, endpoint reachability, API key shape, ' +
      'SDK install status, and (with --server) the same 4 dispatch-readiness ' +
      'checks shown in the Mushi console. Mirrors the in-console dispatch ' +
      'preflight so you can spot setup gaps before opening the admin UI.',
  )
  .option('--cwd <path>', 'Run package detection from a different directory')
  .option('--json', 'Machine-readable output')
  .option(
    '--server',
    'Also call GET /preflight on the backend and include the 4 dispatch ' +
      'checks (GitHub repo, codebase indexed, Anthropic key, autofix enabled). ' +
      'Requires a configured projectId and API key.',
  )
  .option(
    '--ingest',
    'Also call GET /v1/sync/ingest-setup for the 4 required ingest steps ' +
      '(API key, SDK heartbeat, first report). Composable with --server.',
  )
  .option(
    '--qa-stories',
    'Check enabled QA stories for common setup issues: missing Firecrawl key, ' +
      'missing target URL, Slack not connected. Requires --server credentials.',
  )
  .action(async (opts: { cwd?: string; json?: boolean; server?: boolean; ingest?: boolean; qaStories?: boolean }) => {
    const config = loadConfig()
    const result = await runDoctor(config, { cwd: opts.cwd, server: opts.server, ingest: opts.ingest, qaStories: opts.qaStories })
    const { checks } = result

    if (opts.json) {
      console.log(JSON.stringify({ checks, ready: result.ready }, null, 2))
      if (!result.ready) process.exit(1)
      return
    }

    console.log(formatDoctorResult(result))
    if (!result.ready) process.exit(1)
  })

program
  .command('reset [projectId]')
  .description(
    'Archive a project and wipe its test data (codebase_files, fix_attempts, reports). ' +
      'Speeds up re-running the full onboarding flow from scratch. ' +
      'Requires `--confirm` to prevent accidents.',
  )
  .option('--confirm', 'Required safety flag — must pass to proceed')
  .option('--json', 'Machine-readable output')
  .action(async (projectId: string | undefined, opts: { confirm?: boolean; json?: boolean }) => {
    const config = loadConfig()
    const resolvedId = projectId ?? config.projectId
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!resolvedId) { console.error('Provide a projectId or set one via `mushi config projectId <uuid>`'); process.exit(1) }
    if (!opts.confirm) {
      console.error(
        `This will archive project ${resolvedId} and delete all its reports, fix_attempts, and codebase_files.\n` +
          'Re-run with --confirm to proceed.',
      )
      process.exit(1)
    }
    const data = await apiCall(
      `/v1/admin/projects/${resolvedId}/reset`,
      config,
      { method: 'POST' },
    ) as unknown as Record<string, unknown>
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2))
    } else if ((data as Record<string, unknown>).ok) {
      console.log(`Project ${resolvedId} archived and test data wiped.`)
    } else {
      console.error('Reset failed:', JSON.stringify(data, null, 2))
      process.exit(1)
    }
  })

const fixes = program.command('fixes').description('Fix dispatch management')

fixes
  .command('tail')
  .description(
    'Stream SSE dispatch events for a report in real time. ' +
      'Useful for headless debugging without opening the browser.',
  )
  .requiredOption('--report-id <id>', 'Report ID to follow')
  .action(async (opts: { reportId: string }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    const url = `${config.endpoint}/v1/admin/reports/${opts.reportId}/dispatch/stream`
    console.log(`Tailing dispatch stream for report ${opts.reportId}…`)
    console.log(`(Ctrl-C to stop)\n`)

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Mushi-Api-Key': config.apiKey,
        'X-Mushi-Project': config.projectId ?? '',
        'Accept': 'text/event-stream',
      },
    })

    if (!res.ok || !res.body) {
      console.error(`Failed to connect: HTTP ${res.status}`)
      const text = await res.text().catch(() => '')
      if (text) console.error(text.slice(0, 300))
      process.exit(1)
    }

    const decoder = new TextDecoder()
    const reader = res.body.getReader()

    // Handle Ctrl-C gracefully
    let done = false
    process.on('SIGINT', () => {
      done = true
      void reader.cancel()
      console.log('\nDisconnected.')
      process.exit(0)
    })

    while (!done) {
      const { value, done: streamDone } = await reader.read()
      if (streamDone) break
      const chunk = decoder.decode(value, { stream: true })
      // Parse SSE lines and pretty-print them
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') {
            console.log('\n[stream ended]')
            process.exit(0)
          }
          try {
            const event = JSON.parse(raw) as Record<string, unknown>
            const ts = new Date().toISOString()
            const type = (event.type ?? event.event ?? 'event') as string
            const status = (event.status ?? event.data ?? '') as string
            console.log(`${ts}  ${type.padEnd(24)}  ${status}`)
          } catch {
            console.log(line)
          }
        } else if (line.startsWith('event: ')) {
          // SSE event name line — captured as context for the next data line
        } else if (line && !line.startsWith(':')) {
          console.log(line)
        }
      }
    }
  })

// ─── Phase 4: TDD / Story CLI commands ───────────────────────────────────────

const stories = program.command('stories').description('TDD story mapping and test generation')

stories
  .command('map')
  .description('Crawl a live app URL and automatically discover user stories (writes inventory proposal)')
  .requiredOption('--url <url>', 'Live app URL to crawl (e.g. https://your-app.vercel.app)')
  .option('--max-pages <n>', 'Max pages to crawl', '20')
  .option('--provider <p>', 'Crawl provider: firecrawl (default) or browserbase', 'firecrawl')
  .option('--cursor-refine', 'Open a Cursor Cloud PR to refine the draft against repo code')
  .option('--wait', 'Wait for the crawl to complete and print results')
  .action(async (opts: { url: string; maxPages: string; provider: string; cursorRefine?: boolean; wait?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` and `mushi init` first'); process.exit(1) }

    const res = await apiCall<{ runId: string; status: string }>(
      `/v1/admin/inventory/${config.projectId}/map-from-live`,
      config,
      {
        method: 'POST',
        body: JSON.stringify({
          base_url: opts.url,
          max_pages: parseInt(opts.maxPages, 10),
          provider: opts.provider,
          cursor_cloud_refine: opts.cursorRefine ?? false,
        }),
      },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }

    console.log(`✓ Crawl started — run id: ${res.data.runId}`)
    console.log(`  Crawling ${opts.url} with ${opts.provider}…`)

    if (opts.wait) {
      console.log('  Polling for results…')
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const runsRes = await apiCall<{ runs: Array<{ id: string; status: string; pages_crawled: number | null; proposal_id: string | null; error_message: string | null }> }>(
          `/v1/admin/inventory/${config.projectId}/map-runs`,
          config,
        )
        if (!runsRes.ok) break
        const run = runsRes.data.runs.find(r => r.id === res.data.runId)
        if (!run) break
        if (run.status === 'completed') {
          console.log(`\n✓ Done! ${run.pages_crawled ?? 0} pages crawled.`)
          if (run.proposal_id) console.log(`  Proposal id: ${run.proposal_id}`)
          console.log(`  Review in the console: Inventory → Discovery → Past proposals`)
          break
        }
        if (run.status === 'failed') {
          console.error(`\n✗ Crawl failed: ${run.error_message ?? 'unknown'}`)
          process.exit(1)
        }
        process.stdout.write('.')
      }
    }
  })

const tdd = program.command('tdd').description('TDD test generation and management')

tdd
  .command('gen <storyId>')
  .description('Generate a Playwright TDD test from an inventory user story id')
  .option('--mode <m>', 'Gate mode: auto (run immediately) | review (needs approval) | approve (manual)', 'review')
  .option('--no-pr', 'Skip opening a GitHub PR')
  .action(async (storyId: string, opts: { mode: string; pr: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    console.log(`Generating TDD test for story: ${storyId}…`)
    const res = await apiCall<{ qaStoryId: string; prUrl: string | null; approvalStatus: string; needsHumanReview: boolean }>(
      `/v1/admin/inventory/${config.projectId}/stories/${storyId}/generate-test`,
      config,
      { method: 'POST', body: JSON.stringify({ automation_mode: opts.mode, open_pr: opts.pr }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }

    console.log(`✓ Test generated — qa_story id: ${res.data.qaStoryId}`)
    console.log(`  Approval status: ${res.data.approvalStatus}`)
    if (res.data.prUrl) console.log(`  PR: ${res.data.prUrl}`)
    if (res.data.needsHumanReview) console.log(`  ⚠ Human review recommended — some selectors or flows are uncertain.`)
  })

tdd
  .command('improve')
  .description('Run PDCA auto-improve on recently failed QA tests')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    console.log('Running PDCA QA story improver…')
    const res = await apiCall<{ improved: number }>(
      '/v1/admin/pdca/improve-qa-stories',
      config,
      { method: 'POST', body: JSON.stringify({ project_id: config.projectId }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Improved ${res.data.improved} QA stories.`)
  })

tdd
  .command('run <qaStoryId>')
  .description('Trigger a manual run for a QA story')
  .action(async (qaStoryId: string) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ runId: string }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${qaStoryId}/run`,
      config,
      { method: 'POST' },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Run queued — id: ${res.data.runId}`)
  })

tdd
  .command('pending')
  .description('List QA tests pending review')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ stories: Array<{ id: string; name: string; origin_story_node_id: string | null; generated_pr_url: string | null }> }>(
      `/v1/admin/inventory/${config.projectId}/stories/pending-review`,
      config,
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    if (res.data.stories.length === 0) { console.log('No stories pending review.'); return }
    console.log(`${res.data.stories.length} stories pending review:\n`)
    for (const s of res.data.stories) {
      console.log(`  ${s.id}  ${s.name}${s.origin_story_node_id ? ` (story: ${s.origin_story_node_id})` : ''}`)
      if (s.generated_pr_url) console.log(`     PR: ${s.generated_pr_url}`)
    }
    console.log(`\nApprove: mushi tdd approve <id>`)
  })

tdd
  .command('approve <qaStoryId>')
  .description('Approve a pending QA story (enables it in the schedule)')
  .option('--reject', 'Reject instead of approve')
  .action(async (qaStoryId: string, opts: { reject?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const status = opts.reject ? 'rejected' : 'approved'
    const res = await apiCall<{ status: string }>(
      `/v1/admin/inventory/${config.projectId}/stories/${qaStoryId}/approval`,
      config,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Story ${status}.`)
  })

// ─── BYOK key management CLI ──────────────────────────────────────────────────

const keys = program.command('keys').description('Manage API key pool (BYOK)')

keys
  .command('list')
  .description('List all API keys in the pool with their status')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ keys: Array<{ id: string; provider_slug: string; label: string | null; priority: number; status: string; cooldown_until: string | null }> }>(
      `/v1/admin/byok/keys?project_id=${encodeURIComponent(config.projectId)}`,
      config,
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    if (res.data.keys.length === 0) { console.log('No keys configured.'); return }

    for (const k of res.data.keys) {
      const cooldown = k.cooldown_until && new Date(k.cooldown_until) > new Date()
        ? ` [cooldown until ${new Date(k.cooldown_until).toLocaleTimeString()}]`
        : ''
      console.log(`${k.provider_slug.padEnd(14)} [${k.status}] p=${k.priority} ${k.label ?? '(no label)'}${cooldown} — ${k.id}`)
    }
  })

keys
  .command('add')
  .description('Add a new API key to the pool')
  .requiredOption('--provider <p>', 'Provider: anthropic, openai, firecrawl, browserbase, cursor')
  .option('--key <k>', 'The API key value (prefer the MUSHI_BYOK_KEY env var to keep it out of shell history)')
  .option('--label <l>', 'Human-readable label')
  .option('--priority <n>', 'Priority (lower = higher priority)', '100')
  .action(async (opts: { provider: string; key?: string; label?: string; priority: string }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    // Prefer the env var so the secret isn't captured in shell history or
    // visible in the process list (`ps`). Fall back to the explicit flag.
    const key = process.env.MUSHI_BYOK_KEY ?? opts.key
    if (!key) {
      console.error('Provide the key via the MUSHI_BYOK_KEY env var (recommended) or --key <value>.')
      process.exit(1)
    }

    const res = await apiCall<{ id: string }>(
      '/v1/admin/byok/keys',
      config,
      { method: 'POST', body: JSON.stringify({ project_id: config.projectId, provider_slug: opts.provider, key, label: opts.label, priority: parseInt(opts.priority, 10) }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Key added — id: ${res.data.id}`)
  })

// parseAsync so rejections from async command actions surface as clean
// one-line errors (plain `parse()` leaves them as unhandled rejections).
// ─── integrations ─────────────────────────────────────────────────────────────

const integrations = program.command('integrations').description('Manage service integrations')

integrations
  .command('list')
  .description('List all configured integrations and their current health status')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationListData>(
      `/v1/admin/projects/${config.projectId}/integrations`,
      config,
    )
    // Server returns { integrations: [...] } directly (no ok wrapper)
    const rawResult = result as unknown as Record<string, unknown>
    if (!rawResult.integrations && !result.ok) {
      console.error('Failed:', result.error); process.exit(1)
    }
    if (opts.json) { console.log(JSON.stringify(rawResult, null, 2)); return }
    const rows: IntegrationListData['integrations'] = (rawResult.integrations as IntegrationListData['integrations']) ?? []
    if (rows.length === 0) { console.log('No integrations configured. Visit the Integrations page to connect services.'); return }
    const icons: Record<string, string> = {
      slack: '🔔', github: '🐙', sentry: '🪲', langfuse: '🔭',
      discord: '💬', linear: '📐', jira: '🗂️', cursor_cloud: '🖱️', claude_code_agent: '🤖',
    }
    console.log('\nIntegrations:\n')
    for (const row of rows) {
      const icon = icons[row.kind] ?? '🔌'
      const statusIcon = row.status === 'ok' ? '✅' : row.status === 'error' ? '❌' : '⚪'
      console.log(`  ${icon}  ${row.kind.padEnd(20)} ${statusIcon}  ${row.detail ?? ''}`)
    }
    console.log()
  })

integrations
  .command('test <kind>')
  .description(
    'Run a health probe for a specific integration (e.g. slack, sentry, github, langfuse, discord, cursor_cloud, claude_code_agent)',
  )
  .option('--json', 'Machine-readable output')
  .action(async (kind: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationProbeResult>(
      `/v1/admin/projects/${config.projectId}/integrations/probe/${kind}`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const probeOk = result.data?.status === 'ok'
    console.log(probeOk
      ? `✅  ${kind} integration is healthy${result.data.detail ? ': ' + result.data.detail : ''}`
      : `❌  ${kind} integration check failed${result.data.detail ? ': ' + result.data.detail : ''}`,
    )
    if (!probeOk) process.exit(1)
  })

// ─── slack ────────────────────────────────────────────────────────────────────

const slack = program.command('slack').description('Slack integration commands')

slack
  .command('status')
  .description('Show whether Slack is connected and which channel receives notifications')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationProbeResult>(
      `/v1/admin/projects/${config.projectId}/integrations/probe/slack`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    if (result.data?.status === 'ok') {
      console.log('✅  Slack connected')
      if (result.data.detail) console.log(`    ${result.data.detail}`)
      console.log('\n    To change the channel or notification prefs, visit /integrations in the Mushi console.')
    } else {
      console.log('⚪  Slack not connected')
      console.log('    Visit /integrations in the Mushi console and click "Add to Slack".')
    }
  })

slack
  .command('test')
  .description('Send a test Slack notification to confirm the current channel is working')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/v1/admin/projects/${config.projectId}/integrations/slack/test`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    if (result.data?.ok) {
      console.log('✅  Test message sent! Check your Slack channel.')
    } else {
      console.error('❌  Test failed:', result.data?.error ?? 'unknown error')
      process.exit(1)
    }
  })

// ─── qa ───────────────────────────────────────────────────────────────────────

const qa = program.command('qa').description('QA story management')

qa
  .command('stories')
  .description('List QA stories for the current project')
  .option('--json', 'Machine-readable output')
  .option('-n, --limit <n>', 'Max stories to return (not applied server-side; all stories returned)', '20')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ coverage: QaStoryRow[] }>(
      `/v1/admin/projects/${config.projectId}/qa-coverage`,
      config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const stories = result.data?.coverage ?? []
    if (stories.length === 0) {
      console.log('No QA stories yet. Create one at /qa-coverage in the Mushi console.')
      return
    }
    console.log(`\nQA Stories (${stories.length}):\n`)
    for (const s of stories) {
      const statusIcon = s.last_run_status === 'passed' ? '✅'
        : s.last_run_status === 'failed' ? '❌'
        : s.last_run_status === 'error' ? '🚨'
        : '⚪'
      const enabled = s.enabled ? '' : ' [disabled]'
      const sid = s.story_id ?? s.id ?? '—'
      console.log(`  ${statusIcon}  ${s.name.slice(0, 50).padEnd(52)}  ${sid}${enabled}`)
    }
    console.log(`\n   Use 'mushi qa runs <storyId>' to see recent runs for a story.`)
    console.log()
  })

qa
  .command('runs <storyId>')
  .description('Show recent runs for a QA story, including error heads')
  .option('--json', 'Machine-readable output')
  .option('-n, --limit <n>', 'Max runs to return', '10')
  .action(async (storyId: string, opts: { json?: boolean; limit?: string }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const limit = parseInt(opts.limit ?? '10', 10)
    const result = await apiCall<{ runs: QaRunRow[] }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/runs?limit=${limit}`,
      config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const runs = result.data?.runs ?? []
    if (runs.length === 0) {
      console.log('No runs yet for this story. Trigger one with `mushi qa run <storyId>`.')
      return
    }
    console.log(`\nRecent runs for story ${storyId.slice(0, 8)}…:\n`)
    for (const r of runs) {
      const statusIcon = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : r.status === 'error' ? '🚨' : '⏳'
      const ts = r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') : '—'
      const latency = r.latency_ms ? ` (${(r.latency_ms / 1000).toFixed(1)}s)` : ''
      console.log(`  ${statusIcon}  ${ts}${latency}  ${r.id.slice(0, 8)}`)
      if (r.error_message) {
        console.log(`       Error: ${r.error_message.slice(0, 120)}`)
      }
      if (r.assertion_failures?.length) {
        for (const af of r.assertion_failures.slice(0, 3)) {
          console.log(`       · ${String(af).slice(0, 100)}`)
        }
      }
    }
    const consoleUrl = config.consoleUrl ?? 'https://app.mushi.ai'
    console.log(`\n   Open in console: ${consoleUrl}/qa-coverage?story=${storyId}`)
    console.log(`   Tip: run 'mushi config consoleUrl http://localhost:6464' to set your local console URL`)
    console.log()
  })

qa
  .command('run <storyId>')
  .description('Manually trigger a QA story run (fire-and-forget; check results with `mushi qa runs <id>`)')
  .option('--json', 'Machine-readable output')
  .action(async (storyId: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ run_id: string; queued: boolean }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/run`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const runId = result.data?.run_id
    if (runId) {
      console.log(`▶  Run triggered: ${runId.slice(0, 8)}…`)
      console.log(`   Check results: mushi qa runs ${storyId}`)
    } else {
      console.error('❌  Trigger failed: no run_id in response', JSON.stringify(result.data))
      process.exit(1)
    }
  })

// ─── audit ────────────────────────────────────────────────────────────────────

program
  .command('audit')
  .description('Run a full-stack health audit for the current project')
  .option('--json', 'Machine-readable JSON output')
  .option('--project-id <id>', 'Project ID to audit (defaults to MUSHI_PROJECT_ID from config)')
  .addHelpText('after', `
Description:
  Fans out to the Mushi backend to run a full-stack health audit:
    • DB schema + Supabase advisors (requires Supabase PAT in API Keys)
    • Recent backend error logs
    • Tables without RLS enabled
    • Gate results: API contract (G3), spec drift (G6), orphan endpoints (G7),
      unknown frontend calls (G8), schema drift, status claim (G5)

  Returns a PM-readable scorecard with severity-ranked findings.

  Prerequisites:
    1. Configure your Supabase PAT: mushi settings set supabase-pat <token>
    2. Set supabase_project_ref in Admin → Settings → Project.

Examples:
  mushi audit
  mushi audit --json
  mushi audit --project-id abc123`)
  .action(async (opts: { json?: boolean; projectId?: string }) => {
    const config = requireConfig()
    const projectId = opts.projectId ?? config.projectId
    if (!projectId) {
      process.stderr.write('error: project ID required. Run `mushi login` or pass --project-id\n')
      process.exit(1)
    }

    // Admin JWT auth is required for the audit endpoint. The CLI uses the
    // stored Supabase JWT if available, falling back to the API key.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Mushi-Project-Id': projectId,
    }
    const jwt = (config as unknown as Record<string, unknown>).jwt as string | undefined ?? null
    const apiKey = config.apiKey ?? null
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`
    } else if (apiKey) {
      headers['X-Mushi-Api-Key'] = apiKey
    } else {
      process.stderr.write('error: no credentials found. Run `mushi login` first.\n')
      process.exit(1)
    }

    if (!opts.json) process.stdout.write('Running full-stack audit… ')

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      const res = await fetch(
        `${config.endpoint}/v1/admin/projects/${projectId}/audit`,
        { method: 'POST', headers, body: '{}', signal: controller.signal },
      )
      clearTimeout(timer)
      const body = await res.json() as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } }
      if (!res.ok || !body.ok) {
        if (opts.json) { console.log(JSON.stringify(body)); process.exit(1) }
        process.stdout.write('FAIL\n')
        process.stderr.write(`error: ${body.error?.message ?? `HTTP ${res.status}`}\n`)
        process.exit(1)
      }

      if (opts.json) { console.log(JSON.stringify(body.data, null, 2)); return }

      const data = body.data as {
        summary: { overall: string; error_count: number; warn_count: number }
        findings: Array<{ severity: string; title: string; detail: string }>
        gate_runs: Array<{ gate: string; status: string; findings_count: number }>
        backend_linked: boolean
        audit_at: string
      }

      const overallGlyph = data.summary.overall === 'fail' ? '❌' : data.summary.overall === 'warn' ? '⚠️ ' : '✅'
      process.stdout.write(`${overallGlyph}\n\n`)

      console.log(`Full-Stack Audit — ${new Date(data.audit_at).toLocaleString()}`)
      console.log(`Backend linked: ${data.backend_linked ? 'yes' : 'no (configure Supabase PAT + project ref)'}`)
      console.log(`Summary: ${data.summary.error_count} error(s) · ${data.summary.warn_count} warning(s)\n`)

      if (data.findings.length === 0) {
        console.log('  ✓ No findings. Your project looks healthy.')
      } else {
        for (const f of data.findings) {
          const icon = f.severity === 'error' ? '🔴' : f.severity === 'warn' ? '🟡' : 'ℹ️ '
          console.log(`  ${icon} ${f.title}`)
          console.log(`     ${f.detail.slice(0, 120)}${f.detail.length > 120 ? '…' : ''}`)
        }
      }

      if (data.gate_runs.length > 0) {
        console.log('\nGate Results:')
        for (const run of data.gate_runs) {
          const g = run.status === 'pass' ? '✓' : run.status === 'fail' ? '✗' : '~'
          console.log(`  ${g} ${run.gate.padEnd(22)} ${run.status}  (${run.findings_count} finding${run.findings_count !== 1 ? 's' : ''})`)
        }
      }

      if (data.summary.overall === 'fail') process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }))
      } else {
        process.stdout.write('ERROR\n')
        process.stderr.write(`error: ${msg}\n`)
      }
      process.exit(1)
    }
  })

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhoamiData {
  project_id: string
  project_name: string
  stats: { total_reports: number; open_reports: number }
}

interface StatsData {
  project_id: string
  project_name: string
  by_status: Record<string, number>
  by_severity: Record<string, number>
  fixes_count: number
  fixes_merged: number
  lessons_count: number
}

interface ReportListData {
  reports: ReportRow[]
  total: number
}

interface ReportRow {
  id: string
  severity?: string | null
  status?: string | null
  summary?: string | null
  description?: string | null
  category?: string | null
  created_at?: string | null
}

interface ReportDetail extends ReportRow {
  environment?: Record<string, unknown> | null
  component?: string | null
  sentry_event_id?: string | null
  fix_id?: string | null
  tags?: Record<string, unknown> | null
}

interface IntegrationListData {
  integrations: Array<{
    kind: string
    status: 'ok' | 'error' | 'unknown'
    detail?: string | null
  }>
}

interface IntegrationProbeResult {
  status: 'ok' | 'error' | 'unknown'
  detail?: string | null
}

interface QaStoryRow {
  id?: string
  story_id?: string
  name: string
  enabled: boolean
  last_run_status?: string | null
  browser_provider?: string | null
  runs_24h?: number
  pass_rate_pct?: number | null
}

interface QaRunRow {
  id: string
  status: string
  created_at?: string | null
  latency_ms?: number | null
  error_message?: string | null
  assertion_failures?: unknown[] | null
}

interface LessonRow {
  id: string
  rule_text: string
  anti_pattern?: string | null
  summary_paragraph?: string | null
  severity: 'info' | 'warn' | 'critical'
  frequency: number
  last_reinforced_at?: string | null
  cluster_id?: string | null
}

type LessonListData = LessonRow[]

interface LessonsJson {
  schema_version: '1'
  project_id: string
  generated_at: string
  lessons: Array<{
    id: string; rule: string; anti_pattern?: string
    severity: 'info' | 'warn' | 'critical'
    frequency: number; last_reinforced: string; cluster_id?: string
  }>
}
