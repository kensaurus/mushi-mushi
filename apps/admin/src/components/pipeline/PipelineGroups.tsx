/**
 * FILE: apps/admin/src/components/pipeline/PipelineGroups.tsx
 * PURPOSE: The groups of one stage (or every stuck group), each a plain
 *          reason with its count, the oldest item's age, bulk actions and a
 *          link to the setting that blocks it. Opening a group lists its
 *          items: the report, the PR, how long it has waited, and the latest
 *          evidence (failing checks, the Opus verdict and its findings, the
 *          merge queue's last word), each with its own actions.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn } from '../ui'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconExternalLink } from '../icons'
import { ACTION_META, ageLabel, type ActionOutcome, type PipelineAction, type PipelineGroup, type PipelineItem } from '../../lib/pipeline'
import type { PendingAction } from './PipelineActionDialog'

interface Props {
  groups: PipelineGroup[]
  projectNames: Map<string, string>
  showApp: boolean
  now: number
  /** The action running now: `${action}:${groupId|itemId}`. */
  busyKey: string | null
  results: Map<string, ActionOutcome>
  onAction: (pending: PendingAction, key: string) => void
}

const TONE_ICON = {
  stuck: <span className="text-danger-foreground"><IconAlertTriangle size={14} /></span>,
  moving: <span className="text-info-foreground"><IconClock size={14} /></span>,
  done: <span className="text-ok-foreground"><IconCheck size={14} /></span>,
}

const TONE_BORDER = {
  stuck: 'border-l-danger',
  moving: 'border-l-info',
  done: 'border-l-ok',
}

const VERDICT_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = { merge: 'ok', fix_first: 'warn', hold: 'danger' }
const VERDICT_LABEL: Record<string, string> = { merge: 'Opus: merge', fix_first: 'Opus: fix first', hold: 'Opus: hold' }

/** Fix-level actions apply to fix attempts only; report groups have none. */
function fixIdsOf(group: PipelineGroup): string[] {
  return group.items.map((i) => i.id)
}

function ActionButtons({
  actions,
  ids,
  target,
  keyPrefix,
  busyKey,
  onAction,
  size = 'sm',
  testIdPrefix,
}: {
  actions: PipelineAction[]
  ids: string[]
  target: string
  keyPrefix: string
  busyKey: string | null
  onAction: Props['onAction']
  size?: 'sm'
  testIdPrefix: string
}) {
  if (actions.length === 0 || ids.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {actions.map((a) => {
        const key = `${a}:${keyPrefix}`
        return (
          <Btn
            key={a}
            size={size}
            variant={ACTION_META[a].variant}
            loading={busyKey === key}
            disabled={busyKey != null && busyKey !== key}
            onClick={() => onAction({ action: a, fixIds: ids, target }, key)}
            data-testid={`${testIdPrefix}-${a}`}
          >
            {ACTION_META[a].label}
            {ids.length > 1 ? ` (${ids.length})` : ''}
          </Btn>
        )
      })}
    </span>
  )
}

