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
 */

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, FILTER_SELECT_CLASS, RelativeTime, SegmentedControl } from '../ui'
import { useToast } from '../../lib/toast'
import {
  MERGE_QUEUE_STATE_LABEL,
  MERGE_QUEUE_STATE_TONE,
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

export function MergeQueuePanel({ projectId, refreshKey, onMerged }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<MergeQueueRow[]>([])
  const [showMerged, setShowMerged] = useState(false)
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

  const saveRelease = async (patch: { mode?: ReleaseMode; intervalMinutes?: number }) => {
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
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Merge when ready</h3>
          <div aria-hidden="true" className="h-7 rounded-sm bg-surface-overlay/50 motion-safe:animate-pulse" />
        </Card>
      </section>
    )
  }
  const merged = shown.filter((r) => r.state === 'merged')
  // Held rows first (each says why), then the one each repo is working on.
  const listed = [...active].sort((a, b) => Number(b.state === 'blocked') - Number(a.state === 'blocked'))
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

  return (
    <section aria-label="Merge queue">
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Merge when ready</h3>
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
        </div>
      )}
      {active.length > 0 && (
        <p className="text-2xs text-fg-muted">
          {batching
            ? `Approved pull requests ride one release train ${intervalLabel(release?.intervalMinutes ?? 360)}: one branch, one CI run, one merge, so they ship as one release. Security fixes and critical bugs skip the wait.`
            : 'Mushi updates each branch, waits for CI and an Opus “merge” on the final commit, then merges, one pull request per repo at a time.'}{' '}
          You can leave this page.
        </p>
      )}
      {trainLines.length > 0 && (
        <ul className="space-y-0.5">
          {trainLines.map((l) => (
            <li key={l.repo} className="flex flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted">
              <Badge tone={l.moving ? 'accent' : 'neutral'}>{l.moving ? 'Train' : 'Next train'}</Badge>
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
      {shown.length === 0 && <p className="text-2xs text-fg-muted">Nothing waiting to merge.</p>}
      {listed.length > 0 && (
        // A long queue scrolls inside the panel instead of pushing the list down.
        <ul className="max-h-40 overflow-y-auto divide-y divide-edge-subtle">
          {listed.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5">
              <Badge tone={MERGE_QUEUE_STATE_TONE[r.state]} className="shrink-0">{MERGE_QUEUE_STATE_LABEL[r.state]}</Badge>
              {/* A long owner/repo#N is unbreakable monospace: let it break on a
                  phone, and give the reason a content basis (flex-auto, not
                  flex-1's 0%) so it wraps onto its own line instead of
                  collapsing beside the ref (390px, report c07fb341). */}
              <a href={prLink(r)} target="_blank" rel="noreferrer" className="min-w-0 max-w-full wrap-anywhere text-2xs font-mono text-fg-secondary hover:text-fg hover:underline">
                {r.repo}#{r.pr_number}
              </a>
              <span className="min-w-0 flex-auto wrap-break-word text-2xs text-fg-muted" title={r.detail ?? undefined}>
                {r.detail ?? 'Queued.'} <span className="text-fg-faint">· <RelativeTime value={r.updated_at} /></span>
              </span>
              <Btn variant="ghost" size="sm" className="shrink-0" loading={removing === r.id} onClick={() => void remove(r)}>
                Remove
              </Btn>
            </li>
          ))}
        </ul>
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
