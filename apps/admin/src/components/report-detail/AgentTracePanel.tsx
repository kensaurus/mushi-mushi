/**
 * Agent dispatch trace — model calls + spend from llm_invocations.
 *
 * R2 sweep 2026-11-18: six rows from three runs sat ungrouped in a table
 * whose Cost column was all "—", and at 390px the table scrolled sideways,
 * hid Tokens and Status and broke "claude-/haiku-4-5" one word per line.
 * Calls now group by run (a pause of over a minute starts a new one), each
 * call is one wrapping line, and a cost shows only when a call recorded one.
 */
import { Card, Badge } from '../ui'
import type { ReportDetail } from './types'
import { StatusMark } from '../signal/StatusMark'

interface LlmInvocationRow {
  id: string
  function_name: string
  stage: string | null
  used_model: string | null
  status: string
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  created_at: string
}

interface Props {
  report: ReportDetail & { llm_invocations?: LlmInvocationRow[] | Array<Record<string, unknown>> }
}

/**
 * @internal Exported for tests.
 * The total of the costs that were recorded, or null when none was: "$0.0000
 * total" over a column of "—" claimed a free run nobody measured (fresh-eyes
 * sweep 2026-11-18). Unknown is not zero.
 */
export function agentTraceTotalCost(rows: ReadonlyArray<Pick<LlmInvocationRow, 'cost_usd'>>): number | null {
  const known = rows.filter((r) => r.cost_usd != null && Number.isFinite(Number(r.cost_usd)))
  if (known.length === 0) return null
  return known.reduce((sum, r) => sum + Number(r.cost_usd), 0)
}

/** A pause longer than this between two calls starts a new run. */
const TRACE_RUN_GAP_MS = 60_000

/**
 * @internal Exported for tests.
 * Calls in time order, split into runs: one pipeline pass (stage 1 + its
 * embedding) lands within seconds; the next pass is minutes later.
 */
export function groupTraceRuns<T extends Pick<LlmInvocationRow, 'created_at'>>(rows: ReadonlyArray<T>): T[][] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const runs: T[][] = []
  let last = Number.NEGATIVE_INFINITY
  for (const r of sorted) {
    const t = Date.parse(r.created_at)
    if (runs.length === 0 || !(t - last <= TRACE_RUN_GAP_MS)) runs.push([])
    runs[runs.length - 1].push(r)
    last = t
  }
  return runs
}

function tokens(r: LlmInvocationRow): number | null {
  const n = (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
  return n > 0 ? n : null
}

export function AgentTracePanel({ report }: Props) {
  const raw = report.llm_invocations ?? []
  const rows = raw.filter((r): r is LlmInvocationRow => typeof (r as LlmInvocationRow).id === 'string')
  if (rows.length === 0) return null

  const totalCost = agentTraceTotalCost(rows)
  const runs = groupTraceRuns(rows)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Agent trace</h3>
        <Badge className="bg-surface-overlay text-fg-muted text-3xs">
          <span data-testid="agent-trace-total">{totalCost == null ? 'Cost not captured' : `$${totalCost.toFixed(4)} total`}</span>
        </Badge>
      </div>
      <ol className="space-y-2.5" aria-label="Agent trace" data-testid="agent-trace-runs">
        {runs.map((run, i) => {
          const failed = run.filter((r) => r.status !== 'success').length
          const runTokens = run.reduce((n, r) => n + (tokens(r) ?? 0), 0)
          return (
            <li key={run[0].id} className="min-w-0" data-testid="agent-trace-run">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
                <StatusMark status={failed > 0 ? 'failed' : 'passed'} size={10} />
                <span className="font-semibold text-fg">Run {i + 1}</span>
                <span className="text-fg-muted">{new Date(run[0].created_at).toLocaleString()}</span>
                <span className="text-fg-muted">
                  · {run.length} call{run.length === 1 ? '' : 's'}
                  {runTokens > 0 ? ` · ${runTokens.toLocaleString('en-US')} tokens` : ''}
                  {failed > 0 ? ` · ${failed} failed` : ''}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 border-l border-edge-subtle pl-3">
                {run.map((r) => {
                  const n = tokens(r)
                  return (
                    <li key={r.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-2xs" data-testid="agent-trace-call">
                      <span className="min-w-0 break-words text-fg-secondary">{r.function_name}{r.stage ? `:${r.stage}` : ''}</span>
                      <span className="min-w-0 break-all text-fg-muted">{r.used_model ?? 'model not recorded'}</span>
                      <span className="whitespace-nowrap tabular-nums text-fg-muted">{n != null ? `${n.toLocaleString('en-US')} tokens` : 'tokens not recorded'}</span>
                      {r.cost_usd != null ? (
                        <span className="whitespace-nowrap tabular-nums text-fg-muted">${Number(r.cost_usd).toFixed(4)}</span>
                      ) : null}
                      {r.status !== 'success' ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-st-failed-ink">
                          <StatusMark status="failed" size={10} />
                          {r.status}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
      {(report.fix_attempts?.length ?? 0) > 0 && (
        <p className="text-2xs text-fg-muted">
          {report.fix_attempts!.length} fix attempt(s) · latest agent {report.fix_attempts![0]?.agent ?? 'not recorded'}
        </p>
      )}
    </Card>
  )
}