function Evidence({ item }: { item: PipelineItem }) {
  const verdict = item.review?.verdict ?? null
  const showReview = !!verdict && verdict !== 'merge'
  return (
    <div className="space-y-1 text-2xs text-fg-muted">
      {item.failingChecks.length > 0 && (
        <p className="flex flex-wrap items-center gap-1">
          <span>Failing:</span>
          {item.failingChecks.slice(0, 8).map((c) => (
            <Badge key={c} tone="dangerSubtle">{c}</Badge>
          ))}
        </p>
      )}
      {showReview && (
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-1">
            <Badge tone={VERDICT_TONE[verdict] ?? 'neutral'}>{VERDICT_LABEL[verdict] ?? verdict}</Badge>
            {item.review?.summary && <span className="min-w-0 wrap-break-word">{item.review.summary}</span>}
          </p>
          {item.review && item.review.findings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {item.review.findings.map((f, i) => (
                <li key={i} className="wrap-break-word">{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(item.lastError ?? item.queueDetail) && <p className="wrap-break-word">{item.lastError ?? item.queueDetail}</p>}
    </div>
  )
}

function ItemRow({ item, group, props }: { item: PipelineItem; group: PipelineGroup; props: Props }) {
  const result = props.results.get(item.id)
  return (
    <li className="space-y-1 py-2" data-testid={`pipeline-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {item.reportId ? (
          <Link to={`/reports/${item.reportId}`} className="min-w-0 max-w-full truncate text-xs font-medium text-fg hover:underline">
            {item.title}
          </Link>
        ) : (
          <span className="min-w-0 max-w-full truncate text-xs font-medium text-fg">{item.title}</span>
        )}
        {item.prUrl && (
          <a href={item.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-2xs text-fg-secondary hover:text-fg hover:underline">
            {item.repo ?? 'PR'}#{item.prNumber}
            <IconExternalLink size={10} />
          </a>
        )}
        {props.showApp && <Badge tone="neutral">{props.projectNames.get(item.projectId) ?? 'app'}</Badge>}
        <span className="text-2xs tabular-nums text-fg-faint" title={new Date(item.since).toLocaleString()}>
          {ageLabel(item.since, props.now)} in stage
        </span>
        {item.lastEventAt && (
          <span className="text-2xs text-fg-faint" title={new Date(item.lastEventAt).toLocaleString()} data-testid={`pipeline-item-${item.id}-last-event`}>
            · last: {item.lastEventLabel ?? 'event'} ({ageLabel(item.lastEventAt, props.now)} ago)
          </span>
        )}
      </div>
      <Evidence item={item} />
      <div className="flex flex-wrap items-center gap-2">
        {item.prUrl && (
          <ActionButtons
            actions={group.actions}
            ids={[item.id]}
            target={item.title}
            keyPrefix={item.id}
            busyKey={props.busyKey}
            onAction={props.onAction}
            testIdPrefix={`pipeline-item-${item.id}`}
          />
        )}
        {result && (
          <span className={`text-2xs ${result.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid={`pipeline-item-${item.id}-result`}>
            {result.message}
          </span>
        )}
      </div>
    </li>
  )
}

function GroupCard({ group, props }: { group: PipelineGroup; props: Props }) {
  const [open, setOpen] = useState(false)
  const ids = group.items.some((i) => i.prUrl) ? fixIdsOf(group) : []
  return (
    <li className={`rounded-md border border-edge-subtle border-l-4 bg-surface-raised ${TONE_BORDER[group.tone]}`} data-testid={`pipeline-group-${group.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid={`pipeline-group-${group.id}-toggle`}
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {TONE_ICON[group.tone]}
          <span className="min-w-0 text-xs font-medium text-fg wrap-break-word">{group.label}</span>
          {group.oldestAt && group.tone !== 'done' && (
            <span className="shrink-0 text-2xs tabular-nums text-fg-muted">oldest {ageLabel(group.oldestAt, props.now)}</span>
          )}
        </button>
        <span className="flex flex-wrap items-center gap-2">
          {group.settings && (
            <Link to={group.settings.to} className="text-2xs font-medium text-brand hover:underline" data-testid={`pipeline-group-${group.id}-settings`}>
              {group.settings.label} →
            </Link>
          )}
          <ActionButtons
            actions={group.actions}
            ids={ids}
            target={group.label}
            keyPrefix={group.id}
            busyKey={props.busyKey}
            onAction={props.onAction}
            testIdPrefix={`pipeline-group-${group.id}`}
          />
        </span>
      </div>
      {open && (
        <ul className="max-h-128 divide-y divide-edge-subtle overflow-y-auto border-t border-edge-subtle px-2.5">
          {group.items.map((item) => (
            <ItemRow key={item.id} item={item} group={group} props={props} />
          ))}
          {group.count > group.items.length && (
            <li className="py-2 text-2xs text-fg-muted">Showing the oldest {group.items.length} of {group.count}.</li>
          )}
        </ul>
      )}
    </li>
  )
}

export function PipelineGroups(props: Props) {
  if (props.groups.length === 0) {
    return <p className="text-xs text-fg-muted" data-testid="pipeline-groups-empty">Nothing here right now.</p>
  }
  return (
    <ul className="space-y-2" data-testid="pipeline-groups">
      {props.groups.map((g) => (
        <GroupCard key={`${g.stage}:${g.id}`} group={g} props={props} />
      ))}
    </ul>
  )
}
