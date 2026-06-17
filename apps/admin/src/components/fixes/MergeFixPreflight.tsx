/**
 * Confirm popover for merging a Mushi draft PR from the console.
 * Mirrors DispatchFixPreflight — user stays in control, nothing auto-merges.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { mergeFixAttempt, type MergeMethod } from '../../lib/mergeFix'
import { Btn } from '../ui'
import { FixCiFeedback } from './FixCiFeedback'

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

  const ciFailed = liveCiConclusion === 'failure' || liveCiConclusion === 'cancelled' || liveCiConclusion === 'timed_out'
  const ciPassed = liveCiConclusion === 'success'

  const handleMerge = async (method: MergeMethod) => {
    setMerging(true)
    setError(null)
    const result = await mergeFixAttempt(fixId, method)
    setMerging(false)
    if (!result.ok) {
      setError(result.error ?? 'Merge failed')
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
            : 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-sm bg-ok/15 text-ok border border-ok/30 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-wait'
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
          className="absolute right-0 top-full mt-1 z-30 w-80 rounded-md border border-edge-subtle bg-surface-raised shadow-xl p-3 text-left"
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
                <span>CI passed — safe to merge.</span>
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
            <p className="mt-2 rounded-sm border border-danger/25 bg-danger-muted/15 px-2 py-1 text-2xs text-danger">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={merging}
              className="px-2 py-1 text-2xs text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <Btn
              type="button"
              size="sm"
              variant="success"
              onClick={() => void handleMerge('squash')}
              disabled={merging}
              loading={merging}
            >
              {merging ? 'Merging…' : 'Squash merge →'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
