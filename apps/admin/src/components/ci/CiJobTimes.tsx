/**
 * FILE: apps/admin/src/components/ci/CiJobTimes.tsx
 * PURPOSE: "Job times" on the CI page's Now view: per job type over the window, how long it usually
 *          runs (median), its slow runs (1 in 10 take longer than p90), the longest, the wait for a
 *          machine and how often it fails. Jobs failing 1 run in 5 or more lead, worst first (2026-11-17,
 *          "show important things first"); the rest stay slowest first. The same
 *          breakdown as GitHub's Actions performance metrics (run time, queue time, failure rate).
 *
 *          When the table has room (≥ 64rem, a desktop), a "Spread" column draws each job's run
 *          times on one shared scale: usual, slow runs, longest. Length reads at a glance where a
 *          column of minutes has to be read cell by cell (NN/g, "Dashboards: preattentive").
 *          The numbers stay; the bar repeats them, so it is hidden from screen readers.
 *          Neutral grey, not brand: colour on this page means an outcome (red = failed).
 *          Fails and waits are graded cells (red = how often it fails, teal = how long it waits),
 *          darker = worse, with the number inside. Pointing at a row lights its job across the page.
 */

import { useMemo, useState } from 'react'
import type { CiJobType } from '../../lib/ciTypes'
import { formatSeconds, repoShortName } from '../../lib/ciView'
import { Btn, DataTableCell, DataTableHead } from '../ui'
import { failClass, heatClass } from '../../lib/ciWeek'
import { ciJobKey, ciRepoKey, useCiLink } from '../../lib/ciHighlight'

const SHOWN = 10
/** A job failing this often leads the table. */
const LEADS_AT = 0.2

/** @internal Exported for tests. Jobs failing 1 in 5 or more first (worst first), the rest in the server's order (slowest first). */
export function failingFirst(byJob: readonly CiJobType[]): CiJobType[] {
  const rate = (t: CiJobType) => ((t.failRate ?? 0) >= LEADS_AT ? (t.failRate ?? 0) : 0)
  return byJob.map((t, i) => ({ t, i })).sort((a, b) => rate(b.t) - rate(a.t) || a.i - b.i).map((x) => x.t)
}

/** Shown only once the table's container is desktop-wide. */
const WIDE_ONLY = 'hidden @5xl:table-cell'

/** Where a job's usual, slow and longest run sit on a 0–100 scale shared by every row. */
interface JobSpread {
  usualPct: number
  slowPct: number
  longestPct: number
}

/**
 * The shared scale is the longest run of ANY job, not only the rows on screen, so "Show more"
 * never rescales the rows already read. Null when the job has no finished run to draw.
 *
 * @internal Exported for tests only.
 */
export function jobSpread(t: Pick<CiJobType, 'durationP50s' | 'durationP90s' | 'durationMaxS'>, scaleMaxS: number): JobSpread | null {
  if (t.durationP50s == null || scaleMaxS <= 0) return null
  const pct = (s: number) => Math.min(100, Math.max(0, (s / scaleMaxS) * 100))
  const usual = t.durationP50s
  const slow = Math.max(usual, t.durationP90s ?? usual)
  const longest = Math.max(slow, t.durationMaxS ?? slow)
  return { usualPct: pct(usual), slowPct: pct(slow), longestPct: pct(longest) }
}

/** @internal Exported for tests only. */
export function spreadScaleMax(byJob: ReadonlyArray<Pick<CiJobType, 'durationP50s' | 'durationP90s' | 'durationMaxS'>>): number {
  let max = 0
  for (const t of byJob) max = Math.max(max, t.durationMaxS ?? 0, t.durationP90s ?? 0, t.durationP50s ?? 0)
  return max
}

function SpreadBar({ spread, title }: { spread: JobSpread; title: string }) {
  return (
    <span className="relative block h-3 w-full" title={title} aria-hidden="true" data-testid="ci-job-spread">
      {/* Track: the whole scale, so short jobs read as short. */}
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge-subtle" />
      {/* Slow runs to the longest: a thin whisker. */}
      <span
        className="absolute top-1/2 h-px -translate-y-1/2 bg-fg-muted"
        style={{ left: `${spread.slowPct}%`, width: `${Math.max(0, spread.longestPct - spread.slowPct)}%` }}
      />
      <span className="absolute top-0.5 h-2 w-px bg-fg-muted" style={{ left: `${spread.longestPct}%` }} />
      {/* Usual run: solid; usual to slow runs: the lighter box. */}
      <span className="absolute inset-y-0.5 left-0 rounded-l-sm bg-fg-secondary" style={{ width: `${spread.usualPct}%` }} />
      <span
        className="absolute inset-y-0.5 rounded-r-sm bg-fg-faint/40"
        style={{ left: `${spread.usualPct}%`, width: `${Math.max(0, spread.slowPct - spread.usualPct)}%` }}
      />
    </span>
  )
}

