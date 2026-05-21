/**
 * FILE: apps/admin/src/components/fixes/InlineGithubSetupNudge.tsx
 * PURPOSE: C2 — Inline banner shown on the Fixes page when the GitHub (code repo)
 *          integration isn't configured yet. Replaces the implicit "nothing works
 *          without GitHub" state with a clear, actionable nudge. Dismissible per
 *          session so it doesn't interrupt users who already know they need to set it up.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  isGithubMissing: boolean
}

export function InlineGithubSetupNudge({ isGithubMissing }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (!isGithubMissing || dismissed) return null

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-muted/25 px-3 py-2.5 text-2xs"
    >
      <span className="mt-px shrink-0 text-warn" aria-hidden>⚠</span>
      <div className="flex-1">
        <p className="font-semibold text-warn">GitHub repo not connected</p>
        <p className="text-fg-muted mt-0.5">
          Auto-fix dispatches won't create PRs until you configure a GitHub repo URL and token.{' '}
          <Link
            to="/integrations/config"
            className="text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            Connect GitHub →
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-fg-faint hover:text-fg-muted focus:outline-none"
        aria-label="Dismiss GitHub setup nudge"
      >
        ✕
      </button>
    </div>
  )
}
