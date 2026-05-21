/**
 * FILE: apps/admin/src/components/BetaBanner.tsx
 * PURPOSE: Top-of-app strip that sets expectations for beta users and
 *          gives them a one-click way to file a bug or request a feature
 *          via the in-app feedback modal (POST /v1/support/contact).
 */

import { useEffect, useState } from 'react'
import { FeedbackModal } from './FeedbackModal'
import { getMushiSelf, reportMushiBug } from '../lib/mushi-self'
import { ActionPill, ActionPillRow, ContainedBlock, SignalChip } from './report-detail/ReportSurface'

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
        role="region"
        aria-label="Beta announcement"
        className="border-b border-brand/20 bg-brand/5 text-fg-secondary"
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 text-xs">
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
            <SignalChip tone="brand" className="font-mono text-[0.6rem] uppercase tracking-[0.18em]">
              Beta
            </SignalChip>
            <ContainedBlock tone="muted" className="inline-block max-w-none border-brand/20 bg-brand/5 px-2 py-0.5">
              <span className="text-pretty leading-snug text-xs">
                Mushi-mushi is in active beta — expect rough edges and the occasional rebuild.
              </span>
            </ContainedBlock>
          </span>
          <ActionPillRow className="shrink-0">
            <ActionPill onClick={() => openFeedback('bug')} tone="brand">
              🐛 Report a bug
            </ActionPill>
            <ActionPill onClick={() => openFeedback('feature')} tone="neutral">
              ✨ Request a feature
            </ActionPill>
            <ActionPill to="/feedback" tone="neutral">
              My submissions
            </ActionPill>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss beta announcement for 7 days"
              className="rounded-sm px-1.5 py-0.5 text-2xs text-fg-faint hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Dismiss
            </button>
          </ActionPillRow>
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
