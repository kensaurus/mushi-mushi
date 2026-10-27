/**
 * Inline CI status for a fix attempt — pull latest from GitHub on demand and
 * link out to the PR checks tab for full logs.
 *
 * ADR 0033: a test machine that stopped, or a job no machine picked up, reads
 * as a warning ("your fix was not tested") with a Re-run, never as a failed
 * fix. A job still waiting shows its place in the queue when the CI overview
 * can tell it, and links to /ci focused on that job.
 *
 * A genuinely red head (the code failed) names those checks and offers
 * Re-run and Send to CI repair, the same actions /pipeline offers
 * (report 9e2ec6f0). The names are the live GitHub list from
 * GET /v1/admin/pipeline/fix/:id.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { RelativeTime } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { readFixCi, rerunErrorText, type CiTone } from '../../lib/ciInfra'
import type { CiInfraVerdict, CiOverview, CiRerunResult } from '../../lib/ciTypes'
import { queuePositionForPr, queuePositionLine, repoFromPrUrl, type CiQueuePosition } from '../../lib/ciView'
import { loadPipelineFix, runPipelineAction } from '../../lib/pipeline'
import { PipelineActionDialog } from '../pipeline/PipelineActionDialog'

interface Props {
  fixId: string
  prUrl: string
  prNumber?: number | null
  ciConclusion?: string | null
  ciStatus?: string | null
  ciUpdatedAt?: string | null
  /** `fix_attempts.ci_infra` — the latest infra verdict for the PR head. */
  ciInfra?: CiInfraVerdict | null
  /** Project of the fix; lets a waiting job show its place in the queue. */
  projectId?: string | null
  onRefresh?: (next: { conclusion: string | null; status: string | null; updatedAt: string | null }) => void
  compact?: boolean
}

function checksUrl(prUrl: string): string {
  return prUrl.endsWith('/checks') ? prUrl : `${prUrl.replace(/\/$/, '')}/checks`
}

const TONE_CLASS: Record<CiTone, string> = {
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
  neutral: CHIP_TONE.neutral,
}

