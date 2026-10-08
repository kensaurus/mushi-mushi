/**
 * FILE: apps/admin/src/components/ux-runs/UxRunProgress.tsx
 * PURPOSE: Where a `mushi ux` run is, live: phase, what it is doing now (the
 *          screen and attempt), how many screens are finished, and the agent,
 *          model, skill and branch it runs with. Fed by the run row, which the
 *          CLI updates as it goes and at least every 30 s while the agent
 *          works (Realtime reloads the page). A run that stops checking in
 *          is called out, so a dead run never looks live.
 */

import { Badge, Callout, Card } from '../ui'
import { useNow } from '../../lib/useNow'
import {
  UX_PHASE_LABEL,
  UX_STATUS_META,
  uxDuration,
  uxRunQuietMinutes,
  type UxRunListItem,
  type UxSurfaceRow,
  type UxSurfaceStatus,
} from '../../lib/uxRuns'

const FINISHED: UxSurfaceStatus[] = ['accepted', 'reverted', 'skipped', 'regressed', 'blocked']
const SEGMENTS: Array<{ status: UxSurfaceStatus; className: string }> = [
  { status: 'accepted', className: 'bg-ok' },
  { status: 'regressed', className: 'bg-warn' },
  { status: 'reverted', className: 'bg-danger' },
  { status: 'skipped', className: 'bg-fg-muted/40' },
  { status: 'blocked', className: 'bg-fg-muted/40' },
  { status: 'iterating', className: 'bg-info' },
]

export function UxRunProgress({ run, surfaces }: { run: UxRunListItem; surfaces: UxSurfaceRow[] }) {
  const total = surfaces.length
  const counts: Partial<Record<UxSurfaceStatus, number>> = {}
  for (const s of surfaces) counts[s.status] = (counts[s.status] ?? 0) + 1
  const done = FINISHED.reduce((n, st) => n + (counts[st] ?? 0), 0)
  const phase = run.phase ?? (run.status === 'running' ? 'working' : run.status === 'failed' ? 'failed' : 'done')
  const live = run.status === 'running' && phase !== 'done' && phase !== 'failed'
  const current = run.current_surface ? surfaces.find((s) => s.surface_key === run.current_surface) : null
  const now = live
    ? current && run.current_attempt
      ? `${current.label}, attempt ${run.current_attempt}`
      : run.phase_detail
    : null
  const nowMs = useNow(1000, live)
  const quiet = uxRunQuietMinutes(run, nowMs)
  const step = live && current ? run.current_progress : null
  const who = [run.agent + (run.model ? ` · ${run.model}` : ''), run.skill ? `skill ${run.skill}` : null, run.branch ? `${run.branch}${run.base_ref ? ` (from ${run.base_ref})` : ''}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card className="p-3">
      <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
        <Badge tone={phase === 'failed' ? 'dangerSubtle' : phase === 'done' ? 'okSubtle' : 'infoSubtle'}>
          {live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />}
          {UX_PHASE_LABEL[phase] ?? phase}
        </Badge>
        {now && <span className="text-xs text-fg-secondary">{now}</span>}
        <span className="ml-auto text-xs text-fg-muted">
          {total ? `${done} of ${total} screens done` : live ? 'Mapping screens…' : 'No screens'}
        </span>
      </div>
      {total > 0 && (
        <div className="flex h-2 overflow-hidden rounded-full bg-surface-overlay" role="img" aria-label={`${done} of ${total} screens finished`}>
          {SEGMENTS.map(({ status, className }) =>
            counts[status] ? (
              <span
                key={status}
                className={className}
                style={{ width: `${((counts[status] ?? 0) / total) * 100}%` }}
                title={`${UX_STATUS_META[status].label}: ${counts[status]}`}
              />
            ) : null,
          )}
        </div>
      )}
      {step && (
        <div className="flex min-w-0 flex-col gap-0.5 text-xs text-fg-secondary">
          <span className="min-w-0 truncate">
            {uxDuration(nowMs - Date.parse(step.started_at))}
            {step.timeout_ms ? ` of ${uxDuration(step.timeout_ms)}` : ''}
            {' · '}
            {step.steps ? `${step.steps} step${step.steps === 1 ? '' : 's'}` : 'Reading the brief'}
            {step.last_step && <span className="font-mono text-fg-muted"> · {step.last_step}</span>}
          </span>
          {step.files.length > 0 && (
            <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" title={step.files.join('\n')}>
              Changed so far: {step.files.slice(0, 6).join(', ')}
              {step.files.length > 6 ? ` +${step.files.length - 6} more` : ''}
            </span>
          )}
        </div>
      )}
      {quiet > 0 && (
        <Callout tone="warn">
          <span className="text-xs">
            No update for {quiet} min. The run may have stopped. Press Resume in the studio (<code className="font-mono">mushi ux ui</code>), or run{' '}
            <code className="font-mono">mushi ux run --resume {run.local_run_id}</code>: it carries on from the first unfinished screen.
          </span>
        </Callout>
      )}
      <p className="font-mono text-2xs text-fg-muted">{who}</p>
      {run.error && (
        <Callout tone="danger">
          <span className="text-xs">{run.error.split('\n')[0]}</span>
        </Callout>
      )}
      </div>
    </Card>
  )
}
