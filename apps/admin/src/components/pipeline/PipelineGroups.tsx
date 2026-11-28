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
import { AGE_BUCKET_LABELS, CLOSING_ACTIONS, groupPrimary, offeredActions, primaryAction } from '../../lib/pipelineSignals'
import { heldReasonOf, withoutReasonCode } from '../../lib/heldReason'
import type { PendingAction } from './PipelineActionDialog'
import { MoreActionsMenu } from '../signal/MoreActionsMenu'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { VitalText } from '../signal/VitalText'
import { SendToWorkerButton } from './SendToWorkerButton'
import { AppGroupSection } from '../ui/app-group'
import { groupByApp, type AppGroup } from '../../lib/groupByApp'
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
  /**
   * The status line's "Start here" button runs the whole action section of `topGroupId`
   * (PipelinePage): that section shows no second button with its own count.
   */
  heroRunsSection?: boolean
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

const DAY = 86_400_000

/** One of the age bar's buckets (lib/pipelineSignals.ts AGE_BUCKET_LABELS): 0–3 d, 3–7 d, 7–30 d, 30 d+. */
type AgeBucket = 0 | 1 | 2 | 3

/**
 * How long a group's oldest item has waited, in the age bar's buckets. The group's `oldestAt`,
 * else the oldest non-empty server bucket, else the newest bucket. @internal Exported for tests.
 */
export function groupAgeBucket(group: Pick<PipelineGroup, 'oldestAt' | 'ages'>, now: number): AgeBucket {
  const t = group.oldestAt ? Date.parse(group.oldestAt) : Number.NaN
  if (Number.isFinite(t)) {
    const age = now - t
    return age < 3 * DAY ? 0 : age < 7 * DAY ? 1 : age < 30 * DAY ? 2 : 3
  }
  const ages = group.ages
  if (ages) for (let i = 3; i > 0; i--) if ((ages[i] ?? 0) > 0) return i as AgeBucket
  return 0
}

/**
 * A stuck group's left edge by how long it has waited (2026-11-22): every stuck group had the
 * same red edge, so 570 items read as one alarm. Neutral under 3 days, amber 3–7 d, red 7–30 d,
 * full-strength red past 30 d. The age is always printed beside it ("oldest 12 d"), so the edge
 * is never the only signal.
 */
const AGE_EDGE: Record<AgeBucket, string> = {
  0: 'border-l-edge',
  1: 'border-l-warn',
  2: 'border-l-danger/60',
  3: 'border-l-danger',
}
const AGE_INK: Record<AgeBucket, string> = {
  0: 'text-fg-muted',
  1: 'text-warn-foreground',
  2: 'text-danger-foreground',
  3: 'font-semibold text-danger-foreground',
}

/** True for an action that closes or removes something (the page's "Start here" never offers one). */
export function isClosingAction(action: PipelineAction): boolean {
  return CLOSING_ACTIONS.has(action)
}

/**
 * Groups where the agent ran and opened no PR (server `_shared/pipeline-view.ts`
 * AGENT_FAILED_GROUPS). They sat under "Not a code bug", their one shared action, which read
 * as if the agent's errors were not code bugs (2026-11-22). They gather under why instead.
 */
const AGENT_OUTCOME_GROUP_IDS: ReadonlySet<string> = new Set(['agent_failed', 'agent_failed_person', 'agent_failed_nothing', 'agent_said_fixed'])
const AGENT_OUTCOME_HEADING = "Agent couldn't fix"

const VERDICT_STATUS: Record<string, RunStatus> = { merge: 'passed', fix_first: 'slow', hold: 'failed' }
const VERDICT_LABEL: Record<string, string> = { merge: 'AI review: merge', fix_first: 'AI review: fix first', hold: 'AI review: hold' }

/** Where the person fixes what blocks an action, when it is a setting. */
/** A group's signal as a RunStatus, for the per-app header counts. */
const SIGNAL_RUN_STATUS: Record<SignalTone, RunStatus> = { danger: 'failed', warn: 'slow', info: 'running', ok: 'passed', off: 'idle' }

/**
 * All apps: a group's items by app, the app with the oldest item first and, inside it, the
 * oldest item first (the one that has waited longest is the worst). One app: null, the list
 * stays flat. @internal Exported for tests.
 */
