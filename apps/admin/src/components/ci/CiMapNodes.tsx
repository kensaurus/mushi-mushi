/**
 * FILE: apps/admin/src/components/ci/CiMapNodes.tsx
 * PURPOSE: Memoized custom nodes for the /ci runner map — machine, runner,
 *          repo and live job — plus the edge that carries traveling dots into
 *          running work. Each node is its own <button>, so keyboard users
 *          reach every node without React Flow's focus model. State is never
 *          colour alone: every status has a word next to its dot.
 */

import { memo, type ReactNode } from 'react'
import { BaseEdge, Handle, Position, getBezierPath, type EdgeProps, type NodeProps } from '@xyflow/react'
import { TravelingDotsEdge } from '../flow-primitives/TravelingDotsEdge'
import { TONE_HEX } from '../flow-primitives/flowTokens'
import { readVizToken } from '../../lib/vizTokens'
import { formatPercent, formatSeconds } from '../../lib/ciView'
import { usePrefersReducedMotion } from '../../lib/useMotionTransition'
import { IconAlertTriangle, IconCloud, IconInfo, IconServer } from '../icons'
import { useCiMapSelection } from './ciMapContext'
import { CI_OUTCOME_STYLE } from './ciOutcome'
import { runnerStatus } from './ciRunnerStatus'
import type { CiHostNodeData, CiJobNodeData, CiMapEdgeData, CiRepoNodeData, CiRunnerNodeData } from './ciMapLayout'
import { RelativeTime, formatRelative } from '../ui'

const HANDLE_CLS = '!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent'

const PLATFORM_LABEL: Record<string, string> = { linux: 'Linux', wsl2: 'WSL 2', macos: 'macOS', windows: 'Windows' }

function NodeShell({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const selection = useCiMapSelection()
  const selected = selection?.selectedId === id
  return (
    <div className="relative h-full w-full">
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} isConnectable={false} />
      <button
        type="button"
        onClick={() => selection?.onSelect(id)}
        aria-pressed={selected}
        aria-label={label}
        className={`nodrag nopan flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border bg-surface-raised px-2.5 py-2 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
          selected ? 'border-brand' : 'border-edge hover:border-brand/40'
        }`}
      >
        {children}
      </button>
      <Handle type="source" position={Position.Right} className={HANDLE_CLS} isConnectable={false} />
    </div>
  )
}

/** A thin used/total bar with the numbers beside it. */
function MeterRow({ label, used, total, unit = 'GB' }: { label: string; used: number | null; total: number | null; unit?: string }) {
  if (used == null || total == null || total <= 0) {
    return (
      <div className="flex items-center gap-1.5 text-3xs text-fg-faint">
        <span className="w-12 shrink-0">{label}</span>
        <span>not reported</span>
      </div>
    )
  }
  const pct = Math.min(100, Math.max(0, (used / total) * 100))
  const tone = pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warn' : 'bg-ok'
  const fmt = (mb: number) => (unit === 'GB' ? (mb / 1024).toFixed(1) : String(Math.round(mb)))
  return (
    <div className="flex items-center gap-1.5 text-3xs text-fg-muted">
      <span className="w-12 shrink-0">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 tabular-nums">
        {fmt(used)}/{fmt(total)} {unit}
      </span>
    </div>
  )
}

