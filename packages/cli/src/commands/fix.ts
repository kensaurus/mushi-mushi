import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { renderNudgeSnippet, renderNudgeExplainer } from '../nudge.js';
import type { NudgePhase } from '../nudge.js';
import { runDoctor, formatDoctorResult } from '../doctor.js';
import { runUpgrade } from '../upgrade.js';
import { runConnect } from '../connect.js';
import { apiCall } from '../cli-shared.js';

export function registerFixCommands(program: Command): void {
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
    'Run pre-flight checks: CLI config, endpoint reachability, SDK install, ' +
      'ingest readiness (API key → heartbeat → first report), and dispatch ' +
      'readiness (GitHub, index, BYOK, autofix). Ingest + server checks run ' +
      'by default; pass --no-server or --no-ingest to skip.',
  )
  .option('--cwd <path>', 'Run package detection from a different directory')
  .option('--json', 'Machine-readable output')
  .option('--no-server', 'Skip dispatch-readiness /preflight checks')
  .option('--no-ingest', 'Skip ingest-setup checks (SDK heartbeat, first report)')
  .option(
    '--qa-stories',
    'Check enabled QA stories for common setup issues: missing Firecrawl key, ' +
      'missing target URL, Slack not connected. Requires --server credentials.',
  )
  .option(
    '--host-app',
    'Verify host-app wiring: Mushi env vars, Cursor MCP config, Capacitor hybrid SDK notes.',
  )
  .option(
    '--fix',
    'Apply safe local fixes when checks fail: write missing .env.local lines and wire Cursor MCP config.',
  )
  .action(async (opts: { cwd?: string; json?: boolean; server?: boolean; ingest?: boolean; qaStories?: boolean; hostApp?: boolean; fix?: boolean }) => {
    const config = loadConfig()
    const doctorOpts = { cwd: opts.cwd, server: opts.server, ingest: opts.ingest, qaStories: opts.qaStories, hostApp: opts.hostApp }
    let result = await runDoctor(config, doctorOpts)

    if (!result.ready && opts.fix && config.apiKey && config.projectId && config.endpoint) {
      const connectResult = await runConnect({
        apiKey: config.apiKey,
        projectId: config.projectId,
        endpoint: config.endpoint,
        cwd: opts.cwd ?? process.cwd(),
        writeEnv: true,
        wireIde: true,
      }, config)
      for (const msg of connectResult.messages) console.log(msg)
      // Re-run the checks so the printed result + exit code reflect the
      // post-fix state. Without this the command reports the stale pre-fix
      // failures and exits 1 even when every fix succeeded.
      result = await runDoctor(config, doctorOpts)
    }

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

fixes
  .command('merge <fixId>')
  .description(
    'Squash-merge the fix PR on GitHub and mark the report Fixed (same as console merge)',
  )
  .option(
    '--method <method>',
    'GitHub merge method: squash (default), merge, or rebase',
    'squash',
  )
  .option('--json', 'Machine-readable JSON output')
  .action(async (fixId: string, opts: { method: string; json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    const method = opts.method as 'squash' | 'merge' | 'rebase'
    if (!['squash', 'merge', 'rebase'].includes(method)) {
      console.error('--method must be squash, merge, or rebase')
      process.exit(1)
    }

    const result = await apiCall<{
      merged?: boolean
      alreadyMerged?: boolean
      reportId?: string
      reportStatus?: string | null
    }>(`/v1/admin/fixes/${fixId}/merge`, config, {
      method: 'POST',
      body: JSON.stringify({ mergeMethod: method }),
    })

    if (!result.ok) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      } else {
        console.error('Merge failed:', result.error.message)
      }
      process.exit(1)
    }

    const data = result.data ?? {}
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ...data }, null, 2))
      return
    }

    if (data.alreadyMerged) {
      console.log(`PR was already merged. Report status: ${data.reportStatus ?? 'unknown'}`)
    } else {
      console.log(`Merged successfully. Report status: ${data.reportStatus ?? 'fixed'}`)
    }
  })

fixes
  .command('refresh-ci <fixId>')
  .description('Pull latest GitHub Actions check-run status for a fix attempt (on-demand ci-sync)')
  .option('--json', 'Machine-readable JSON output')
  .action(async (fixId: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    const result = await apiCall<{
      check_run_status?: string | null
      check_run_conclusion?: string | null
      check_run_updated_at?: string | null
    }>(`/v1/admin/fixes/${fixId}/refresh-ci`, config, { method: 'POST' })

    if (!result.ok) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      } else {
        console.error('CI refresh failed:', result.error.message)
      }
      process.exit(1)
    }

    const data = result.data ?? {}
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ...data }, null, 2))
      return
    }

    const status = data.check_run_status ?? 'unknown'
    const conclusion = data.check_run_conclusion ?? '—'
    const updated = data.check_run_updated_at
      ? new Date(data.check_run_updated_at).toISOString()
      : '—'
    console.log(`CI status: ${status} · conclusion: ${conclusion} · updated: ${updated}`)
  })

}
