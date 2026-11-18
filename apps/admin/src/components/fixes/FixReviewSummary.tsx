/**
 * The Opus review of a cloud agent's PR (ADR 0030), compact enough for the
 * merge popover: verdict chip, the summary, then what to look at before
 * merging (findings, removed behaviour, an owner decision). "Not reviewed"
 * is said plainly, never hidden.
 */

import { Btn } from '../ui'
import { canRerunReview, type FixReview } from '../../lib/fixReview'
import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { VitalText } from '../signal/VitalText'

const SEVERITY_LABEL = { blocker: 'Blocker', major: 'Major', minor: 'Minor' } as const
/** Severity as shape and colour: ▲ blocker, ◆ major, ○ minor. */
const SEVERITY_SIGNAL: Record<keyof typeof SEVERITY_LABEL, SignalTone> = { blocker: 'danger', major: 'warn', minor: 'off' }

/** The verdict as a mark: merge passes, hold fails, fix-first and an old verdict are slow, a running review runs. */
function reviewStatus(review: FixReview): RunStatus {
  if (review.state === 'queued' || review.rerunning) return 'running'
  if (review.verdict === 'hold') return 'failed'
  if (review.state === 'merge') return 'passed'
  if (review.state === 'fix_first' || review.state === 'stale') return 'slow'
  if (review.state === 'failed') return 'failed'
  return 'idle'
}

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
        <StatusPill status={reviewStatus(review)} label={review.label} />
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
          Reading the diff, a few minutes{review.verdict ? '; the last verdict applies until then.' : '.'}
        </p>
      )}
      {review.stale && (
        <p className="text-2xs text-warn">
          This verdict is about an older commit. The pull request has changed since; re-run the review.
        </p>
      )}
      {review.reason && (
        <p className="text-2xs text-fg-muted">
          <VitalText text={review.reason} />
        </p>
      )}
      {review.summary && (
        <p className="text-2xs text-fg-secondary leading-relaxed">
          <span className="text-fg-faint">AI reviewer: </span>
          <VitalText text={review.summary} />
        </p>
      )}

      {findings.length > 0 && (
        <ul className="max-h-40 overflow-y-auto space-y-1 text-2xs" aria-label="Review findings">
          {findings.map((f, i) => (
            <li key={`${f.file}:${f.line ?? ''}:${i}`} className="leading-snug">
              <span className={`inline-flex items-center gap-1 font-medium ${TONE_INK[SEVERITY_SIGNAL[f.severity]]}`} data-severity={f.severity}>
                <StatusGlyph tone={SEVERITY_SIGNAL[f.severity]} />
                {SEVERITY_LABEL[f.severity]}
              </span>
              {f.file !== '(general)' && (
                <span className="font-mono text-fg-faint"> {f.file}{f.line ? `:${f.line}` : ''}</span>
              )}
              <span className="text-fg-secondary">
                : <VitalText text={f.issue} />
              </span>
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
