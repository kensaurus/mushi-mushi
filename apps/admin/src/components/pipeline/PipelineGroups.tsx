/**
 * FILE: apps/admin/src/components/pipeline/PipelineGroups.tsx
 * PURPOSE: The groups of one stage (or every stuck group), each a plain
 *          reason with its count, the oldest item's age, bulk actions and a
 *          link to the setting that blocks it. Opening a group lists its
 *          items: the report, the PR, how long it has waited, and the latest
 *          evidence (failing checks, the Opus verdict and its findings, the
 *          merge queue's last word), each with its own actions. A group of
 *          reports not fixed yet also offers "Send to my local worker" when
 *          you have a worker lane for its app (ADR 0048).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn } from '../ui'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconExternalLink } from '../icons'
import { ACTION_META, actionableIds, ageLabel, sharedBlockReason, type ActionOutcome, type PipelineAction, type PipelineGroup, type PipelineItem } from '../../lib/pipeline'
import type { PendingAction } from './PipelineActionDialog'
import { SendToWorkerButton } from './SendToWorkerButton'
import type { WorkerLane } from '../../lib/workers'

interface Props {
  groups: PipelineGroup[]
  projectNames: Map<string, string>
  showApp: boolean
  now: number
  /** The action running now: `${action}:${groupId|itemId}`. */
  busyKey: string | null
  results: Map<string, ActionOutcome>
  onAction: (pending: PendingAction, key: string) => void
  /** Your own local worker lanes (every app); empty hides "Send to my local worker". */
  workerLanes?: WorkerLane[]
}

/** Stages whose reports have no fix to keep yet: a local worker may take them. */
const SENDABLE_STAGES = new Set(['reported', 'triaged', 'pr'])

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

/** Where the person fixes what blocks an action, when it is a setting. */
function blockedFixLink(reason: string): { label: string; to: string } | null {
  if (/GitHub token/i.test(reason)) return { label: 'GitHub connection', to: '/integrations/config#platform-card-github' }
  if (/follow-ups are off|Cursor key/i.test(reason)) return { label: 'Review follow-ups setting', to: '/settings?tab=byok#review-followups' }
  return null
}

/**
 * One button per group action. An action the server would refuse for every
 * item is disabled with its reason (report 69fcafcb); a bulk button runs on
 * the items that can take it and says how many.
 */
export function ActionButtons({
  actions,
  items,
  target,
  keyPrefix,
  busyKey,
  onAction,
  testIdPrefix,
}: {
  actions: PipelineAction[]
  items: PipelineItem[]
  target: string
  keyPrefix: string
  busyKey: string | null
  onAction: Props['onAction']
  testIdPrefix: string
}) {
  const shown = actions.filter((a) => items.some((i) => (a === 'dismiss' || a === 'requeue' ? i.reportId : i.prUrl)))
  if (shown.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((a) => {
        const key = `${a}:${keyPrefix}`
        const ids = actionableIds(items, a)
        const off = ids.length === 0
        const reason = off ? (sharedBlockReason(items, a) ?? 'None of these can take it right now.') : undefined
        const some = !off && ids.length < items.length ? `${ids.length} of ${items.length} can take it; the others are listed with the reason.` : undefined
        const byId = new Map(items.map((i) => [i.id, i]))
        return (
          <Btn
            key={a}
            size="sm"
            variant={off ? 'ghost' : ACTION_META[a].variant}
            loading={busyKey === key}
            disabled={off || (busyKey != null && busyKey !== key)}
            title={reason ?? some}
            aria-describedby={off ? `${testIdPrefix}-${a}-why` : undefined}
            onClick={() => onAction({ action: a, fixIds: ids, reportIds: ids.map((id) => byId.get(id)?.reportId ?? null), target }, key)}
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

/** "Re-run CI is off: <why>" for each action the server would refuse for this item. */
export function BlockedReasons({ item, actions, testIdPrefix }: { item: PipelineItem; actions: PipelineAction[]; testIdPrefix: string }) {
  const off = actions.filter((a) => item.blocked?.[a])
  if (off.length === 0) return null
  return (
    <ul className="space-y-0.5 text-2xs text-fg-muted" data-testid={`${testIdPrefix}-blocked`}>
      {off.map((a) => {
        const why = item.blocked![a]!
        const fix = blockedFixLink(why)
        return (
          <li key={a} id={`${testIdPrefix}-${a}-why`} className="wrap-break-word">
            <span className="font-medium text-fg-secondary">{ACTION_META[a].label}</span> is off: {why}
            {fix && (
              <>
                {' '}
                <Link to={fix.to} className="font-medium text-brand hover:underline">
                  {fix.label} →
                </Link>
              </>
            )}
          </li>
        )
      })}
    </ul>
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
        <ActionButtons
          actions={group.actions}
          items={[item]}
          target={item.title}
          keyPrefix={item.id}
          busyKey={props.busyKey}
          onAction={props.onAction}
          testIdPrefix={`pipeline-item-${item.id}`}
        />
        {result && (
          <span className={`text-2xs ${result.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid={`pipeline-item-${item.id}-result`}>
            {result.message}
          </span>
        )}
      </div>
      <BlockedReasons item={item} actions={group.actions} testIdPrefix={`pipeline-item-${item.id}`} />
    </li>
  )
}

/** Items shown per group before "Show more": the page scrolls, the group does not (2375c9c5). */
const ITEMS_STEP = 20

function GroupCard({ group, props }: { group: PipelineGroup; props: Props }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(ITEMS_STEP)
  const apps = new Set(group.items.map((i) => i.projectId))
  const appId = apps.size === 1 ? [...apps][0]! : null
  const sendIds = [...new Set(group.items.map((i) => i.reportId).filter((x): x is string => !!x))]
  const lanes = appId && SENDABLE_STAGES.has(group.stage) ? (props.workerLanes ?? []).filter((l) => l.projectId === appId) : []
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
            <Link
              to={group.settings.to}
              title={group.settings.hint}
              className="text-2xs font-medium text-brand hover:underline"
              data-testid={`pipeline-group-${group.id}-settings`}
            >
              {group.settings.label} →
            </Link>
          )}
          <ActionButtons
            actions={group.actions}
            items={group.items}
            target={group.label}
            keyPrefix={group.id}
            busyKey={props.busyKey}
            onAction={props.onAction}
            testIdPrefix={`pipeline-group-${group.id}`}
          />
          {appId && lanes.length > 0 && sendIds.length > 0 && (
            <SendToWorkerButton projectId={appId} reportIds={sendIds} lanes={lanes} data-testid={`pipeline-group-${group.id}-send-to-worker`} />
          )}
        </span>
      </div>
      {group.settings?.hint && (
        <p className="-mt-1 px-2.5 pb-2 text-2xs text-fg-muted" data-testid={`pipeline-group-${group.id}-settings-hint`}>
          {group.settings.hint}
        </p>
      )}
      {open && (
        <ul className="divide-y divide-edge-subtle border-t border-edge-subtle px-2.5">
          {group.items.slice(0, shown).map((item) => (
            <ItemRow key={item.id} item={item} group={group} props={props} />
          ))}
          {shown < group.items.length && (
            <li className="py-2">
              <Btn size="sm" variant="ghost" onClick={() => setShown((n) => n + ITEMS_STEP)} data-testid={`pipeline-group-${group.id}-more`}>
                Show {Math.min(ITEMS_STEP, group.items.length - shown)} more of {group.items.length}
              </Btn>
            </li>
          )}
          {group.count > group.items.length && shown >= group.items.length && (
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
