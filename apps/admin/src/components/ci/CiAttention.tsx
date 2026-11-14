/**
 * FILE: apps/admin/src/components/ci/CiAttention.tsx
 * PURPOSE: "Needs attention" on the CI page's Now view: jobs running longer than their job usually
 *          takes, jobs that failed in the last two hours and why, and the queue per app. The owner
 *          could not tell what was stuck or what had failed from the queue columns (2026-11-07).
 *          Panels size to their content: an empty one is a one-line "nothing here" row, and the
 *          by-app table gets the full width (2026-11-14: three equal-height thirds left a big
 *          empty box and squeezed the table's APP cell into a run-on paragraph).
 */

import { useMemo, useState } from 'react'
import type { CiJob, CiJobType } from '../../lib/ciTypes'
import { recentFailed, runningLong, waitingByRepo } from '../../lib/ciAttention'
import { formatSeconds, repoShortName, type CiJobOutcome } from '../../lib/ciView'
import { LINK_ACCENT } from '../../lib/chipTone'
import { useNow } from '../../lib/useNow'
import { Badge, Btn, DataTableCell, DataTableHead, RelativeTime } from '../ui'
import { IconExternalLink } from '../icons'
import { CI_OUTCOME_STYLE } from './ciOutcome'

const SHOWN = 6

/**
 * The queue's outcome style for each failure kind, so a failure looks the same here as on its
 * card: red only for a code failure, neutral for a job cancelled before a machine took it.
 */
const FAILURE_STYLE: Record<ReturnType<typeof recentFailed>[number]['kind'], { outcome: CiJobOutcome; label: string }> = {
  code: { outcome: 'code_failure', label: CI_OUTCOME_STYLE.code_failure.label },
  machine: { outcome: 'infra', label: CI_OUTCOME_STYLE.infra.label },
  waited: { outcome: 'cancelled', label: 'Cancelled while waiting' },
}

