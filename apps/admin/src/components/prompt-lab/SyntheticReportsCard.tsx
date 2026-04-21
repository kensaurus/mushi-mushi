import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Btn, Badge, RelativeTime, EmptyState, ErrorAlert } from '../ui'
import { TableSkeleton } from '../skeletons/TableSkeleton'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import { formatPct } from '../charts'
import { PromptDialog } from '../ConfirmDialog'
import type { SyntheticReportRow } from './types'

interface SyntheticPayload {
  reports: SyntheticReportRow[]
}

export function SyntheticReportsCard() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<SyntheticPayload>('/v1/admin/synthetic')
  const [generating, setGenerating] = useState(false)
  const [askingCount, setAskingCount] = useState(false)

  async function commitGenerate(raw: string) {
    const count = Math.max(1, Math.min(50, Math.round(Number(raw))))
    setGenerating(true)
    const res = await apiFetch<{ generated?: number }>('/v1/admin/synthetic', {
      method: 'POST',
      body: JSON.stringify({ count }),
    })
    setGenerating(false)
    setAskingCount(false)
    if (res.ok) {
      toast.push({
        tone: 'success',
        message: `Generated ${res.data?.generated ?? count} synthetic reports. They'll flow through Stage 1 → Stage 2 like real ones.`,
      })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Generation failed' })
    }
  }

  const reports = data?.reports ?? []
  const passed = reports.filter((r) => r.match_score != null && r.match_score >= 0.8).length
  const scored = reports.filter((r) => r.match_score != null).length

  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-fg-secondary">Synthetic reports</h3>
          <p className="text-2xs text-fg-faint">
            LLM-generated bug reports with expected classifications. Use them to validate prompt changes without waiting for real users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scored > 0 && (
            <span className="text-2xs font-mono text-fg-muted">
              {passed}/{scored} matched
            </span>
          )}
          <Btn size="sm" onClick={() => setAskingCount(true)} disabled={generating} loading={generating}>
            Generate
          </Btn>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading synthetic reports" />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No synthetic reports yet"
          description="Hit Generate to create LLM-authored test reports. Compare expected vs actual classification to spot prompt regressions."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-fg-faint">
              <tr>
                <th className="text-left font-normal px-2 py-1">Description</th>
                <th className="text-left font-normal px-2 py-1">Expected</th>
                <th className="text-left font-normal px-2 py-1">Actual</th>
                <th className="text-right font-normal px-2 py-1">Match</th>
                <th className="text-left font-normal px-2 py-1">Generated</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const exp = r.expected_classification
                const act = r.actual_classification
                const match = r.match_score
                const matchTone = match == null
                  ? 'bg-fg-faint/15 text-fg-muted border border-edge-subtle'
                  : match >= 0.8
                    ? 'bg-ok/15 text-ok border border-ok/30'
                    : match >= 0.5
                      ? 'bg-warn/15 text-warn border border-warn/30'
                      : 'bg-danger/15 text-danger border border-danger/30'
                return (
                  <tr key={r.id} className="border-t border-edge-subtle align-top">
                    <td className="px-2 py-1.5 text-fg-secondary max-w-[24rem]">
                      <div className="line-clamp-2">
                        {r.generated_report?.description ?? '(no description)'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-fg-muted">
                      {exp?.category ?? '—'} / {exp?.severity ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-fg-muted">
                      {act ? `${act.category ?? '—'} / ${act.severity ?? '—'}` : 'pending'}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Badge className={matchTone}>
                        {match == null ? 'pending' : formatPct(match)}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-fg-muted">
                      <RelativeTime value={r.generated_at} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {askingCount && (
        <PromptDialog
          title="Generate synthetic reports"
          body="LLM-authored bug reports flow through Stage 1 → Stage 2 just like real ones. Use them to validate prompt changes before shipping. Cap is 50 per batch."
          label="How many reports? (1–50)"
          inputType="number"
          defaultValue="10"
          confirmLabel="Generate"
          loading={generating}
          validate={(v) => {
            const n = Number(v)
            if (!Number.isFinite(n) || n < 1 || n > 50) return 'Enter a whole number between 1 and 50.'
            return null
          }}
          onConfirm={commitGenerate}
          onCancel={() => setAskingCount(false)}
        />
      )}
    </Card>
  )
}
