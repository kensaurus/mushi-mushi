/**
 * FILE: apps/admin/src/components/pipeline/WorkerLaneCard.tsx
 * PURPOSE: One local worker lane (one app on one machine) on the Workers tab:
 *          its settings (model, mode, how many at once, pause, drain, stop
 *          date; an audit lane's veto model), what it runs now, its queue in
 *          order, and its last runs. Conflict and audit runs hold no report,
 *          so they show as text, not a report link.
 *          Each change saves just that setting; the machine reads it at its
 *          next heartbeat, within a minute. A run in flight shows its stage,
 *          how long it has been there and its last log lines (ADR 0048
 *          amendment 2026-10-28), with "Stop this run".
 */

import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { Link } from 'react-router-dom'
import { Badge, Btn, Input, SelectField, Toggle } from '../ui'
import { IconChevronDown, IconChevronUp, IconClose, IconExternalLink } from '../icons'
import { StatusPill } from '../signal/StatusMark'
import { VitalText } from '../signal/VitalText'
import { laneRunStatus, runOutcomeStatus } from './pipelineRunStatus'
import {
  durationLabel,
  LANE_MODES,
  laneCountsLine,
  laneRuns,
  MIN_SEVERITY_OPTIONS,
  MODEL_RE,
  OUTCOME_LABEL,
  reportIdsIn,
  sinceLabel,
  STAGE_LABEL,
  stopRun,
  type LaneConfig,
  type LaneSettings,
  type MinSeverity,
  type QueueAdd,
  type QueueMove,
  type RunTelemetry,
  type WorkerHost,
  type WorkerLane,
  type WriteResult,
} from '../../lib/workers'

/** Settings every lane shares, said once above the lanes; undefined where they differ. */
export interface CommonLaneSettings {
  model: string | null | undefined
  concurrency: number | undefined
  stopAt: string | null | undefined
}

/**
 * What all lanes share (two or more lanes): each field is `undefined` when they differ. The same
 * model, "Runs at once 1" and stop date sat in four inputs on every one of 20 lane cards (round-2
 * review, 2026-11-18). Null when nothing is shared.
 */