function JobLink({ job }: { job: CiJob }) {
  const where = `${repoShortName(job.repo)}${job.prNumber ? ` · PR #${job.prNumber}` : ''}`
  return (
    <span className="min-w-0">
      {job.htmlUrl ? (
        <a href={job.htmlUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-start gap-1 wrap-anywhere font-medium ${LINK_ACCENT}`}>
          <span className="min-w-0 wrap-anywhere">{job.jobName}</span>
          <IconExternalLink size={10} className="mt-0.5 shrink-0" />
        </a>
      ) : (
        <span className="wrap-anywhere font-medium text-fg">{job.jobName}</span>
      )}
      <span className="block text-2xs text-fg-muted" title={job.repo}>
        {where}
      </span>
    </span>
  )
}

function Block({ title, count, empty, children, testId }: { title: string; count: number; empty: string; children: React.ReactNode; testId: string }) {
  // Nothing to show: one line, not a panel the height of its neighbours.
  if (count === 0) {
    return (
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-xs" data-testid={testId}>
        <span className="font-semibold text-fg">{title}</span>
        <span className="text-2xs text-fg-muted">{empty}</span>
      </p>
    )
  }
  return (
    <div className="min-w-0 rounded-md border border-edge-subtle p-3" data-testid={testId}>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg">
        {title}
        <Badge tone="neutral">{count}</Badge>
      </h3>
      {children}
    </div>
  )
}

function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null
  return (
    <Btn type="button" variant="ghost" size="sm" className="mt-2" onClick={onClick}>
      Show {hidden} more
    </Btn>
  )
}

export function CiAttention({ jobs, byJob }: { jobs: CiJob[]; byJob: CiJobType[] | undefined }) {
  const now = useNow(30_000)
  const long = useMemo(() => runningLong(jobs, byJob, now), [jobs, byJob, now])
  const failed = useMemo(() => recentFailed(jobs, now), [jobs, now])
  const waiting = useMemo(() => waitingByRepo(jobs, now), [jobs, now])
  const [allFailed, setAllFailed] = useState(false)
  const shownFailed = allFailed ? failed : failed.slice(0, SHOWN)

  const waitingCount = waiting.reduce((n, r) => n + r.count, 0)

  const blocks = [
    {
      key: 'long',
      count: long.length,
      node: (
        <Block
          key="long"
          title="Running longer than usual"
          count={long.length}
          empty={byJob ? 'Every running job is within its usual time.' : 'Usual times appear once Mushi Mushi has a few runs of each job.'}
          testId="ci-attention-long"
        >
          <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {long.map((r) => (
              <li key={r.job.id} className="flex min-w-0 flex-col gap-0.5 text-xs">
                <JobLink job={r.job} />
                <span className="text-2xs text-fg-muted">
                  Running <strong className="font-semibold text-fg">{formatSeconds(r.elapsedS)}</strong>, usually {formatSeconds(r.typicalS)} (1 in 10 runs over{' '}
                  {formatSeconds(r.p90S)})
                  {r.job.runnerName ? ` · on ${r.job.runnerName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      ),
    },
    {
      key: 'failed',
      count: failed.length,
      node: (
        <Block key="failed" title="Failed in the last 2 hours" count={failed.length} empty="Nothing failed in the last 2 hours." testId="ci-attention-failed">
          <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {shownFailed.map((f) => {
              const style = FAILURE_STYLE[f.kind]
              const s = CI_OUTCOME_STYLE[style.outcome]
              return (
                <li key={f.job.id} className="flex min-w-0 flex-col gap-0.5 text-xs">
                  {/* The queue card's outcome chip and name, not a loud pill: red means a code failure only. */}
                  <span className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
                    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${s.chip}`} title={s.meaning}>
                      <s.Icon size={10} />
                    </span>
                    <span>{style.label}</span>
                    <span aria-hidden="true">·</span>
                    <RelativeTime value={new Date(f.at).toISOString()} />
                  </span>
                  <JobLink job={f.job} />
                  {f.kind !== 'code' && <span className="line-clamp-2 text-2xs text-fg-muted">{f.reason}</span>}
                </li>
              )
            })}
          </ul>
          <ShowMore hidden={failed.length - shownFailed.length} onClick={() => setAllFailed(true)} />
        </Block>
      ),
    },
    {
      key: 'waiting',
      count: waitingCount,
      node: (
        <Block key="waiting" title="Waiting for a machine, by app" count={waitingCount} empty="Nothing is waiting." testId="ci-attention-waiting">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-edge-subtle">
                <DataTableHead>App</DataTableHead>
                <DataTableHead align="right">Jobs</DataTableHead>
                <DataTableHead align="right">Oldest</DataTableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {waiting.map((r) => (
                <tr key={r.repo}>
                  <DataTableCell>
                    <span className="block font-medium text-fg" title={r.repo}>
                      {repoShortName(r.repo)}
                    </span>
                    <span className="block text-2xs text-fg-muted">{r.topJobs.map((t) => `${t.name} ×${t.count}`).join(' · ')}</span>
                  </DataTableCell>
                  <DataTableCell align="right" className="w-16 tabular-nums">{r.count}</DataTableCell>
                  <DataTableCell align="right" className="w-24 whitespace-nowrap tabular-nums">
                    <span className={r.oldestS > 3600 ? 'font-semibold text-warn-foreground' : undefined}>{formatSeconds(r.oldestS)}</span>
                  </DataTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      ),
    },
  ]

  // Panels with something in them first, each the full width; the all-clear rows after, one line each.
  return (
    <div className="flex flex-col gap-3">
      {blocks.filter((b) => b.count > 0).map((b) => b.node)}
      {blocks.some((b) => b.count === 0) && (
        <div className="flex flex-col gap-1.5 rounded-md border border-edge-subtle px-2 py-2">{blocks.filter((b) => b.count === 0).map((b) => b.node)}</div>
      )}
    </div>
  )
}
