/**
 * FILE: apps/admin/src/components/judge/JudgeReviewRows.tsx
 * PURPOSE: Disagreements as a review queue (console UX overhaul, 2026-11-19): one compact row per
 *          report, its grade as a bar, the grader's reason in one line, and the decision in the
 *          same row: "Accept grader's view" / "Keep diagnosis" (lib/judgeReview.ts), or
 *          "Open report" when the server can't offer them. A reviewed row turns into a ✓ pill.
 *          Used by Overview ("Worst disagreements") and Evaluations → Disagreements only.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { BarCell } from '../signal/BarCell'
import { StatusPill } from '../signal/StatusMark'
import { apiFetch } from '../../lib/supabase'
import { apiErrorText } from '../../lib/apiErrorText'
import { useToast } from '../../lib/toast'
import { LINK_ACCENT } from '../../lib/chipTone'
import { firstSentence, patchWords, reviewBody, type ReviewChoice, type ReviewRowFields } from '../../lib/judgeReview'

export interface ReviewRow extends ReviewRowFields {
  id: string
  report_id: string
  judge_score: number | null
  report_summary: string | null
}

const CONFIRMS =
  'Confirms the category as a person: a reporter feature request may then go to auto-fix.'

export function JudgeReviewRows({
  rows,
  canEdit,
  onChanged,
  'data-testid': testId = 'judge-review-rows',
}: {
  rows: readonly ReviewRow[]
  canEdit: boolean
  /** Reload the list and the counts after a decision. */
  onChanged: () => void
  'data-testid'?: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  // Rows decided this visit show their ✓ at once, before the reload lands.
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())

  async function decide(row: ReviewRow, choice: ReviewChoice) {
    const body = reviewBody(row, choice)
    if (!body) return
    setBusy(`${row.id}:${choice}`)
    try {
      const res = await apiFetch(`/v1/admin/reports/${row.report_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) {
        toast.error(choice === 'accept' ? "Could not apply the grader's view" : 'Could not keep the diagnosis', apiErrorText(res.error, 'Try again in a moment.'))
        return
      }
      setDone((prev) => new Set(prev).add(row.id))
      toast.success(choice === 'accept' ? "Applied the grader's view" : 'Kept the diagnosis')
      onChanged()
    } catch {
      toast.error('Could not save', 'Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <ol className="list-none divide-y divide-edge-subtle p-0" data-testid={testId}>
      {rows.map((r) => {
        const reviewed = r.reviewed || done.has(r.id)
        const accept = reviewed ? null : reviewBody(r, 'accept')
        const keep = reviewed ? null : reviewBody(r, 'keep')
        const reason = firstSentence(r.judge_reasoning)
        const grade = r.judge_score != null ? Math.round(r.judge_score * 100) : null
        const changes = patchWords(r.grader_patch)
        return (
          <li key={r.id} className="flex min-w-0 flex-col gap-1 py-1.5 sm:flex-row sm:items-center sm:gap-3" data-testid="judge-review-row" data-reviewed={reviewed || undefined}>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Link to={`/reports/${r.report_id}`} className={`min-w-0 truncate text-xs font-semibold ${LINK_ACCENT}`} title={r.report_summary ?? undefined}>
                  {r.report_summary?.trim() || 'Untitled report'}
                </Link>
                {grade != null ? (
                  // A disagreement can still earn a high grade, so the bar is neutral, not red.
                  <BarCell value={grade} max={100} text={`${grade}%`} widthClass="w-12" className="shrink-0" />
                ) : null}
              </div>
              {reason ? (
                <p className="truncate text-2xs text-fg-secondary" title={r.judge_reasoning ?? undefined} data-testid="judge-review-reason">
                  {reason}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {reviewed ? (
                <StatusPill status="passed" label="Reviewed" />
              ) : (
                <>
                  {accept ? (
                    <Btn
                      size="sm"
                      variant="ghost"
                      loading={busy === `${r.id}:accept`}
                      disabled={!canEdit || busy !== null}
                      title={canEdit ? `${changes}. ${CONFIRMS}` : 'Viewers can read grades but cannot change reports.'}
                      onClick={() => void decide(r, 'accept')}
                    >
                      Accept grader&apos;s view
                    </Btn>
                  ) : null}
                  {keep ? (
                    <Btn
                      size="sm"
                      variant="ghost"
                      loading={busy === `${r.id}:keep`}
                      disabled={!canEdit || busy !== null}
                      title={canEdit ? `Keep the current diagnosis. ${CONFIRMS}` : 'Viewers can read grades but cannot change reports.'}
                      onClick={() => void decide(r, 'keep')}
                    >
                      Keep diagnosis
                    </Btn>
                  ) : null}
                  {!accept && !keep ? (
                    <Btn size="sm" variant="ghost" to={`/reports/${r.report_id}`}>
                      Open report
                    </Btn>
                  ) : null}
                </>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
