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

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn } from '../ui'
import { IconChevronDown, IconChevronRight, IconExternalLink } from '../icons'
import { ACTION_META, actionableIds, ageLabel, sharedBlockReason, type ActionOutcome, type PipelineAction, type PipelineGroup, type PipelineItem } from '../../lib/pipeline'
import { groupPrimary, offeredActions, primaryAction } from '../../lib/pipelineSignals'
import { heldReasonOf, withoutReasonCode } from '../../lib/heldReason'
import type { PendingAction } from './PipelineActionDialog'
import { MoreActionsMenu } from '../signal/MoreActionsMenu'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { VitalText } from '../signal/VitalText'
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
  /** A group to open and scroll to (`/pipeline?group=<id>`, Home's Needs you buttons). */
  focusGroupId?: string | null
  /**
   * The one group to start with (the status line's "biggest"): the only row that takes ▲.
   * Unset: the first failed group. ▲ sat on ~18 rows beside a legend calling it "the
   * bottleneck" (round-2 review, 2026-11-18); a failed row keeps its red edge.
   */
  topGroupId?: string | null
}

/** Stages whose reports have no fix to keep yet: a local worker may take them. */
const SENDABLE_STAGES = new Set(['reported', 'triaged', 'pr'])

/**
 * Stuck groups that are slow or waiting, not failed (2026-11-18): an agent or CI still running,
 * a conflict agent not started, a PR waiting on its base or a later train, a backlog report, a
 * merged fix with no deploy yet. They take ◆; ▲ is only for what failed or needs a decision.
 */
const SLOW_GROUP_IDS: ReadonlySet<string> = new Set(['agent_slow', 'ci_slow', 'conflict_stuck', 'base_red', 'after_red_train', 'no_fix_old', 'not_deployed'])

/** The signal tone of a group's mark: ▲ failed, ◆ slow or waiting, ■ moving, ● done. @internal Exported for tests. */
export function groupSignalTone(group: Pick<PipelineGroup, 'id' | 'tone'>): SignalTone {
  if (group.tone === 'done') return 'ok'
  if (group.tone === 'moving') return 'info'
  return SLOW_GROUP_IDS.has(group.id) ? 'warn' : 'danger'
}

const TONE_BORDER: Record<SignalTone, string> = {
  danger: 'border-l-danger',
  warn: 'border-l-warn',
  info: 'border-l-info',
  ok: 'border-l-ok',
  off: 'border-l-edge',
}

const VERDICT_STATUS: Record<string, RunStatus> = { merge: 'passed', fix_first: 'slow', hold: 'failed' }
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
 *
 * `split` (the pipeline page, 2026-11-18): only the primary action
 * (lib/pipelineSignals.ts `primaryAction`) is a button; the rest sit in a
 * "More" menu with the same disabled reasons, busy state and test ids.
 */
