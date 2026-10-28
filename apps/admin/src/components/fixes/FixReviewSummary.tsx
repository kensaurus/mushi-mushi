/**
 * The Opus review of a cloud agent's PR (ADR 0030), compact enough for the
 * merge popover: verdict chip, the summary, then what to look at before
 * merging (findings, removed behaviour, an owner decision). "Not reviewed"
 * is said plainly, never hidden.
 */

import { Btn } from '../ui'
import { statusChipTone } from '../../lib/chipTone'
import { canRerunReview, reviewTone, type FixReview } from '../../lib/fixReview'

const SEVERITY_LABEL = { blocker: 'Blocker', major: 'Major', minor: 'Minor' } as const
const SEVERITY_TONE = { blocker: 'text-danger', major: 'text-warn', minor: 'text-fg-muted' } as const

interface Props {
  review: FixReview | null
  loading: boolean
  error: string | null
  rerunning: boolean
  onRerun: () => void
}

export function FixReviewSummary({ review, loading, error, rerunning, onRerun }: Props) {
  if (loading && !review) {
    return <p className="text-2xs text-fg-faint">Loading the Opus review…</p>
  }
  if (error && !review) {
    return <p className="text-2xs text-fg-muted">Opus review: could not load ({error}).</p>
  }
  if (!review) return null

  const showDetails = review.state === 'fix_first' || review.state === 'hold'
  const findings = showDetails ? review.findings : review.findings.filter((f) => f.severity !== 'minor')

  return (
    <section aria-label="Opus review" className="rounded-sm border border-edge-subtle bg-surface p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium ${statusChipTone(reviewTone(review))}`}>
          {review.label}
        </span>
        {canRerunReview(review) && (
          <Btn type="button" variant="ghost" size="sm" onClick={onRerun} disabled={rerunning} loading={rerunning}>
            {review.state === 'not_reviewed' ? 'Review with Opus' : 'Re-run review'}
          </Btn>
        )}
      </div>

      {review.state === 'not_reviewed' && (
        <p className="text-2xs text-fg-muted">
          No independent review of this pull request yet. Read the diff on GitHub before merging.
        </p>
      )}
      {(review.state === 'queued' || review.rerunning) && (
        <p className="text-2xs text-fg-muted">
          The AI review is reading the diff. This takes a few minutes
          {review.verdict ? '; the last verdict applies until it finishes.' : '.'}
        </p>
      )}
      {review.stale && (
        <p className="text-2xs text-warn">
          This verdict is about an older commit. The pull request has changed since; re-run the review.
        </p>
      )}
      {review.reason && <p className="text-2xs text-fg-muted">{review.reason}</p>}
      {review.summary && (
        <p className="text-2xs text-fg-secondary leading-relaxed">
          <span className="text-fg-faint">AI reviewer: </span>
          {review.summary}
        </p>
      )}

      {findings.length > 0 && (
        <ul className="max-h-40 overflow-y-auto space-y-1 text-2xs" aria-label="Review findings">
          {findings.map((f, i) => (
            <li key={`${f.file}:${f.line ?? ''}:${i}`} className="leading-snug">
              <span className={`font-medium ${SEVERITY_TONE[f.severity]}`}>{SEVERITY_LABEL[f.severity]}</span>
              {f.file !== '(general)' && (
                <span className="font-mono text-fg-faint"> {f.file}{f.line ? `:${f.line}` : ''}</span>
              )}
              <span className="text-fg-secondary">: {f.issue}</span>
              {showDetails && f.suggested_fix && <span className="text-fg-muted"> Fix: {f.suggested_fix}</span>}
            </li>
          ))}
        </ul>
      )}

      {review.removesBehavior.length > 0 && (
        <div className="text-2xs">
          <span className="font-medium text-warn">Removes existing behaviour:</span>
          <ul className="list-disc pl-4 text-fg-secondary">
            {review.removesBehavior.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {review.needsHumanDecision && (
        <p className="text-2xs">
          <span className="font-medium text-warn">Needs your decision: </span>
          <span className="text-fg-secondary">{review.needsHumanDecision}</span>
        </p>
      )}
      {review.commentUrl && (
        <a href={review.commentUrl} target="_blank" rel="noopener noreferrer" className="text-2xs text-accent hover:underline">
          Review comment on GitHub
        </a>
      )}
    </section>
  )
}