export function FixCiFeedback({
  fixId,
  prUrl,
  prNumber,
  ciConclusion,
  ciStatus,
  ciUpdatedAt,
  ciInfra,
  projectId,
  onRefresh,
  compact = false,
}: Props) {
  const [conclusion, setConclusion] = useState(ciConclusion ?? null)
  const [status, setStatus] = useState(ciStatus ?? null)
  const [infra, setInfra] = useState<CiInfraVerdict | null>(ciInfra ?? null)
  const [updatedAt, setUpdatedAt] = useState(ciUpdatedAt ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [queue, setQueue] = useState<CiQueuePosition | null>(null)
  const [failingChecks, setFailingChecks] = useState<string[]>([])
  const [repairing, setRepairing] = useState(false)
  const [confirmRepair, setConfirmRepair] = useState(false)

  const reading = readFixCi({ check_run_conclusion: conclusion, check_run_status: status, ci_infra: infra })
  const repo = repoFromPrUrl(prUrl)
  const waiting = reading.state === 'waiting_for_runner' || status?.toLowerCase() === 'queued'
  const ciRed = reading.state === 'code_failure' || reading.state === 'timed_out'

  // Place in the queue, read once from the CI overview while the PR waits.
  useEffect(() => {
    if (!waiting || !projectId || !prNumber) return
    let cancelled = false
    void apiFetch<CiOverview>(`/v1/admin/ci/overview?project_id=${encodeURIComponent(projectId)}&days=1&refresh=1`).then((res) => {
      if (cancelled || !res.ok || !res.data) return
      setQueue(queuePositionForPr(res.data.jobs, { repo, prNumber }, Date.now()))
    })
    return () => {
      cancelled = true
    }
  }, [waiting, projectId, prNumber, repo])

  // Live failing-check names for a red head. The report page's chip is
  // compact, so the names have to sit on the chip itself.
  useEffect(() => {
    if (!ciRed) {
      setFailingChecks([])
      return
    }
    let cancelled = false
    void loadPipelineFix(fixId).then((view) => {
      if (cancelled) return
      setFailingChecks(view?.item?.failingChecks ?? [])
    }).catch(() => {
      if (!cancelled) setFailingChecks([])
    })
    return () => {
      cancelled = true
    }
  }, [ciRed, fixId, updatedAt])

  const handleRefresh = async () => {
    setRefreshing(true)
    setError(null)
    setNotice(null)
    const res = await apiFetch<{
      check_run_conclusion?: string | null
      check_run_status?: string | null
      check_run_updated_at?: string | null
      ci_infra?: CiInfraVerdict | null
    }>(`/v1/admin/fixes/${fixId}/refresh-ci`, { method: 'POST' })
    setRefreshing(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not refresh CI')
      return
    }
    const next = {
      conclusion: res.data?.check_run_conclusion ?? null,
      status: res.data?.check_run_status ?? null,
      updatedAt: res.data?.check_run_updated_at ?? new Date().toISOString(),
    }
    setConclusion(next.conclusion)
    setStatus(next.status)
    setUpdatedAt(next.updatedAt)
    // An older server omits ci_infra; keep what we had rather than clear it.
    if (res.data && 'ci_infra' in res.data) setInfra(res.data.ci_infra ?? null)
    onRefresh?.(next)
  }

  const handleRerun = async () => {
    setRerunning(true)
    setError(null)
    setNotice(null)
    const res = await apiFetchMutate<CiRerunResult>(`/v1/admin/fixes/${fixId}/ci/rerun`, { method: 'POST', body: '{}' })
    setRerunning(false)
    if (!res.ok) {
      setError(rerunErrorText(res.error?.code, res.error?.message))
      return
    }
    setInfra(null)
    setConclusion(null)
    setStatus('queued')
    setUpdatedAt(new Date().toISOString())
    setNotice('Tests started again. This page shows the result once GitHub reports it.')
  }

  const handleRepair = async () => {
    setRepairing(true)
    setError(null)
    setNotice(null)
    try {
      const out = await runPipelineAction('ci_repair', [fixId])
      const first = out[0]
      if (first?.ok) setNotice(first.message)
      else setError(first?.message ?? 'Could not send this to CI repair')
    } finally {
      setRepairing(false)
      setConfirmRepair(false)
    }
  }

  const ghChecks = checksUrl(prUrl)
  const ciLink = queue ? `/ci?job=${encodeURIComponent(queue.jobId)}` : '/ci'
  const showRerun = reading.canRerun || reading.infra || ciRed
  const showRepair = ciRed
  const rerunBlocked = reading.state === 'waiting_for_runner' || reading.state === 'running'
  const failingLabel = failingChecks.length > 0 ? ` · ${failingChecks.slice(0, 8).join(', ')}` : ''

  return (
    <div
      className={
        compact
          ? 'space-y-1'
          : 'rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2.5 py-2 space-y-1.5'
      }
      data-testid="fix-ci-feedback"
      data-ci-state={reading.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium ${TONE_CLASS[reading.tone]}`}
        >
          {reading.infra && <span aria-hidden="true">⚠</span>}
          {reading.label}
          {prNumber ? ` · PR #${prNumber}` : ''}
          {failingLabel}
        </span>
        {updatedAt && (
          <span className="text-2xs text-fg-faint">
            synced <RelativeTime value={updatedAt} />
          </span>
        )}
      </div>

      {(!compact || reading.infra) && (
        <p className="text-2xs text-fg-muted leading-relaxed" role={reading.infra ? 'status' : undefined}>
          {reading.detail}
          {reading.state === 'passed' && !compact ? ' Safe to squash-merge from the console.' : ''}
        </p>
      )}

      {waiting && queue && <p className="text-2xs text-fg-secondary">{queuePositionLine(queue, repo)}</p>}

      <div className="flex flex-wrap items-center gap-2 text-2xs">
        {showRerun && (
          <>
            <button
              type="button"
              onClick={() => void handleRerun()}
              disabled={rerunning || rerunBlocked}
              title={rerunBlocked ? 'Tests are still waiting or running; re-run once they stop.' : undefined}
              className="font-medium text-accent hover:underline disabled:opacity-50"
            >
              {rerunning ? 'Re-running tests…' : 'Re-run tests'}
            </button>
            <span aria-hidden="true" className="text-fg-faint select-none">·</span>
          </>
        )}
        {showRepair && (
          <>
            <button
              type="button"
              onClick={() => setConfirmRepair(true)}
              disabled={repairing}
              className="font-medium text-accent hover:underline disabled:opacity-50"
            >
              {repairing ? 'Sending to CI repair…' : 'Send to CI repair'}
            </button>
            <span aria-hidden="true" className="text-fg-faint select-none">·</span>
          </>
        )}
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="font-medium text-accent hover:underline disabled:opacity-50"
        >
          {refreshing ? 'Refreshing CI…' : 'Refresh CI status'}
        </button>
        <span aria-hidden="true" className="text-fg-faint select-none">·</span>
        <a
          href={ghChecks}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent hover:underline"
        >
          View GitHub Actions log →
        </a>
        {(reading.infra || waiting) && (
          <>
            <span aria-hidden="true" className="text-fg-faint select-none">·</span>
            <Link to={ciLink} className="font-medium text-accent hover:underline">
              See CI runners
            </Link>
          </>
        )}
      </div>

      {notice && <p className="text-2xs text-fg-secondary" role="status">{notice}</p>}
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
      {confirmRepair && (
        <PipelineActionDialog
          pending={{ action: 'ci_repair', fixIds: [fixId], target: prNumber ? `PR #${prNumber}` : 'this pull request' }}
          busy={repairing}
          onConfirm={() => void handleRepair()}
          onCancel={() => setConfirmRepair(false)}
        />
      )}
    </div>
  )
}