export function commonLaneSettings(lanes: ReadonlyArray<Pick<WorkerLane, 'config'>>): CommonLaneSettings | null {
  if (lanes.length < 2) return null
  const same = <T,>(pick: (l: Pick<WorkerLane, 'config'>) => T): T | undefined => {
    const first = pick(lanes[0]!)
    return lanes.every((l) => pick(l) === first) ? first : undefined
  }
  const out: CommonLaneSettings = { model: same((l) => l.config.model ?? null), concurrency: same((l) => l.config.concurrency), stopAt: same((l) => l.config.stop_at ?? null) }
  return out.model === undefined && out.concurrency === undefined && out.stopAt === undefined ? null : out
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** "All 20 lanes: grok-4.7-xhigh-fast · 1 run at once · stop Dec 4." */
export function commonSettingsLine(common: CommonLaneSettings, lanes: number): string {
  const parts: string[] = []
  if (common.model !== undefined) parts.push(common.model ?? "the agent's default model")
  if (common.concurrency !== undefined) parts.push(`${common.concurrency} run${common.concurrency === 1 ? '' : 's'} at once`)
  if (common.stopAt !== undefined) parts.push(common.stopAt ? `stop ${shortDate(common.stopAt)}` : 'no stop date')
  return `All ${lanes} lanes: ${parts.join(' · ')}. A lane names only what differs; open its settings to change them.`
}

/** Normalised title: a queued report with the same title as one above it is a duplicate. */
const titleKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * For each queued report, the 1-based position of an earlier one with the same title, or null
 * (queue items 104 and 109 were the same bug, round-2 review 2026-11-18). @internal Exported for tests.
 */
export function queueDuplicates(queue: ReadonlyArray<{ reportId: string; title: string }>): Array<number | null> {
  const first = new Map<string, number>()
  return queue.map((q, i) => {
    const k = titleKey(q.title)
    const at = first.get(k)
    if (at != null) return at + 1
    first.set(k, i)
    return null
  })
}

type RecentRun = WorkerLane['recent'][number]

/** Outcomes that are a success: their runs group by the outcome alone, whatever each detail says. */
const SUCCESS_OUTCOMES = new Set(['pr_opened', 'pushed', 'filed', 'gone'])

/** "6 runs opened a PR": a success group says what went right, never "the same error" (round-3 review, 2026-11-19). */
const SUCCESS_GROUP_TEXT: Record<string, string> = {
  pr_opened: 'opened a PR',
  pushed: 'merged the base in',
  filed: 'filed findings',
  gone: 'were already fixed',
}

/**
 * Last runs with the same outcome and the same error, grouped: ten "Failed · machine: git fetch
 * failed: bad object …" rows were one problem (round-2 review, 2026-11-18). Successes group by
 * outcome alone: four "Already fixed" rows differed only in the commit their detail named
 * (round-3 review, 2026-11-19). Any other run without a detail stands alone. Order is the newest
 * run of each group. @internal Exported for tests.
 */
export function groupRecentRuns(recent: readonly RecentRun[]): Array<{ key: string; runs: RecentRun[] }> {
  const groups = new Map<string, RecentRun[]>()
  for (const r of recent) {
    const key = r.outcome && SUCCESS_OUTCOMES.has(r.outcome) ? `ok:${r.outcome}` : r.detail ? `${r.outcome ?? ''}|${r.failureKind ?? ''}|${r.detail}` : `run:${r.claimId}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups].map(([key, runs]) => ({ key, runs }))
}

/** What a group of runs says in its summary: "6 runs opened a PR", or "10 runs ended with the same error". @internal Exported for tests. */
export function recentGroupText(runs: readonly Pick<RecentRun, 'outcome'>[]): string {
  const outcome = runs[0]?.outcome ?? ''
  const ok = SUCCESS_GROUP_TEXT[outcome]
  return ok ? `${runs.length} runs ${ok}` : `${runs.length} runs ended with the same error`
}

/** Queued reports shown before "Show all": 117 rows were 4,000 px of one lane (2026-11-18). */
const QUEUE_SHOWN = 10

interface Props {
  lane: WorkerLane
  host: WorkerHost | undefined
  now: number
  showApp: boolean
  /** Settings every lane shares (said once above the lanes); this card names only what differs. */
  common?: CommonLaneSettings | null
  onPatch: (lane: WorkerLane, patch: LaneSettings) => Promise<WriteResult>
  /** Add these to the queue's top or end (`add`), or replace the queue with this order. */
  onQueue: (lane: WorkerLane, reportIds: string[], add?: QueueAdd) => Promise<WriteResult>
  /** Move one queued report, or take it out (one or two rows, any queue length). */
  onMove: (lane: WorkerLane, reportId: string, to: QueueMove) => Promise<WriteResult>
  /** After a run was stopped. */
  onChanged?: () => void
}

/** A run that holds an agent space this long is a problem (the server's RUN_STUCK_MS). */
const STUCK_SEC = 45 * 60

/**
 * Where a run is and what it last said; nothing from a CLI that does not report it. `stale`: the
 * machine is offline, so this is its last word, drawn grey with no running pulse or live
 * durations ("coding agent at work for under a minute" 35 h after the last heartbeat, round-3
 * review 2026-11-19).
 */
function RunDetail({ run, testId, stale = false }: { run: RunTelemetry | undefined; testId: string; stale?: boolean }) {
  if (!run) return null
  const stuck = !stale && run.ageSec >= STUCK_SEC
  return (
    <div className="ml-2 space-y-0.5" data-testid={`${testId}-detail`}>
      <p className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
        <StatusPill status={stale ? 'idle' : stuck ? 'failed' : 'running'} label={STAGE_LABEL[run.stage] ?? run.stage} title={stuck ? 'Stuck: this run has held its agent space too long' : undefined} />
        <span>
          {stale ? 'last reported' : `for ${durationLabel(run.stageSec)} · run ${durationLabel(run.ageSec)}`}
          {run.model ? ` · ${run.model}` : ''}
        </span>
      </p>
      {run.log.length > 0 && (
        <ol className="rounded-sm bg-surface-overlay px-2 py-px font-mono text-2xs text-fg-secondary" aria-label="Last log lines">
          {run.log.map((line, i) => (
            <li key={i} className="wrap-anywhere">
              {line}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function StopRun({ claimId, onChanged, testId }: { claimId: string; onChanged?: () => void; testId: string }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<WriteResult | null>(null)
  return (
    <>
      <Btn size="sm" variant="ghost" onClick={() => setAsking(true)} data-testid={`${testId}-stop`}>
        Stop
      </Btn>
      {note && <span className={`text-2xs ${note.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`}>{note.message}</span>}
      {asking && (
        <ConfirmDialog
          title="Stop this run"
          body="The report is free again: the next lane or a cloud agent can take it. The machine stops the agent at its next heartbeat, within a minute, and commits and pushes nothing more; a git hook already running ends at git's own time limit."
          confirmLabel="Stop the run"
          tone="danger"
          loading={busy}
          onConfirm={() => {
            setBusy(true)
            void stopRun(claimId).then((res) => {
              setBusy(false)
              setAsking(false)
              setNote(res)
              if (res.ok) onChanged?.()
            })
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}

/** ISO → the value a datetime-local input shows, in the viewer's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A report link when the run holds a report; plain text for a conflict or an audit pass. */
function RunTitle({ reportId, title, className }: { reportId: string | null; title: string; className: string }) {
  return reportId ? (
    <Link to={`/reports/${reportId}`} className={`${className} hover:underline`}>
      {title}
    </Link>
  ) : (
    <span className={className}>{title}</span>
  )
}

export function WorkerLaneCard({ lane, host, now, showApp, common = null, onPatch, onQueue, onMove, onChanged }: Props) {
  const c = lane.config
  const [model, setModel] = useState(c.model ?? '')
  const [reviewModel, setReviewModel] = useState(lane.reviewModel ?? '')
  const reviewModelError = reviewModel && !MODEL_RE.test(reviewModel) ? 'Letters, digits, ".", "_", ":" and "-" only.' : undefined
  const modeHint = LANE_MODES.find((m) => m.value === c.mode)?.hint
  const [stop, setStop] = useState(toLocalInput(c.stop_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<WriteResult | null>(null)
  const [pasted, setPasted] = useState('')
  const pastedIds = reportIdsIn(pasted)
  const modelError = model && !MODEL_RE.test(model) ? 'Letters, digits, ".", "_", ":" and "-" only.' : undefined
  // The machine being offline wins: its last word ("idle") is stale and the lane takes nothing
  // (lanes read "idle" and "Taking reports" on an offline machine, round-2 review 2026-11-18).
  // A stop date in the past stops the lane too; it was not flagged.
  const offline = !host || !host.online || host.revoked
  const stopped = !!c.stop_at && Date.parse(c.stop_at) <= now
  const state = offline ? 'offline' : c.paused ? 'paused' : stopped ? 'stopped' : c.drain ? 'draining' : String(lane.status.state ?? 'starting')
  const [showAllQueue, setShowAllQueue] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dupes = queueDuplicates(lane.queue)
  const dupeCount = dupes.filter((d) => d != null).length
  const queueShown = showAllQueue ? lane.queue : lane.queue.slice(0, QUEUE_SHOWN)
  // What this lane sets differently from the lanes' shared settings, for its settings summary.
  const differs = [
    common?.model === undefined || (c.model ?? null) !== common.model ? (c.model ?? "agent's default model") : null,
    LANE_MODES.find((m) => m.value === c.mode)?.label ?? c.mode,
    common?.concurrency === undefined || c.concurrency !== common.concurrency ? `${c.concurrency} at once` : null,
    common?.stopAt === undefined || (c.stop_at ?? null) !== common.stopAt ? (c.stop_at ? `stop ${shortDate(c.stop_at)}` : 'no stop date') : null,
  ].filter((x): x is string => !!x)
  const testId = `worker-lane-${lane.id}`
  const runs = laneRuns(lane)
  const followups = runs.filter((r) => r.kind === 'followup')
  // A lane with nothing queued, nothing running and nothing to warn about is one line until
  // opened: 15 idle lanes each repeated the toggles, an empty queue and an "Add reports" field
  // (round-3 review, 2026-11-19).
  const quiet = lane.queue.length === 0 && lane.active.length === 0 && followups.length === 0 && !stopped
  const open = !quiet || expanded
  // The machine's offline state is said once, on the machine and its problem card: a lane on it
  // reads a grey "offline", not 20 red ✕ chips.
  const pillStatus = offline ? 'idle' : laneRunStatus(state)

  const save = async (key: string, patch: LaneSettings) => {
    setBusy(key)
    setNote(await onPatch(lane, patch))
    setBusy(null)
  }
  const add = async (where: QueueAdd) => {
    setBusy(`add:${where}`)
    const res = await onQueue(lane, pastedIds, where)
    setNote(res)
    if (res.ok) setPasted('')
    setBusy(null)
  }
  const move = async (reportId: string, to: QueueMove) => {
    setBusy(`${to}:${reportId}`)
    setNote(await onMove(lane, reportId, to))
    setBusy(null)
  }
  const last = lane.queue.length - 1
  // Conflicts and audit lanes find their own work; they read no queue (the server refuses one).
  const takesQueue = c.mode === 'fix' || c.mode === 'followups' || c.mode === 'skill'

  return (
    <li data-testid={testId} data-quiet={quiet ? 'true' : undefined} className={open ? 'space-y-3 py-3' : 'py-1.5'}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {quiet && (
          <button
            type="button"
            className="text-2xs text-fg-secondary hover:text-fg"
            aria-expanded={expanded}
            aria-label={expanded ? `Fold ${lane.name}` : `Open ${lane.name}`}
            onClick={() => setExpanded((v) => !v)}
            data-testid={`${testId}-expand`}
          >
            <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
          </button>
        )}
        <span className="font-mono text-xs font-semibold text-fg">{lane.name}</span>
        {showApp && <Badge tone="neutral">{lane.projectName}</Badge>}
        <StatusPill status={pillStatus} label={state} />
        <span className="text-2xs text-fg-muted">
          {open && `on ${host?.hostname ?? 'a machine'}${lane.repo ? ` (${lane.repo})` : ''} · `}
          {laneCountsLine(lane)}
        </span>
      </div>
      {open && (
      <>

      {stopped && (
        <p className="text-2xs font-medium text-warn-foreground" data-testid={`${testId}-stopped`}>
          Its stop date passed on {shortDate(c.stop_at!)}: it takes nothing. Move or clear the date in its settings to start it again.
        </p>
      )}

      {/* Settings fold under one summary line: four inputs per lane, 20 lanes, mostly the same values. */}
      <details className="group" data-testid={`${testId}-settings`}>
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 text-2xs text-fg-secondary hover:text-fg">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
          <span className="font-medium">Settings</span>
          <span className="text-fg-muted" data-testid={`${testId}-settings-summary`}>{differs.join(' · ')}</span>
        </summary>
      <div className="mt-2 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <Input id={`${testId}-model-input`} label="Model" placeholder="the agent's default" value={model} error={modelError} onChange={(e) => setModel(e.target.value.trim())} data-testid={`${testId}-model`} />
          </div>
          <Btn
            size="sm"
            variant="ghost"
            disabled={!!modelError || model === (c.model ?? '')}
            loading={busy === 'model'}
            onClick={() => void save('model', { model: model || null })}
            data-testid={`${testId}-model-save`}
          >
            Save
          </Btn>
        </div>
        <SelectField
          id={`${testId}-mode-input`}
          label="Mode"
          value={c.mode}
          onChange={(e) => void save('mode', { mode: e.target.value as LaneConfig['mode'] })}
          data-testid={`${testId}-mode`}
        >
          {LANE_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          id={`${testId}-concurrency-input`}
          label="Runs at once"
          value={String(c.concurrency)}
          onChange={(e) => void save('concurrency', { concurrency: Number(e.target.value) })}
          data-testid={`${testId}-concurrency`}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <Input id={`${testId}-stop-input`} label="Stop date" type="datetime-local" value={stop} onChange={(e) => setStop(e.target.value)} data-testid={`${testId}-stop`} />
          </div>
          <Btn
            size="sm"
            variant="ghost"
            loading={busy === 'stop'}
            disabled={stop === toLocalInput(c.stop_at)}
            onClick={() => void save('stop', { stop_at: stop ? new Date(stop).toISOString() : null })}
            data-testid={`${testId}-stop-save`}
          >
            {stop ? 'Save' : 'Clear'}
          </Btn>
        </div>
      </div>

      {modeHint && <p className="text-2xs text-fg-muted" data-testid={`${testId}-mode-hint`}>{modeHint}</p>}
      {c.mode === 'fix' && (
        <div className="max-w-md space-y-1">
          <SelectField
            id={`${testId}-min-severity-input`}
            label="Takes"
            value={lane.minSeverity ?? ''}
            disabled={busy === 'min_severity'}
            onChange={(e) => void save('min_severity', { min_severity: (e.target.value || null) as MinSeverity | null })}
            data-testid={`${testId}-min-severity`}
          >
            {MIN_SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
          <p className="text-2xs text-fg-muted">
            Worst first, one report per duplicate group. Reports you queue below go whatever their severity.
          </p>
        </div>
      )}
      {c.mode === 'conflicts' && !lane.repo && (
        <p className="text-2xs text-warn-foreground">This machine has not said which repository its clone is. Update the Mushi Mushi CLI there; until then the lane takes no conflicts.</p>
      )}
      {c.mode === 'audit' && (
        <div className="flex max-w-md items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <Input
              id={`${testId}-review-model-input`}
              label="Second model (may only veto)"
              placeholder="none: the check alone decides"
              value={reviewModel}
              error={reviewModelError}
              onChange={(e) => setReviewModel(e.target.value.trim())}
              data-testid={`${testId}-review-model`}
            />
          </div>
          <Btn
            size="sm"
            variant="ghost"
            disabled={!!reviewModelError || reviewModel === (lane.reviewModel ?? '')}
            loading={busy === 'review_model'}
            onClick={() => void save('review_model', { review_model: reviewModel || null })}
            data-testid={`${testId}-review-model-save`}
          >
            Save
          </Btn>
        </div>
      )}
      </div>
      </details>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Toggle label={c.paused ? 'Paused' : offline ? `Takes reports once ${host?.hostname ?? 'its machine'} is back` : 'Taking reports'} checked={!c.paused} disabled={busy === 'paused'} onChange={(on) => void save('paused', { paused: !on })} />
        <Toggle label="Drain: finish what runs, take nothing new" checked={c.drain} disabled={busy === 'drain'} onChange={(on) => void save('drain', { drain: on })} />
        {note && (
          <span className={`text-2xs ${note.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid={`${testId}-note`}>
            {note.message}
          </span>
        )}
      </div>

      {(lane.active.length > 0 || followups.length > 0) && (
        <div className="space-y-1">
          <p className="text-2xs font-medium text-fg-secondary" data-testid={`${testId}-now-heading`}>
            {offline ? `At its last heartbeat, ${sinceLabel(host?.lastHeartbeatAt ?? null, now)}` : 'Working on now'}
          </p>
          <ul className="space-y-1.5 text-xs">
            {lane.active.map((a) => (
              <li key={a.claimId} data-testid={`${testId}-run-${a.claimId}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <RunTitle reportId={a.reportId} title={a.title} className="min-w-0 truncate text-fg" />
                  <span className="text-2xs text-fg-muted">since {sinceLabel(a.since, now)}</span>
                  <StopRun claimId={a.claimId} onChanged={onChanged} testId={`${testId}-run-${a.claimId}`} />
                </div>
                <RunDetail run={runs.find((r) => r.runId === a.claimId)} testId={`${testId}-run-${a.claimId}`} stale={offline} />
              </li>
            ))}
            {followups.map((r) => (
              <li key={r.runId} data-testid={`${testId}-run-${r.runId}`}>
                <span className="text-fg">A review follow-up</span>
                <RunDetail run={r} testId={`${testId}-run-${r.runId}`} stale={offline} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {takesQueue && (
      <div className="space-y-1">
        <p className="text-2xs font-medium text-fg-secondary">
          Queue ({lane.queue.length}{dupeCount > 0 ? `, ${dupeCount} with the same title as one above` : ''}): taken first, top to bottom
        </p>
        {c.mode === 'fix' && lane.queue.length > 0 && (
          <p className="text-2xs text-fg-muted">Queued reports go whatever the lane&apos;s &ldquo;Takes&rdquo; setting; fixed or dismissed ones leave on their own.</p>
        )}
        {lane.queue.length === 0 ? (
          <p className="text-2xs text-fg-muted">
            {c.mode === 'skill'
              ? 'Empty: start a skill run on Spend credits with Run on set to this lane.'
              : 'Empty: the lane takes the worst open reports first. Send reports here from a report or a pipeline group.'}
          </p>
        ) : (
          <ol className="divide-y divide-edge-subtle border-y border-edge-subtle" data-testid={`${testId}-queue`}>
            {queueShown.map((q, i) => (
              <li key={q.reportId} className="flex items-center gap-2 px-2 py-1" data-testid={`${testId}-queue-${q.reportId}`}>
                <span className="w-6 shrink-0 text-right text-2xs tabular-nums text-fg-faint">{i + 1}</span>
                <Link to={`/reports/${q.reportId}`} className={`min-w-0 flex-1 truncate text-xs hover:underline ${dupes[i] != null ? 'text-fg-muted' : 'text-fg'}`}>
                  {q.title}
                </Link>
                {dupes[i] != null && (
                  <span className="shrink-0 whitespace-nowrap text-2xs text-warn-foreground" data-testid={`${testId}-queue-${q.reportId}-dupe`} title="Same title as a report above: probably the same bug. Remove one.">
                    same as #{dupes[i]}
                  </span>
                )}
                {q.severity && <Badge tone="neutral">{q.severity}</Badge>}
                <span className="flex shrink-0 gap-0.5">
                  <Btn size="sm" variant="ghost" aria-label="Move to the top: fix it next" title="Move to the top: fix it next" disabled={i === 0 || busy != null} loading={busy === `top:${q.reportId}`} onClick={() => void move(q.reportId, 'top')} data-testid={`${testId}-queue-${q.reportId}-top`}>
                    Top
                  </Btn>
                  <Btn size="sm" variant="ghost" aria-label="Move up" disabled={i === 0 || busy != null} onClick={() => void move(q.reportId, 'up')} data-testid={`${testId}-queue-${q.reportId}-up`}>
                    <IconChevronUp size={12} />
                  </Btn>
                  <Btn size="sm" variant="ghost" aria-label="Move down" disabled={i === last || busy != null} onClick={() => void move(q.reportId, 'down')} data-testid={`${testId}-queue-${q.reportId}-down`}>
                    <IconChevronDown size={12} />
                  </Btn>
                  <Btn size="sm" variant="ghost" aria-label="Remove from the queue" disabled={busy != null} onClick={() => void move(q.reportId, 'remove')} data-testid={`${testId}-queue-${q.reportId}-remove`}>
                    <IconClose size={12} />
                  </Btn>
                </span>
              </li>
            ))}
            {lane.queue.length > QUEUE_SHOWN && (
              <li className="px-2 py-1">
                <Btn size="sm" variant="ghost" onClick={() => setShowAllQueue((v) => !v)} data-testid={`${testId}-queue-toggle`}>
                  {showAllQueue ? `Show the first ${QUEUE_SHOWN}` : `Show all ${lane.queue.length}`}
                </Btn>
              </li>
            )}
          </ol>
        )}
        <div className="flex flex-wrap items-end gap-1.5">
          <div className="min-w-0 flex-1 basis-56">
            <Input
              id={`${testId}-add-input`}
              label="Add reports by id"
              placeholder="Paste report ids or links, one or more"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              data-testid={`${testId}-add`}
            />
          </div>
          <Btn
            size="sm"
            disabled={pastedIds.length === 0 || busy != null}
            loading={busy === 'add:top'}
            onClick={() => void add('top')}
            title="The lane takes these next, before the rest of its queue"
            data-testid={`${testId}-add-top`}
          >
            {pastedIds.length > 1 ? `Add ${pastedIds.length} to top` : 'Add to top'}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            disabled={pastedIds.length === 0 || busy != null}
            loading={busy === 'add:end'}
            onClick={() => void add('end')}
            data-testid={`${testId}-add-save`}
          >
            Add to end
          </Btn>
        </div>
      </div>
      )}

      {lane.recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-2xs font-medium text-fg-secondary">Last runs</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 text-left text-2xs" data-testid={`${testId}-recent`}>
              <tbody className="divide-y divide-edge-subtle">
                {groupRecentRuns(lane.recent.slice(0, 10)).map(({ key, runs }) => {
                  const r = runs[0]!
                  return (
                    <tr key={key} data-testid={runs.length > 1 ? `${testId}-recent-group` : undefined}>
                      <td className="py-1 pr-2 align-top">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <StatusPill
                            status={runOutcomeStatus(r.outcome, r.failureKind)}
                            label={`${OUTCOME_LABEL[r.outcome ?? ''] ?? r.outcome ?? 'ended'}${r.failureKind ? ` · ${r.failureKind === 'infra' ? 'machine' : 'code'}` : ''}`}
                          />
                          {runs.length > 1 && <span className="font-mono font-bold tabular-nums text-fg">×{runs.length}</span>}
                        </span>
                      </td>
                      <td className="max-w-xs py-1 pr-2 align-top">
                        {runs.length > 1 ? (
                          <details className="group">
                            <summary className="cursor-pointer list-none truncate text-fg hover:underline" data-testid={`${testId}-recent-group-text`}>{recentGroupText(runs)}</summary>
                            <ul className="mt-0.5 space-y-0.5">
                              {runs.map((x) => (
                                <li key={x.claimId} className="flex items-baseline gap-1.5">
                                  <RunTitle reportId={x.reportId} title={x.title} className="min-w-0 truncate text-fg-secondary" />
                                  {x.prUrl && (
                                    <a href={x.prUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-brand hover:underline">
                                      PR <IconExternalLink size={10} />
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <RunTitle reportId={r.reportId} title={r.title} className="block truncate text-fg" />
                        )}
                        {/* A group's detail only when every run says the same ("pull request opened" under "6 runs opened a PR" restated it). */}
                        {r.detail && (runs.length === 1 || (!SUCCESS_GROUP_TEXT[r.outcome ?? ''] && runs.every((x) => x.detail === r.detail))) && (
                          <span className="block truncate text-fg-muted" title={r.detail}>
                            <VitalText text={r.detail} />
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2 align-top">
                        {runs.length === 1 && r.prUrl && (
                          <a href={r.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                            PR <IconExternalLink size={10} />
                          </a>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1 align-top text-fg-faint">
                        {runs.length > 1 ? `latest ${sinceLabel(r.finishedAt ?? r.claimedAt, now)}` : sinceLabel(r.finishedAt ?? r.claimedAt, now)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}
    </li>
  )
}
