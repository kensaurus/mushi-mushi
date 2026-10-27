/**
 * FILE: apps/admin/src/components/pipeline/WorkerLaneCard.tsx
 * PURPOSE: One local worker lane (one app on one machine) on the Workers tab:
 *          its settings (model, mode, how many at once, pause, drain, stop
 *          date; an audit lane's veto model), what it runs now, its queue in
 *          order, and its last runs. Conflict and audit runs hold no report,
 *          so they show as text, not a report link.
 *          Each change saves just that setting; the machine reads it at its
 *          next heartbeat, within a minute.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Card, Input, SelectField, Toggle } from '../ui'
import { IconChevronDown, IconChevronUp, IconClose, IconExternalLink } from '../icons'
import { LANE_MODES, laneCountsLine, MODEL_RE, moveItem, OUTCOME_LABEL, reportIdsIn, sinceLabel, type LaneConfig, type LaneSettings, type WorkerHost, type WorkerLane, type WriteResult } from '../../lib/workers'

interface Props {
  lane: WorkerLane
  host: WorkerHost | undefined
  now: number
  showApp: boolean
  onPatch: (lane: WorkerLane, patch: LaneSettings) => Promise<WriteResult>
  /** Replace the queue with this order, or (append) add these at its end. */
  onQueue: (lane: WorkerLane, reportIds: string[], append?: boolean) => Promise<WriteResult>
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

