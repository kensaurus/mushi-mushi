/**
 * FILE: apps/admin/src/components/BetaBanner.tsx
 * PURPOSE: Top-of-app strip that sets expectations for beta users and
 *          gives them a one-click way to file a bug or request a feature
 *          via the in-app feedback modal (POST /v1/support/contact).
 */

import { useEffect, useRef, useState } from 'react'
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
  }, [dismissed])

  if (dismissed) return null

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
      {/* Lime-green beta strip: vivid colour so it reads as "live & rough-edged"
          even against dark or light themes. Height is intentionally tight (py-0.5)
          so it steals minimal vertical space while still being unmissably loud. */}
      <div
        id={BETA_BANNER_ID}
        ref={bannerRef}
        role="region"
        aria-label="Beta announcement"
        className="sticky top-0 z-[100] shrink-0 border-b border-lime/40 bg-lime-muted"
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-1 px-3 py-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1 sm:px-4 sm:py-0.5">
          <span className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center">
            <span className="inline-flex shrink-0 items-center rounded border border-lime/60 bg-lime/20 px-1.5 py-px font-mono text-3xs font-bold uppercase tracking-[0.18em] text-lime">
              Beta
            </span>
            <span className="min-w-0 truncate text-xs font-medium leading-snug text-lime/80">
              Mushi-mushi is in active beta — expect rough edges and the occasional rebuild.
            </span>
          </span>
          <nav
            aria-label="Beta banner actions"
            className="flex shrink-0 flex-wrap items-center gap-x-0 gap-y-0.5 text-2xs sm:justify-end"
          >
            <button
              type="button"
              onClick={() => openFeedback('bug')}
              className="px-2 py-0.5 font-medium text-lime/90 hover:text-lime transition-colors"
            >
              🐛 Report a bug
            </button>
            <span aria-hidden="true" className="hidden text-lime/25 select-none sm:inline">|</span>
            <button
              type="button"
              onClick={() => openFeedback('feature')}
              className="px-2 py-0.5 font-medium text-lime/70 hover:text-lime transition-colors"
            >
              ✨ Feature request
            </button>
            <span aria-hidden="true" className="hidden text-lime/25 select-none sm:inline">|</span>
            <Link
              to="/feedback"
              className="px-2 py-0.5 font-medium text-lime/70 hover:text-lime transition-colors"
            >
              My submissions
            </Link>
            <span aria-hidden="true" className="hidden text-lime/25 select-none sm:inline">|</span>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss beta banner"
              className="px-2 py-0.5 font-medium text-lime/50 hover:text-lime/80 transition-colors"
            >
              ✕
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
