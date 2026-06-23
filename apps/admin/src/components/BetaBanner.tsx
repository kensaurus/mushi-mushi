/**
 * FILE: apps/admin/src/components/BetaBanner.tsx
 * PURPOSE: Top-of-app strip that sets expectations for beta users and
 *          gives them a one-click way to file a bug or request a feature
 *          via the in-app feedback modal (POST /v1/support/contact).
 *
 * Cross-surface note (Option B): admin lime chrome is intentional — it is
 * operator-console beta signalling, not customer SDK `MushiBannerConfig`.
 * See docs/admin/SDK-UI-UNIFICATION-DECISIONS.md §2.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FeedbackModal } from './FeedbackModal'
import { getMushiSelf, reportMushiBug } from '../lib/mushi-self'
import { Link } from 'react-router-dom'
import { BETA_BANNER_ID, setBetaBannerOffset } from '../lib/appChrome'

const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DISMISS_KEY = 'mushi-mushi:beta-banner-dismissed-at'

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

export function BetaBanner() {
  const location = useLocation()
  const isTesterPortal = location.pathname === '/tester' || location.pathname.startsWith('/tester/')
  const [dismissed, setDismissed] = useState(true)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature'>('bug')
  const bannerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const at = readDismissedAt()
    if (at === null || Date.now() - at > DISMISS_TTL_MS) {
      setDismissed(false)
    }
  }, [])

  // Fixed drawers/panels use viewport positioning and ignore in-flow chrome.
  // Publish the live banner height so overlays can offset their top edge.
  useEffect(() => {
    if (dismissed) {
      setBetaBannerOffset(0)
      return
    }
    const el = bannerRef.current
    if (!el) return

    const sync = () => setBetaBannerOffset(el.getBoundingClientRect().height)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setBetaBannerOffset(0)
    }
  }, [dismissed, isTesterPortal])

  useEffect(() => {
    if (isTesterPortal) setBetaBannerOffset(0)
  }, [isTesterPortal])

  if (isTesterPortal || dismissed) return null

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* best effort */
    }
    setDismissed(true)
  }

  function openFeedback(type: 'bug' | 'feature') {
    // Prefer the Mushi SDK widget when it's loaded — reports then flow through
    // the same pipeline as customer reports, giving us first-hand QA of the
    // full submission experience. Fall back to the FeedbackModal (which posts
    // to /v1/support/contact) when Mushi isn't loaded yet or VITE_MUSHI_SELF_*
    // env vars are absent.
    if (type === 'bug' && getMushiSelf()) {
      reportMushiBug({ category: 'bug' })
      return
    }
    setFeedbackType(type)
    setFeedbackOpen(true)
  }

  return (
    <>
      <div
        id={BETA_BANNER_ID}
        ref={bannerRef}
        role="region"
        aria-label="Beta announcement"
        className="sticky top-0 z-[100] shrink-0 border-b border-edge-subtle bg-surface-raised/95"
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-1 px-3 py-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1 sm:px-4">
          <span className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center">
            <span className="inline-flex shrink-0 items-center rounded border border-edge bg-surface-overlay px-1.5 py-px font-mono text-2xs font-medium text-fg-muted">
              Beta
            </span>
            <span className="min-w-0 truncate text-xs leading-snug text-fg-secondary">
              Mushi is in active beta — expect rough edges and occasional rebuilds.
            </span>
          </span>
          <nav
            aria-label="Beta banner actions"
            className="flex shrink-0 flex-wrap items-center gap-x-0 gap-y-0.5 text-2xs sm:justify-end"
          >
            <button
              type="button"
              onClick={() => openFeedback('bug')}
              className="px-2 py-0.5 font-medium text-fg-secondary hover:text-fg transition-colors"
            >
              Report a bug
            </button>
            <span aria-hidden="true" className="hidden text-fg-faint select-none sm:inline">|</span>
            <button
              type="button"
              onClick={() => openFeedback('feature')}
              className="px-2 py-0.5 font-medium text-fg-muted hover:text-fg transition-colors"
            >
              Feature request
            </button>
            <span aria-hidden="true" className="hidden text-fg-faint select-none sm:inline">|</span>
            <Link
              to="/feedback"
              className="px-2 py-0.5 font-medium text-fg-muted hover:text-fg transition-colors"
            >
              My submissions
            </Link>
            <span aria-hidden="true" className="hidden text-fg-faint select-none sm:inline">|</span>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss beta banner"
              className="px-2 py-0.5 font-medium text-fg-faint hover:text-fg-muted transition-colors"
            >
              Dismiss
            </button>
          </nav>
        </div>
      </div>

      {feedbackOpen && (
        <FeedbackModal
          initialType={feedbackType}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </>
  )
}
