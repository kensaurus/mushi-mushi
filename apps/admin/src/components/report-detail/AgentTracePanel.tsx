/**
 * Agent dispatch trace — model calls + spend from llm_invocations.
 */
import { Card, Badge } from '../ui'
import type { ReportDetail } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

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

export function AgentTracePanel({ report }: Props) {
  const raw = report.llm_invocations ?? []
  const rows = raw.filter((r): r is LlmInvocationRow => typeof (r as LlmInvocationRow).id === 'string')
  if (rows.length === 0) return null

  const totalCost = rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Agent trace</h3>
        <Badge className="bg-surface-overlay text-fg-muted text-3xs">${totalCost.toFixed(4)} total</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-2xs">
          <thead>
            <tr className="text-left text-fg-muted border-b border-edge-subtle">
              <th className="py-1 pr-2">When</th>
              <th className="py-1 pr-2">Function</th>
              <th className="py-1 pr-2">Model</th>
              <th className="py-1 pr-2">Tokens</th>
              <th className="py-1 pr-2">Cost</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-edge-subtle/50">
                <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-1.5 pr-2 font-mono">{r.function_name}{r.stage ? `:${r.stage}` : ''}</td>
                <td className="py-1.5 pr-2">{r.used_model ?? '—'}</td>
                <td className="py-1.5 pr-2">
                  {(r.input_tokens ?? 0) + (r.output_tokens ?? 0) || '—'}
                </td>
                <td className="py-1.5 pr-2">{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
                <td className="py-1.5">
                  <Badge className={r.status === 'success' ? CHIP_TONE.okSubtle + ' text-3xs' : CHIP_TONE.dangerSubtle + ' text-3xs'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(report.fix_attempts?.length ?? 0) > 0 && (
        <p className="text-2xs text-fg-muted">
          {report.fix_attempts!.length} fix attempt(s) · latest agent {report.fix_attempts![0]?.agent ?? '—'}
        </p>
      )}
    </Card>
  )
}
