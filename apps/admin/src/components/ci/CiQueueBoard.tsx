/**
 * FILE: apps/admin/src/components/ci/CiQueueBoard.tsx
 * PURPOSE: The CI queue on /ci — what is waiting for a test machine, what is
 *          running, and what finished in the last 2 hours — as three columns
 *          with counts in their headers. A card moves Waiting → Running →
 *          Finished with a shared-layout animation (instant under
 *          prefers-reduced-motion). Times tick every second while anything is
 *          live. Built from `CiOverview.jobs` only.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGroup, motion } from 'framer-motion'
import type { CiJob } from '../../lib/ciTypes'
import { buildCiQueue, fixLinkKey, formatSeconds, jobElapsedSeconds, waitingHint, type CiFixLinks } from '../../lib/ciView'
import { useNow } from '../../lib/useNow'
import { useMotionTransition } from '../../lib/useMotionTransition'
import { RelativeTime } from '../ui'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'

interface Props {
  jobs: CiJob[]
  fixLinks?: CiFixLinks
  /** Job to highlight and scroll to (from `/ci?job=`). */
  focusJobId?: string | null
}

type Column = 'waiting' | 'running' | 'finished'

const COLUMN_META: Record<Column, { title: string; empty: string }> = {
  waiting: { title: 'Waiting', empty: 'Nothing is waiting for a test machine.' },
  running: { title: 'Running', empty: 'Nothing is running right now.' },
  finished: { title: 'Finished (last 2 h)', empty: 'Nothing finished in the last 2 hours.' },
}

function JobCard({ job, column, now, fixLinks, focused }: { job: CiJob; column: Column; now: number; fixLinks?: CiFixLinks; focused: boolean }) {
  const transition = useMotionTransition()
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focused])
  const elapsed = jobElapsedSeconds(job, now)
  const reportId = job.prNumber != null ? fixLinks?.get(fixLinkKey(job.repo, job.prNumber)) : undefined
  const hint = column === 'waiting' ? waitingHint(job) : null

  return (
    <motion.li
      ref={ref}
      layout="position"
      layoutId={`ci-job-${job.id}`}
      transition={transition}
      data-testid={`ci-queue-job-${job.id}`}
      data-focused={focused || undefined}
      className={`flex flex-col gap-1 rounded-md border bg-surface-raised px-2.5 py-2 text-xs ${
        focused ? 'border-brand ring-2 ring-brand/40' : 'border-edge-subtle'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {column === 'finished' ? (
          <CiJobOutcomeChip job={job} />
        ) : (
          <CiJobOutcomeChip outcome={column} />
        )}
        <span className="min-w-0 truncate font-medium text-fg" title={job.jobName}>
          {job.workflowName ? `${job.workflowName} / ${job.jobName}` : job.jobName}
        </span>
      </div>
      <p className="min-w-0 truncate text-2xs text-fg-muted">
        {job.repo}
        {job.prNumber ? ` · PR #${job.prNumber}` : job.headBranch ? ` · ${job.headBranch}` : ''}
      </p>
      <p className="text-2xs text-fg-secondary tabular-nums">
        {column === 'waiting' && <>waiting {formatSeconds(elapsed)}</>}
        {column === 'running' && (
          <>
            on {job.runnerName ?? 'a runner'} · {formatSeconds(elapsed)}
          </>
        )}
        {column === 'finished' && (
          <>
            {job.completedAt ? <RelativeTime value={job.completedAt} /> : 'finished'}
            {job.durationSeconds != null ? ` · ran ${formatSeconds(job.durationSeconds)}` : ''}
          </>
        )}
      </p>
      {hint && (
        <p className="text-2xs text-warn-foreground">
          <span aria-hidden="true">⚠ </span>
          {hint}
        </p>
      )}
      {(job.htmlUrl || reportId) && (
        <div className="flex flex-wrap gap-3 text-2xs">
          {job.htmlUrl && (
            <a href={job.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
              GitHub ↗
            </a>
          )}
          {reportId && (
            <Link to={`/reports/${reportId}`} className="font-medium text-accent hover:underline">
              Mushi fix →
            </Link>
          )}
        </div>
      )}
    </motion.li>
  )
}

export function CiQueueBoard({ jobs, fixLinks, focusJobId }: Props) {
  const live = jobs.some((j) => j.status === 'queued' || j.status === 'in_progress' || j.status === 'waiting' || j.status === 'pending')
  const now = useNow(1000, live)
  // Columns re-sort on new data, not on every tick.
  const queue = useMemo(() => buildCiQueue(jobs, Date.now()), [jobs])

  return (
    <LayoutGroup id="ci-queue">
      <div className="grid gap-3 md:grid-cols-3" data-testid="ci-queue">
        {(['waiting', 'running', 'finished'] as const).map((col) => {
          const list = queue[col]
          const meta = COLUMN_META[col]
          return (
            <section key={col} aria-labelledby={`ci-queue-${col}`} className="flex min-w-0 flex-col gap-2 rounded-md border border-edge-subtle bg-surface-overlay/40 p-2">
              <h3 id={`ci-queue-${col}`} className="flex items-center gap-2 px-0.5 text-xs font-semibold text-fg">
                {meta.title}
                <span className="rounded-full bg-surface-raised px-1.5 text-3xs font-medium tabular-nums text-fg-secondary" data-testid={`ci-queue-count-${col}`}>
                  {list.length}
                </span>
              </h3>
              {list.length === 0 ? (
                <p className="px-0.5 text-2xs text-fg-muted">{meta.empty}</p>
              ) : (
                <ul className="flex max-h-112 flex-col gap-1.5 overflow-y-auto">
                  {list.map((job) => (
                    <JobCard key={job.id} job={job} column={col} now={now} fixLinks={fixLinks} focused={job.id === focusJobId} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
