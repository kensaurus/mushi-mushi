/**
 * FILE: apps/admin/src/components/reports/DispatchFixPreflight.tsx
 * PURPOSE: Replaces the bare "Dispatch fix" button with a confirm
 *          popover that answers the user's "what does this button do?"
 *          question BEFORE we queue a worker. Inspired by Linear's
 *          create-PR confirm step and Vercel's deploy-preview dialog --
 *          the cheapest pre-commit is the one that requires no read
 *          of docs.
 *
 *          The popover stays inline (no full-screen modal) so dense
 *          triage sessions don't lose context. Once the user
 *          confirms, the parent's `onDispatch` runs and the row's
 *          existing "Dispatching..." state takes over.
 *
 *          Prerequisites checklist (May 2026): the popover now reads
 *          `usePreflight()` and renders each missing requirement with a
 *          deep-link "Fix this →" button. The Queue button is hard-
 *          blocked when any check fails, replacing the previous flow
 *          where the user discovered the gap only after a 500 came back
 *          from the dispatch endpoint (AUTOFIX_DISABLED / skipped due
 *          to indexing off, etc.).
 */

import { type CSSProperties, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { PreflightCheck, PreflightState } from '../../lib/useDispatchPreflight'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  busy: boolean
  severity: string | null
  blastRadius: number
  confidence: number | null
  onConfirm: () => void
  onOpenDetail?: () => void
  preflight?: PreflightState
  /** GitHub repo URL the fix PR will land on. Sourced from platform integrations. */
  repoUrl?: string | null
  /** Table row — shorter label, width-constrained trigger. */
  variant?: 'default' | 'table'
}

