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
 *
 *          2026-11-19: every failed row has "Why?" and every live row "Inspect" (the debug drawer,
 *          CiJobDebug.tsx). With All apps and two or more apps, "Running now" and "What broke"
 *          become one section per app (AppGroupSection, lib/ciDebug buildCiAppGroups): worst app
 *          first, its cards, live jobs and failures under it, healthy apps collapsed. Causes and
 *          cards that span apps are said once, above the apps.
 */
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  machinePresence,
  machinePresenceWord,
} from '../../lib/ciStatus'
import type { RecentFailure } from '../../lib/ciAttention'
import type { CiAlert } from '../../lib/ciAlerts'
import { buildCiAppGroups, type CiAppGroup } from '../../lib/ciDebug'
import { AppGroupSection } from '../ui/app-group'
import { CiAlertStrip } from './CiAlertStrip'
import { CiWhyButton } from './CiJobDebug'
import { fixLinkKey, type CiFixLinks } from '../../lib/ciView'
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

/** The tile's left edge: the only frame a machine gets inside its section (one level of card, 2026-11-18). */
const MACHINE_EDGE: Record<MachineState, string> = {
  idle: 'border-edge',
  running: 'border-st-running',
  failed: 'border-st-failed',
}

type MachineState = 'idle' | 'running' | 'failed'

// One status per machine on every tab (lib/ciStatus machinePresence): Speed and cost and Settings read it too.
function machineStatus(m: MachineNow): MachineState {
  const p = machinePresence(m)
  return p === 'offline' ? 'failed' : p
}

const machineWord = machinePresenceWord

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
/**
 * Labels two or more idle machines lack: one line under the tiles instead of the same red chip on
 * each ("missing kensaurus-local" twice, 2026-11-18). Label → the machines that lack it.
 *
 */
export function sharedMissingLabels(machines: ReadonlyArray<Pick<MachineNow, 'name' | 'missingLabels'>>): Map<string, string[]> {
  const by = new Map<string, string[]>()
  for (const m of machines) for (const l of m.missingLabels ?? []) by.set(l, [...(by.get(l) ?? []), m.name])
  return new Map([...by].filter(([, names]) => names.length > 1))
}

/** One line per label several idle machines lack: the reason jobs wait while they sit idle. */
export function MissingLabelsLine({ shared }: { shared: Map<string, string[]> }) {
  if (shared.size === 0) return null
  return (
    <ul className="mt-1.5 flex flex-col gap-1" data-testid="ci-machines-missing-shared">
      {[...shared].map(([label, names]) => (
        <li key={label} className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-secondary">
          <span className="inline-flex items-center gap-1 rounded-sm border border-st-failed/55 bg-st-failed-soft px-1.5 py-px font-bold text-st-failed-ink" data-testid="ci-machine-missing-label">
            <StatusMark status="failed" size={9} />
            missing {label}
          </span>
          <span>{names.join(', ')} sit idle: no runner with this label, which waiting jobs need.</span>
        </li>
      ))}
    </ul>
  )
}

