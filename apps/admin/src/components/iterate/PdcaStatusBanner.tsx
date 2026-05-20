/**
 * FILE: apps/admin/src/components/iterate/PdcaStatusBanner.tsx
 * PURPOSE: Surface PDCA pipeline health — active runs, failures, empty project state.
 */

import type { PdcaRun } from './types'

interface Props {
  runs: PdcaRun[]
  projectName: string | null
}

export function PdcaStatusBanner({ runs, projectName }: Props) {
  const active = runs.filter((r) => r.status === 'running' || r.status === 'queued')
  const lastFailed = runs.find((r) => r.status === 'failed') ?? null

  if (active.length > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn motion-safe:animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {active.length} run{active.length === 1 ? '' : 's'} in progress
            </p>
            <p className="text-2xs text-fg-muted">
              Producer → critic loop is running. This page auto-refreshes every 4s until complete.
            </p>
          </div>
        </div>
        <span className="font-mono text-3xs text-fg-faint shrink-0">
          {active.filter((r) => r.status === 'running').length} running ·{' '}
          {active.filter((r) => r.status === 'queued').length} queued
        </span>
      </div>
    )
  }

  if (lastFailed) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <div>
          <p className="text-xs font-medium text-danger">Latest run failed</p>
          <p className="text-2xs text-fg-muted">
            {lastFailed.target_url} — open the run to inspect iterations, then queue a new run or trigger retry.
          </p>
        </div>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2.5">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
        <div>
          <p className="text-xs font-medium text-info">
            {projectName ? `No PDCA runs for ${projectName} yet` : 'No PDCA runs yet'}
          </p>
          <p className="text-2xs text-fg-muted">
            Queue a run with a target URL and critic persona — the runner fetches the page and iterates until the score target or max iterations.
          </p>
        </div>
      </div>
    )
  }

  const succeeded = runs.filter((r) => r.status === 'succeeded').length
  return (
    <div className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
      <div>
        <p className="text-xs font-medium text-ok">Pipeline idle</p>
        <p className="text-2xs text-fg-muted">
          {runs.length} run{runs.length === 1 ? '' : 's'} on file · {succeeded} succeeded
          {projectName ? ` · scoped to ${projectName}` : ''}.
        </p>
      </div>
    </div>
  )
}
