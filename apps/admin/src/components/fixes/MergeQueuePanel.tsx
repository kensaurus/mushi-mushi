/**
 * FILE: apps/admin/src/components/fixes/MergeQueuePanel.tsx
 * PURPOSE: The merge queue of the active app on /fixes (ADR 0041): what is
 *          waiting to merge, what a Cursor agent is resolving, what needs
 *          you and why, and what merged today.
 *
 *          Replaces the 2026-10-23 experience of a bulk merge: one toast
 *          ("3 could not merge (check CI / branch protection)") with no PR
 *          named and a wrong hint, while the real cause was a branch behind
 *          its base after the previous merge.
 *
 *          Release trains (ADR 0044, the default): approved PRs ride one
 *          train PR per interval, so a batch ships as one deploy and one
 *          release. The panel shows each repo's train and the app's cadence.
 *
 *          2026-11-18 (the CI page's visual language): the queue is a picture,
 *          not paragraphs. A stage train with counts (Queued → Waiting →
 *          Agent resolving → Held → Train running → Merged today) where only
 *          Held (◆) and merges (●) take a colour; "Decide for me" is a
 *          two-branch picture; each held
 *          row carries its reason as a plain-word chip ("key used up",
 *          lib/heldReason.ts), with the full sentence as its tooltip.
 */

