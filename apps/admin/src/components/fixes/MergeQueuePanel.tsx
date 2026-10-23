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
 */

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, RelativeTime } from '../ui'
import { useToast } from '../../lib/toast'
import {
  MERGE_QUEUE_STATE_LABEL,
  MERGE_QUEUE_STATE_TONE,
  isActiveQueueRow,
  loadMergeQueue,
  mergeQueueSummary,
  prLink,
  removeFromMergeQueue,
  type MergeQueueRow,
} from '../../lib/mergeQueue'

const POLL_MS = 30_000

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

  const load = useCallback(async () => {
    if (!projectId) return
    const res = await loadMergeQueue(projectId)
    if (!res.ok || !res.data) return
    setRows((prev) => {
      const mergedBefore = new Set(prev.filter((r) => r.state === 'merged').map((r) => r.id))
      if (prev.length > 0 && res.data!.rows.some((r) => r.state === 'merged' && !mergedBefore.has(r.id))) onMerged?.()
      return res.data!.rows
    })
  }, [projectId, onMerged])

  useEffect(() => {
    setRows([])
    void load()
  }, [load, refreshKey])

  const active = rows.filter(isActiveQueueRow)
  useEffect(() => {
    if (active.length === 0) return
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [active.length, load])

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
  if (shown.length === 0) return null
  const merged = shown.filter((r) => r.state === 'merged')
  // Rows that need you first, then the one each repo is working on.
  const listed = [...active].sort((a, b) => Number(b.state === 'blocked') - Number(a.state === 'blocked'))

  return (
    <section aria-label="Merge queue">
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Merge when ready</h3>
        <p className="text-2xs text-fg-muted">{mergeQueueSummary(shown)}</p>
      </div>
      {active.length > 0 && (
        <p className="text-2xs text-fg-muted">
          Mushi updates each branch, waits for CI and an Opus “merge” on the final commit, then merges, one pull request per repo at a time.
          You can leave this page.
        </p>
      )}
      {listed.length > 0 && (
        <ul className="divide-y divide-edge-subtle">
          {listed.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5">
              <Badge tone={MERGE_QUEUE_STATE_TONE[r.state]}>{MERGE_QUEUE_STATE_LABEL[r.state]}</Badge>
              <a href={prLink(r)} target="_blank" rel="noreferrer" className="text-2xs font-mono text-fg-secondary hover:text-fg hover:underline">
                {r.repo}#{r.pr_number}
              </a>
              <span className="min-w-0 flex-1 text-2xs text-fg-muted" title={r.detail ?? undefined}>
                {r.detail ?? 'Queued.'} <span className="text-fg-faint">· <RelativeTime value={r.updated_at} /></span>
              </span>
              <Btn variant="ghost" size="sm" loading={removing === r.id} onClick={() => void remove(r)}>
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
                  <a href={prLink(r)} target="_blank" rel="noreferrer" className="font-mono hover:text-fg hover:underline">
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