export function WorkerLaneCard({ lane, host, now, showApp, onPatch, onQueue }: Props) {
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
  const state = c.paused ? 'paused' : c.drain ? 'draining' : String(lane.status.state ?? (host?.online ? 'starting' : 'offline'))
  const testId = `worker-lane-${lane.id}`

  const save = async (key: string, patch: LaneSettings) => {
    setBusy(key)
    setNote(await onPatch(lane, patch))
    setBusy(null)
  }
  const queue = async (key: string, ids: string[], append = false) => {
    setBusy(key)
    const res = await onQueue(lane, ids, append)
    setNote(res)
    if (res.ok && append) setPasted('')
    setBusy(null)
  }
  const ids = lane.queue.map((q) => q.reportId)
  // Conflicts and audit lanes find their own work; they read no queue (the server refuses one).
  const takesQueue = c.mode === 'fix' || c.mode === 'followups' || c.mode === 'skill'

  return (
    <li data-testid={testId}>
      <Card className="space-y-3 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-semibold text-fg">{lane.name}</span>
        {showApp && <Badge tone="neutral">{lane.projectName}</Badge>}
        <Badge tone={state === 'working' ? 'ok' : state === 'paused' || state === 'draining' ? 'warn' : 'neutral'}>{state}</Badge>
        <span className="text-2xs text-fg-muted">
          on {host?.hostname ?? 'a machine'}
          {lane.repo ? ` (${lane.repo})` : ''} · {laneCountsLine(lane)}
        </span>
      </div>

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
      {c.mode === 'conflicts' && !lane.repo && (
        <p className="text-2xs text-warn-foreground">This machine has not said which repository its clone is. Update the Mushi CLI there; until then the lane takes no conflicts.</p>
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

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Toggle label={c.paused ? 'Paused' : 'Taking reports'} checked={!c.paused} disabled={busy === 'paused'} onChange={(on) => void save('paused', { paused: !on })} />
        <Toggle label="Drain: finish what runs, take nothing new" checked={c.drain} disabled={busy === 'drain'} onChange={(on) => void save('drain', { drain: on })} />
        {note && (
          <span className={`text-2xs ${note.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid={`${testId}-note`}>
            {note.message}
          </span>
        )}
      </div>

      {lane.active.length > 0 && (
        <div className="space-y-1">
          <p className="text-2xs font-medium text-fg-secondary">Working on now</p>
          <ul className="space-y-0.5 text-xs">
            {lane.active.map((a) => (
              <li key={a.claimId} className="flex flex-wrap items-baseline gap-x-2">
                <RunTitle reportId={a.reportId} title={a.title} className="min-w-0 truncate text-fg" />
                <span className="text-2xs text-fg-muted">since {sinceLabel(a.since, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {takesQueue && (
      <div className="space-y-1">
        <p className="text-2xs font-medium text-fg-secondary">Queue ({lane.queue.length}): taken first, top to bottom</p>
        {lane.queue.length === 0 ? (
          <p className="text-2xs text-fg-muted">
            {c.mode === 'skill'
              ? 'Empty: start a skill run on Spend credits with Run on set to this lane.'
              : 'Empty: the lane takes the worst open reports first. Send reports here from a report or a pipeline group.'}
          </p>
        ) : (
          <ol className="divide-y divide-edge-subtle rounded-sm border border-edge-subtle" data-testid={`${testId}-queue`}>
            {lane.queue.map((q, i) => (
              <li key={q.reportId} className="flex items-center gap-2 px-2 py-1" data-testid={`${testId}-queue-${q.reportId}`}>
                <span className="w-5 shrink-0 text-right text-2xs tabular-nums text-fg-faint">{i + 1}</span>
                <Link to={`/reports/${q.reportId}`} className="min-w-0 flex-1 truncate text-xs text-fg hover:underline">
                  {q.title}
                </Link>
                {q.severity && <Badge tone="neutral">{q.severity}</Badge>}
                <span className="flex shrink-0 gap-0.5">
                  <Btn size="sm" variant="ghost" aria-label="Move up" disabled={i === 0 || busy != null} onClick={() => void queue(`up:${q.reportId}`, moveItem(ids, i, -1))} data-testid={`${testId}-queue-${q.reportId}-up`}>
                    <IconChevronUp size={12} />
                  </Btn>
                  <Btn size="sm" variant="ghost" aria-label="Move down" disabled={i === ids.length - 1 || busy != null} onClick={() => void queue(`down:${q.reportId}`, moveItem(ids, i, 1))} data-testid={`${testId}-queue-${q.reportId}-down`}>
                    <IconChevronDown size={12} />
                  </Btn>
                  <Btn size="sm" variant="ghost" aria-label="Remove from the queue" disabled={busy != null} onClick={() => void queue(`rm:${q.reportId}`, ids.filter((x) => x !== q.reportId))} data-testid={`${testId}-queue-${q.reportId}-remove`}>
                    <IconClose size={12} />
                  </Btn>
                </span>
              </li>
            ))}
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
            variant="ghost"
            disabled={pastedIds.length === 0 || busy != null}
            loading={busy === 'add'}
            onClick={() => void queue('add', pastedIds, true)}
            data-testid={`${testId}-add-save`}
          >
            {pastedIds.length > 1 ? `Add ${pastedIds.length}` : 'Add'}
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
                {lane.recent.slice(0, 10).map((r) => (
                  <tr key={r.claimId}>
                    <td className="py-1 pr-2 align-top">
                      <Badge tone={r.outcome === 'pr_opened' || r.outcome === 'pushed' || r.outcome === 'filed' ? 'ok' : r.failureKind === 'infra' || r.outcome === 'lease_expired' ? 'warn' : r.outcome === 'failed' || r.outcome === 'refused' ? 'danger' : 'neutral'}>
                        {OUTCOME_LABEL[r.outcome ?? ''] ?? r.outcome ?? 'ended'}
                        {r.failureKind ? ` · ${r.failureKind === 'infra' ? 'machine' : 'code'}` : ''}
                      </Badge>
                    </td>
                    <td className="max-w-xs py-1 pr-2 align-top">
                      <RunTitle reportId={r.reportId} title={r.title} className="block truncate text-fg" />
                      {r.detail && <span className="block truncate text-fg-muted" title={r.detail}>{r.detail}</span>}
                    </td>
                    <td className="py-1 pr-2 align-top">
                      {r.prUrl && (
                        <a href={r.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                          PR <IconExternalLink size={10} />
                        </a>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1 align-top text-fg-faint">{sinceLabel(r.finishedAt ?? r.claimedAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </Card>
    </li>
  )
}