import { useCallback, useEffect, useState } from 'react'
import { Btn, Card, FILTER_SELECT_CLASS, RelativeTime, SegmentedControl, Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import { groupQueueRows, heldReasonOf, withoutReasonCode } from '../../lib/heldReason'
import { StageTrain, type TrainStage } from '../signal/StageTrain'
import { StatusGlyph } from '../signal/StatusGlyph'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import {
  MERGE_QUEUE_STATE_LABEL,
  TRAIN_INTERVAL_OPTIONS,
  intervalLabel,
  isActiveQueueRow,
  loadMergeQueue,
  mergeQueueSummary,
  prLink,
  removeFromMergeQueue,
  saveReleaseSettings,
  trainLine,
  type MergeQueueRow,
  type ReleaseMode,
  type ReleaseSettings,
  type ReleaseTrain,
} from '../../lib/mergeQueue'

/** A queue row's state as a mark: moving rows run, held rows fail until someone acts. */
const QUEUE_ROW_STATUS: Record<MergeQueueRow['state'], RunStatus> = {
  queued: 'waiting',
  waiting: 'waiting',
  resolving: 'running',
  blocked: 'failed',
  merged: 'passed',
  removed: 'cancelled',
}

const MODE_OPTIONS = [
  { id: 'train', label: 'Batch' },
  { id: 'each', label: 'Each PR' },
] as const

const POLL_MS = 30_000

/**
 * Whether this app's queue was non-empty on the last visit, so the loading
 * frame starts at about the size the panel will have: the panel used to
 * render nothing until its rows loaded and then push the fix list down
 * ~416px (layout shift on /fixes, measured 2026-10-24).
 */
const NONEMPTY_KEY = (projectId: string) => `mushi:merge-queue-nonempty:${projectId}`
function rememberedNonEmpty(projectId: string | null): boolean {
  if (!projectId) return false
  try {
    return window.localStorage.getItem(NONEMPTY_KEY(projectId)) === '1'
  } catch {
    return false
  }
}
function rememberNonEmpty(projectId: string, nonEmpty: boolean): void {
  try {
    window.localStorage.setItem(NONEMPTY_KEY(projectId), nonEmpty ? '1' : '0')
  } catch {
    // Storage unavailable (private window): the frame starts compact.
  }
}

interface Props {
  projectId: string | null
  /** Bumped by the page after it queues PRs, so the panel reads at once. */
  refreshKey: number
  /** A row merged: the page reloads its fixes. */
  onMerged?: () => void
}

/** Queue lines shown before "Show N more". */
const QUEUE_ROWS_FIRST = 4

export function MergeQueuePanel({ projectId, refreshKey, onMerged }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<MergeQueueRow[]>([])
  const [showMerged, setShowMerged] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trains, setTrains] = useState<ReleaseTrain[]>([])
  const [release, setRelease] = useState<ReleaseSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    const res = await loadMergeQueue(projectId)
    setLoaded(true)
    if (!res.ok || !res.data) return
    rememberNonEmpty(projectId, res.data.rows.some((r) => r.state !== 'removed'))
    setTrains(res.data.trains ?? [])
    setRelease(res.data.release?.find((r) => r.projectId === projectId) ?? null)
    setRows((prev) => {
      const mergedBefore = new Set(prev.filter((r) => r.state === 'merged').map((r) => r.id))
      if (prev.length > 0 && res.data!.rows.some((r) => r.state === 'merged' && !mergedBefore.has(r.id))) onMerged?.()
      return res.data!.rows
    })
  }, [projectId, onMerged])

  useEffect(() => {
    setRows([])
    setTrains([])
    setRelease(null)
    setLoaded(false)
    void load()
  }, [load, refreshKey])

  const active = rows.filter(isActiveQueueRow)
  const movingTrain = trains.some((t) => t.state === 'building' || t.state === 'testing')
  useEffect(() => {
    if (active.length === 0 && !movingTrain) return
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [active.length, movingTrain, load])

  const saveRelease = async (patch: { mode?: ReleaseMode; intervalMinutes?: number; autoDecide?: boolean }) => {
    if (!projectId || !release) return
    const before = release
    setRelease({ ...release, ...patch })
    setSaving(true)
    const res = await saveReleaseSettings(projectId, patch)
    setSaving(false)
    if (!res.ok) {
      setRelease(before)
      toast.push({ tone: 'error', message: res.error?.message ?? 'Could not save how fixes are released.' })
    }
  }

  const remove = async (row: MergeQueueRow) => {
    setRemoving(row.id)
    const res = await removeFromMergeQueue(row.id)
    setRemoving(null)
    if (!res.ok) {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Could not take it out of the queue.' })
      return
    }
    void load()
  }

  const shown = rows.filter((r) => r.state !== 'removed')
  if (!projectId) return null
  if (!loaded) {
    // The panel's frame while the first read runs, at the size it had last time.
    return (
      <section aria-label="Merge queue" aria-busy="true">
        <Card className={`p-3 space-y-2 ${rememberedNonEmpty(projectId) ? 'h-72' : 'h-24'}`}>
          <h3 className="text-xs font-semibold text-fg-secondary">Merge queue</h3>
          <div aria-hidden="true" className="h-7 rounded-sm bg-surface-overlay/50 motion-safe:animate-pulse" />
        </Card>
      </section>
    )
  }
  const merged = shown.filter((r) => r.state === 'merged')
  // Held rows first (each says why), then the one each repo is working on.
  const listed = [...active].sort((a, b) => Number(b.state === 'blocked') - Number(a.state === 'blocked'))
  const groups = groupQueueRows(listed)
  // Held rows lead, so the first few are the ones that need a person; the rest
  // open on request. A 160px box that scrolled inside a long page trapped the
  // wheel and hid rows (2026-11-22 design pass).
  const shownGroups = showAllRows ? groups : groups.slice(0, QUEUE_ROWS_FIRST)
  const hiddenGroups = groups.length - shownGroups.length
  const batching = (release?.mode ?? 'train') === 'train'
  // One line per repo: its train on the way, or when the next one leaves.
  const repos = [...new Set([...active.map((r) => r.repo), ...trains.filter((t) => t.state === 'building' || t.state === 'testing').map((t) => t.repo)])]
  const now = new Date()
  const trainLines = batching
    ? repos
        .map((repo) => {
          const mine = trains.filter((t) => t.repo === repo)
          const moving = mine.find((t) => t.state === 'building' || t.state === 'testing') ?? null
          const last = mine.find((t) => t.state !== 'abandoned') ?? null
          const ready = active.filter((r) => r.repo === repo && r.state === 'queued').length
          const text = trainLine(moving, { lastAt: last?.created_at ?? null, intervalMinutes: release?.intervalMinutes ?? 360, now, ready })
          return { repo, moving, text }
        })
        .filter((l) => l.text)
    : []

  const held = active.filter((r) => r.state === 'blocked')
  // "2 key used up · 1 merge conflict": the held rows' reasons, biggest first.
  const heldReasons = [...held.reduce((m, r) => {
    const why = heldReasonOf(r.detail) ?? 'see the row'
    return m.set(why, (m.get(why) ?? 0) + 1)
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const onTrain = trains.filter((t) => t.state === 'building' || t.state === 'testing').reduce((n, t) => n + t.members.length, 0)
  const count = (state: MergeQueueRow['state']) => active.filter((r) => r.state === state).length
  const stages: TrainStage[] = [
    { id: 'queued', label: MERGE_QUEUE_STATE_LABEL.queued, count: count('queued') },
    { id: 'waiting', label: MERGE_QUEUE_STATE_LABEL.waiting, count: count('waiting'), note: count('waiting') ? 'branch update or CI' : undefined },
    { id: 'resolving', label: MERGE_QUEUE_STATE_LABEL.resolving, count: count('resolving'), note: count('resolving') ? 'merge conflict' : undefined },
    {
      id: 'held',
      label: MERGE_QUEUE_STATE_LABEL.blocked,
      count: held.length,
      tone: held.length ? 'warn' : undefined,
      note: heldReasons.length ? heldReasons.map(([why, n]) => `${n} ${why}`).join(' · ') : undefined,
      to: held.length ? '#merge-queue-rows' : undefined,
    },
    { id: 'train', label: 'Train running', count: onTrain },
    { id: 'merged', label: 'Merged today', count: merged.length, tone: merged.length ? 'ok' : undefined },
  ]

  return (
    <section aria-label="Merge queue">
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary">Merge queue</h3>
        <p className="text-2xs text-fg-muted">{mergeQueueSummary(shown)}</p>
      </div>
      {release && (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Release"
            ariaLabel="How approved fixes are released"
            size="sm"
            value={release.mode}
            options={MODE_OPTIONS}
            onChange={(mode) => void saveRelease({ mode })}
          />
          {batching && (
            <label className="inline-flex items-center gap-1 text-2xs text-fg-muted">
              <span className="sr-only">How often a release train leaves</span>
              <select
                className={FILTER_SELECT_CLASS}
                value={release.intervalMinutes}
                disabled={saving}
                onChange={(e) => void saveRelease({ intervalMinutes: Number(e.target.value) })}
              >
                {[...new Set([...TRAIN_INTERVAL_OPTIONS, release.intervalMinutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>{intervalLabel(m)}</option>
                ))}
              </select>
            </label>
          )}
          <Toggle
            label="Decide for me"
            ariaLabel="Let Mushi Mushi merge approved fixes and close held ones"
            checked={release.autoDecide === true}
            disabled={saving}
            onChange={(autoDecide) => void saveRelease({ autoDecide })}
          />
        </div>
      )}
      {release?.autoDecide && (
        // Decide for me as a picture: Opus's verdict splits each fix two ways (ADR 0055).
        <p
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-secondary"
          data-testid="auto-decide-note"
        >
          <span className="text-2xs font-semibold text-fg">The AI review decides:</span>
          <span className="inline-flex items-center gap-1">
            <StatusGlyph tone="ok" />
            <span className="font-semibold text-fg">merge</span> → queue
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusGlyph tone="danger" />
            <span className="font-semibold text-fg">hold</span> → close, fix again, up to 3 tries per bug
          </span>
          <span className="text-fg-muted">closed PRs can be reopened</span>
        </p>
      )}
      {(active.length > 0 || onTrain > 0 || merged.length > 0) && (
        <div className="space-y-1" data-testid="merge-queue-train">
          <StageTrain label="Merge queue" stages={stages} />
          <p className="text-3xs text-fg-secondary">
            {batching
              ? `Batch: one release train ${intervalLabel(release?.intervalMinutes ?? 360)}, one CI run, one merge · security fixes and critical bugs skip the wait`
              : 'Each PR: branch updated, CI and an AI review “merge” on the final commit, then merged, one per repo at a time'}{' '}
            · you can leave this page
          </p>
        </div>
      )}
      {trainLines.length > 0 && (
        <ul className="space-y-0.5">
          {trainLines.map((l) => (
            <li key={l.repo} className="flex flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted">
              <StatusPill status={l.moving ? 'running' : 'waiting'} label={l.moving ? 'Train' : 'Next train'} />
              {l.moving?.pr_number ? (
                <a href={prLink({ repo: l.repo, pr_number: l.moving.pr_number })} target="_blank" rel="noreferrer" className="min-w-0 max-w-full wrap-anywhere font-mono text-fg-secondary hover:text-fg hover:underline">
                  {l.repo}#{l.moving.pr_number}
                </a>
              ) : (
                <span className="min-w-0 max-w-full wrap-anywhere font-mono text-fg-secondary">{l.repo}</span>
              )}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length === 0 && <p className="text-2xs text-fg-muted">Nothing in the merge queue.</p>}
      {listed.length > 0 && (
        <>
        <ul className="divide-y divide-edge-subtle" id="merge-queue-rows" data-testid="merge-queue-rows">
          {shownGroups.map((group) => {
            const r = group[0]
            const why = r.state === 'blocked' ? heldReasonOf(r.detail) : null
            const many = group.length > 1
            return (
            <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5" data-testid={`merge-queue-row-${r.id}`} data-count={group.length}>
              <StatusPill status={QUEUE_ROW_STATUS[r.state]} label={many ? `${MERGE_QUEUE_STATE_LABEL[r.state]} ${group.length}` : MERGE_QUEUE_STATE_LABEL[r.state]} className="shrink-0" />
              {why && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-warn/55 bg-warn-muted px-1 text-3xs font-bold text-warn-foreground"
                  title={r.detail ?? undefined}
                  data-testid={`merge-queue-row-${r.id}-why`}
                >
                  <StatusGlyph tone="warn" className="h-2.5 w-2.5" />
                  {why}
                </span>
              )}
              {/* A long owner/repo#N is unbreakable monospace: let it break on a
                  phone, and give the reason a content basis (flex-auto, not
                  flex-1's 0%) so it wraps onto its own line instead of
                  collapsing beside the ref (390px, report c07fb341).
                  Same state, repo and sentence: one line, every PR on it (fresh-eyes 2026-11-18). */}
              <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {group.map((g, i) => (
                  <span key={g.id} className="inline-flex items-center gap-0.5">
                    <a href={prLink(g)} target="_blank" rel="noreferrer" className="min-w-0 max-w-full wrap-anywhere text-2xs font-mono text-fg-secondary hover:text-fg hover:underline">
                      {i === 0 ? `${g.repo}#${g.pr_number}` : `#${g.pr_number}`}
                    </a>
                    {many && (
                      <Btn variant="ghost" size="sm" className="!px-1 !text-3xs pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={`Remove #${g.pr_number} from the queue`} title="Remove from the queue" loading={removing === g.id} onClick={() => void remove(g)}>
                        ✕
                      </Btn>
                    )}
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-auto wrap-break-word text-2xs text-fg-muted" title={r.detail ?? undefined}>
                {r.detail ? withoutReasonCode(r.detail) : 'Queued.'} <span className="text-fg-faint">· <RelativeTime value={r.updated_at} /></span>
              </span>
              {!many && (
                <Btn variant="ghost" size="sm" className="shrink-0 pointer-coarse:min-h-11" aria-label={`Remove #${r.pr_number} from the queue`} loading={removing === r.id} onClick={() => void remove(r)}>
                  Remove
                </Btn>
              )}
            </li>
            )
          })}
        </ul>
        {(hiddenGroups > 0 || showAllRows) && groups.length > QUEUE_ROWS_FIRST && (
          <Btn
            variant="ghost"
            size="sm"
            aria-controls="merge-queue-rows"
            aria-expanded={showAllRows}
            onClick={() => setShowAllRows((v) => !v)}
            data-testid="merge-queue-show-all"
          >
            {showAllRows ? 'Show fewer' : `Show ${hiddenGroups} more`}
          </Btn>
        )}
        </>
      )}
      {merged.length > 0 && (
        <div>
          <button type="button" className="text-2xs text-fg-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setShowMerged((v) => !v)}>
            {showMerged ? 'Hide' : 'Show'} {merged.length} merged today
          </button>
          {showMerged && (
            <ul className="mt-1 space-y-0.5">
              {merged.map((r) => (
                <li key={r.id} className="text-2xs text-fg-muted">
                  <a href={prLink(r)} target="_blank" rel="noreferrer" className="wrap-anywhere font-mono hover:text-fg hover:underline">
                    {r.repo}#{r.pr_number}
                  </a>{' '}
                  merged {r.merged_at ? <RelativeTime value={r.merged_at} /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
    </section>
  )
}
