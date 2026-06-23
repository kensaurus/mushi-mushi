import type { Command } from 'commander';
import { loadConfig } from '../config.js';
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
