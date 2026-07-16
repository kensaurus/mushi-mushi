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
import { getMushiSelf, isMushiSelfEnabled, reportMushiBug } from '../lib/mushi-self'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { BETA_BANNER_ID, setBetaBannerOffset } from '../lib/appChrome'
import { betaBannerTone } from '../lib/tokens'

const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DISMISS_KEY = 'mushi-mushi:beta-banner-dismissed-at'

/** Routes where visitors are not authenticated — feedback APIs require JWT. */
const PUBLIC_AUTH_PATHS = new Set(['/login', '/signup', '/reset-password'])

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
  const { session } = useAuth()
  const isTesterPortal = location.pathname === '/tester' || location.pathname.startsWith('/tester/')
  // Bug reports must work logged-out too (red-team #12: pre-login reports
  // were silently discarded) — the SDK widget authenticates with its own
  // project API key, no JWT needed. Feature requests still post to the
  // JWT-gated /v1/support/contact, so they stay session-gated.
  const onPublicAuthPath = PUBLIC_AUTH_PATHS.has(location.pathname)
  const canReportBug = !!session || isMushiSelfEnabled()
  const canSubmitFeedback = !!session && !onPublicAuthPath
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
    if (type === 'bug' && (getMushiSelf() || isMushiSelfEnabled())) {
      reportMushiBug({ category: 'bug' })
      return
    }
    if (type === 'bug' && !session) {
      // No SDK and no JWT — never drop the report on the floor: hand the
      // user a mailto instead of posting to an endpoint that will 401.
      const href = `mailto:kensaurus@gmail.com?subject=${encodeURIComponent('[mushi-mushi bug]')}&body=${encodeURIComponent(`Page: ${window.location.href}\n\n`)}`
      window.open(href, '_blank')
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
        className={`shrink-0 z-[100] border-b ${betaBannerTone()}`}
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-1 px-3 py-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1 sm:px-4">
          <span className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center">
            <span className="inline-flex shrink-0 items-center rounded border border-lime/40 bg-lime/15 px-1.5 py-px font-mono text-2xs font-medium text-lime-foreground">
              Beta
            </span>
            <span className="min-w-0 truncate text-xs leading-snug text-lime-foreground">
              Mushi is in active beta — expect rough edges and occasional rebuilds.
            </span>
          </span>
          <nav
            aria-label="Beta banner actions"
            className="flex shrink-0 flex-wrap items-center gap-x-0 gap-y-0.5 text-2xs text-lime-foreground/75 sm:justify-end"
          >
            {canReportBug ? (
              <>
                <button
                  type="button"
                  onClick={() => openFeedback('bug')}
                  className="px-2 py-0.5 font-medium transition-opacity hover:text-lime-foreground"
                >
                  Report a bug
                </button>
                <span aria-hidden="true" className="hidden select-none text-lime-foreground/40 sm:inline">|</span>
              </>
            ) : null}
            {canSubmitFeedback ? (
              <>
                <button
                  type="button"
                  onClick={() => openFeedback('feature')}
                  className="px-2 py-0.5 font-medium transition-opacity hover:text-lime-foreground"
                >
                  Feature request
                </button>
                <span aria-hidden="true" className="hidden select-none text-lime-foreground/40 sm:inline">|</span>
                <Link
                  to="/feedback"
                  className="px-2 py-0.5 font-medium transition-opacity hover:text-lime-foreground"
                >
                  My submissions
                </Link>
                <span aria-hidden="true" className="hidden select-none text-lime-foreground/40 sm:inline">|</span>
              </>
            ) : null}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss beta banner"
              className="px-2 py-0.5 font-medium transition-opacity hover:text-lime-foreground"
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
