/**
 * FILE: apps/admin/src/components/health/PipelineRecoveryPanel.tsx
 * PURPOSE: Reports stuck before triage, and the button that recovers them, on
 *          /health (console 2026-11-19: a stuck state needs a working button in
 *          the same spot). It runs the same recovery as the 5-minute cron, for
 *          this app only, and shows what it did inline:
 *
 *            ◆ 3 reports stuck before triage · 1 failed job   [Run recovery now]
 *              Re-sent 3 stuck reports to triage, retried 1 failed job.
 *
 *          `alert` (overview tab) draws only while something is stuck; `row`
 *          (Scheduled jobs tab) always draws, with "Nothing stuck" when calm.
 *
 * Data: GET /v1/admin/queue/stats (this app: the project header narrows it,
 *       the same scope the trigger acts on), POST
 *       /v1/admin/health/cron/pipeline-recovery/trigger (owners and admins).
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { StatusMark, STATUS_INK, type RunStatus } from '../signal/StatusMark'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { ADMIN_ONLY_HINT } from '../../lib/orgPermissions'

interface QueueStats {
  hasAnyProject: boolean
  strandedReports: number
  retryableFailed: number
  stalePending: number
  recoverable: number
}

interface RecoverResult {
  reports: number
  queue: number
  reconciled: number
  message: string
}

/** "3 reports stuck before triage · 1 failed job · 2 jobs waiting 15 min+" (zero parts dropped). @internal Exported for tests. */
export function stuckSummary(s: Pick<QueueStats, 'strandedReports' | 'retryableFailed' | 'stalePending'>): string {
  const parts: string[] = []
  if (s.strandedReports > 0) parts.push(`${s.strandedReports} report${s.strandedReports === 1 ? '' : 's'} stuck before triage`)
  if (s.retryableFailed > 0) parts.push(`${s.retryableFailed} failed job${s.retryableFailed === 1 ? '' : 's'} with tries left`)
  if (s.stalePending > 0) parts.push(`${s.stalePending} job${s.stalePending === 1 ? '' : 's'} waiting 15 min+`)
  return parts.length ? parts.join(' · ') : 'Nothing stuck before triage'
}

export function PipelineRecoveryPanel({ canRun, variant }: { canRun: boolean; variant: 'alert' | 'row' }) {
  const { data, reload } = usePageData<QueueStats>('/v1/admin/queue/stats')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (!data || !data.hasAnyProject) return null
  const stuck = data.recoverable > 0
  if (variant === 'alert' && !stuck && !result) return null
  const status: RunStatus = stuck ? (data.strandedReports > 0 || data.retryableFailed > 0 ? 'failed' : 'slow') : 'passed'

  const run = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await apiFetch<RecoverResult>('/v1/admin/health/cron/pipeline-recovery/trigger', { method: 'POST' })
      setResult(res.ok && res.data ? { ok: true, message: res.data.message } : { ok: false, message: res.error?.message ?? 'Recovery did not run. Try again in a minute.' })
    } catch {
      setResult({ ok: false, message: 'Could not reach Mushi Mushi. Check your connection and retry.' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${variant === 'alert' ? `mb-3 rounded-md border border-l-4 border-edge-subtle bg-surface-raised px-2.5 py-2 ${status === 'failed' ? 'border-l-st-failed' : status === 'slow' ? 'border-l-st-slow' : 'border-l-st-passed'}` : 'py-2'}`}
      data-testid={`pipeline-recovery-${variant}`}
      data-status={status}
    >
      <StatusMark status={status} />
      <span className={`text-xs font-semibold ${STATUS_INK[status]}`}>{stuckSummary(data)}</span>
      {(stuck || variant === 'row') && (
        <Btn
          size="sm"
          variant={stuck ? 'primary' : 'ghost'}
          loading={busy}
          disabled={!canRun || busy}
          onClick={() => void run()}
          title={canRun ? 'Re-sends stuck reports to triage for this app; it spends AI budget.' : ADMIN_ONLY_HINT}
          data-testid="pipeline-recovery-run"
        >
          Run recovery now
        </Btn>
      )}
      {!canRun && <span className="text-2xs text-fg-muted">{ADMIN_ONLY_HINT}</span>}
      {result && (
        <span className={`basis-full text-2xs ${result.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid="pipeline-recovery-result">
          {result.message}
        </span>
      )}
    </div>
  )
}
