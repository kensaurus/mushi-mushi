import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Btn, Badge, RelativeTime, EmptyState } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { describeApiError } from '../../lib/humanizeApiError'
import { TableSkeleton } from '../skeletons/TableSkeleton'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import { formatPct } from '../charts'
import { PromptDialog } from '../ConfirmDialog'
import { ConfigHelp } from '../ConfigHelp'
import type { SyntheticReportRow } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

interface SyntheticPayload {
  reports: SyntheticReportRow[]
}

export function SyntheticReportsCard() {
  const toast = useToast()
  const { data, loading, error, errorCode, reload } = usePageData<SyntheticPayload>('/v1/admin/synthetic')
  const [generating, setGenerating] = useState(false)
  const [askingCount, setAskingCount] = useState(false)

  async function commitGenerate(raw: string) {
    const count = Math.max(1, Math.min(50, Math.round(Number(raw))))
    setGenerating(true)
    const res = await apiFetch<{ generated: number; evaluated: number; requested: number }>('/v1/admin/synthetic', {
      method: 'POST',
      body: JSON.stringify({ count }),
    })
    setGenerating(false)
    setAskingCount(false)
    if (!res.ok || !res.data) {
      const e = describeApiError(res.error, 'No synthetic reports were generated')
      toast.error(e.title, e.hint)
      return
    }
    // Report what the generator actually produced, never the requested count.
    const { generated } = res.data
    const noun = `synthetic report${generated === 1 ? '' : 's'}`
    if (generated < count) {
      toast.push({
        tone: 'warn',
        message: `Generated ${generated} of ${count} ${noun}. Some LLM calls failed; try again for the rest.`,
      })
    } else {
      toast.push({
        tone: 'success',
        message: `Generated ${generated} ${noun}. They'll flow through Stage 1 → Stage 2 like real ones.`,
      })
    }
    reload()
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
          <ConfigHelp helpId="prompt-lab.synthetic_count" />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading synthetic reports" />
      ) : error ? (
        <PageLoadError error={error} code={errorCode} resource="synthetic reports" onRetry={reload} />
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
                    ? 'bg-ok-muted/50 text-ok-foreground border border-ok/25'
                    : match >= 0.5
                      ? CHIP_TONE.warnSubtle
                      : CHIP_TONE.dangerSubtle
                return (
                  <tr key={r.id} className="border-t border-edge-subtle align-top">
                    <td className="px-2 py-1.5 text-fg-secondary max-w-96">
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
