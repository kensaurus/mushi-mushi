/**
 * FILE: apps/admin/src/components/iterate/PdcaStatusBanner.tsx
 * PURPOSE: Surface PDCA pipeline health — active runs, failures, empty project state.
 */

import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="warn"
        pulseDot
        title={`${active.length} run${active.length === 1 ? '' : 's'} in progress`}
        subtitle="Producer → critic loop is running. This page auto-refreshes every 4s until complete."
        action={
          <span className="font-mono text-3xs text-fg-faint shrink-0">
            {active.filter((r) => r.status === 'running').length} running ·{' '}
            {active.filter((r) => r.status === 'queued').length} queued
          </span>
        }
      />
    )
  }

  if (lastFailed) {
    return (
      <StatusBannerShell
        tone="danger"
        title="Latest run failed"
        subtitle={`${lastFailed.target_url} — open the run to inspect iterations, then queue a new run or trigger retry.`}
      />
    )
  }

  if (runs.length === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={projectName ? `No PDCA runs for ${projectName} yet` : 'No PDCA runs yet'}
        subtitle="Queue a run with a target URL and critic persona — the runner fetches the page and iterates until the score target or max iterations."
      />
    )
  }

  const succeeded = runs.filter((r) => r.status === 'succeeded').length
  return (
    <StatusBannerShell
      tone="ok"
      title="Pipeline idle"
      subtitle={`${runs.length} run${runs.length === 1 ? '' : 's'} on file · ${succeeded} succeeded${projectName ? ` · scoped to ${projectName}` : ''}.`}
    />
  )
}