export function groupItemsByApp(
  group: Pick<PipelineGroup, 'items'>,
  projectNames: ReadonlyMap<string, string>,
  showApp: boolean,
): AppGroup<PipelineItem>[] | null {
  if (!showApp || new Set(group.items.map((i) => i.projectId)).size < 2) return null
  return groupByApp(group.items, (i) => ({ id: i.projectId, name: projectNames.get(i.projectId) }), {
    rank: (i) => {
      const t = Date.parse(i.since)
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
    },
  })
}

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
  const byApp = groupItemsByApp(group, props.projectNames, props.showApp)
  // "Show more" pages through the whole group in the grouped order, so each app shows its oldest first.
  const shownIds = new Set((byApp ? byApp.flatMap((a) => a.items) : group.items).slice(0, shown).map((i) => i.id))
  const stuck = group.tone === 'stuck'
  const bucket = groupAgeBucket(group, props.now)
  const edge = stuck ? AGE_EDGE[bucket] : TONE_BORDER[signal]
  // The group to start with is the one card that stands out: a brand ring and a "Start here" label.
  const emphasis = marked ? 'ring-2 ring-brand/40' : ''
  return (
    // On a phone the title takes its own line and the age + actions a row beneath, never a
    // one-letter-wide column (GROUP_HEAD, 2026-11-18).
    <li
      ref={ref}
      className={`scroll-mt-20 rounded-md border border-edge-subtle border-l-4 bg-surface-raised ${edge} ${emphasis}`.trim()}
      data-testid={`pipeline-group-${group.id}`}
      data-tone={signal}
      data-age={stuck ? AGE_BUCKET_LABELS[bucket] : undefined}
      data-start-here={marked ? 'true' : undefined}
    >
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
          {(signal !== 'danger' || marked) && <StatusGlyph tone={signal} />}
          {marked && (
            <span className="shrink-0" data-testid={`pipeline-group-${group.id}-start-here`}>
              <Badge tone="brand">Start here</Badge>
              <span className="sr-only">: </span>
            </span>
          )}
          <span className={`min-w-0 text-xs text-fg wrap-break-word ${marked ? 'font-semibold' : 'font-medium'}`}>{group.label}</span>
        </button>
        <span className="flex flex-wrap items-center gap-2 pl-5.5 sm:justify-end sm:pl-0" data-testid={`pipeline-group-${group.id}-side`}>
          {group.oldestAt && group.tone !== 'done' && (
            <span
              className={`shrink-0 text-2xs tabular-nums ${stuck ? AGE_INK[bucket] : 'text-fg-muted'}`}
              title={stuck ? `Waiting ${AGE_BUCKET_LABELS[bucket]}` : undefined}
              data-testid={`pipeline-group-${group.id}-age`}
            >
              oldest {ageLabel(group.oldestAt, props.now)}
            </span>
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
          {byApp
            ? // All apps: one block per app (worst first), its count in the header and "Open →"
              // to that app's own pipeline at this group. The row's app badge would repeat the header.
              byApp.map((app) => {
                const rows = app.items.filter((i) => shownIds.has(i.id))
                if (rows.length === 0) return null
                return (
                  <li key={app.id} className="py-1" data-testid={`pipeline-group-${group.id}-app-${app.id}`}>
                    <AppGroupSection
                      app={app}
                      counts={{ [SIGNAL_RUN_STATUS[signal]]: app.items.length }}
                      summary={app.items[0] ? `oldest ${ageLabel(app.items[0].since, props.now)}` : undefined}
                      to={`/pipeline?project=${encodeURIComponent(app.id)}&group=${encodeURIComponent(group.id)}`}
                      data-testid={`pipeline-app-group-${group.id}-${app.id}`}
                    >
                      <ul className="divide-y divide-edge-subtle">
                        {rows.map((item) => (
                          <ItemRow key={item.id} item={item} group={group} props={{ ...props, showApp: false }} />
                        ))}
                      </ul>
                    </AppGroupSection>
                  </li>
                )
              })
            : group.items.slice(0, shown).map((item) => <ItemRow key={item.id} item={item} group={group} props={props} />)}
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
  // A closing action (Not a code bug, Close PR, Remove) is never one button for several groups.
  const primaries = new Map(
    groups.map((g) => {
      const p = groupPrimary(g)
      return [g, p && !CLOSING_ACTIONS.has(p.action) ? p : null] as const
    }),
  )
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

/** One block of the list as drawn. */
export type SectionBlock =
  | { kind: 'action'; action: PipelineAction; groups: PipelineGroup[] }
  | { kind: 'reason'; label: string; groups: PipelineGroup[] }
  | { kind: 'other'; groups: PipelineGroup[]; headed: boolean }

/**
 * The list as drawn: action sections, the agent's no-PR outcomes under "Agent couldn't fix"
 * (when there are two or more of them), and every run of lone groups that follows a section
 * under its own "Other" heading. Lone rows ("8 apps: auto-fix is on…", "5 reports: rejected at
 * intake") sat right under "Send to CI repair: 2 groups" and read as part of it (round-3 review,
 * 2026-11-19). Lone groups before the first section need no heading. @internal Exported for tests.
 */
export function sectionBlocks(groups: readonly PipelineGroup[]): SectionBlock[] {
  const agent = groups.filter((g) => AGENT_OUTCOME_GROUP_IDS.has(g.id))
  const pooled = agent.length > 1
  const rest = pooled ? groups.filter((g) => !AGENT_OUTCOME_GROUP_IDS.has(g.id)) : groups
  const at = (g: PipelineGroup) => groups.indexOf(g)
  const sections: Array<{ action: PipelineAction | null; reason?: string; groups: PipelineGroup[] }> = actionSections(rest)
  if (pooled) sections.push({ action: null, reason: AGENT_OUTCOME_HEADING, groups: agent })
  sections.sort((a, b) => at(a.groups[0]!) - at(b.groups[0]!))
  const out: SectionBlock[] = []
  let seenSection = false
  for (const sec of sections) {
    if (sec.reason) {
      seenSection = true
      out.push({ kind: 'reason', label: sec.reason, groups: sec.groups })
      continue
    }
    if (sec.action) {
      seenSection = true
      out.push({ kind: 'action', action: sec.action, groups: sec.groups })
      continue
    }
    const last = out[out.length - 1]
    if (last && last.kind === 'other' && last.headed === seenSection) last.groups.push(...sec.groups)
    else out.push({ kind: 'other', groups: [...sec.groups], headed: seenSection })
  }
  return out
}

/**
 * What a section's one button runs on: each group's primary items, in list order. The status
 * line's "Start here" button runs the same set when its group sits in that section, so the
 * two never show different counts (2026-11-22: "Re-run CI (67)" above "Re-run CI (68)").
 * Exported for the page (and its tests).
 */
export function sectionRun(groups: readonly PipelineGroup[]): { ids: string[]; reportIds: Array<string | null> } {
  const ids: string[] = []
  const reportIds: Array<string | null> = []
  for (const g of groups) {
    const byId = new Map(g.items.map((i) => [i.id, i]))
    for (const id of groupPrimary(g)?.ids ?? []) {
      ids.push(id)
      reportIds.push(byId.get(id)?.reportId ?? null)
    }
  }
  return { ids, reportIds }
}

/** The action section a group sits in, when it shares its fix with other groups. Exported for the page. */
export function sectionOf(groups: readonly PipelineGroup[], groupId: string): { action: PipelineAction; groups: PipelineGroup[] } | null {
  for (const b of sectionBlocks(groups)) if (b.kind === 'action' && b.groups.some((g) => g.id === groupId)) return { action: b.action, groups: b.groups }
  return null
}

/** A heading for groups that take the same fix, and the one button that runs it on all of them. */
function ActionSection({ action, groups, props, markId }: { action: PipelineAction; groups: PipelineGroup[]; props: Props; markId: string | null }) {
  const { ids, reportIds } = sectionRun(groups)
  // The status line's "Start here" button already runs this section: one button, one count.
  const ranAbove = markId != null && props.heroRunsSection === true && groups.some((g) => g.id === markId)
  const total = groups.reduce((n, g) => n + g.count, 0)
  const key = `${action}:section`
  const label = ACTION_META[action].label
  // The heading counts what the button runs on ("14 items" over "Send to CI repair (13)",
  // round-3 review 2026-11-19); the rest are named as such.
  const left = Math.max(0, total - ids.length)
  return (
    <li className="space-y-1" data-testid={`pipeline-action-section-${action}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <p className="text-2xs font-semibold text-fg-secondary" data-testid={`pipeline-action-section-${action}-head`}>
          {label}:{' '}
          <span className="font-normal text-fg-muted">
            {groups.length} groups, {ids.length} {ids.length === 1 ? 'item' : 'items'}
            {left > 0 && ` (${left} more can't take it now)`}
          </span>
        </p>
        {ranAbove ? (
          <span className="text-2xs text-fg-muted" data-testid={`pipeline-action-section-${action}-above`}>
            Runs from Start here, above
          </span>
        ) : (
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
        )}
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
  const card = (g: PipelineGroup) => <GroupCard key={`${g.stage}:${g.id}`} group={g} props={props} marked={g.id === markId} />
  return (
    <ul className="space-y-2" data-testid="pipeline-groups">
      {sectionBlocks(props.groups).map((b, i) =>
        b.kind === 'action' ? (
          <ActionSection key={`section:${b.action}`} action={b.action} groups={b.groups} props={props} markId={markId} />
        ) : b.kind === 'reason' ? (
          <li key={`reason:${b.label}`} className="space-y-1" data-testid="pipeline-agent-outcome-section">
            <p className="px-1 pt-1 text-2xs font-semibold text-fg-secondary">
              {b.label}:{' '}
              <span className="font-normal text-fg-muted">
                {b.groups.length} groups, {b.groups.reduce((n, g) => n + g.count, 0)} reports, no PR opened
              </span>
            </p>
            <ul className="space-y-1">{b.groups.map(card)}</ul>
          </li>
        ) : b.headed ? (
          <li key={`other:${i}`} className="space-y-1" data-testid="pipeline-other-section">
            <p className="px-1 pt-1 text-2xs font-semibold text-fg-secondary">
              Other: <span className="font-normal text-fg-muted">{b.groups.length} {b.groups.length === 1 ? 'group' : 'groups'}, {b.groups.reduce((n, g) => n + g.count, 0)} items</span>
            </p>
            <ul className="space-y-1">{b.groups.map(card)}</ul>
          </li>
        ) : (
          b.groups.map(card)
        ),
      )}
    </ul>
  )
}