export function ActionButtons({
  actions,
  items,
  target,
  keyPrefix,
  busyKey,
  onAction,
  testIdPrefix,
  split = false,
  omitPrimary = false,
}: {
  actions: PipelineAction[]
  items: PipelineItem[]
  target: string
  keyPrefix: string
  busyKey: string | null
  onAction: Props['onAction']
  testIdPrefix: string
  split?: boolean
  /** The group sits under a heading whose one button runs this primary for every group: show only More. */
  omitPrimary?: boolean
}) {
  const shown = offeredActions(actions, items)
  if (shown.length === 0) return null
  const byId = new Map(items.map((i) => [i.id, i]))
  const meta = (a: PipelineAction) => {
    const key = `${a}:${keyPrefix}`
    const ids = actionableIds(items, a)
    const off = ids.length === 0
    const reason = off ? (sharedBlockReason(items, a) ?? 'None of these can take it right now.') : undefined
    const some = !off && ids.length < items.length ? `${ids.length} of ${items.length} can take it; the others are listed with the reason.` : undefined
    return {
      key,
      ids,
      off,
      title: reason ?? some,
      label: `${ACTION_META[a].label}${ids.length > 1 ? ` (${ids.length})` : ''}`,
      run: () => onAction({ action: a, fixIds: ids, reportIds: ids.map((id) => byId.get(id)?.reportId ?? null), target }, key),
    }
  }
  const button = (a: PipelineAction) => {
    const m = meta(a)
    return (
      <Btn
        key={a}
        size="sm"
        variant={m.off ? 'ghost' : ACTION_META[a].variant}
        loading={busyKey === m.key}
        disabled={m.off || (busyKey != null && busyKey !== m.key)}
        title={m.title}
        aria-describedby={m.off ? `${testIdPrefix}-${a}-why` : undefined}
        onClick={m.run}
        data-testid={`${testIdPrefix}-${a}`}
      >
        {m.label}
      </Btn>
    )
  }
  if (!split) return <span className="flex flex-wrap gap-1">{shown.map(button)}</span>
  const primary = primaryAction(shown, items)
  const rest = shown.filter((a) => a !== primary)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {primary && !omitPrimary && button(primary)}
      <MoreActionsMenu
        label={target}
        testId={`${testIdPrefix}-more-actions`}
        actions={rest.map((a) => {
          const m = meta(a)
          return {
            key: a,
            label: m.label,
            onSelect: m.run,
            disabled: m.off || (busyKey != null && busyKey !== m.key),
            busy: busyKey === m.key,
            title: m.title,
            describedBy: m.off ? `${testIdPrefix}-${a}-why` : undefined,
            testId: `${testIdPrefix}-${a}`,
            danger: ACTION_META[a].variant === 'danger',
          }
        })}
      />
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
  const note = item.lastError ?? item.queueDetail
  const why = note && withoutReasonCode(note) !== note ? heldReasonOf(note) : null
  return (
    <div className="space-y-1 text-2xs text-fg-muted">
      {item.failingChecks.length > 0 && (
        <p className="flex flex-wrap items-center gap-1">
          <span>Failing:</span>
          {item.failingChecks.slice(0, 8).map((c) => (
            <StatusPill key={c} status="failed" label={c} />
          ))}
        </p>
      )}
      {showReview && (
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-1">
            <StatusPill status={VERDICT_STATUS[verdict] ?? 'idle'} label={VERDICT_LABEL[verdict] ?? verdict} />
            {item.review?.summary && (
              <span className="min-w-0 wrap-break-word">
                <VitalText text={item.review.summary} />
              </span>
            )}
          </p>
          {item.review && item.review.findings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {item.review.findings.map((f, i) => (
                <li key={i} className="wrap-break-word">
                  <VitalText text={f} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {note && (
        <p className="wrap-break-word">
          {why && (
            // A reason code in the server's sentence ("(key_used_up)") reads as a plain-word chip (2026-11-18).
            <span
              className="mr-1 inline-flex items-center rounded-sm border border-warn/55 bg-warn-muted px-1 text-3xs font-bold text-warn-foreground"
              title={note}
              data-testid={`pipeline-item-${item.id}-why`}
            >
              {why}
            </span>
          )}
          <VitalText text={why ? withoutReasonCode(note) : note} />
        </p>
      )}
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
            <VitalText text={item.title} />
          </Link>
        ) : (
          <span className="min-w-0 max-w-full truncate text-xs font-medium text-fg">
            <VitalText text={item.title} />
          </span>
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
          split
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

/**
 * A group's header row: one column (title, then age + actions beneath) below 640 px, then
 * title | age + actions. A viewport breakpoint, not a container query: `container-type` gives
 * the card layout containment, a stacking context, so an open More menu would paint under
 * the next card.
 */
// mushi-mushi-allowlist: title track shrinks, the age + actions track keeps its content width
const GROUP_HEAD = 'grid grid-cols-1 items-center gap-x-3 gap-y-1.5 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto]'

/** Items shown per group before "Show more": the page scrolls, the group does not (2375c9c5). */
const ITEMS_STEP = 20

function GroupCard({ group, props, marked, inSection = false }: { group: PipelineGroup; props: Props; marked: boolean; inSection?: boolean }) {
  const focused = props.focusGroupId === group.id
  const [open, setOpen] = useState(focused)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focused])
  const [shown, setShown] = useState(ITEMS_STEP)
  const apps = new Set(group.items.map((i) => i.projectId))
  const appId = apps.size === 1 ? [...apps][0]! : null
  const sendIds = [...new Set(group.items.map((i) => i.reportId).filter((x): x is string => !!x))]
  const signal = groupSignalTone(group)
  const lanes = appId && SENDABLE_STAGES.has(group.stage) ? (props.workerLanes ?? []).filter((l) => l.projectId === appId) : []
  return (
    // On a phone the title takes its own line and the age + actions a row beneath, never a
    // one-letter-wide column (GROUP_HEAD, 2026-11-18).
    <li ref={ref} className={`scroll-mt-20 rounded-md border border-edge-subtle border-l-4 bg-surface-raised ${TONE_BORDER[signal]}`} data-testid={`pipeline-group-${group.id}`} data-tone={signal}>
      <div className={GROUP_HEAD} data-testid={`pipeline-group-${group.id}-head`}>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid={`pipeline-group-${group.id}-toggle`}
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {/* ▲ once per list (the group to start with); ◆ slow and ■/● stay on every row. */}
          {(signal !== 'danger' || marked) && <StatusGlyph tone={signal} label={marked ? 'Start here' : undefined} />}
          <span className="min-w-0 text-xs font-medium text-fg wrap-break-word">{group.label}</span>
        </button>
        <span className="flex flex-wrap items-center gap-2 pl-5.5 sm:justify-end sm:pl-0" data-testid={`pipeline-group-${group.id}-side`}>
          {group.oldestAt && group.tone !== 'done' && (
            <span className="shrink-0 text-2xs tabular-nums text-fg-muted">oldest {ageLabel(group.oldestAt, props.now)}</span>
          )}
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
            split
            omitPrimary={inSection}
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

/**
 * Groups whose one fix is the same action, under one heading with one button for all of them
 * (round-2 review, 2026-11-18: "Update branch" ×4, "Re-run review" ×3, "Not a code bug" ×3 as
 * separate rows). Only a primary the server would take counts; a group alone keeps its own
 * button. Order is the list's order (biggest first). @internal Exported for tests.
 */
export function actionSections(groups: readonly PipelineGroup[]): Array<{ action: PipelineAction | null; groups: PipelineGroup[] }> {
  const primaries = new Map(groups.map((g) => [g, groupPrimary(g)]))
  const byAction = new Map<PipelineAction, PipelineGroup[]>()
  for (const g of groups) {
    const p = primaries.get(g)
    if (p) byAction.set(p.action, [...(byAction.get(p.action) ?? []), g])
  }
  const out: Array<{ action: PipelineAction | null; groups: PipelineGroup[] }> = []
  const placed = new Set<PipelineAction>()
  for (const g of groups) {
    const p = primaries.get(g)
    const same = p ? (byAction.get(p.action) ?? []) : []
    if (p && same.length > 1) {
      if (placed.has(p.action)) continue
      placed.add(p.action)
      out.push({ action: p.action, groups: same })
    } else out.push({ action: null, groups: [g] })
  }
  return out
}

/** A heading for groups that take the same fix, and the one button that runs it on all of them. */
function ActionSection({ action, groups, props, markId }: { action: PipelineAction; groups: PipelineGroup[]; props: Props; markId: string | null }) {
  const ids: string[] = []
  const reportIds: Array<string | null> = []
  for (const g of groups) {
    const byId = new Map(g.items.map((i) => [i.id, i]))
    for (const id of groupPrimary(g)?.ids ?? []) {
      ids.push(id)
      reportIds.push(byId.get(id)?.reportId ?? null)
    }
  }
  const total = groups.reduce((n, g) => n + g.count, 0)
  const key = `${action}:section`
  const label = ACTION_META[action].label
  return (
    <li className="space-y-1" data-testid={`pipeline-action-section-${action}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <p className="text-2xs font-semibold text-fg-secondary">
          {label}: <span className="font-normal text-fg-muted">{groups.length} groups, {total} items</span>
        </p>
        <Btn
          size="sm"
          variant={ACTION_META[action].variant === 'primary' ? 'primary' : 'ghost'}
          loading={props.busyKey === key}
          disabled={ids.length === 0 || (props.busyKey != null && props.busyKey !== key)}
          onClick={() => props.onAction({ action, fixIds: ids, reportIds, target: `${groups.length} groups: ${label}` }, key)}
          data-testid={`pipeline-action-section-${action}-run`}
        >
          {label}
          {ids.length > 1 ? ` (${ids.length})` : ''}
        </Btn>
      </div>
      <ul className="space-y-1">
        {groups.map((g) => (
          <GroupCard key={`${g.stage}:${g.id}`} group={g} props={props} marked={g.id === markId} inSection />
        ))}
      </ul>
    </li>
  )
}

export function PipelineGroups(props: Props) {
  if (props.groups.length === 0) {
    return <p className="text-xs text-fg-muted" data-testid="pipeline-groups-empty">Nothing here right now.</p>
  }
  const markId = props.topGroupId ?? props.groups.find((g) => groupSignalTone(g) === 'danger')?.id ?? null
  return (
    <ul className="space-y-2" data-testid="pipeline-groups">
      {actionSections(props.groups).map((sec) =>
        sec.action ? (
          <ActionSection key={`section:${sec.action}`} action={sec.action} groups={sec.groups} props={props} markId={markId} />
        ) : (
          <GroupCard key={`${sec.groups[0]!.stage}:${sec.groups[0]!.id}`} group={sec.groups[0]!} props={props} marked={sec.groups[0]!.id === markId} />
        ),
      )}
    </ul>
  )
}
