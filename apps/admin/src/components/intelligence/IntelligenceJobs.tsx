/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceJobs.tsx
 * PURPOSE: LLM digest generation jobs — active card, failure nag, recent list.
 */

import { Card, Btn, Badge, RelativeTime, EmptyState } from '../ui'
import { JOB_STATUS_TONE, type IntelligenceJob } from './types'

interface ActiveJobProps {
  job: IntelligenceJob
  onCancel: () => void
}

function elapsedSeconds(job: IntelligenceJob): number | null {
  const start = job.started_at ?? job.created_at
  if (!start) return null
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now()
  return Math.max(0, Math.round((end - new Date(start).getTime()) / 1000))
}

export function ActiveJobCard({ job, onCancel }: ActiveJobProps) {
  const elapsed = elapsedSeconds(job)
  return (
    <Card elevated className="border border-brand/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-fg">Generation in progress</span>
            <Badge className={JOB_STATUS_TONE[job.status]}>{job.status}</Badge>
            <span className="font-mono text-3xs text-fg-faint" title={job.id}>
              {job.id.slice(0, 8)}…
            </span>
          </div>
          <p className="text-2xs text-fg-muted">
            {job.trigger === 'manual' ? 'Manual run' : 'Scheduled cron'}
            {' · '}Started <RelativeTime value={job.started_at ?? job.created_at} />
            {elapsed != null && (
              <span className="font-mono tabular-nums text-fg-faint"> · {elapsed}s elapsed</span>
            )}
          </p>
          <p className="mt-1 text-2xs text-fg-faint">
            Typical runtime 20–60s. The page refreshes automatically while this job is queued or running.
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-edge-subtle">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand motion-safe:transition-[transform,opacity]" />
          </div>
        </div>
        <Btn variant="danger" size="sm" onClick={onCancel} className="shrink-0">
          Cancel job
        </Btn>
      </div>
    </Card>
  )
}

interface FailureNoteProps {
  jobs: IntelligenceJob[]
  onRetry?: () => void
  retrying?: boolean
}

function failureHint(error: string | null | undefined): string {
  const raw = error ?? ''
  if (raw.includes('UNAUTHORIZED_INVALID_JWT_FORMAT')) {
    return (
      'The edge gateway rejected the internal service call (JWT format). ' +
      'This is usually fixed by redeploying intelligence-report with verify_jwt disabled — retry generation; ' +
      'if it persists, contact support.'
    )
  }
  if (raw.toLowerCase().includes('anthropic') || raw.toLowerCase().includes('api key')) {
    return 'Check Settings → LLM Keys for a valid Anthropic BYOK key, then retry.'
  }
  return 'Check Settings → LLM Keys for a valid BYOK key, then retry.'
}

export function LastFailureNote({ jobs, onRetry, retrying }: FailureNoteProps) {
  // Jobs are newest-first — only nag when the *latest* run failed, not a stale row
  // from before a successful retry (e.g. gateway JWT issue fixed by redeploy).
  const latest = jobs[0]
  if (!latest || latest.status !== 'failed') return null
  const lastFailed = latest
  const hint = failureHint(lastFailed.error)
  return (
    <Card className="border border-danger/30 bg-danger/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 text-xs font-semibold text-danger">Last generation failed</div>
          <p className="text-2xs text-fg-muted leading-relaxed">
            {lastFailed.error ?? 'Unknown error.'}
            {' '}
            {hint}
          </p>
          <p className="mt-1 font-mono text-3xs text-fg-faint">
            Job {lastFailed.id.slice(0, 8)}… · <RelativeTime value={lastFailed.finished_at ?? lastFailed.created_at} />
          </p>
        </div>
        {onRetry && (
          <Btn size="sm" variant="primary" onClick={onRetry} loading={retrying} className="shrink-0">
            Retry generation
          </Btn>
        )}
      </div>
    </Card>
  )
}

interface RecentJobsProps {
  jobs: IntelligenceJob[]
  projectName: string | null
  loading?: boolean
}

export function RecentJobsList({ jobs, projectName, loading }: RecentJobsProps) {
  if (loading) return null

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No generation jobs yet"
        description={
          projectName
            ? `No digest jobs recorded for ${projectName}. Click Generate this week to enqueue the first run.`
            : 'Generate a weekly digest to see job history here.'
        }
        hints={[
          'Jobs appear when you click Generate or when Monday cron runs',
          'Queued → running → completed usually takes under a minute',
          'Failed jobs show the LLM error message for debugging',
        ]}
      />
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-edge-subtle px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          Recent generation jobs
        </h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge-subtle bg-surface-raised/50 text-2xs text-fg-muted">
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Trigger</th>
            <th className="px-3 py-2 text-left font-medium">Started</th>
            <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Duration</th>
            <th className="px-3 py-2 text-left font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b border-edge-subtle last:border-0">
              <td className="px-3 py-2">
                <Badge className={JOB_STATUS_TONE[j.status]}>{j.status}</Badge>
              </td>
              <td className="px-3 py-2 text-2xs text-fg-muted">{j.trigger}</td>
              <td className="px-3 py-2 text-2xs text-fg-muted">
                <RelativeTime value={j.started_at ?? j.created_at} />
              </td>
              <td className="hidden px-3 py-2 font-mono text-2xs tabular-nums text-fg-faint sm:table-cell">
                {j.finished_at && j.started_at
                  ? `${Math.round((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000)}s`
                  : j.status === 'running' || j.status === 'queued'
                    ? '…'
                    : '—'}
              </td>
              <td className="max-w-56 truncate px-3 py-2 text-2xs text-danger" title={j.error ?? undefined}>
                {j.error ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

interface PipelineStatusBannerProps {
  activeJob: IntelligenceJob | null
  lastFailed: IntelligenceJob | null
  reportCount: number
  projectName: string | null
  benchmarkOptIn: boolean
}

export function PipelineStatusBanner({
  activeJob,
  lastFailed,
  reportCount,
  projectName,
  benchmarkOptIn,
}: PipelineStatusBannerProps) {
  if (activeJob) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden />
        <div>
          <p className="text-xs font-medium text-brand">Digest generation running</p>
          <p className="text-2xs text-fg-muted">
            Job {activeJob.id.slice(0, 8)}… is {activeJob.status}. Results appear below when complete.
          </p>
        </div>
      </div>
    )
  }

  if (lastFailed) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <div>
          <p className="text-xs font-medium text-danger">Last run failed</p>
          <p className="text-2xs text-fg-muted truncate" title={lastFailed.error ?? undefined}>
            {lastFailed.error ?? 'Check LLM keys and retry.'}
          </p>
        </div>
      </div>
    )
  }

  if (reportCount === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2.5">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
        <div>
          <p className="text-xs font-medium text-info">
            {projectName ? `No digests for ${projectName} yet` : 'No digests yet'}
          </p>
          <p className="text-2xs text-fg-muted">
            Monday cron writes automatically, or click Generate this week for an immediate run.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
      <div>
        <p className="text-xs font-medium text-ok">Pipeline healthy</p>
        <p className="text-2xs text-fg-muted">
          {reportCount} digest{reportCount === 1 ? '' : 's'} on file
          {benchmarkOptIn ? ' · benchmarking opted in' : ' · benchmarking off'}
          {projectName ? ` · scoped to ${projectName}` : ''}.
        </p>
      </div>
    </div>
  )
}
