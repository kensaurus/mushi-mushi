/**
 * FILE: apps/admin/src/components/BetaBanner.tsx
 * PURPOSE: Top-of-app strip that sets expectations for beta users and
 *          gives them a one-click way to file a bug to the maintainer.
 *
 * WHY
 * ---
 * Mushi-mushi is in active beta. End users have started signing up and
 * hitting rough edges (the "owner or admin of an organization" 400 they
 * surfaced on Tuesday is one example) that would normally be triaged on
 * an internal Slack — they have no such channel. Without a visible
 * "this is beta + here's where to write us" affordance, every broken
 * flow turns into a silent churn event.
 *
 * The banner is intentionally lightweight (one row, dismissible per-
 * device for 7 days), uses the existing semantic tokens so it blends
 * into the chrome on any theme, and the mailto: includes a `subject`
 * prefix and a templated body so reports are easy to triage on the
 * receiving end.
 */

import { useEffect, useState } from 'react'

// 7 days. Long enough that we don't nag the same user every session,
// short enough that someone who dismissed it a week ago — and has
// since hit a new bug — sees the report channel surface again.
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DISMISS_KEY = 'mushi-mushi:beta-banner-dismissed-at'

const REPORT_EMAIL = 'kensaurus@gmail.com'

function buildMailto(): string {
  const subject = '[mushi-mushi beta] '
  // We deliberately pre-fill the body with a tiny structured template
  // so reports arrive with the four facts that matter most — what they
  // tried, what they saw, what they expected, and where in the app. A
  // pre-filled template is the cheapest reliable way to nudge bug
  // reporters into a useful format. (Lazy users delete it; thorough
  // users fill it in; both outcomes beat a blank body.)
  const body = [
    'Hi! I hit a bug in mushi-mushi.',
    '',
    'What I was doing:',
    '',
    'What I expected:',
    '',
    'What actually happened:',
    '',
    'Where (URL / page):',
    '',
    '---',
    `Reported from: ${typeof window !== 'undefined' ? window.location.href : 'mushi-mushi admin'}`,
  ].join('\n')
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    // localStorage can throw in private-browsing modes / strict CSP.
    // Banner falls back to "always show" which is the safer default
    // for a beta-trust messaging channel.
    return null
  }
}

export function BetaBanner() {
  const [dismissed, setDismissed] = useState(true)

  // Hydrate dismissal state on mount so SSR/client first-paint don't
  // disagree. The default-true initial value keeps the banner from
  // flashing on screen for users who already dismissed it.
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
      // See readDismissedAt — quota / CSP failures are non-fatal; the
      // banner will just reappear next session.
    }
    setDismissed(true)
  }

  return (
    <div
      role="region"
      aria-label="Beta announcement"
      className="border-b border-brand/20 bg-brand/5 text-fg-secondary"
    >
      <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded-sm bg-brand/15 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-brand"
          >
            Beta
          </span>
          <span>
            Mushi-mushi is in active beta — expect rough edges and the occasional rebuild.
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <a
            href={buildMailto()}
            className="inline-flex items-center gap-1 rounded-sm border border-brand/30 bg-surface-raised/60 px-2 py-0.5 text-2xs font-medium text-brand hover:bg-brand/10 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <span aria-hidden>✉</span>
            <span>Report a bug</span>
          </a>
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
  )
}
