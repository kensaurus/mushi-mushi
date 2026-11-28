/**
 * FILE: apps/admin/src/components/onboarding/TimeToFirstDiagnosisCard.tsx
 * PURPOSE: Verify-tab card for the time from making a key to the first
 *          plain-English diagnosis. Target is under 2 minutes.
 *
 * OVERVIEW:
 * - A real report shows the elapsed time, via setupRail's formatter (past a
 *   day it reads as days). Once that report has arrived the number is
 *   history: a slow first install stays neutral, never an info or amber
 *   warning (round-3 review, 2026-11-19).
 * - A diagnosed test or seed report, and nothing from the app yet, says the
 *   pipeline works and points at the SDK (report 9b7624e6). Another test
 *   report does not start the clock.
 * - Otherwise it waits. The read refetches when a test report is sent or a
 *   report row changes (useTimeToFirstDiagnosis), so this wait ends once that
 *   test report is classified.
 *
 * DEPENDENCIES:
 * - useTimeToFirstDiagnosis, formatDiagnosisDuration, Card, Btn
 */

import { Btn, Card } from '../ui'
import { formatDiagnosisDuration } from '../../lib/setupRail'
import { useTimeToFirstDiagnosis } from '../../lib/useTimeToFirstDiagnosis'

export function TimeToFirstDiagnosisCard({ hasApiKey, onOpenSdk }: { hasApiKey: boolean; onOpenSdk: () => void }) {
  const { data, loading } = useTimeToFirstDiagnosis()
  if (!hasApiKey || loading) return null

  const ms = data?.ms ?? null
  const TARGET_MS = 2 * 60 * 1000

  if (ms != null) {
    const underTarget = ms <= TARGET_MS
    return (
      // Once the first report has arrived this is history, and nothing can change it: a slow first
      // install stays neutral, never an amber warning (round-3 review, 2026-11-19).
      <Card className={`p-5 ${underTarget ? 'border border-ok/30 bg-ok/5' : ''}`} data-testid="ttfd-measured">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-3xs font-semibold text-fg-secondary">First report in your queue</p>
            <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${underTarget ? 'text-ok' : 'text-fg'}`}>
              {formatDiagnosisDuration(ms)}
            </p>
          </div>
          <span className={`text-2xs font-medium ${underTarget ? 'text-ok' : 'text-fg-muted'}`}>
            {underTarget ? 'Under the 2-minute target ✓' : 'Target: under 2 minutes'}
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted leading-relaxed">
          From making your key to your first plain-English read of a bug from your app.
        </p>
      </Card>
    )
  }

  // Only test or seed reports so far: the pipeline works, and the clock is
  // still waiting on the app (report 9b7624e6). Sending another test report
  // never clears this card, so it points at the SDK instead.
  if (data?.testDiagnosisAt) {
    return (
      <Card className="p-5 border border-ok/25 bg-ok/5" data-testid="ttfd-test-only">
        <p className="text-3xs font-semibold text-fg-secondary">First report from your app</p>
        <p className="mt-0.5 text-sm text-fg-secondary">Your test bug got its plain-English read, so Mushi Mushi works for this app.</p>
        <p className="mt-1 text-xs text-fg-muted leading-relaxed">
          The 2-minute clock starts with the first report from your app. Install the SDK, then report a bug from your
          app with its bug button.
        </p>
        <Btn size="sm" variant="ghost" className="mt-2" onClick={onOpenSdk}>
          Install the SDK
        </Btn>
      </Card>
    )
  }

  return (
    <Card className="p-5 border border-edge-subtle" data-testid="ttfd-waiting">
      <p className="text-3xs font-semibold text-fg-secondary">First report from your app</p>
      <p className="mt-0.5 text-sm text-fg-secondary">Waiting on the first report from your app.</p>
      <p className="mt-1 text-xs text-fg-muted leading-relaxed">
        Send a test bug below, then report a bug from your app. Target: a plain-English read in under 2 minutes
        from making the key.
      </p>
    </Card>
  )
}
