/**
 * FILE: apps/admin/src/components/onboarding/TimeToFirstDiagnosisCard.tsx
 * PURPOSE: Verify-tab card for the time from making a key to the first
 *          plain-English diagnosis. Target is under 2 minutes.
 *
 * OVERVIEW:
 * - A real report shows the elapsed time.
 * - A diagnosed test or seed report, and nothing from the app yet, says the
 *   pipeline works and points at the SDK (report 9b7624e6). Another test
 *   report does not start the clock.
 * - Otherwise it waits. The read refetches when a test report is sent or a
 *   report row changes (useTimeToFirstDiagnosis), so this wait ends once that
 *   test report is classified.
 *
 * DEPENDENCIES:
 * - useTimeToFirstDiagnosis, Card, Btn
 */

import { Btn, Card } from '../ui'
import { useTimeToFirstDiagnosis } from '../../lib/useTimeToFirstDiagnosis'

/** Format a millisecond interval as a short human string ("1m 48s", "42s"). */
function formatDiagnosisDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export function TimeToFirstDiagnosisCard({ hasApiKey, onOpenSdk }: { hasApiKey: boolean; onOpenSdk: () => void }) {
  const { data, loading } = useTimeToFirstDiagnosis()
  if (!hasApiKey || loading) return null

  const ms = data?.ms ?? null
  const TARGET_MS = 2 * 60 * 1000

  if (ms != null) {
    const underTarget = ms <= TARGET_MS
    return (
      <Card className={`p-5 ${underTarget ? 'border border-ok/30 bg-ok/5' : 'border border-info/25 bg-info/5'}`}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report in your queue</p>
            <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${underTarget ? 'text-ok' : 'text-fg'}`}>
              {formatDiagnosisDuration(ms)}
            </p>
          </div>
          <span className={`text-2xs font-medium ${underTarget ? 'text-ok' : 'text-info'}`}>
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
        <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report from your app</p>
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
      <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report from your app</p>
      <p className="mt-0.5 text-sm text-fg-secondary">Waiting on the first report from your app.</p>
      <p className="mt-1 text-xs text-fg-muted leading-relaxed">
        Send a test bug below, then report a bug from your app. Target: a plain-English read in under 2 minutes
        from making the key.
      </p>
    </Card>
  )
}
