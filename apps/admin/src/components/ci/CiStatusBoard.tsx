/**
 * FILE: apps/admin/src/components/ci/CiStatusBoard.tsx
 * PURPOSE: The top of the CI page as pictures, not paragraphs (2026-11-16, redrawn 2026-11-18;
 *          the owner: "a running runner could show as running colour and status and graphical,
 *          and show different when broken — you expect us to read a bunch of text wall?").
 *          It answers, in this order, from the screen alone:
 *            1. Which machine is doing what? A tile per machine: a status light (running breathes
 *               blue, idle is a grey ring, offline is red), a dot per running job, CPU and memory
 *               gauges, its labels as chips, and a red "missing <label>" chip when it sits idle
 *               while jobs wait for a label it lacks.
 *            2. When will each job finish? A running bar (stripes) filled to elapsed ÷ usual, a
 *               tick at the usual time, the overrun orange then red, "18 / 16 min". Waiting jobs
 *               sit under one header per label set ("8 waiting for kensaurus-local"), lit together
 *               with the machines that have or lack it.
 *            3. What broke? One red card per cause seen in two or more PRs ("Dependency audit ·
 *               5 PRs · 3 apps"), single failures as compact ✕ rows.
 *            4. Where does each app's time go? Bars for wait and run, a pass-rate bar, and the
 *               main delay as a status pill.
 *          The one-sentence status stays for screen readers (role=status). Data: lib/ciStatus.ts.
 */
