/**
 * FILE: apps/admin/src/components/ci/CiJobTimes.tsx
 * PURPOSE: "Job times" on the CI page's Now view: per job type over the window, how long it usually
 *          runs (median), its slow runs (1 in 10 take longer than p90), the longest, the wait for a
 *          machine and how often it fails. Slowest first, so the long-running jobs lead. The same
 *          breakdown as GitHub's Actions performance metrics (run time, queue time, failure rate).
 */

import { useState } from 'react'
import type { CiJobType } from '../../lib/ciTypes'
import { formatSeconds, repoShortName } from '../../lib/ciView'
import { Badge, Btn, DataTableCell, DataTableHead } from '../ui'

const SHOWN = 10

export function CiJobTimes({ byJob, days }: { byJob: CiJobType[] | undefined; days: number }) {
  const [all, setAll] = useState(false)
  if (!byJob) return <p className="text-xs text-fg-muted">Job times appear after the next update of this page.</p>
  if (byJob.length === 0) return <p className="text-xs text-fg-muted">No finished jobs in the last {days} days.</p>
  const rows = all ? byJob : byJob.slice(0, SHOWN)
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-xs" data-testid="ci-job-times">
        <thead>
          <tr className="border-b border-edge-subtle">
            <DataTableHead>Job</DataTableHead>
            <DataTableHead align="right">Runs</DataTableHead>
            <DataTableHead align="right">Usually</DataTableHead>
            <DataTableHead align="right">Slow runs (1 in 10)</DataTableHead>
            <DataTableHead align="right">Longest</DataTableHead>
            <DataTableHead align="right">Waits</DataTableHead>
            <DataTableHead align="right">Fails</DataTableHead>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle">
          {rows.map((t) => {
            const failPct = t.failRate == null ? null : Math.round(t.failRate * 100)
            return (
              <tr key={`${t.repo}|${t.workflow}|${t.job}`}>
                <DataTableCell>
                  <span className="block wrap-anywhere font-medium text-fg">{t.job}</span>
                  <span className="block text-2xs text-fg-faint" title={t.repo}>
                    {repoShortName(t.repo)} · {t.workflow}
                  </span>
                </DataTableCell>
                <DataTableCell align="right">{t.runs}</DataTableCell>
                <DataTableCell align="right">{formatSeconds(t.durationP50s)}</DataTableCell>
                <DataTableCell align="right">{formatSeconds(t.durationP90s)}</DataTableCell>
                <DataTableCell align="right">{formatSeconds(t.durationMaxS)}</DataTableCell>
                <DataTableCell align="right">{formatSeconds(t.queueP50s)}</DataTableCell>
                <DataTableCell align="right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    {failPct != null && failPct >= 20 ? <Badge tone="dangerSubtle">{failPct}%</Badge> : <span>{failPct == null ? '–' : `${failPct}%`}</span>}
                    {t.infraFailures > 0 && <span className="text-2xs text-fg-faint" title="Jobs the test machine stopped">+{t.infraFailures} stopped</span>}
                  </span>
                </DataTableCell>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!all && byJob.length > SHOWN && (
        <Btn type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          Show {byJob.length - SHOWN} more
        </Btn>
      )}
    </div>
  )
}
