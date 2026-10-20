// mushi-ui: intentional overlay — not Modal/Drawer (reason: inline confirm popover anchored to merge trigger; preserves triage table context)
/**
 * Confirm popover for merging a Mushi draft PR from the console.
 * Mirrors DispatchFixPreflight — user stays in control, nothing auto-merges.
 *
 * Shows the Opus review of the PR (ADR 0030) before the merge button: a
 * "fix first" lists its findings, a "hold" needs "Merge anyway" ticked
 * (the server refuses a hold without `override: true`), and a PR with no
 * review says "Not reviewed".
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { mergeFixAttempt, type MergeMethod } from '../../lib/mergeFix'
import { fetchFixReview, rerunFixReview, reviewBlocksMerge, type FixReview } from '../../lib/fixReview'
import { Btn, Checkbox } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { FixCiFeedback } from './FixCiFeedback'
import { FixReviewSummary } from './FixReviewSummary'

interface Props {
  fixId: string
  prUrl: string
  prNumber?: number | null
  summary?: string | null
  ciConclusion?: string | null
  ciStatus?: string | null
  ciUpdatedAt?: string | null
  busy?: boolean
  onMerged?: (reportStatus: string | null) => void
  /** Compact label for tight layouts (FixCard). */
  compact?: boolean
}

export function MergeFixPreflight({
  fixId,
  prUrl,
  prNumber,
  summary,
  ciConclusion,
  ciStatus,
  ciUpdatedAt,
  busy = false,
  onMerged,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveCiConclusion, setLiveCiConclusion] = useState(ciConclusion ?? null)
  const [review, setReview] = useState<FixReview | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [overrideHold, setOverrideHold] = useState(false)
  const popoverId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popoverRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const loadReview = useCallback(async () => {
    setReviewLoading(true)
    const res = await fetchFixReview(fixId)
    setReviewLoading(false)
    if (res.ok) {
      setReview(res.review)
      setReviewError(null)
    } else {
      setReviewError(res.error)
    }
  }, [fixId])

  useEffect(() => {
    if (!open) return
    setOverrideHold(false)
    void loadReview()
  }, [open, loadReview])

  const handleRerun = async () => {
    setRerunning(true)
    const res = await rerunFixReview(fixId)
    setRerunning(false)
    if (res.ok) {
      setReview(res.review)
      setReviewError(null)
    } else {
      setReviewError(res.error)
    }
  }

  const holdBlocks = reviewBlocksMerge(review) && !overrideHold

  const ciFailed = liveCiConclusion === 'failure' || liveCiConclusion === 'cancelled' || liveCiConclusion === 'timed_out'
  const ciPassed = liveCiConclusion === 'success'

  const handleMerge = async (method: MergeMethod) => {
    setMerging(true)
    setError(null)
    const result = await mergeFixAttempt(fixId, method, { override: overrideHold })
    setMerging(false)
    if (!result.ok) {
      setError(result.error ?? 'Merge failed')
      // A review finished while the popover was open: show it.
      if (result.code === 'REVIEW_HOLD') void loadReview()
      return
    }
    setOpen(false)
    onMerged?.(result.reportStatus ?? 'fixed')
  }

  const disabled = busy || merging

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        onClick={(e) => {
          e.stopPropagation()
          if (disabled) return
          setOpen((v) => !v)
          setError(null)
        }}
        disabled={disabled}
        className={
          compact
            ? 'text-ok hover:text-ok font-medium underline-offset-2 hover:underline disabled:opacity-50 text-xs'
            : `inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-sm hover:bg-ok-muted/40 disabled:opacity-50 disabled:cursor-wait ${CHIP_TONE.okSubtle}`
        }
      >
        {merging ? 'Merging…' : compact ? 'Merge in console' : 'Merge PR in console →'}
      </button>

      {open && (
        <div
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          aria-label="Merge pull request"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-30 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-edge-subtle bg-surface-raised shadow-xl p-3 text-left"
        >
          <div className="text-xs font-medium text-fg mb-1">
            Merge draft PR{prNumber ? ` #${prNumber}` : ''}
          </div>
          <p className="text-2xs text-fg-muted leading-relaxed">
            Squash-merge into your default branch via GitHub. This marks the linked report{' '}
            <span className="font-medium text-fg">Fixed</span>, notifies the reporter, and runs
            your connected integrations (Sentry resolve, Jira done, etc.).{' '}
            <span className="text-fg-faint">You confirm — nothing merges automatically.</span>
          </p>

          {summary && (
            <p className="mt-2 text-2xs text-fg-secondary line-clamp-2" title={summary}>
              {summary}
            </p>
          )}

          <div className="mt-2">
            <FixReviewSummary
              review={review}
              loading={reviewLoading}
              error={reviewError}
              rerunning={rerunning}
              onRerun={() => void handleRerun()}
            />
          </div>

          {reviewBlocksMerge(review) && (
            <div className={`mt-2 rounded-sm px-2 py-1.5 text-2xs ${CHIP_TONE.dangerSubtle}`}>
              <p className="mb-1">
                The review says hold: Mushi will not merge this until you override it. Fix the findings and re-run the
                review, or merge anyway if you have checked them yourself.
              </p>
              <Checkbox label="Merge anyway (override the hold)" checked={overrideHold} onChange={setOverrideHold} />
            </div>
          )}

          <div className="mt-2">
            <FixCiFeedback
              fixId={fixId}
              prUrl={prUrl}
              prNumber={prNumber}
              ciConclusion={liveCiConclusion}
              ciStatus={ciStatus}
              ciUpdatedAt={ciUpdatedAt}
              onRefresh={({ conclusion }) => setLiveCiConclusion(conclusion)}
            />
          </div>

          <ul className="mt-2 space-y-1 text-2xs text-fg-secondary">
            <li className="flex items-start gap-1">
              <span aria-hidden="true" className="text-fg-faint mt-0.5">→</span>
              <span>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Review diff on GitHub
                </a>{' '}
                before merging.
              </span>
            </li>
            {ciPassed && (
              <li className="flex items-start gap-1 text-ok">
                <span aria-hidden="true" className="mt-0.5">✓</span>
                <span>CI passed.</span>
              </li>
            )}
            {ciFailed && (
              <li className="flex items-start gap-1 text-warn">
                <span aria-hidden="true" className="mt-0.5">!</span>
                <span>
                  CI is failing. GitHub may block the merge if branch protection requires green
                  checks — fix CI first or merge on GitHub with override.
                </span>
              </li>
            )}
            {error?.includes('draft') && (
              <li className="flex items-start gap-1 text-warn">
                <span aria-hidden="true" className="mt-0.5">→</span>
                <span>
                  Draft PRs are auto-marked ready on merge — if this persists, refresh the page
                  or use &quot;View GitHub Actions log&quot; to confirm PR state on GitHub.
                </span>
              </li>
            )}
            {!liveCiConclusion && (
              <li className="flex items-start gap-1">
                <span aria-hidden="true" className="text-fg-faint mt-0.5">→</span>
                <span>CI status unknown — refresh above or review checks on the PR before merging.</span>
              </li>
            )}
          </ul>

          {error && (
            <p className={`mt-2 rounded-sm px-2 py-1 text-2xs ${CHIP_TONE.dangerSubtle}`}>
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={merging}
            >
              Cancel
            </Btn>
            <Btn
              type="button"
              size="sm"
              variant="success"
              onClick={() => void handleMerge('squash')}
              disabled={merging || holdBlocks}
              loading={merging}
            >
              {merging ? 'Merging…' : overrideHold ? 'Merge anyway →' : 'Squash merge →'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
