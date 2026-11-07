/**
 * FILE: apps/admin/src/components/ci/CiAttention.tsx
 * PURPOSE: "Needs attention" on the CI page's Now view: jobs running longer than their job usually
 *          takes, jobs that failed in the last two hours and why, and the queue per app. The owner
 *          could not tell what was stuck or what had failed from the queue columns (2026-11-07).
 */

import { useMemo, useState } from 'react'
import type { CiJob, CiJobType } from '../../lib/ciTypes'
import { recentFailed, runningLong, waitingByRepo } from '../../lib/ciAttention'
import { formatSeconds, repoShortName } from '../../lib/ciView'
import { useNow } from '../../lib/useNow'
import { Badge, Btn, DataTableCell, DataTableHead, RelativeTime } from '../ui'
import { IconExternalLink } from '../icons'

const SHOWN = 6

function JobLink({ job }: { job: CiJob }) {
  const where = `${repoShortName(job.repo)}${job.prNumber ? ` · PR #${job.prNumber}` : ''}`
  return (
    <span className="min-w-0">
      {job.htmlUrl ? (
        <a href={job.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 wrap-anywhere font-medium text-accent hover:underline">
          <span className="min-w-0 wrap-anywhere">{job.jobName}</span>
          <IconExternalLink size={10} className="mt-0.5 shrink-0" />
        </a>
      ) : (
        <span className="wrap-anywhere font-medium text-fg">{job.jobName}</span>
      )}
      <span className="block text-2xs text-fg-faint" title={job.repo}>
        {where}
      </span>
    </span>
  )
}

function Block({ title, count, children, testId }: { title: string; count: number; children: React.ReactNode; testId: string }) {
  return (
    <div className="min-w-0 rounded-md border border-edge-subtle p-3" data-testid={testId}>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg">
        {title}
        <Badge tone={count > 0 ? 'warnSubtle' : 'neutral'}>{count}</Badge>
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

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Block title="Running longer than usual" count={long.length} testId="ci-attention-long">
        {long.length === 0 ? (
          <p className="text-xs text-fg-muted">
            {byJob ? 'Every running job is within its usual time.' : 'Usual times appear once Mushi has a few runs of each job.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {long.map((r) => (
              <li key={r.job.id} className="flex flex-col gap-0.5 text-xs">
                <JobLink job={r.job} />
                <span className="text-2xs text-fg-secondary">
                  Running <strong className="text-warn">{formatSeconds(r.elapsedS)}</strong>, usually {formatSeconds(r.typicalS)} (1 in 10 runs over{' '}
                  {formatSeconds(r.p90S)})
                  {r.job.runnerName ? ` · on ${r.job.runnerName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Failed in the last 2 hours" count={failed.length} testId="ci-attention-failed">
        {failed.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing failed in the last 2 hours.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {shownFailed.map((f) => (
                <li key={f.job.id} className="flex flex-col gap-0.5 text-xs">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={f.kind === 'code' ? 'dangerSubtle' : f.kind === 'machine' ? 'warnSubtle' : 'neutral'}>
                      {f.kind === 'code' ? 'Tests failed' : f.kind === 'machine' ? 'Machine stopped' : 'Cancelled while waiting'}
                    </Badge>
                    <RelativeTime value={new Date(f.at).toISOString()} className="text-2xs text-fg-faint" />
                  </span>
                  <JobLink job={f.job} />
                  {f.kind !== 'code' && <span className="line-clamp-2 text-2xs text-fg-muted">{f.reason}</span>}
                </li>
              ))}
            </ul>
            <ShowMore hidden={failed.length - shownFailed.length} onClick={() => setAllFailed(true)} />
          </>
        )}
      </Block>

      <Block title="Waiting for a machine, by app" count={waiting.reduce((n, r) => n + r.count, 0)} testId="ci-attention-waiting">
        {waiting.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing is waiting.</p>
        ) : (
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
                    <span className="block text-2xs text-fg-faint">{r.topJobs.map((t) => `${t.name} ×${t.count}`).join(' · ')}</span>
                  </DataTableCell>
                  <DataTableCell align="right">{r.count}</DataTableCell>
                  <DataTableCell align="right">
                    <span className={r.oldestS > 3600 ? 'font-semibold text-warn' : undefined}>{formatSeconds(r.oldestS)}</span>
                  </DataTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Block>
    </div>
  )
}
