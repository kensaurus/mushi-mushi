/**
 * FILE: apps/admin/src/components/ci/CiQueueBoard.tsx
 * PURPOSE: The CI queue on /ci — what is waiting for a test machine, what is
 *          running, and what finished in the last 2 hours — as three
 *          columns. Each card carries its outcome's colour stripe, icon and
 *          name (ciOutcome.tsx), the job name first, where it ran, and
 *          actions named for what they do: logs on GitHub, the fix in Mushi,
 *          and Re-run tests for a job the machine stopped. Finished jobs
 *          filter by outcome. A card moves Waiting → Running → Finished with
 *          a shared-layout animation (instant under prefers-reduced-motion);
 *          times tick every second while anything is live.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGroup, motion } from 'framer-motion'
import type { CiJob, CiRerunResult } from '../../lib/ciTypes'
import {
  buildCiQueue,
  fixLinkKey,
  formatSeconds,
  jobElapsedSeconds,
  jobOutcome,
  runnerDisplayName,
  waitingHint,
  type CiFixLinks,
  type CiJobOutcome,
} from '../../lib/ciView'
import { rerunErrorText } from '../../lib/ciInfra'
import { apiFetchMutate } from '../../lib/supabase'
import { useNow } from '../../lib/useNow'
import { useMotionTransition } from '../../lib/useMotionTransition'
import { IconArrowRight, IconClock, IconCloud, IconExternalLink, IconGit, IconPlay, IconRerun, IconServer, IconCheck } from '../icons'
import { FilterChip, RelativeTime } from '../ui'
import { CI_OUTCOME_STYLE } from './ciOutcome'

interface Props {
  jobs: CiJob[]
  fixLinks?: CiFixLinks
  /** Job to highlight and scroll to (from `/ci?job=`). */
  focusJobId?: string | null
}

type Column = 'waiting' | 'running' | 'finished'

const COLUMN_META: Record<Column, { title: string; hint: string; empty: string; Icon: ComponentType<{ size?: number; className?: string }>; tone: string }> = {
  waiting: { title: 'Waiting', hint: 'for a free test machine', empty: 'Nothing is waiting. Every job got a machine.', Icon: IconClock, tone: CI_OUTCOME_STYLE.waiting.chip },
  running: { title: 'Running', hint: 'on a test machine now', empty: 'No machine is busy right now.', Icon: IconPlay, tone: CI_OUTCOME_STYLE.running.chip },
  finished: { title: 'Finished', hint: 'in the last 2 hours', empty: 'Nothing finished in the last 2 hours.', Icon: IconCheck, tone: CI_OUTCOME_STYLE.passed.chip },
}

type FinishedFilter = 'all' | 'code_failure' | 'infra' | 'passed'

const FILTERS: Array<{ id: FinishedFilter; label: string; tone: 'default' | 'danger' | 'warn' | 'ok' }> = [
  { id: 'all', label: 'All', tone: 'default' },
  { id: 'code_failure', label: CI_OUTCOME_STYLE.code_failure.label, tone: 'danger' },
  { id: 'infra', label: CI_OUTCOME_STYLE.infra.label, tone: 'warn' },
  { id: 'passed', label: CI_OUTCOME_STYLE.passed.label, tone: 'ok' },
]

/** "glot.it" from "kensaurus/glot.it": the owner repeats on every card. */
function repoName(repo: string): string {
  return repo.split('/').pop() ?? repo
}

