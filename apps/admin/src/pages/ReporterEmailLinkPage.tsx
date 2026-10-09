/**
 * FILE: apps/admin/src/pages/ReporterEmailLinkPage.tsx
 * PURPOSE: Public `/email/reporter?action=verify|unsubscribe&t=…` — the page
 *          an app's end user opens from a report-update email (Plan 018 §4.1).
 *          Not auth-gated: the token in the link is the credential.
 *
 * Neutral on purpose: the person here is a user of someone else's app, not a
 * Mushi customer, so there is no console chrome or branding. Nothing is
 * written until they click the button (mail scanners only load the page).
 */

import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Btn } from '../components/ui'
import { RESOLVED_API_URL } from '../lib/env'
import {
  REPORTER_EMAIL_COPY,
  parseReporterEmailLink,
  submitReporterEmailLink,
  type ReporterEmailOutcome,
} from '../lib/reporterEmailLink'

export function ReporterEmailLinkPage() {
  const { search } = useLocation()
  const link = parseReporterEmailLink(search)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ReporterEmailOutcome | null>(null)

  const copy = link ? REPORTER_EMAIL_COPY[link.action] : null
  const title = !link
    ? 'This link is not valid'
    : outcome?.ok
      ? outcome.title
      : copy?.title

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <main className="w-full max-w-sm rounded-lg border border-edge-subtle bg-surface p-6 space-y-3">
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        {!link ? (
          <p className="text-sm text-fg-secondary">
            It may have been cut off by your mail client. Open the latest email and use its link instead.
          </p>
        ) : outcome?.ok ? (
          <p className="text-sm text-fg-secondary" role="status">
            {outcome.message}
          </p>
        ) : (
          <>
            <p className="text-sm text-fg-secondary">{copy?.body}</p>
            {outcome && !outcome.ok && (
              <p className="text-sm text-danger" role="alert">
                {outcome.message}
              </p>
            )}
            <Btn
              loading={busy}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setOutcome(await submitReporterEmailLink(RESOLVED_API_URL, link))
                setBusy(false)
              }}
            >
              {copy?.button}
            </Btn>
          </>
        )}
      </main>
    </div>
  )
}
