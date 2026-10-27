/**
 * FILE: apps/admin/src/components/ci/CiCostFixButton.tsx
 * PURPOSE: "Open fix PR" on a CI advice card (ADR 0047). A confirm dialog
 *          says which workflow file changes and that the result is a DRAFT
 *          pull request to review; then the job's progress, the PR link and,
 *          once the PR merged, the saving Mushi measured (billed minutes per
 *          day after the merge against the 14 days before). Errors read in
 *          plain words: no GitHub write access, a refused edit, already
 *          applied.
 *
 *          `useCostFixJobs` loads each project's recent jobs once, so a PR
 *          opened earlier shows its state after a reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import type { CiAdviceFixable } from '../../lib/ciAdvice'
import {
  CI_COST_FIX_CHANGE,
  costFixErrorText,
  costFixSavingText,
  costFixStatusText,
  isCostFixInFlight,
  type CiCostFixJob,
} from '../../lib/ciCostFix'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn, CodeChip } from '../ui'
import { IconExternalLink } from '../icons'

/** How often a job in flight is read again. */
const COST_FIX_POLL_MS = 3_000

/** The key a job and an advice target share. */
export function costFixKey(f: { projectId: string; repo: string; workflowPath: string; kind: string }): string {
  return `${f.projectId}:${f.repo.toLowerCase()}:${f.workflowPath}:${f.kind}`
}

/** Each project's jobs, newest first, keyed by `costFixKey` (the newest per key wins). */
export function useCostFixJobs(projectIds: readonly string[]): Map<string, CiCostFixJob> {
  const [jobs, setJobs] = useState<Map<string, CiCostFixJob>>(() => new Map())
  const ids = [...new Set(projectIds)].sort().join(',')
  useEffect(() => {
    if (!ids) return
    let live = true
    void Promise.all(
      ids.split(',').map((id) => apiFetch<{ jobs: CiCostFixJob[] }>(`/v1/admin/ci/cost-fixes?project_id=${encodeURIComponent(id)}`, { cache: 'no-store' })),
    ).then((results) => {
      if (!live) return
      const next = new Map<string, CiCostFixJob>()
      for (const r of results) {
        for (const job of r.ok ? (r.data?.jobs ?? []) : []) {
          const key = costFixKey(job)
          if (!next.has(key)) next.set(key, job)
        }
      }
      setJobs(next)
    })
    return () => {
      live = false
    }
  }, [ids])
  return jobs
}

export function CiCostFixButton({ fixable, initialJob = null }: { fixable: CiAdviceFixable; initialJob?: CiCostFixJob | null }) {
  const { autofix } = fixable
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<CiCostFixJob | null>(initialJob)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialJob && !job) setJob(initialJob)
  }, [initialJob, job])

  const readIds = useRef(new Set<string>())
  const refresh = useCallback(async (id: string) => {
    readIds.current.add(id)
    const res = await apiFetch<{ job: CiCostFixJob }>(`/v1/admin/ci/cost-fixes/${id}`, { cache: 'no-store' })
    if (res.ok && res.data?.job) setJob(res.data.job)
    return res.ok
  }, [])

  // The list does not look at GitHub. Read an opened PR's job once by id, so
  // the card notices a merge and shows the saving measured since.
  useEffect(() => {
    if (!job || job.status !== 'pr_opened' || job.closedAt || job.measured?.complete) return
    if (readIds.current.has(job.id)) return
    void refresh(job.id)
  }, [job, refresh])

  // Read a job in flight again until the worker finishes it.
  useEffect(() => {
    if (!job || !isCostFixInFlight(job)) return
    const t = setTimeout(() => void refresh(job.id), COST_FIX_POLL_MS)
    return () => clearTimeout(t)
  }, [job, refresh])

  async function open() {
    setBusy(true)
    setError(null)
    const res = await apiFetchMutate<{ job: CiCostFixJob }>('/v1/admin/ci/cost-fixes', {
      method: 'POST',
      body: JSON.stringify({
        projectId: autofix.projectId,
        repo: autofix.repo,
        workflowPath: autofix.workflowPath,
        kind: autofix.kind,
        evidence: fixable.evidence.slice(0, 2000),
        ...(fixable.monthSavingUsd != null && fixable.monthSavingUsd >= 0 ? { monthSavingUsd: fixable.monthSavingUsd } : {}),
      }),
    })
    setBusy(false)
    setConfirming(false)
    if (res.ok && res.data?.job) {
      setJob(res.data.job)
      return
    }
    if (res.data?.job) {
      // PR_ALREADY_OPEN carries the job that opened it.
      setJob(res.data.job)
      return
    }
    setError(costFixErrorText(res.error?.code, res.error?.message))
  }

  const inFlight = isCostFixInFlight(job)
  const prOpen = job?.status === 'pr_opened' && !job.closedAt
  const saving = job ? costFixSavingText(job) : null
  const canOpen = !inFlight && !prOpen && job?.status !== 'no_change'

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="ci-cost-fix">
      <div className="flex flex-wrap items-center gap-1.5">
        {canOpen && (
          <Btn size="sm" variant="accent" onClick={() => setConfirming(true)} loading={busy} aria-label={`Open fix PR for ${fixable.label}`}>
            Open fix PR
          </Btn>
        )}
        <CodeChip title={`${autofix.repo}/${autofix.workflowPath}`} maxWidthClass="max-w-full">
          {fixable.label}
        </CodeChip>
        {fixable.monthSavingUsd != null && fixable.monthSavingUsd > 0 && !job?.mergedAt && (
          <span className="text-2xs text-fg-muted">saves about ${fixable.monthSavingUsd.toFixed(2)}/mo (estimated)</span>
        )}
        {job?.prUrl && (
          <a
            href={job.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-2xs text-brand hover:underline"
          >
            {job.prNumber ? `PR #${job.prNumber}` : 'Pull request'}
            <IconExternalLink size={11} />
          </a>
        )}
        {prOpen && !job?.mergedAt && (
          <Btn size="sm" variant="ghost" onClick={() => void refresh(job!.id)}>
            Check again
          </Btn>
        )}
      </div>
      {job && (
        <p
          role="status"
          className={`wrap-break-word text-2xs ${job.status === 'failed' || job.status === 'refused' ? 'text-danger' : 'text-fg-secondary'}`}
        >
          {costFixStatusText(job)}
        </p>
      )}
      {saving && <p className="wrap-break-word text-2xs font-medium text-ok">{saving}</p>}
      {error && (
        <p role="alert" className="wrap-break-word text-2xs text-danger">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Open a draft fix PR?"
          body={CI_COST_FIX_CHANGE[autofix.kind]}
          details={
            <p className="wrap-break-word">
              Mushi changes one file, <code className="font-mono">{autofix.workflowPath}</code> in{' '}
              <code className="font-mono">{autofix.repo}</code>, and opens it as a <strong>draft</strong> pull request.
              Nothing changes until you review it, mark it ready and merge it.
            </p>
          }
          confirmLabel="Open draft PR"
          loading={busy}
          onConfirm={open}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