function HostNodeInner({ id, data }: NodeProps) {
  const d = data as CiHostNodeData
  const platform = d.platform ? PLATFORM_LABEL[d.platform] : null
  const sub =
    d.variant === 'github'
      ? 'GitHub runs these machines; Mushi sees their jobs only.'
      : d.variant === 'unknown'
        ? 'Runners with no heartbeat. Run mushi runner key on the machine to set one up.'
        : `${platform ?? 'Machine'}${d.cpuCount ? ` · ${d.cpuCount} CPUs` : ''}${d.load1 != null ? ` · load ${d.load1.toFixed(1)}` : ''}`
  return (
    <NodeShell id={id} label={`Machine ${d.title}. ${sub}. Open details.`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {d.variant === 'github' ? (
          <IconCloud size={14} className="shrink-0 text-fg-muted" />
        ) : d.variant === 'unknown' ? (
          <IconInfo size={14} className="shrink-0 text-fg-faint" />
        ) : (
          <IconServer size={14} className="shrink-0 text-fg-muted" />
        )}
        <span className="truncate text-xs font-semibold text-fg">{d.title}</span>
        {d.stale && (
          <span className="ml-auto shrink-0 rounded-sm border border-warn/30 bg-warn-muted/50 px-1 text-3xs font-medium text-warn-foreground">
            No heartbeat
          </span>
        )}
      </div>
      <p className="text-3xs leading-snug text-fg-muted line-clamp-2">{sub}</p>
      {d.variant === 'machine' && (
        <div className="mt-auto flex flex-col gap-0.5">
          <MeterRow label="Memory" used={d.memUsedMb} total={d.memTotalMb} />
          <MeterRow label="Swap" used={d.swapUsedMb} total={d.swapTotalMb} />
        </div>
      )}
    </NodeShell>
  )
}

function RunnerNodeInner({ id, data }: NodeProps) {
  const d = data as CiRunnerNodeData
  const status = runnerStatus(d)
  const warnings = [
    d.oomKills ? `ran out of memory ${d.oomKills}×` : null,
    d.infraFailures7d ? `${d.infraFailures7d} machine stop${d.infraFailures7d === 1 ? '' : 's'} this week` : null,
    d.restarts ? `${d.restarts} restart${d.restarts === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  const hasMemory = d.memCurrentMb != null || d.memMaxMb != null
  const labels = d.labels.filter((l) => l !== 'self-hosted').join(', ')
  return (
    <NodeShell id={id} label={`Runner ${d.title}, ${status.word}. Open details.`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
        <span className="truncate text-xs font-semibold text-fg" title={d.title}>
          {d.name}
          {d.oneJob && <span className="font-normal text-fg-muted"> · one-job runners</span>}
        </span>
        <span className="ml-auto shrink-0 text-3xs font-medium text-fg-secondary" title={status.word}>
          {status.short ?? status.word}
        </span>
      </div>
      <p className="truncate text-3xs text-fg-muted">
        {d.jobs24h} job{d.jobs24h === 1 ? '' : 's'} today
        {d.oneJob ? ` · ${d.members} runner${d.members === 1 ? '' : 's'}` : ''}
        {d.lastJobAt ? ` · last ${formatRelative(d.lastJobAt)}` : ' · no jobs seen'}
      </p>
      {warnings.length > 0 && (
        <p className={`flex min-w-0 items-center gap-1 text-3xs font-medium ${d.oomKills ? 'text-danger' : 'text-warn-foreground'}`}>
          <IconAlertTriangle size={10} className="shrink-0" />
          <span className="truncate">{warnings.join(' · ')}</span>
        </p>
      )}
      <div className="mt-auto">
        {hasMemory ? (
          <MeterRow label="Memory" used={d.memCurrentMb} total={d.memMaxMb} />
        ) : (
          <p className="truncate text-3xs text-fg-faint" title={d.labels.join(', ')}>
            {labels ? `Labels: ${labels}` : d.runnerKind === 'github_hosted' ? 'GitHub picks the machine' : 'No labels reported'}
          </p>
        )}
      </div>
    </NodeShell>
  )
}

function RepoNodeInner({ id, data }: NodeProps) {
  const d = data as CiRepoNodeData
  return (
    <NodeShell id={id} label={`Repository ${d.repo}: ${d.queued} waiting, ${d.running} running. Open details.`}>
      <span className="truncate text-xs font-semibold text-fg" title={d.repo}>
        {d.repo}
      </span>
      <p className="text-3xs text-fg-muted tabular-nums">
        {d.queued} waiting · {d.running} running
      </p>
      <p className="text-3xs text-fg-faint tabular-nums">
        Wait (p95) {formatSeconds(d.queueP95s)} · passes {formatPercent(d.passRate)}
      </p>
    </NodeShell>
  )
}

function JobNodeInner({ id, data }: NodeProps) {
  const d = data as CiJobNodeData
  const outcome = CI_OUTCOME_STYLE[d.running ? 'running' : 'waiting']
  const word = outcome.label
  return (
    <NodeShell id={id} label={`Job ${d.title} in ${d.repo}, ${word}. Open details.`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <outcome.Icon size={12} className={`shrink-0 ${outcome.text}`} />
        <span className="truncate text-xs font-medium text-fg">{d.title}</span>
        {d.prNumber ? <span className="ml-auto shrink-0 text-3xs text-fg-muted">PR #{d.prNumber}</span> : null}
      </div>
      <p className="text-3xs text-fg-muted">
        {word}
        {d.running && d.runnerLabel ? ` on ${d.runnerLabel}` : ''} · since{' '}
        <RelativeTime value={d.running && d.startedAt ? d.startedAt : d.createdAt} />
      </p>
    </NodeShell>
  )
}

export const CiHostNode = memo(HostNodeInner)
export const CiRunnerNode = memo(RunnerNodeInner)
export const CiRepoNode = memo(RepoNodeInner)
export const CiJobNode = memo(JobNodeInner)

function CiEdgeInner({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const running = (data as CiMapEdgeData | undefined)?.running === true
  const reduced = usePrefersReducedMotion()
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: running ? TONE_HEX.ok : readVizToken('viz-graph-muted'),
          strokeWidth: running ? 2 : 1.25,
          opacity: running ? 0.9 : 0.6,
        }}
      />
      {running && !reduced && <TravelingDotsEdge path={path} color={TONE_HEX.ok} dots={2} strokeWidth={3} />}
    </>
  )
}

export const CiEdge = memo(CiEdgeInner)
