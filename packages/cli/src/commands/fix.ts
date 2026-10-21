import type { Command } from 'commander';
import { loadConfig, type CliConfig } from '../config.js';
import { apiCall, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js';
import { MushiCliError } from '../errors.js';

/** `owner/name` of a GitHub repo URL, lower-cased; null when it is not one. */
function githubOwnerName(url: string): string | null {
  const cleaned = url
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

/**
 * `--repo` takes a linked repo's id or its GitHub `owner/name`. A name is
 * looked up among the project's linked repos (GET /v1/admin/repo/repos), so
 * it needs a project id; the server still checks the id belongs to it.
 */
async function resolveTargetRepoId(repo: string, cfg: CliConfig): Promise<string> {
  if (!repo.includes('/')) return requireUuid(repo, '--repo');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new MushiCliError('E_INVALID_INPUT', '--repo must be a repo id or owner/name', 'e.g. --repo acme/app-backend');
  }
  if (!cfg.projectId) {
    throw new MushiCliError(
      'E_INVALID_INPUT',
      '--repo owner/name needs a project to look the repo up in',
      'pass --project-id or set MUSHI_PROJECT_ID, or pass the repo id instead',
    );
  }
  const res = await apiCall<Array<{ id: string; repo_url: string }>>(
    `/v1/admin/repo/repos?project_id=${encodeURIComponent(cfg.projectId)}`,
    cfg,
  );
  if (!res.ok) {
    console.error('Error listing linked repos:', res.error.message);
    process.exit(1);
  }
  const linked = res.data ?? [];
  const matches = linked.filter((r) => githubOwnerName(r.repo_url) === repo.toLowerCase());
  if (matches.length === 1) return matches[0]!.id;
  const names = linked.map((r) => githubOwnerName(r.repo_url) ?? r.repo_url).join(', ') || 'none';
  throw new MushiCliError(
    'E_INVALID_INPUT',
    matches.length === 0
      ? `${repo} is not linked to this project`
      : `${repo} matches ${matches.length} linked repos; pass the repo id`,
    `linked repos: ${names}`,
  );
}

/** GET /v1/admin/fixes/:id/verification (Plan 024, ADR 0035). */
interface CliVerification {
  headSha: string | null
  gates: Array<{ id: string; status: string; label: string; detail: string }>
  passed: boolean
  autoMerge?: { state: string; detail: string | null } | null
  regressions?: Array<Record<string, unknown>>
}

const GATE_MARK: Record<string, [string, string]> = {
  pass: ['✓', 'pass'],
  fail: ['✗', 'fail'],
  pending: ['…', 'pending'],
  unavailable: ['–', 'unavailable'],
  not_set_up: ['○', 'not set up'],
}

const AUTO_MERGE_WORDS: Record<string, string> = {
  none: 'not merged by Mushi',
  eligible: 'eligible, waiting for the next run',
  merged: 'merged by Mushi',
  skipped: 'skipped',
  failed: 'failed',
}

const SIGNAL_WORDS: Record<string, string> = {
  ci_failed_on_merge: 'CI failed on the merge commit',
  report_reopened: 'the report was reopened',
  new_report_in_changed_file: 'a new report names a file this fix changed',
}

/** The gate checklist as lines: glyph, word, label, then what to do. */
function renderVerification(v: CliVerification): string[] {
  const lines = [`Head ${v.headSha ? v.headSha.slice(0, 7) : 'unknown'}: ${v.passed ? 'every gate passes' : 'not verified yet'}`]
  for (const g of v.gates ?? []) {
    const [glyph, word] = GATE_MARK[g.status] ?? ['?', g.status]
    lines.push(`  ${glyph} ${word.padEnd(11)} ${g.label}`)
    if (g.detail && g.status !== 'pass') lines.push(`                ${g.detail}`)
  }
  const am = v.autoMerge
  if (am) lines.push(`Automatic merge: ${AUTO_MERGE_WORDS[am.state] ?? am.state}${am.detail ? `. ${am.detail}` : ''}`)
  for (const r of v.regressions ?? []) {
    const signal = String(r['signal'] ?? '')
    const revertUrl = (r['revertPrUrl'] ?? r['revert_pr_url']) as string | null | undefined
    const revertState = String(r['revertState'] ?? r['revert_state'] ?? 'none')
    const detail = typeof r['detail'] === 'string' && r['detail'] ? `: ${r['detail']}` : ''
    lines.push(`Regression: ${SIGNAL_WORDS[signal] ?? signal}${detail}`)
    if (revertUrl) lines.push(`  Revert PR: ${revertUrl}`)
    else if (revertState === 'not_safe') lines.push('  No revert PR: later commits changed the same files. Revert by hand.')
  }
  return lines
}

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
  .option(
    '--repo <repoId|owner/name>',
    "Linked repo to open the fix PR against (a project with several repos). Default: the project's primary repo",
  )
  .option('-e, --endpoint <url>', 'API endpoint (overrides MUSHI_API_ENDPOINT)')
  .option('--api-key <key>', 'API key (overrides MUSHI_API_KEY)')
  .option('--project-id <id>', 'Project ID (overrides MUSHI_PROJECT_ID)')
  .addHelpText('after', `
Examples:
  mushi fix abc123 --agent cursor_cloud --wait
  mushi fix abc123 --agent cursor_cloud --model composer-latest --no-auto-pr
  mushi fix abc123 --agent claude_code

  # A project with a frontend and a backend repo: send the fix to the backend
  mushi fix abc123 --repo acme/app-backend

  # CI: fail the pipeline if the fix errors
  mushi fix $REPORT_ID --agent cursor_cloud --wait && echo "Fix PR opened"`)
  .action(async (reportId: string, opts: {
    agent: string
    model?: string
    autoPr: boolean
    wait?: boolean
    repo?: string
    endpoint?: string
    apiKey?: string
    projectId?: string
  }) => {
    requireUuid(reportId, 'reportId')
    const cfg = loadConfig()
    if (opts.endpoint) cfg.endpoint = opts.endpoint
    if (opts.apiKey) cfg.apiKey = opts.apiKey
    if (opts.projectId) cfg.projectId = opts.projectId
    const targetRepoId = opts.repo ? await resolveTargetRepoId(opts.repo, cfg) : undefined

    const isTTY = process.stdout.isTTY

    const emitEvent = (type: string, data: Record<string, unknown>) => {
      if (isTTY) {
        const ts = new Date().toISOString()
        console.log(`[${ts}] ${type}`, JSON.stringify(data))
      } else {
        process.stdout.write(JSON.stringify({ type, ...data }) + '\n')
      }
    }

    emitEvent('dispatch.start', {
      reportId,
      agent: opts.agent,
      model: opts.model ?? null,
      targetRepoId: targetRepoId ?? null,
    })

    const body: Record<string, unknown> = {
      reportId,
      projectId: cfg.projectId,
      agent: opts.agent,
      ...(targetRepoId ? { targetRepoId } : {}),
    }
    if (opts.agent === 'cursor_cloud') {
      if (opts.model) body.cursorModel = opts.model
      if (!opts.autoPr) body.cursorAutoCreatePR = false
    }

    const result = await apiCall<{
      dispatchId?: string; fixId?: string; status?: string; agentId?: string; runId?: string; prUrl?: string
    }>('/v1/admin/fixes/dispatch', cfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!result.ok) {
      console.error('Error dispatching fix:', result.error.message)
      process.exit(1)
    }

    const { dispatchId, fixId, status, agentId, runId, prUrl } = result.data
    emitEvent('dispatch.ok', { dispatchId, fixId, status, agentId, runId, prUrl })

    if (!opts.wait) {
      process.exit(0)
    }

    // The route answers with the dispatch job id; poll that job.
    if (!dispatchId) {
      console.error('No dispatchId returned — cannot poll.')
      process.exit(1)
    }

    // Poll until terminal state.
    const POLL_MS = 5_000
    const MAX_POLLS = 120 // 10 min max
    const TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'skipped', 'skipped_unsupported_agent', 'skipped_no_sandbox'])

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const pollResult = await apiCall<{ status?: string; pr_url?: string; error?: string; cursor_agent_id?: string }>(
        `/v1/admin/fixes/dispatch/${dispatchId}`,
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
  .option(
    '--override',
    'Not available here: the CLI signs in with an API key, and only a person in the Mushi console can override an Opus "hold" (with a reason)',
  )
  .option('--json', 'Machine-readable JSON output')
  .action(async (fixId: string, opts: { method: string; override?: boolean; json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    if (opts.override) {
      console.error(
        'Overriding an Opus "hold" needs a person in the Mushi console: open the fix, read the findings, and choose Merge anyway with a reason. The CLI signs in with an API key, which cannot override (ADR 0030).',
      )
      process.exit(1)
    }

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
      review?: { state: string; label: string; overridden: boolean }
    }>(`/v1/admin/fixes/${fixId}/merge`, config, {
      method: 'POST',
      body: JSON.stringify({ mergeMethod: method }),
    })

    if (!result.ok) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      } else {
        console.error('Merge failed:', result.error.message)
        if (result.error.code === 'REVIEW_HOLD') {
          console.error(`Read the review: mushi fixes review ${fixId} --show. To merge anyway, override the hold in the Mushi console (with a reason).`)
        }
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
    if (data.review) {
      console.log(`${data.review.label}${data.review.overridden ? ' (overridden)' : ''}`)
    }
  })

interface CliFixReview {
  state: string
  label: string
  summary: string | null
  reason: string | null
  findings: Array<{ severity: string; file: string; line: number | null; issue: string; suggested_fix: string }>
  removesBehavior: string[]
  needsHumanDecision: string | null
  commentUrl: string | null
}

function printReview(review: CliFixReview): void {
  console.log(review.label)
  if (review.reason) console.log(review.reason)
  if (review.summary) console.log(`\n${review.summary}`)
  for (const f of review.findings) {
    const where = f.file === '(general)' ? '' : ` ${f.file}${f.line ? `:${f.line}` : ''}`
    console.log(`  - ${f.severity}${where}: ${f.issue} Fix: ${f.suggested_fix}`)
  }
  for (const r of review.removesBehavior) console.log(`  - removes: ${r}`)
  if (review.needsHumanDecision) console.log(`Needs your decision: ${review.needsHumanDecision}`)
  if (review.commentUrl) console.log(`On GitHub: ${review.commentUrl}`)
}

fixes
  .command('review <fixId>')
  .description('Re-run the Opus review of a fix PR (ADR 0030), or show the current one with --show')
  .option('--show', 'Show the current review instead of starting a new one')
  .option('--json', 'Machine-readable JSON output')
  .action(async (fixId: string, opts: { show?: boolean; json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    const result = opts.show
      ? await apiCall<{ review?: CliFixReview }>(`/v1/admin/fixes/${fixId}/timeline`, config)
      : await apiCall<{ review?: CliFixReview }>(`/v1/admin/fixes/${fixId}/review`, config, { method: 'POST' })
    if (!result.ok) {
      if (opts.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      else console.error(opts.show ? 'Could not read the review:' : 'Review not started:', result.error.message)
      process.exit(1)
    }
    const review = result.data?.review
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, review: review ?? null }, null, 2))
      return
    }
    if (!opts.show) console.log('Review queued. It takes a few minutes; check with --show.')
    if (review) printReview(review)
  })

