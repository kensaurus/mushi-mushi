/**
 * FILE: apps/admin/src/components/ux-runs/UxRunPullRequest.tsx
 * PURPOSE: The draft PR the studio opened from a UX run's branch: its state,
 *          required checks and whether it can merge, plus a "Merge to <base>"
 *          button behind an in-page confirmation. Nothing merges on its own
 *          (ADR 0017): a person reads the confirmation and clicks Confirm.
 *
 * Data: GET  /v1/admin/projects/:pid/ux-runs/:localRunId/pull-request
 *       POST /v1/admin/projects/:pid/ux-runs/:localRunId/merge { method }
 * Polls the PR every 30 s while a check is still running.
 */

import { useEffect, useRef, useState } from 'react'
import { Badge, Btn, Callout, Card, SelectField } from '../ui'
import { IconExternalLink } from '../icons'
import type { CHIP_TONE } from '../../lib/chipTone'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { uxMergeBlocker, uxRequiredChecks, type UxCheckResult, type UxPullRequest, type UxRunListItem } from '../../lib/uxRuns'

type MergeMethod = 'squash' | 'merge' | 'rebase'
type PrState = UxPullRequest['state']

const POLL_MS = 30_000

const STATE_META: Record<PrState, { label: string; tone: keyof typeof CHIP_TONE }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'infoSubtle' },
  merged: { label: 'Merged', tone: 'okSubtle' },
  closed: { label: 'Closed', tone: 'dangerSubtle' },
}

const CHECK_META: Record<UxCheckResult, { mark: string; label: string; className: string }> = {
  pass: { mark: '✓', label: 'passed', className: 'text-ok-foreground' },
  fail: { mark: '✗', label: 'failing', className: 'text-danger-foreground' },
  pending: { mark: '○', label: 'running', className: 'text-fg-muted' },
}

const METHOD_PHRASE: Record<MergeMethod, string> = {
  squash: 'a squash merge',
  merge: 'a merge commit',
  rebase: 'a rebase',
}

interface Props {
  projectId: string
  runId: string
  run: Pick<UxRunListItem, 'pr_url' | 'pr_number' | 'pr_state'>
  /** Called after GitHub merged the PR, so the page can refresh the run. */
  onMerged: () => void
}

export function UxRunPullRequest({ projectId, runId, run, onMerged }: Props) {
  const base = `/v1/admin/projects/${projectId}/ux-runs/${runId}`
  const mergedOnRow = run.pr_state === 'merged'
  // Fetched once even when merged, for the title and base branch; polling stays off then.
  const pr = usePageData<UxPullRequest>(`${base}/pull-request`)
  const [confirming, setConfirming] = useState(false)
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [merging, setMerging] = useState(false)
  const [mergedHere, setMergedHere] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const data = pr.data
  const state: PrState | null = mergedOnRow || mergedHere ? 'merged' : (data?.state ?? null)
  const checks = data ? uxRequiredChecks(data.checks) : []
  const polling = !mergedHere && (state === 'draft' || state === 'open') && checks.some((c) => c.result === 'pending')
  const { reload } = pr

  useEffect(() => {
    if (!polling) return
    const id = window.setInterval(reload, POLL_MS)
    return () => window.clearInterval(id)
  }, [polling, reload])

  const number = data?.number ?? run.pr_number
  const url = data?.url ?? run.pr_url ?? undefined
  const baseRef = data?.baseRef ?? 'the default branch'
  const blocker = state === 'merged' ? null : data ? uxMergeBlocker(data) : (pr.errorMessage ?? pr.error ?? 'Checking the PR on GitHub…')

  async function merge() {
    if (inFlight.current) return
    inFlight.current = true
    setMerging(true)
    setMergeError(null)
    const res = await apiFetchMutate<{ merged: boolean; alreadyMerged: boolean; sha?: string; message?: string }>(`${base}/merge`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    })
    inFlight.current = false
    setMerging(false)
    if (res.ok && (res.data?.merged || res.data?.alreadyMerged)) {
      setMergedHere(true)
      setConfirming(false)
      onMerged()
      return
    }
    setMergeError((res.ok ? res.data?.message : res.error?.message) ?? 'GitHub did not merge the PR.')
    // A rejection usually means a check or mergeability changed; show the current state.
    reload()
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-fg hover:underline">
          <span className="truncate">
            PR #{number ?? '?'}
            {data?.title ? ` ${data.title}` : ''}
          </span>
          <IconExternalLink className="h-3 w-3 shrink-0" />
        </a>
        {state && <Badge tone={STATE_META[state].tone}>{STATE_META[state].label}</Badge>}
      </div>

      {state !== 'merged' && data && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-fg">Required checks</h3>
          {checks.length === 0 ? (
            <p className="text-2xs text-fg-muted">{baseRef} has no required checks.</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-xs">
              {checks.map((c) => (
                <li key={c.name} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={CHECK_META[c.result].className}>{CHECK_META[c.result].mark}</span>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-fg hover:underline">{c.name}</a>
                  ) : (
                    <span className="text-fg">{c.name}</span>
                  )}
                  <span className="text-2xs text-fg-muted">{CHECK_META[c.result].label}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-2xs text-fg-muted">
            {data.mergeable === true ? 'GitHub can merge it.' : data.mergeable === false ? 'GitHub cannot merge it yet.' : 'GitHub is still working out whether it can merge.'}
            {polling ? ' Checking again every 30 seconds.' : ''}
          </p>
        </div>
      )}

      {state === 'merged' ? (
        <Callout tone="ok">Merged{data?.baseRef ? ` into ${data.baseRef}` : ''}. Your repository’s CI runs on it now.</Callout>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" variant="success" disabled={blocker != null || merging} aria-expanded={confirming} onClick={() => { setConfirming(true); setMergeError(null) }}>
            Merge to {baseRef}
          </Btn>
          {blocker && <span className="text-2xs text-fg-secondary">{blocker}</span>}
          {/* GitHub hiccups clear on their own; a missing PR or connection does not. */}
          {!data && pr.error && pr.errorCode !== 'NO_PR' && pr.errorCode !== 'GITHUB_NOT_CONNECTED' && (
            <Btn size="sm" variant="ghost" onClick={reload}>Try again</Btn>
          )}
        </div>
      )}

      {confirming && state !== 'merged' && blocker == null && (
        <Callout tone="warn">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-fg">
              Merge PR #{number} into {baseRef} with {METHOD_PHRASE[method]}? Your repository’s CI runs on {baseRef} after the merge; for a mobile app this can start a store release.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label="Merge method" value={method} disabled={merging} onChange={(e) => setMethod(e.target.value as MergeMethod)}>
                <option value="squash">Squash</option>
                <option value="merge">Merge commit</option>
                <option value="rebase">Rebase</option>
              </SelectField>
              <Btn size="sm" variant="success" loading={merging} disabled={merging} onClick={() => void merge()}>
                {merging ? 'Merging…' : 'Confirm merge'}
              </Btn>
              <Btn size="sm" variant="ghost" disabled={merging} onClick={() => setConfirming(false)}>
                Cancel
              </Btn>
            </div>
          </div>
        </Callout>
      )}

      {mergeError && <Callout tone="danger">{mergeError}</Callout>}
    </Card>
  )
}