export function MachineCard({ m, testId, sharedMissing }: { m: MachineNow; testId?: string; sharedMissing?: ReadonlyMap<string, string[]> }) {
  const ownMissing = (m.missingLabels ?? []).filter((l) => !sharedMissing?.has(l))
  const keys = [...(m.runnerNames ?? []).map(ciRunnerKey), ...(m.labels ?? []).map(labelKey), ...(m.missingLabels ?? []).map(labelKey), `machine:${m.id}`]
  const link = useCiLink(keys, keys[0] ?? `machine:${m.id}`)
  const status = machineStatus(m)
  const dots = Math.min(m.running, 8)
  return (
    <li {...link} className={`${link.className} min-w-0`} data-testid={testId ?? `ci-machine-${m.id}`} data-status={status}>
      <div className={`flex h-full flex-col gap-1.5 border-l-2 py-1 pr-1 pl-2.5 ${MACHINE_EDGE[status]}`}>
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
        {((m.labels?.length ?? 0) > 0 || ownMissing.length > 0) && (
          <span className="flex flex-wrap gap-1" data-testid="ci-machine-labels">
            {ownMissing.map((l) => (
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

/**
 * "Fix" beside a live job that belongs to a Mushi Mushi fix. Running and waiting jobs are listed
 * once, here; the queue under the week shows only finished ones (2026-11-18), so the fix link
 * the queue's live cards carried lives on these rows.
 */
function FixLink({ job, fixLinks }: { job: RunningNow['job']; fixLinks?: CiFixLinks }) {
  const fix = job.prNumber != null ? fixLinks?.get(fixLinkKey(job.repo, job.prNumber)) : undefined
  if (!fix) return null
  return (
    <Link to={`/reports/${fix.reportId}`} className={`text-2xs font-medium whitespace-nowrap ${LINK_ACCENT}`} data-testid="ci-live-fix-link">
      Open the fix in Mushi Mushi
    </Link>
  )
}

/**
 * The app and PR every live job shares, said once in the "Running now" header (round 3,
 * 2026-11-19: "glot.it" and "#1081" on all five rows). Null when they differ.
 *
 * @internal Exported for tests.
 */
export function sharedLiveOrigin(jobs: ReadonlyArray<{ app: string; job: { prNumber: number | null } }>): { app: string; prNumber: number | null } | null {
  if (jobs.length < 2) return null
  const { app, job } = jobs[0]
  return jobs.every((j) => j.app === app && j.job.prNumber === job.prNumber) ? { app, prNumber: job.prNumber } : null
}

/**
 * One running job; pointing at it lights its app, job and runner across the page. The machine is
 * its tile's business (the tile above lists the jobs on it), so a row names it only on hover.
 */
function RunningRow({ r, fixLinks, hideOrigin = false }: { r: RunningNow; fixLinks?: CiFixLinks; hideOrigin?: boolean }) {
  const link = useCiLink(ciJobKeys(r.job), ciJobKey(r.job.repo, r.job.jobName))
  const status: RunStatus = r.slow ? 'slow' : 'running'
  return (
    <li
      {...link}
      className={`${link.className} grid grid-cols-1 items-center gap-x-3 gap-y-1 px-2.5 py-1.5 @xl:grid-cols-2`}
      data-testid={`ci-running-${r.job.id}`}
      data-status={status}
      title={r.machine ? `On ${r.machine.name}` : undefined}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StatusMark status={status} label={r.slow ? 'Running slower than usual' : 'Running'} />
        <JobName name={r.job.jobName} url={r.job.htmlUrl} />
        {!hideOrigin && <span className={CHIP}>{r.app}</span>}
        {!hideOrigin && r.job.prNumber != null && <span className={`${CHIP} font-mono`}>#{r.job.prNumber}</span>}
        <FixLink job={r.job} fixLinks={fixLinks} />
        <CiWhyButton jobId={r.job.id} label="Inspect" title="The live steps, and Cancel run" />
      </span>
      {r.elapsedS != null && <RunBar elapsedS={r.elapsedS} usualS={r.usualS} label={runLabel(r)} />}
    </li>
  )
}

/** One job waiting for a machine, under its group's header: mark, job, app, PR, wait. */
function WaitingRow({ w, fixLinks, hideOrigin = false }: { w: WaitingNow; fixLinks?: CiFixLinks; hideOrigin?: boolean }) {
  const link = useCiLink([...ciJobKeys(w.job), ...w.needs.map(labelKey)], ciJobKey(w.job.repo, w.job.jobName))
  return (
    <li {...link} className={`${link.className} flex min-w-0 flex-wrap items-center gap-1.5 py-1.5 pr-2.5 pl-6`} data-testid={`ci-waiting-${w.job.id}`} data-status="waiting">
      <StatusMark status="waiting" label="Waiting for a machine" />
      <JobName name={w.job.jobName} url={w.job.htmlUrl} />
      {!hideOrigin && <span className={CHIP}>{w.app}</span>}
      {!hideOrigin && w.job.prNumber != null && <span className={`${CHIP} font-mono`}>#{w.job.prNumber}</span>}
      <FixLink job={w.job} fixLinks={fixLinks} />
      <span className="ml-auto font-mono text-2xs font-bold text-st-waiting-ink tabular-nums">{durationWords(w.waitS)}</span>
      <CiWhyButton jobId={w.job.id} label="Inspect" title="What it waits for, and Cancel run" />
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
      {/* The label in the waiting colour: the red "missing <label>" under the machines already
          says no idle machine has it, so a second red cross here said it twice (round 3). */}
      {g.needs.map((l) => (
        <span
          key={l}
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-2xs font-bold ${STATUS_SOFT.waiting} text-st-waiting-ink`}
          title={g.mismatch ? `Needs “${l}”: an idle machine is not set up for it` : `Needs a “${l}” machine`}
          data-testid="ci-waiting-label"
          data-mismatch={g.mismatch || undefined}
        >
          {l}
        </span>
      ))}
    </li>
  )
}

/** Waiting jobs shown under their headers before "+N more"; every group's header always shows. */
const WAITING_ROWS = 8

function WaitingGroups({ groups, total, fixLinks, hideOrigin = false }: { groups: WaitingGroup[]; total: number; fixLinks?: CiFixLinks; hideOrigin?: boolean }) {
  // The rest on request, here: the queue below no longer lists live jobs a second time.
  const [all, setAll] = useState(false)
  let left = all ? total : WAITING_ROWS
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
            <WaitingRow key={w.job.id} w={w} fixLinks={fixLinks} hideOrigin={hideOrigin} />
          ))}
        </Fragment>
      ))}
      {hidden > 0 && (
        <li className="px-2.5 py-1">
          <button type="button" className={`text-2xs font-medium ${LINK_ACCENT}`} onClick={() => setAll(true)} data-testid="ci-waiting-more">
            Show {hidden} more waiting
          </button>
        </li>
      )}
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
        <span className="ml-auto flex items-center gap-1">
          <CiWhyButton jobId={c.hits[0]?.failure.job.id} />
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
      <span className="ml-auto flex items-center gap-1.5">
        <CiWhyButton jobId={f.job.id} />
        {f.job.htmlUrl && (
          <a href={f.job.htmlUrl} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT} aria-label={`Log: ${f.job.jobName}`} title="Open the log on GitHub">
            <IconExternalLink size={12} />
          </a>
        )}
      </span>
    </li>
  )
}

const DELAY: Record<NonNullable<CiStatus['apps'][number]['delay']> | 'none', { status: RunStatus; word: string }> = {
  waiting: { status: 'waiting', word: 'waits' },
  failing: { status: 'failed', word: 'failing' },
  slow: { status: 'slow', word: 'long runs' },
  none: { status: 'passed', word: 'fine' },
}

/** A number that never breaks inside ("18 / min" at 390 px, 2026-11-18). */
const nw = (text: string) => <span className="whitespace-nowrap">{text}</span>

/**
 * The delay every app shares, or null when they differ. Nine "waits" pills in a column said one
 * thing nine times (2026-11-18): then the header says it once and the column goes.
 *
 * @internal Exported for tests.
 */
export function sharedDelay(apps: ReadonlyArray<Pick<CiStatus['apps'][number], 'delay'>>): keyof typeof DELAY | null {
  if (apps.length < 2) return null
  const first = apps[0].delay ?? 'none'
  return apps.every((a) => (a.delay ?? 'none') === first) ? first : null
}

/** Share of apps one delay must cover before the header names it once ("most apps: waits"). */
const MOST_APPS = 0.75

/**
 * The delay most apps share (at least 3 apps and 3 in 4 of them), and whether every app does.
 * "waits" on 9 of 10 rows said one thing nine times (2026-11-18): the header says it once and
 * only the rows that differ keep a pill.
 *
 * @internal Exported for tests.
 */
export function commonDelay(apps: ReadonlyArray<Pick<CiStatus['apps'][number], 'delay'>>): { delay: keyof typeof DELAY; every: boolean } | null {
  const all = sharedDelay(apps)
  if (all) return { delay: all, every: true }
  if (apps.length < 3) return null
  const counts = new Map<keyof typeof DELAY, number>()
  for (const a of apps) counts.set(a.delay ?? 'none', (counts.get(a.delay ?? 'none') ?? 0) + 1)
  const [delay, n] = [...counts].sort((x, y) => y[1] - x[1])[0]
  return n / apps.length >= MOST_APPS ? { delay, every: false } : null
}

function WaitBar({ a, maxWait }: { a: CiStatus['apps'][number]; maxWait: number }) {
  return a.waitP95S != null ? <BarCell value={a.waitP95S} max={maxWait} tone={a.delay === 'waiting' ? 'warn' : 'heat'} text={nw(durationWords(a.waitP95S))} widthClass="w-20" /> : <>—</>
}
function RunBarCell({ a, maxRun }: { a: CiStatus['apps'][number]; maxRun: number }) {
  return a.runP50S != null ? <BarCell value={a.runP50S} max={maxRun} tone={a.delay === 'slow' ? 'warn' : 'neutral'} text={nw(durationWords(a.runP50S))} widthClass="w-20" /> : <>—</>
}
function passOf(a: CiStatus['apps'][number]): number | null {
  return a.passRate == null ? null : Math.round(a.passRate * 100)
}

/** One app's week; pointing at it lights the app across the page. */
function AppTimeRow({ a, maxWait, maxRun, column, showDelay }: { a: CiStatus['apps'][number]; maxWait: number; maxRun: number; column: boolean; showDelay: boolean }) {
  const link = useCiLink([ciRepoKey(a.repo)], ciRepoKey(a.repo))
  const d = DELAY[a.delay ?? 'none']
  const pass = passOf(a)
  return (
    <tr {...link} className={link.className}>
      <DataTableCell className="font-semibold">
        {a.app}
        {/* Most apps share one delay (the header names it): the few that differ say so beside the name, not in a column of blanks (round 3). */}
        {!column && showDelay && <StatusPill status={d.status} label={d.word} className="ml-1.5" />}
      </DataTableCell>
      <DataTableCell>
        <WaitBar a={a} maxWait={maxWait} />
      </DataTableCell>
      <DataTableCell>
        <RunBarCell a={a} maxRun={maxRun} />
      </DataTableCell>
      <DataTableCell>
        {pass != null ? <BarCell value={pass} max={100} tone={pass < 80 ? 'danger' : 'ok'} text={nw(`${pass}%`)} widthClass="w-16" /> : '—'}
      </DataTableCell>
      {column && <DataTableCell>{showDelay && <StatusPill status={d.status} label={d.word} />}</DataTableCell>}
    </tr>
  )
}

/** The same app on a phone: name and pass rate on one line, wait and run bars under it. */
function AppTimeCard({ a, maxWait, maxRun, showDelay }: { a: CiStatus['apps'][number]; maxWait: number; maxRun: number; showDelay: boolean }) {
  const link = useCiLink([ciRepoKey(a.repo)], ciRepoKey(a.repo))
  const d = DELAY[a.delay ?? 'none']
  const pass = passOf(a)
  return (
    <li {...link} className={`${link.className} flex flex-col gap-1 py-1.5`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-semibold text-fg">{a.app}</span>
        {pass != null && (
          <span className={`ml-auto shrink-0 font-mono text-2xs font-bold whitespace-nowrap tabular-nums ${pass < 80 ? 'text-st-failed-ink' : 'text-st-passed-ink'}`}>{pass}% pass</span>
        )}
        {showDelay && <StatusPill status={d.status} label={d.word} className={pass == null ? 'ml-auto' : ''} />}
      </span>
      <span
        // mushi-mushi-allowlist: label / bar columns (auto + the rest of the row)
        className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 text-2xs text-fg-secondary"
      >
        <span>Wait (1 in 20)</span>
        <WaitBar a={a} maxWait={maxWait} />
        <span>Usual run</span>
        <RunBarCell a={a} maxRun={maxRun} />
      </span>
    </li>
  )
}

/** An app group's right side: its pass rate as a bar, its slow wait, and "Open" (switches to that app). */
function AppGroupSummary({ g, onOpenApp }: { g: CiAppGroup; onOpenApp?: (id: string) => void }) {
  const pass = g.passRate == null ? null : Math.round(g.passRate * 100)
  return (
    <span className="flex items-center gap-2">
      {pass != null && <BarCell value={pass} max={100} tone={pass < 80 ? 'danger' : 'ok'} text={nw(`${pass}% pass`)} widthClass="w-14" />}
      {g.waitP95S != null && g.waitP95S >= 60 && (
        <span className="font-mono text-2xs font-bold text-fg-secondary tabular-nums" title="1 job in 20 waits this long for a machine">
          wait {durationWords(g.waitP95S)}
        </span>
      )}
      {onOpenApp && (
        <button type="button" className={`text-2xs font-medium ${LINK_ACCENT}`} onClick={() => onOpenApp(g.id)} aria-label={`Open ${g.name} only`} data-testid={`ci-app-open-${g.id}`}>
          Open →
        </button>
      )}
    </span>
  )
}

/** One app: its cards, live jobs and failures, worst first. */
function AppGroupBody({ g, overview, status, now, fixLinks }: { g: CiAppGroup; overview: CiOverview; status: CiStatus; now: number; fixLinks?: CiFixLinks }) {
  const live = g.running.length + g.waiting.length > 0
  const broke = g.causes.length + g.singles.length > 0
  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {g.alerts.length > 0 && (
        <CiAlertStrip overview={overview} status={status} now={now} alerts={g.alerts} emptyText={null} testIdPrefix={`ci-app-${g.id}`} maxShown={3} columns={3} showPinned={false} />
      )}
      {g.causes.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid={`ci-app-causes-${g.id}`}>
          {g.causes.map((c) => (
            <CauseCard key={c.key} c={c} />
          ))}
        </ul>
      )}
      {g.singles.length > 0 && (
        <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle" data-testid={`ci-app-broke-${g.id}`}>
          {g.singles.slice(0, 8).map((s) => (
            <SingleRow key={`${s.group.key}|${s.failure.job.id}`} {...s} />
          ))}
          {g.singles.length > 8 && <li className="px-2.5 py-1 text-2xs text-fg-secondary">+{g.singles.length - 8} more in the queue below</li>}
        </ul>
      )}
      {live && (
        <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle" data-testid={`ci-app-live-${g.id}`}>
          {g.running.map((r) => (
            <RunningRow key={r.job.id} r={r} fixLinks={fixLinks} hideOrigin />
          ))}
          {g.waiting.map((w) => (
            <WaitingRow key={w.job.id} w={w} fixLinks={fixLinks} hideOrigin />
          ))}
        </ul>
      )}
      {!live && !broke && g.alerts.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <StatusMark status="passed" size={10} /> Nothing broke in the last 2 hours; nothing running.
        </p>
      )}
    </div>
  )
}

/**
 * "Right now" for All apps, one section per app (2026-11-19). The app holding the worst row leads;
 * a healthy app starts collapsed. A cause seen in several apps is said once, above them.
 */
function AppGroups({
  overview,
  status,
  now,
  alerts,
  causes,
  singles,
  fixLinks,
  onOpenApp,
}: {
  overview: CiOverview
  status: CiStatus
  now: number
  alerts: readonly CiAlert[]
  causes: FailureCause[]
  singles: Array<{ group: FailureGroup; failure: RecentFailure; step: string | null }>
  fixLinks?: CiFixLinks
  onOpenApp?: (id: string) => void
}) {
  const groups = useMemo(() => buildCiAppGroups({ overview, status, alerts, causes, singles }), [overview, status, alerts, causes, singles])
  return (
    <section aria-labelledby="ci-by-app" className={`min-w-0 ${BOARD_SPAN}`} data-testid="ci-by-app">
      <h3 id="ci-by-app" className={H3}>
        By app
        <span className="font-normal text-fg-secondary">worst first</span>
      </h3>
      {groups.shared.causes.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-2xs font-semibold text-fg-secondary">Across apps</p>
          <ul className="flex flex-col gap-2" data-testid="ci-causes-shared">
            {groups.shared.causes.map((c) => (
              <CauseCard key={c.key} c={c} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col">
        {groups.apps.map((g) => (
          <AppGroupSection
            // Re-keyed when its health flips: AppGroupSection reads defaultOpen once, and an app that
            // turns red on the next poll must open, not stay collapsed.
            key={`${g.id}:${g.healthy}`}
            app={{ id: g.id, name: g.name }}
            counts={g.counts}
            countLabels={{ cancelled: 'stopped', slow: 'slow', waiting: 'waiting' }}
            summary={<AppGroupSummary g={g} onOpenApp={onOpenApp} />}
            defaultOpen={!g.healthy}
            data-testid={`ci-app-group-${g.id}`}
          >
            <AppGroupBody g={g} overview={overview} status={status} now={now} fixLinks={fixLinks} />
          </AppGroupSection>
        ))}
      </div>
    </section>
  )
}

interface CiStatusBoardProps {
  overview: CiOverview
  fixLinks?: CiFixLinks
  /** All apps with two or more apps: "Running now" and "What broke" become one section per app. */
  groupByApp?: boolean
  /** The page's ranked cards, filed under their app when grouped. */
  alerts?: readonly CiAlert[]
  /** "Open →" on an app's group: switch the page to that app. */
  onOpenApp?: (id: string) => void
}

export function CiStatusBoard({ overview, fixLinks, groupByApp = false, alerts = [], onOpenApp }: CiStatusBoardProps) {
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
  const sharedMissing = useMemo(() => sharedMissingLabels(machines), [machines])
  const common = commonDelay(status.apps)
  // A row keeps its delay pill only where it differs from the one the header names.
  const showDelayOf = (a: CiStatus['apps'][number]) => !common || (a.delay ?? 'none') !== common.delay
  // A column only when there is no shared delay to name: with one, the rows that differ say so beside their name.
  const delayColumn = !common
  const origin = sharedLiveOrigin([...status.running, ...status.waitingJobs])

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
                <MachineCard key={m.id} m={m} sharedMissing={sharedMissing} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-secondary">No machine has reported in.</p>
          )}
          <MissingLabelsLine shared={sharedMissing} />
        </section>

        {groupByApp && (
          <AppGroups overview={overview} status={status} now={now} alerts={alerts} causes={causes} singles={singles} fixLinks={fixLinks} onOpenApp={onOpenApp} />
        )}

        {/* 2. When will each job finish, and what waits? */}
        {!groupByApp && (
        <section aria-labelledby="ci-running-now" className="min-w-0">
          <h3 id="ci-running-now" className={H3}>
            Running now
            {/* Nothing live: the line below says so; a "0" pill beside it said it twice (round 3). */}
            {(status.running.length > 0 || status.waitingJobs.length > 0) && <StatusPill status="running" label={String(status.running.length)} />}
            {status.waitingJobs.length > 0 && <StatusPill status="waiting" label={`${status.waitingJobs.length} waiting`} />}
            {origin && (
              <span className="inline-flex items-center gap-1 font-normal" data-testid="ci-running-origin">
                <span className={CHIP}>{origin.app}</span>
                {origin.prNumber != null && <span className={`${CHIP} font-mono`}>#{origin.prNumber}</span>}
              </span>
            )}
          </h3>
          {status.running.length === 0 && status.waitingJobs.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <StatusMark status="idle" /> Nothing running or waiting.
            </p>
          ) : (
            <ul className="divide-y divide-edge-subtle rounded-md border border-edge-subtle" data-testid="ci-running-now">
              {status.running.map((r) => (
                <RunningRow key={r.job.id} r={r} fixLinks={fixLinks} hideOrigin={origin != null} />
              ))}
              <WaitingGroups groups={status.waitingGroups} total={status.waitingJobs.length} fixLinks={fixLinks} hideOrigin={origin != null} />
            </ul>
          )}
        </section>
        )}

        {/* 3. What broke, and where? */}
        {!groupByApp && (
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
        )}

        {/* 4. Where does each app's time go this week? */}
        <section aria-labelledby="ci-time" className={BOARD_SPAN}>
          <h3 id="ci-time" className={H3}>
            Where the time goes this week
            {common && (
              <span className="inline-flex items-center gap-1 font-normal text-fg-secondary" data-testid="ci-time-shared-delay">
                {common.every ? 'every app' : 'most apps'}: <StatusPill status={DELAY[common.delay].status} label={DELAY[common.delay].word} />
              </span>
            )}
          </h3>
          {/* A phone gets one stacked row per app; the table (with its pass column) from a wider board. */}
          <ul className="divide-y divide-edge-subtle @xl:hidden" data-testid="ci-time-by-app-stacked">
            {status.apps.map((a) => (
              <AppTimeCard key={a.repo} a={a} maxWait={maxWait} maxRun={maxRun} showDelay={showDelayOf(a)} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto @xl:block">
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
                  {delayColumn && <DataTableHead>Main delay</DataTableHead>}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-subtle">
                {status.apps.map((a) => (
                  <AppTimeRow key={a.repo} a={a} maxWait={maxWait} maxRun={maxRun} column={delayColumn} showDelay={showDelayOf(a)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