import { Fragment, useMemo } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import {
  buildCiStatus,
  durationWords,
  groupFailureCauses,
  groupFailures,
  type CiStatus,
  type FailureCause,
  type FailureGroup,
  type MachineNow,
  type RunningNow,
  type WaitingGroup,
  type WaitingNow,
} from '../../lib/ciStatus'
import type { RecentFailure } from '../../lib/ciAttention'
import { ciJobKey, ciJobKeys, ciRepoKey, ciRunnerKey, useCiLink, type CiKey } from '../../lib/ciHighlight'
import { LINK_ACCENT } from '../../lib/chipTone'
import { useNow } from '../../lib/useNow'
import { DataTableCell, DataTableHead } from '../ui'
import { IconExternalLink } from '../icons'
import { BarCell } from '../signal/BarCell'
import { RunBar, STATUS_SOFT, StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'

/**
 * Machine tiles by the width they get, not the viewport: the same tiles fill the Machines view,
 * two thirds of a wide Now view, or a phone. 1 → 2 → 3 → 4 → 5 columns.
 */
export const MACHINE_GRID = '@xl:grid-cols-2 @4xl:grid-cols-3 @min-[88rem]:grid-cols-4 @min-[120rem]:grid-cols-5'
const BOARD_SPAN = '@min-[72rem]:col-span-2'
const H3 = 'mb-1.5 flex items-center gap-2 text-xs font-semibold text-fg'
const CHIP = 'inline-flex max-w-full items-center gap-1 truncate rounded-sm border border-edge bg-surface-raised px-1.5 py-px text-2xs font-semibold text-fg'
const labelKey = (l: string): CiKey => `label:${l.toLowerCase()}`

function machineStatus(m: MachineNow): RunStatus {
  if (m.stale) return 'failed'
  return m.running > 0 ? 'running' : 'idle'
}

function machineWord(m: MachineNow): string {
  if (m.stale) return 'offline'
  return m.running > 0 ? `running ${m.running}` : 'idle'
}

function Gauge({ label, pct }: { label: string; pct: number | null }) {
  if (pct == null) return null
  const fill = pct >= 90 ? 'bg-st-failed' : pct >= 70 ? 'bg-st-slow' : 'bg-fg-secondary'
  return (
    <span className="flex items-center gap-1.5 text-3xs font-semibold text-fg-secondary" title={`${label}: ${pct}%`}>
      <span className="w-7 shrink-0 uppercase">{label}</span>
      <span className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-overlay" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className={`ci-grow-x absolute inset-y-0 left-0 ${fill}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right font-mono font-bold text-fg tabular-nums">{pct}%</span>
    </span>
  )
}

/** One real machine as a tile. Pointing at it lights its jobs; a label chip lights the jobs that need it. */
export function MachineCard({ m, testId }: { m: MachineNow; testId?: string }) {
  const keys = [...(m.runnerNames ?? []).map(ciRunnerKey), ...(m.labels ?? []).map(labelKey), ...(m.missingLabels ?? []).map(labelKey), `machine:${m.id}`]
  const link = useCiLink(keys, keys[0] ?? `machine:${m.id}`)
  const status = machineStatus(m)
  const dots = Math.min(m.running, 8)
  return (
    <li {...link} className={`${link.className} min-w-0`} data-testid={testId ?? `ci-machine-${m.id}`} data-status={status}>
      <div className={`flex h-full flex-col gap-1.5 rounded-md border px-2.5 py-2 ${status === 'idle' ? 'border-edge bg-surface' : STATUS_SOFT[status]}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusMark status={status} size={12} />
          <span className="truncate text-sm font-bold text-fg">{m.name}</span>
          <span className="ml-auto shrink-0">
            <StatusPill status={status} label={machineWord(m)} />
          </span>
        </div>
        {m.detail && <span className="-mt-1 text-3xs text-fg-secondary">{m.detail}{m.kind === 'github' ? ' · billed by GitHub' : ''}</span>}
        {m.running > 0 && (
          <span className="flex flex-wrap items-center gap-1" role="img" aria-label={`${m.running} job${m.running === 1 ? '' : 's'} running: ${m.apps.map((a) => `${a.app} ${a.count}`).join(', ')}`}>
            {Array.from({ length: dots }, (_, i) => (
              <span key={i} className="h-2 w-2 rounded-full bg-st-running" aria-hidden="true" />
            ))}
            {m.running > dots && <span className="font-mono text-3xs font-bold text-st-running-ink" aria-hidden="true">+{m.running - dots}</span>}
            <span className="ml-1 flex flex-wrap gap-1" aria-hidden="true">
              {m.apps.map((a) => (
                <span key={a.app} className={CHIP}>
                  {a.app}
                  {a.count > 1 && <span className="font-mono text-fg-secondary">×{a.count}</span>}
                </span>
              ))}
            </span>
          </span>
        )}
        {(m.busyPct != null || m.memPct != null) && (
          <span className="flex flex-col gap-0.5">
            <Gauge label="CPU" pct={m.busyPct} />
            <Gauge label="Mem" pct={m.memPct} />
          </span>
        )}
        {((m.labels?.length ?? 0) > 0 || (m.missingLabels?.length ?? 0) > 0) && (
          <span className="flex flex-wrap gap-1" data-testid="ci-machine-labels">
            {(m.missingLabels ?? []).map((l) => (
              <span key={`x${l}`} className="inline-flex items-center gap-1 rounded-sm border border-st-failed/55 bg-st-failed-soft px-1.5 py-px text-2xs font-bold text-st-failed-ink" title={`Jobs wait for “${l}”, and this idle machine has no runner with it`} data-testid="ci-machine-missing-label">
                <StatusMark status="failed" size={9} />
                missing {l}
              </span>
            ))}
            {(m.labels ?? []).map((l) => (
              <span key={l} className="rounded-sm border border-edge-subtle bg-surface-overlay px-1.5 py-px font-mono text-3xs text-fg-secondary">
                {l}
              </span>
            ))}
          </span>
        )}
      </div>
    </li>
  )
}

function minutesOf(s: number): number {
  return Math.max(1, Math.round(s / 60))
}

/** "18 / 16 min", or "2 min" with no usual time yet. */
function runLabel(r: Pick<RunningNow, 'elapsedS' | 'usualS'>): string {
  if (r.elapsedS == null) return 'starting'
  if (r.usualS == null) return durationWords(r.elapsedS)
  return `${minutesOf(r.elapsedS)} / ${minutesOf(r.usualS)} min`
}

function JobName({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`truncate text-xs font-bold ${LINK_ACCENT}`} title="Open the log on GitHub">
      {name} <IconExternalLink size={10} className="inline" />
    </a>
  ) : (
    <span className="truncate text-xs font-bold text-fg">{name}</span>
  )
}

/** One running job; pointing at it lights its app, job and runner across the page. */
function RunningRow({ r }: { r: RunningNow }) {
  const link = useCiLink(ciJobKeys(r.job), ciJobKey(r.job.repo, r.job.jobName))
  const status: RunStatus = r.slow ? 'slow' : 'running'
  return (
    <li {...link} className={`${link.className} grid grid-cols-1 items-center gap-x-3 gap-y-1 px-2.5 py-1.5 @xl:grid-cols-2`} data-testid={`ci-running-${r.job.id}`} data-status={status}>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StatusMark status={status} label={r.slow ? 'Running slower than usual' : 'Running'} />
        <JobName name={r.job.jobName} url={r.job.htmlUrl} />
        <span className={CHIP}>{r.app}</span>
        {r.job.prNumber != null && <span className={`${CHIP} font-mono`}>#{r.job.prNumber}</span>}
        {r.machine && <span className={`${CHIP} font-normal text-fg-secondary`}>{r.machine.name}</span>}
      </span>
      {r.elapsedS != null && <RunBar elapsedS={r.elapsedS} usualS={r.usualS} label={runLabel(r)} />}
    </li>
  )
}

/** One job waiting for a machine, under its group's header: mark, job, app, PR, wait. */
function WaitingRow({ w }: { w: WaitingNow }) {
  const link = useCiLink([...ciJobKeys(w.job), ...w.needs.map(labelKey)], ciJobKey(w.job.repo, w.job.jobName))
  return (
    <li {...link} className={`${link.className} flex min-w-0 flex-wrap items-center gap-1.5 py-1.5 pr-2.5 pl-6`} data-testid={`ci-waiting-${w.job.id}`} data-status="waiting">
      <StatusMark status="waiting" label="Waiting for a machine" />
      <JobName name={w.job.jobName} url={w.job.htmlUrl} />
      <span className={CHIP}>{w.app}</span>
      {w.job.prNumber != null && <span className={`${CHIP} font-mono`}>#{w.job.prNumber}</span>}
      <span className="ml-auto font-mono text-2xs font-bold text-st-waiting-ink tabular-nums">{durationWords(w.waitS)}</span>
    </li>
  )
}

/**
 * "◷ 8 waiting for kensaurus-local": one header per label set instead of the same chip on every
 * row (2026-11-18). It carries the `label:` key, so pointing at it lights the machine tiles that
 * have (or lack) the label; red when an idle machine is not set up for it.
 */
function WaitingGroupHeader({ g }: { g: WaitingGroup }) {
  const keys = g.needs.length > 0 ? g.needs.map(labelKey) : [...new Set(g.jobs.map((w) => ciRepoKey(w.job.repo)))]
  const link = useCiLink(keys, keys[0] ?? `waiting:${g.key}`)
  const n = g.jobs.length
  return (
    <li {...link} className={`${link.className} flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 py-1`} data-testid={`ci-waiting-group-${g.key || 'cloud'}`} data-status="waiting">
      <StatusMark status="waiting" />
      <span className="text-xs font-bold text-st-waiting-ink tabular-nums">
        {n} waiting for{g.needs.length === 0 ? ' a machine' : ''}
      </span>{' '}
      {g.needs.map((l) => (
        <span
          key={l}
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-2xs font-bold ${g.mismatch ? STATUS_SOFT.failed + ' text-st-failed-ink' : STATUS_SOFT.waiting + ' text-st-waiting-ink'}`}
          title={g.mismatch ? `Needs “${l}”: an idle machine is not set up for it` : `Needs a “${l}” machine`}
          data-testid="ci-waiting-label"
        >
          {g.mismatch && <StatusMark status="failed" size={9} />}
          {l}
        </span>
      ))}
    </li>
  )
}