function RerunButton({ fixId }: { fixId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const rerun = async () => {
    setState('busy')
    const res = await apiFetchMutate<CiRerunResult>(`/v1/admin/fixes/${fixId}/ci/rerun`, { method: 'POST', body: '{}' })
    if (res.ok) {
      setState('done')
      setMessage('Tests started again.')
    } else {
      setState('error')
      setMessage(rerunErrorText(res.error?.code, res.error?.message))
    }
  }
  if (state === 'done') return <span className="text-2xs font-medium text-ok">{message}</span>
  return (
    <>
      <button
        type="button"
        onClick={rerun}
        disabled={state === 'busy'}
        className="inline-flex items-center gap-1 rounded-sm border border-warn/40 bg-warn-muted/50 px-1.5 py-0.5 text-2xs font-medium text-warn-foreground hover:bg-warn-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        title="Run this fix's tests again. The machine stopped, so the code was never tested."
      >
        <IconRerun size={11} />
        {state === 'busy' ? 'Re-running…' : 'Re-run tests'}
      </button>
      {state === 'error' && message && <span className="w-full text-2xs text-danger">{message}</span>}
    </>
  )
}

function JobCard({ job, column, now, fixLinks, focused }: { job: CiJob; column: Column; now: number; fixLinks?: CiFixLinks; focused: boolean }) {
  const transition = useMotionTransition()
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focused])
  const elapsed = jobElapsedSeconds(job, now)
  const fix = job.prNumber != null ? fixLinks?.get(fixLinkKey(job.repo, job.prNumber)) : undefined
  const hint = column === 'waiting' ? waitingHint(job) : null
  const outcome: CiJobOutcome = column === 'finished' ? jobOutcome(job) : column
  const s = CI_OUTCOME_STYLE[outcome]
  const runner = runnerDisplayName(job)
  const RunnerIcon = job.runnerKind === 'github_hosted' ? IconCloud : IconServer

  return (
    <motion.li
      ref={ref}
      layout="position"
      layoutId={`ci-job-${job.id}`}
      transition={transition}
      data-testid={`ci-queue-job-${job.id}`}
      data-focused={focused || undefined}
      className={`flex flex-col gap-1 rounded-md border border-l-4 bg-surface-raised px-2.5 py-2 text-xs ${s.stripe} ${
        focused ? 'border-brand ring-2 ring-brand/40' : 'border-y-edge-subtle border-r-edge-subtle'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${s.chip}`} title={s.meaning}>
          <s.Icon size={11} />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-fg" title={job.workflowName ? `${job.workflowName} / ${job.jobName}` : job.jobName}>
          {job.jobName}
        </span>
        {job.prNumber ? <span className="shrink-0 rounded-sm bg-surface-overlay px-1 text-3xs font-medium text-fg-secondary tabular-nums">PR #{job.prNumber}</span> : null}
      </div>
      <p className={`text-2xs font-medium ${s.text}`}>
        <span className="sr-only">Outcome: </span>
        {s.label}
        {column === 'waiting' && <> · {formatSeconds(elapsed)} so far</>}
        {column === 'running' && <> · {formatSeconds(elapsed)} so far</>}
        {column === 'finished' && job.durationSeconds != null && <span className="font-normal text-fg-muted"> · ran {formatSeconds(job.durationSeconds)}</span>}
      </p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-fg-muted">
        <span className="inline-flex min-w-0 items-center gap-1" title={job.repo}>
          <IconGit size={11} className="shrink-0" />
          <span className="truncate">
            {repoName(job.repo)}
            {job.workflowName ? ` · ${job.workflowName}` : ''}
          </span>
        </span>
        {runner && column !== 'waiting' && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <RunnerIcon size={11} className="shrink-0" />
            <span className="truncate">{runner}</span>
          </span>
        )}
        {column === 'finished' && job.completedAt && (
          <span className="inline-flex items-center gap-1">
            <IconClock size={11} className="shrink-0" />
            <RelativeTime value={job.completedAt} />
          </span>
        )}
      </p>
      {hint && <p className="text-2xs text-warn-foreground">{hint}</p>}
      {(job.htmlUrl || fix) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
          {column === 'finished' && outcome === 'infra' && fix?.fixId && <RerunButton fixId={fix.fixId} />}
          {fix && (
            <Link to={`/reports/${fix.reportId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Open the fix in Mushi
              <IconArrowRight size={11} />
            </Link>
          )}
          {job.htmlUrl && (
            <a href={job.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              {outcome === 'code_failure' ? 'Read the failing logs' : 'View on GitHub'}
              <IconExternalLink size={11} />
            </a>
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
  const [filter, setFilter] = useState<FinishedFilter>('all')
  const finishedCounts = useMemo(() => {
    const c: Record<FinishedFilter, number> = { all: queue.finished.length, code_failure: 0, infra: 0, passed: 0 }
    for (const j of queue.finished) {
      const o = jobOutcome(j)
      if (o === 'code_failure' || o === 'infra' || o === 'passed') c[o]++
    }
    return c
  }, [queue.finished])
  // An empty column takes one share of five, so the busy ones get the room.
  const spans = (['waiting', 'running', 'finished'] as const).map((col) => (queue[col].length === 0 ? 1 : 2))
  const total = spans.reduce((a, b) => a + b, 0)
  const gridCols = total === 6 ? 'md:grid-cols-3' : total === 5 ? 'md:grid-cols-5' : total === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'
  const span = (n: number) => (total === 6 || total === 3 ? '' : n === 2 ? 'md:col-span-2' : 'md:col-span-1')

  return (
    <LayoutGroup id="ci-queue">
      <div className={`grid gap-3 ${gridCols}`} data-testid="ci-queue">
        {(['waiting', 'running', 'finished'] as const).map((col, i) => {
          const meta = COLUMN_META[col]
          const all = queue[col]
          const list = col === 'finished' && filter !== 'all' ? all.filter((j) => jobOutcome(j) === filter) : all
          return (
            <section key={col} aria-labelledby={`ci-queue-${col}`} className={`flex min-w-0 flex-col gap-2 rounded-md border border-edge-subtle bg-surface-overlay/40 p-2 ${span(spans[i])}`}>
              <div className="flex items-center gap-2 px-0.5">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-sm ${meta.tone}`}>
                  <meta.Icon size={11} />
                </span>
                <h3 id={`ci-queue-${col}`} className="text-xs font-semibold text-fg">
                  {meta.title}
                </h3>
                <span className="rounded-full bg-surface-raised px-1.5 text-3xs font-medium tabular-nums text-fg-secondary" data-testid={`ci-queue-count-${col}`}>
                  {all.length}
                </span>
                {all.length > 0 && <span className="min-w-0 truncate text-3xs text-fg-muted">{meta.hint}</span>}
              </div>
              {col === 'finished' && all.length > 0 && (
                <div className="flex flex-wrap gap-1 px-0.5" role="group" aria-label="Show finished jobs">
                  {FILTERS.map((f) => (
                    <FilterChip key={f.id} label={f.label} count={finishedCounts[f.id]} active={filter === f.id} tone={f.tone} onClick={() => setFilter(f.id)} />
                  ))}
                </div>
              )}
              {list.length === 0 ? (
                <p className="px-0.5 text-2xs text-fg-muted">{all.length === 0 ? meta.empty : 'No finished jobs with this outcome.'}</p>
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