fixes
  .command('verify <fixId>')
  .description("Show the verified-merge gates for a fix PR's current head (ADR 0035), or re-check them with --rerun")
  .option('--rerun', 'Re-check the gates now, then show them')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Gates: Opus review, CI, a test that fails without the fix, no tests weakened,
a small change, and a second review. Mushi merges on its own only when every
gate passes and Verified merge is on for the project.
Docs: https://kensaur.us/mushi-mushi/docs/admin/verified-merge`)
  .action(async (fixId: string, opts: { rerun?: boolean; json?: boolean }) => {
    requireUuid(fixId, 'fixId')
    const config = requireConfig()
    const json = outputIsJson(opts.json)
    if (opts.rerun) {
      const started = await apiCall(`/v1/admin/fixes/${fixId}/verify`, config, { method: 'POST' })
      if (!started.ok) {
        if (json) console.log(JSON.stringify({ ok: false, error: started.error }, null, 2))
        else console.error('Re-check not started:', started.error.message)
        process.exit(1)
      }
    }
    const result = await apiCall<CliVerification>(`/v1/admin/fixes/${fixId}/verification`, config)
    if (!result.ok) {
      if (json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      else console.error('Could not read the verification:', result.error.message)
      process.exit(1)
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, verification: result.data ?? null }, null, 2))
      return
    }
    if (!result.data) {
      console.log('No verification for this fix yet. Mushi checks open agent PRs every 10 minutes after their review.')
      return
    }
    for (const line of renderVerification(result.data)) console.log(line)
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

fixes
  .command('rerun-ci <fixId>')
  .description('Re-run the failed or cancelled CI runs on a fix PR\'s latest commit (for example after the test machine stopped)')
  .option('--json', 'Machine-readable JSON output')
  .action(async (fixId: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured. Run `mushi init`'); process.exit(1) }

    const result = await apiCall<{ rerun?: Array<{ runId: number }>; headSha?: string }>(
      `/v1/admin/fixes/${fixId}/ci/rerun`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) {
      if (opts.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
      else console.error('Re-run failed:', result.error.message)
      process.exit(1)
    }
    const runs = result.data?.rerun ?? []
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ...result.data }, null, 2))
      return
    }
    console.log(`Re-ran ${runs.length} run${runs.length === 1 ? '' : 's'}: ${runs.map((r) => `#${r.runId}`).join(', ')}`)
  })

}