/** Waiting jobs shown under their headers before "+N more"; every group's header always shows. */
const WAITING_ROWS = 8

function WaitingGroups({ groups, total }: { groups: WaitingGroup[]; total: number }) {
  let left = WAITING_ROWS
  const shown = groups.map((g) => {
    const jobs = g.jobs.slice(0, Math.max(0, left))
    left -= jobs.length
    return { g, jobs }
  })
  const hidden = total - shown.reduce((n, s) => n + s.jobs.length, 0)
  return (
    <>
      {shown.map(({ g, jobs }) => (
        <Fragment key={g.key}>
          <WaitingGroupHeader g={g} />
          {jobs.map((w) => (
            <WaitingRow key={w.job.id} w={w} />
          ))}
        </Fragment>
      ))}
      {hidden > 0 && <li className="px-2.5 py-1 text-2xs text-fg-secondary">+{hidden} more waiting in the queue below</li>}
    </>
  )
}

function LogsMenu({ hits }: { hits: FailureCause['hits'] }) {
  const logs = hits.filter((h) => h.failure.job.htmlUrl)
  if (logs.length === 0) return null
  return (
    <details className="relative">
      <summary className="inline-flex h-6 cursor-pointer list-none items-center gap-1 rounded-sm border border-edge bg-surface-raised px-1.5 text-2xs font-semibold text-fg hover:border-accent focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none" aria-label={`${logs.length} logs`}>
        <IconExternalLink size={11} /> logs
      </summary>
      <ul className="ci-rise absolute top-full right-0 z-20 mt-1 min-w-48 rounded-sm border border-edge bg-surface-root py-1 shadow-raised">
        {logs.map(({ group, failure }) => (
          <li key={failure.job.id}>
            <a href={failure.job.htmlUrl!} target="_blank" rel="noopener noreferrer" className="block px-2.5 py-1 text-xs text-fg hover:bg-surface-overlay">
              {group.app} {group.prNumber != null ? `#${group.prNumber}` : group.branch ?? ''} · {failure.job.jobName}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** One cause across several PRs: a red card, app and PR chips, one logs menu. */
function CauseCard({ c }: { c: FailureCause }) {
  const keys = [...c.apps.map((a) => ciRepoKey(a.repo)), ...c.hits.map((h) => ciJobKey(h.failure.job.repo, h.failure.job.jobName))]
  const link = useCiLink(keys, keys[0] ?? c.key)
  const prs = new Set(c.hits.map((h) => h.group.key)).size
  return (
    <li {...link} className={`${link.className} rounded-md border border-st-failed/55 bg-st-failed-soft px-2.5 py-2`} data-testid={`ci-cause-${c.key}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusMark status="failed" label="Failed" />
        <span className="truncate text-sm font-bold text-fg">{c.step}</span>
        <span className="font-mono text-2xs font-bold text-st-failed-ink tabular-nums">
          {prs} PRs · {c.apps.length} {c.apps.length === 1 ? 'app' : 'apps'}
        </span>
        <span className="ml-auto">
          <LogsMenu hits={c.hits} />
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {c.apps.map((a) => (
          <span key={a.repo} className={CHIP}>
            {a.app}
          </span>
        ))}
        {c.hits.map((h) => (
          <span key={h.failure.job.id} className={`${CHIP} font-mono font-normal text-fg-secondary`} title={`${h.group.app} · ${h.failure.job.jobName}`}>
            {h.group.prNumber != null ? `#${h.group.prNumber}` : h.group.branch ?? 'branch'}
          </span>
        ))}
      </div>
    </li>
  )
}

function failureStatus(f: RecentFailure): RunStatus {
  return f.kind === 'code' ? 'failed' : 'cancelled'
}

/** One failure on its own: ✕, app, PR, step, log. */
function SingleRow({ group: g, failure: f, step }: { group: FailureGroup; failure: RecentFailure; step: string | null }) {
  const link = useCiLink([ciRepoKey(g.repo), ...ciJobKeys(f.job)], ciJobKey(f.job.repo, f.job.jobName))
  const what = f.kind === 'code' ? step ?? 'failed' : f.kind === 'machine' ? 'machine stopped · re-run' : 'cancelled before a machine took it'
  return (
    <li {...link} className={`${link.className} flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 py-1.5`} data-testid={`ci-broke-${g.key}`}>
      <StatusMark status={failureStatus(f)} label={f.kind === 'code' ? 'Failed' : 'Did not finish'} />
      <span className={CHIP}>{g.app}</span>
      <span className={`${CHIP} font-mono`}>{g.prNumber != null ? `#${g.prNumber}` : g.branch ?? 'branch'}</span>
      <span className="truncate text-xs font-bold text-fg">{f.job.jobName}</span>
      <span className="truncate text-2xs text-fg-secondary">{what}</span>
      {f.job.htmlUrl && (
        <a href={f.job.htmlUrl} target="_blank" rel="noopener noreferrer" className={`ml-auto ${LINK_ACCENT}`} aria-label={`Log: ${f.job.jobName}`} title="Open the log on GitHub">
          <IconExternalLink size={12} />
        </a>
      )}
    </li>
  )
}

const DELAY: Record<NonNullable<CiStatus['apps'][number]['delay']> | 'none', { status: RunStatus; word: string }> = {
  waiting: { status: 'waiting', word: 'waits' },
  failing: { status: 'failed', word: 'failing' },
  slow: { status: 'slow', word: 'long runs' },
  none: { status: 'passed', word: 'fine' },
}

/** One app's week; pointing at it lights the app across the page. */
function AppTimeRow({ a, maxWait, maxRun }: { a: CiStatus['apps'][number]; maxWait: number; maxRun: number }) {
  const link = useCiLink([ciRepoKey(a.repo)], ciRepoKey(a.repo))
  const d = DELAY[a.delay ?? 'none']
  const pass = a.passRate == null ? null : Math.round(a.passRate * 100)
  return (
    <tr {...link} className={link.className}>
      <DataTableCell className="font-semibold">{a.app}</DataTableCell>
      <DataTableCell>
        {a.waitP95S != null ? <BarCell value={a.waitP95S} max={maxWait} tone={a.delay === 'waiting' ? 'warn' : 'heat'} text={durationWords(a.waitP95S)} widthClass="w-20" /> : '—'}
      </DataTableCell>
      <DataTableCell>
        {a.runP50S != null ? <BarCell value={a.runP50S} max={maxRun} tone={a.delay === 'slow' ? 'warn' : 'neutral'} text={durationWords(a.runP50S)} widthClass="w-20" /> : '—'}
      </DataTableCell>
      <DataTableCell>
        {pass != null ? <BarCell value={pass} max={100} tone={pass < 80 ? 'danger' : 'ok'} text={`${pass}%`} widthClass="w-16" /> : '—'}
      </DataTableCell>
      <DataTableCell>
        <StatusPill status={d.status} label={d.word} />
      </DataTableCell>
    </tr>
  )
}

export function CiStatusBoard({ overview }: { overview: CiOverview }) {
  const now = useNow(30_000)
  const status = useMemo(() => buildCiStatus(overview, now), [overview, now])
  const grouped = useMemo(() => groupFailures(overview, now), [overview, now])
  // Draft PRs skip CI on purpose: one line under the list, never a failure each.
  const drafts = grouped.filter((g) => g.draftOnly)
  const { causes, singles } = useMemo(() => groupFailureCauses(grouped), [grouped])
  const brokePrs = grouped.filter((g) => !g.draftOnly).length
  const maxWait = Math.max(1, ...status.apps.map((a) => a.waitP95S ?? 0))
  const maxRun = Math.max(1, ...status.apps.map((a) => a.runP50S ?? 0))
  const machines = status.allMachines

  return (
    // The wrapper is the container: a container query never matches the container element itself.
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-4 @min-[72rem]:grid-cols-2" data-testid="ci-status-board">
        {/* The one-sentence answer, for screen readers; the tiles below say it as pictures. */}
        <p className="sr-only" data-testid="ci-status-headline" role="status">
          {status.headline}
        </p>

        {/* 1. Which machine is doing what? */}
        <section aria-labelledby="ci-machines-now" className={BOARD_SPAN}>
          <h3 id="ci-machines-now" className={H3}>
            Machines right now
            <span className="flex items-center gap-2 font-normal text-fg-secondary">
              <span className="inline-flex items-center gap-1"><StatusMark status="running" size={9} /> running</span>
              <span className="inline-flex items-center gap-1"><StatusMark status="idle" size={9} /> idle</span>
              <span className="inline-flex items-center gap-1"><StatusMark status="failed" size={9} /> offline</span>
            </span>
          </h3>
          {machines.length > 0 ? (
            <ul className={`grid grid-cols-1 gap-2 ${MACHINE_GRID}`} data-testid="ci-machines-now">
              {machines.map((m) => (
                <MachineCard key={m.id} m={m} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-secondary">No machine has reported in.</p>
          )}
        </section>

        {/* 2. When will each job finish, and what waits? */}
        <section aria-labelledby="ci-running-now" className="min-w-0">
          <h3 id="ci-running-now" className={H3}>
            Running now
            <StatusPill status="running" label={String(status.running.length)} />
            {status.waitingJobs.length > 0 && <StatusPill status="waiting" label={`${status.waitingJobs.length} waiting`} />}
          </h3>
          {status.running.length === 0 && status.waitingJobs.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <StatusMark status="idle" /> Nothing running or waiting.
            </p>
          ) : (
            <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle" data-testid="ci-running-now">
              {status.running.map((r) => (
                <RunningRow key={r.job.id} r={r} />
              ))}
              <WaitingGroups groups={status.waitingGroups} total={status.waitingJobs.length} />
            </ul>
          )}
        </section>

        {/* 3. What broke, and where? */}
        <section aria-labelledby="ci-broke" className="min-w-0">
          <h3 id="ci-broke" className={H3}>
            What broke in the last 2 hours
            {brokePrs > 0 ? <StatusPill status="failed" label={`${brokePrs} PR${brokePrs === 1 ? '' : 's'}`} /> : <StatusPill status="passed" label="none" />}
          </h3>
          {(causes.length > 0 || singles.length > 0) && (
            <div className="flex flex-col gap-2" data-testid="ci-broke">
              {causes.length > 0 && (
                <ul className="flex flex-col gap-2" data-testid="ci-causes">
                  {causes.map((c) => (
                    <CauseCard key={c.key} c={c} />
                  ))}
                </ul>
              )}
              {singles.length > 0 && (
                <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle">
                  {singles.slice(0, 8).map((s) => (
                    <SingleRow key={`${s.group.key}|${s.failure.job.id}`} {...s} />
                  ))}
                  {singles.length > 8 && <li className="px-2.5 py-1 text-2xs text-fg-secondary">+{singles.length - 8} more in the queue below</li>}
                </ul>
              )}
            </div>
          )}
          {drafts.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-2xs text-fg-secondary" data-testid="ci-broke-drafts">
              <StatusMark status="cancelled" />
              <span>{drafts.length} draft {drafts.length === 1 ? 'PR' : 'PRs'} skip CI:</span>
              {drafts.map((g) => (
                <span key={g.key} className={`${CHIP} font-normal`}>
                  {g.app} {g.prNumber ? `#${g.prNumber}` : 'branch'}
                </span>
              ))}
              <span>Mark one ready for review to run it.</span>
            </p>
          )}
        </section>

        {/* 4. Where does each app's time go this week? */}
        <section aria-labelledby="ci-time" className={BOARD_SPAN}>
          <h3 id="ci-time" className={H3}>
            Where the time goes this week
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 text-left text-xs" data-testid="ci-time-by-app">
              <thead>
                <tr>
                  <DataTableHead>App</DataTableHead>
                  <DataTableHead>
                    <span title="1 job in 20 waits this long or longer for a free machine">Wait (1 in 20)</span>
                  </DataTableHead>
                  <DataTableHead>
                    <span title="Half the jobs finish within this">Usual run</span>
                  </DataTableHead>
                  <DataTableHead>Pass</DataTableHead>
                  <DataTableHead>Main delay</DataTableHead>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-subtle">
                {status.apps.map((a) => (
                  <AppTimeRow key={a.repo} a={a} maxWait={maxWait} maxRun={maxRun} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
