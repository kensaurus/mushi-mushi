/** `mushi ux-runs list|show|file`: runs synced by `mushi ux run --sync` (Plan 021). */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { MushiCliError } from '../errors.js'

interface RunRow {
  local_run_id: string
  status: string
  agent: string
  model: string | null
  branch: string | null
  counts: Record<string, number>
  started_at: string
}

interface SurfaceRow {
  surface_key: string
  path: string
  label: string
  status: string
  note: string | null
  penalty_before: number | null
  penalty_after: number | null
  report_id: string | null
}

const STATUS_LABEL: Record<string, string> = {
  accepted: 'improved',
  reverted: 'rolled back',
  regressed: 'moved by another fix',
  blocked: 'could not load',
  skipped: 'no change needed',
  iterating: 'agent working',
  baseline: 'measuring',
  pending: 'queued',
}

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

function projectId(): { config: ReturnType<typeof requireConfig>; pid: string } {
  const config = requireConfig({ needsProject: true })
  return { config, pid: encodeURIComponent(config.projectId as string) }
}

function requireRunId(runId: string): string {
  if (!RUN_ID_RE.test(runId)) throw new MushiCliError('E_INVALID_INPUT', `"${runId}" is not a run id (like 20261006-011207-qafu).`)
  return runId
}

export function registerUxRunsCommands(program: Command): void {
  const runs = program
    .command('ux-runs')
    .description('UX runs synced from `mushi ux run --sync`: which screens were improved, rolled back or moved')

  runs
    .command('list')
    .description('Recent UX runs for this project')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const { config, pid } = projectId()
      const result = await apiCall<{ runs: RunRow[] }>(`/v1/admin/projects/${pid}/ux-runs`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data.runs, null, 2))
        return
      }
      if (result.data.runs.length === 0) {
        console.log('No UX runs yet. Start one with: mushi ux run --dev "pnpm dev --port {port}" --sync')
        return
      }
      for (const r of result.data.runs) {
        const c = r.counts
        console.log(
          `${r.local_run_id}  ${r.status.padEnd(7)}  ${r.agent}${r.model ? ` · ${r.model}` : ''}  ` +
            `improved ${c.accepted ?? 0} · rolled back ${c.reverted ?? 0} · moved ${c.regressed ?? 0} · blocked ${c.blocked ?? 0}`,
        )
      }
    })

  runs
    .command('show <runId>')
    .description('Every screen of one run, what still needs a look first')
    .option('--json', 'Machine-readable JSON output')
    .action(async (runId: string, opts: { json?: boolean }) => {
      const { config, pid } = projectId()
      const result = await apiCall<{ run: RunRow; surfaces: SurfaceRow[] }>(
        `/v1/admin/projects/${pid}/ux-runs/${requireRunId(runId)}`,
        config,
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      const { run, surfaces } = result.data
      if (run.branch) console.log(`Kept changes: ${run.branch}\n`)
      const order = ['regressed', 'reverted', 'blocked', 'iterating', 'baseline', 'accepted', 'skipped', 'pending']
      for (const s of [...surfaces].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))) {
        const score = s.penalty_before !== null ? `  score ${s.penalty_before}${s.penalty_after !== null ? `→${s.penalty_after}` : ''}` : ''
        console.log(`${(STATUS_LABEL[s.status] ?? s.status).padEnd(22)} ${s.label}  ${s.path}${score}${s.report_id ? '  (filed)' : ''}`)
        if (s.note) console.log(`${' '.repeat(23)}${s.note}`)
      }
    })

  runs
    .command('file <runId> <screen>')
    .description('File one screen of a run as a bug (source ux_loop; no AI call)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (runId: string, screen: string, opts: { json?: boolean }) => {
      if (!KEY_RE.test(screen)) throw new MushiCliError('E_INVALID_INPUT', `"${screen}" is not a screen key (see \`mushi ux-runs show ${runId}\` --json).`)
      const { config, pid } = projectId()
      const result = await apiCall<{ report_id: string; reused: boolean }>(
        `/v1/admin/projects/${pid}/ux-runs/${requireRunId(runId)}/surfaces/${screen}/report`,
        config,
        { method: 'POST', body: '{}' },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(result.data.reused ? `Already filed: report ${result.data.report_id}` : `Filed report ${result.data.report_id}`)
    })
}