/** A graded number cell: the colour says how bad, the number inside says exactly. */
const CELL = 'inline-block min-w-12 rounded-xs px-1.5 py-0.5 text-right font-mono font-bold tabular-nums'

function JobRow({ t, scaleMax, waitMax }: { t: CiJobType; scaleMax: number; waitMax: number }) {
  const link = useCiLink([ciJobKey(t.repo, t.job), ciRepoKey(t.repo)], ciJobKey(t.repo, t.job))
  const failPct = t.failRate == null ? null : Math.round(t.failRate * 100)
  const spread = jobSpread(t, scaleMax)
  return (
    <tr {...link} className={link.className}>
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
      <DataTableCell className={WIDE_ONLY}>
        {spread ? (
          <SpreadBar
            spread={spread}
            title={`Usually ${formatSeconds(t.durationP50s)}, 1 in 10 over ${formatSeconds(t.durationP90s)}, longest ${formatSeconds(t.durationMaxS)}`}
          />
        ) : (
          <span className="text-fg-faint">–</span>
        )}
      </DataTableCell>
      <DataTableCell align="right">
        <span className={`${CELL} ${heatClass(t.queueP50s, waitMax)}`} title="Half its runs waited this long or less for a machine">
          {formatSeconds(t.queueP50s)}
        </span>
      </DataTableCell>
      <DataTableCell align="right">
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          {failPct == null ? <span>–</span> : <span className={`${CELL} ${failClass(t.failRate)}`}>{failPct}%</span>}
          {t.infraFailures > 0 && <span className="text-2xs text-fg-faint" title="Jobs the test machine stopped">+{t.infraFailures} stopped</span>}
        </span>
      </DataTableCell>
    </tr>
  )
}

export function CiJobTimes({ byJob, days }: { byJob: CiJobType[] | undefined; days: number }) {
  const [all, setAll] = useState(false)
  const scaleMax = useMemo(() => spreadScaleMax(byJob ?? []), [byJob])
  const sorted = useMemo(() => failingFirst(byJob ?? []), [byJob])
  const waitMax = useMemo(() => Math.max(0, ...(byJob ?? []).map((t) => t.queueP50s ?? 0)), [byJob])
  if (!byJob) return <p className="text-xs text-fg-muted">Job times appear after the next update of this page.</p>
  if (byJob.length === 0) return <p className="text-xs text-fg-muted">No finished jobs in the last {days} days.</p>
  const rows = all ? sorted : sorted.slice(0, SHOWN)
  return (
    <div className="@container min-w-0 overflow-x-auto">
      <table className="w-full text-xs" data-testid="ci-job-times">
        <thead>
          <tr className="border-b border-edge-subtle">
            <DataTableHead>Job</DataTableHead>
            <DataTableHead align="right">Runs</DataTableHead>
            <DataTableHead align="right">Usually</DataTableHead>
            <DataTableHead align="right">Slow runs (1 in 10)</DataTableHead>
            <DataTableHead align="right">Longest</DataTableHead>
            <DataTableHead className={`${WIDE_ONLY} w-1/3`}>
              <span className="flex items-center justify-between gap-2">
                <span>Spread</span>
                <span className="font-normal text-fg-faint tabular-nums">0 – {formatSeconds(scaleMax)}</span>
              </span>
            </DataTableHead>
            <DataTableHead align="right">Waits</DataTableHead>
            <DataTableHead align="right">Fails</DataTableHead>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle">
          {rows.map((t) => (
            <JobRow key={`${t.repo}|${t.workflow}|${t.job}`} t={t} scaleMax={scaleMax} waitMax={waitMax} />
          ))}
        </tbody>
      </table>
      {!all && byJob.length > SHOWN && (
        <Btn type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          Show {byJob.length - SHOWN} more
        </Btn>
      )}
      {/* The bar's key, only where the bar shows. */}
      <p className="mt-1.5 hidden items-center gap-3 text-2xs text-fg-muted @5xl:flex" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-fg-secondary" /> usual run</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-fg-faint/40" /> up to the slow runs (1 in 10)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-px w-4 bg-fg-muted" /> to the longest</span>
      </p>
    </div>
  )
}
