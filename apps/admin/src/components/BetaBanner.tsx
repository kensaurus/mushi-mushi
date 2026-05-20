/**
 * FILE: apps/admin/src/components/BetaBanner.tsx
 * PURPOSE: Top-of-app strip that sets expectations for beta users and
 *          gives them a one-click way to file a bug or request a feature
 *          via the in-app feedback modal (POST /v1/support/contact).
 */

import { useEffect, useState } from 'react'
import { FeedbackModal } from './FeedbackModal'

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

  useEffect(() => {
    const at = readDismissedAt()
    if (at === null || Date.now() - at > DISMISS_TTL_MS) {
      setDismissed(false)
    }
  }, [])

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
    setFeedbackType(type)
    setFeedbackOpen(true)
  }

  return (
    <>
      <div
        role="region"
        aria-label="Beta announcement"
        className="border-b border-brand/20 bg-brand/5 text-fg-secondary"
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 text-xs">
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
            <span
              aria-hidden
              className="inline-flex shrink-0 items-center justify-center rounded-sm bg-brand/15 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-brand"
            >
              Beta
            </span>
            <span className="text-pretty leading-snug">
              Mushi-mushi is in active beta — expect rough edges and the occasional rebuild.
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openFeedback('bug')}
              className="inline-flex items-center gap-1 rounded-sm border border-brand/30 bg-surface-raised/60 px-2 py-0.5 text-2xs font-medium text-brand hover:bg-brand/10 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span aria-hidden>🐛</span>
              <span>Report a bug</span>
            </button>
            <button
              type="button"
              onClick={() => openFeedback('feature')}
              className="inline-flex items-center gap-1 rounded-sm border border-edge bg-surface-raised/60 px-2 py-0.5 text-2xs font-medium text-fg-secondary hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span aria-hidden>✨</span>
              <span>Request a feature</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss beta announcement for 7 days"
              className="rounded-sm px-1.5 py-0.5 text-2xs text-fg-faint hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Dismiss
            </button>
          </span>
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
