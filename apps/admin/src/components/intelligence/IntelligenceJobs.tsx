/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceJobs.tsx
 * PURPOSE: Two related views of LLM digest generation jobs:
 *            - ActiveJobCard: live "in progress" card with cancel button.
 *            - RecentJobsList: trailing 5 jobs with status + duration.
 *            - LastFailureNote: terse error nag when the most recent run died.
 *          Kept in one file because they share the same JOB_STATUS_TONE table
 *          and are always rendered together.
 */

import { Card, Btn, Badge, RelativeTime } from '../ui'
import { JOB_STATUS_TONE, type IntelligenceJob } from './types'

interface ActiveJobProps {
  job: IntelligenceJob
  onCancel: () => void
}

export function ActiveJobCard({ job, onCancel }: ActiveJobProps) {
  return (
    <Card elevated className="p-3 border border-brand/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-fg">Generation in progress</span>
            <Badge className={JOB_STATUS_TONE[job.status]}>{job.status}</Badge>
          </div>
          <p className="text-2xs text-fg-muted">
            Started <RelativeTime value={job.started_at ?? job.created_at} />
            {' · '}LLM call typically takes 20–60s
          </p>
          <div className="mt-2 h-1 rounded-full bg-edge-subtle overflow-hidden">
            <div className="h-full w-1/3 bg-brand animate-pulse rounded-full" />
          </div>
        </div>
        <Btn variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </Card>
  )
}

interface FailureNoteProps {
  jobs: IntelligenceJob[]
}

export function LastFailureNote({ jobs }: FailureNoteProps) {
  const lastFailed = jobs.find((j) => j.status === 'failed')
  if (!lastFailed) return null
  return (
    <Card className="p-3 border border-danger/30 bg-danger/5">
      <div className="text-xs font-semibold text-danger mb-1">Last generation failed</div>
      <p className="text-2xs text-fg-muted">
        {lastFailed.error ?? 'Unknown error.'}{' '}
        Check Settings → LLM Keys to confirm your BYOK key is valid, then retry.
      </p>
    </Card>
  )
}

interface RecentJobsProps {
  jobs: IntelligenceJob[]
}

export function RecentJobsList({ jobs }: RecentJobsProps) {
  if (jobs.length === 0) return null
  return (
    <Card className="p-3">
      <h3 className="text-2xs uppercase tracking-wider text-fg-muted mb-1.5">
        Recent generation jobs
      </h3>
      <ul className="space-y-1 text-2xs">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="flex items-center justify-between gap-2 border-t border-edge-subtle pt-1 first:border-0 first:pt-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge className={JOB_STATUS_TONE[j.status]}>{j.status}</Badge>
              <span className="text-fg-muted">
                Started <RelativeTime value={j.started_at ?? j.created_at} />
              </span>
              {j.finished_at && j.started_at && (
                <span className="text-fg-faint font-mono">
                  {Math.round(
                    (new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000,
                  )}
                  s
                </span>
              )}
            </div>
            {j.error && (
              <span className="text-danger truncate max-w-md" title={j.error}>
                {j.error}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