const POPOVER_PAD = 10

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export function DispatchFixPreflight({
  busy,
  severity,
  blastRadius,
  confidence,
  onConfirm,
  onOpenDetail,
  preflight,
  repoUrl,
  variant = 'default',
}: Props) {
  const [open, setOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const popoverId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Compute position: fixed so the popover escapes overflow:auto + mask-image
  // on the scroll container and is never clipped inside the reports table.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const popW = popoverRef.current?.offsetWidth ?? 416
    const popH = popoverRef.current?.offsetHeight ?? 480
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 4

    let top = rect.bottom + GAP
    // Right-align the popover with the trigger button's right edge.
    let left = rect.right - popW

    if (left < POPOVER_PAD) left = POPOVER_PAD
    if (left + popW > vw - POPOVER_PAD) left = vw - popW - POPOVER_PAD
    if (top + popH > vh - POPOVER_PAD) top = rect.top - popH - GAP
    top = clamp(top, POPOVER_PAD, Math.max(POPOVER_PAD, vh - popH - POPOVER_PAD))

    setPopoverStyle({ position: 'fixed', top, left, zIndex: 10_000 })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

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

  const highBlast = blastRadius >= 3
  const lowConfidence = confidence != null && confidence < 0.6
  const sevHigh = severity === 'critical' || severity === 'high'

  // Preflight blocks the dispatch *before* it leaves the browser so the
  // user never sees `AUTOFIX_DISABLED` or a silent `skipped` outcome.
  // When no preflight prop is passed (legacy callers), the popover keeps
  // its old "always enabled" behaviour — so embedding pages can opt in
  // incrementally.
  const failingChecks = preflight?.failing ?? []
  const preflightBlocked = !!preflight && (!preflight.loading && !preflight.ready)

  const handleConfirm = () => {
    if (preflightBlocked) return
    setOpen(false)
    onConfirm()
  }

  const isTable = variant === 'table'
  const triggerLabel = busy
    ? isTable
      ? 'Sending…'
      : 'Dispatching…'
    : isTable
      ? 'Fix →'
      : 'Dispatch fix →'

  return (
    <div className={isTable ? 'inline-flex min-w-0 max-w-full shrink-0' : 'inline-flex'}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        onClick={(e) => {
          e.stopPropagation()
          if (busy) return
          setOpen((v) => !v)
        }}
        disabled={busy}
        className={[
          'inline-flex items-center justify-center gap-0.5 rounded-sm border font-medium disabled:cursor-wait disabled:opacity-50',
          isTable
            ? 'h-5 min-h-0 shrink-0 truncate px-1.5 text-3xs leading-none bg-brand/12 text-brand border border-brand/28 hover:bg-brand/20'
            : 'px-2 py-1 text-2xs bg-brand/12 text-brand border border-brand/28 hover:bg-brand/20',
        ].join(' ')}
      >
        <span className="truncate">{triggerLabel}</span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          aria-label="Dispatch agentic fix"
          onClick={(e) => e.stopPropagation()}
          style={popoverStyle}
          className="w-[min(26rem,calc(100vw-1.25rem))] max-h-[min(32rem,calc(100vh-1.25rem))] overflow-y-auto rounded-md border border-edge-subtle bg-surface-raised shadow-xl p-3 text-left"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-xs font-medium text-fg">
              Dispatch agentic fix attempt
            </div>
            {repoUrl && (() => {
              // Extract owner/repo from the URL for a compact display
              const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/i)
              const shortName = match?.[1] ?? repoUrl.replace(/^https?:\/\//, '')
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-surface-overlay border border-edge px-1.5 py-0.5 text-2xs text-fg-muted font-mono"
                  title={`PR will land on ${repoUrl}`}
                >
                  <span aria-hidden="true">📂</span>
                  {shortName}
                </span>
              )
            })()}
          </div>
          <p className="text-2xs text-fg-muted leading-relaxed">
            We&apos;ll queue a Mushi fix-worker that reads your repo, picks the
            file it thinks owns this bug, and drafts a pull request on a new
            feature branch.{' '}
            <span className="text-fg-faint">
              You stay in control — dispatch opens a draft PR; you review and merge in the console or on GitHub.
            </span>
          </p>

          <ul className="mt-2 space-y-1 text-2xs text-fg-secondary">
            <li className="flex items-start gap-1">
              <span aria-hidden="true" className="text-fg-faint mt-0.5">→</span>
              <span>
                <span className="font-medium">Status streams here.</span>{' '}
                <span className="text-fg-muted">
                  Queued → running → PR ready (typically 2–6 minutes).
                </span>
              </span>
            </li>
            <li className="flex items-start gap-1">
              <span aria-hidden="true" className="text-fg-faint mt-0.5">→</span>
              <span>
                <span className="font-medium">PR lands on a branch</span>{' '}
                <span className="text-fg-muted">
                  named <code className="font-mono">mushi/fix-&lt;report-id&gt;</code>.
                </span>
              </span>
            </li>
            <li className="flex items-start gap-1">
              <span aria-hidden="true" className="text-fg-faint mt-0.5">→</span>
              <span>
                <span className="font-medium">No CI side effects.</span>{' '}
                <span className="text-fg-muted">
                  Draft PR — your branch protection rules still gate the merge.
                </span>
              </span>
            </li>
          </ul>

          {preflight && (
            <PreflightChecklist
              loading={preflight.loading}
              checks={preflight.checks}
              failing={failingChecks}
              onClose={() => setOpen(false)}
            />
          )}

          {(highBlast || lowConfidence || sevHigh) && (
            <div className="mt-2 rounded-sm p-2 text-2xs bg-warn-muted/50 text-warning-foreground border border-warn/25">
              <div className="font-medium mb-0.5">Heads up:</div>
              <ul className="space-y-0.5">
                {highBlast && (
                  <li>
                    This bug was felt by {blastRadius} distinct users — a single fix
                    attempt closes the whole group.
                  </li>
                )}
                {lowConfidence && (
                  <li>
                    LLM confidence is {Math.round((confidence ?? 0) * 100)}%. The worker
                    may pick the wrong file — review the diff carefully.
                  </li>
                )}
                {sevHigh && (
                  <li>
                    Severity is {severity}. Consider reading the breadcrumbs first.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            {onOpenDetail ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  onOpenDetail()
                }}
                className="text-2xs text-fg-muted hover:text-fg underline underline-offset-2"
              >
                Read first
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                }}
                className="px-2 py-1 text-2xs text-fg-muted hover:text-fg rounded-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={preflightBlocked}
                onClick={(e) => {
                  e.stopPropagation()
                  handleConfirm()
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-sm bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  preflightBlocked
                    ? `Fix the ${failingChecks.length} prerequisite${failingChecks.length === 1 ? '' : 's'} above first`
                    : undefined
                }
              >
                {preflightBlocked ? 'Resolve prerequisites first' : 'Queue fix worker →'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Live preflight checklist rendered inside the dispatch popover. */
function PreflightChecklist({
  loading,
  checks,
  failing,
  onClose,
}: {
  loading: boolean
  checks: PreflightCheck[]
  failing: PreflightCheck[]
  onClose: () => void
}) {
  if (loading) {
    return (
      <div className="mt-2 rounded-sm border border-edge bg-surface-overlay/40 p-2 text-2xs text-fg-muted">
        Checking prerequisites…
      </div>
    )
  }
  if (failing.length === 0) {
    return (
      <div className={`mt-2 rounded-sm border border-ok/30 ${CHIP_TONE.okSubtle} p-2 text-2xs`}>
        <div className="flex items-center gap-1.5">
          <CheckIcon />
          <span className="font-medium">All {checks.length} prerequisites met</span>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-2 rounded-sm border border-danger/30 bg-danger-muted/15 p-2 text-2xs">
      <div className="font-medium text-danger mb-1">
        Can&apos;t dispatch yet — {failing.length} prerequisite{failing.length === 1 ? '' : 's'} missing:
      </div>
      <ul className="space-y-1.5">
        {failing.map((c) => (
          <li key={c.key} className="flex items-start gap-1.5">
            <span aria-hidden="true" className="text-danger mt-0.5 shrink-0">✕</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-fg">{c.label}</div>
              <div className="text-fg-muted text-pretty">{c.hint}</div>
              <Link
                to={c.fixHref}
                onClick={onClose}
                className="inline-block mt-0.5 text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                Fix this →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 6.5L4.5 9L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
