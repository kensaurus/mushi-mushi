/**
 * FILE: apps/admin/src/components/repo/OpenPullRequests.tsx
 * PURPOSE: Every open pull request in the project's connected repos, with its
 *          required checks and a Merge button behind an in-page confirmation,
 *          so a release ships from the console (owner, 2026-10-08). Fixes and
 *          UX runs keep their own PR cards; this lists the rest too.
 *
 * Data: GET  /v1/admin/projects/:pid/pull-requests
 *       POST /v1/admin/projects/:pid/pull-requests/:owner/:repo/:number/merge { method }
 * Nothing merges on its own (ADR 0017): a person reads the confirmation and clicks Confirm.
 */

import { useEffect, useRef, useState } from 'react'
import { Badge, Btn, Callout, Card, SelectField } from '../ui'
import { IconExternalLink } from '../icons'
import { formatRelative } from '../ui/metrics'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { uxRequiredChecks, type UxPullRequest } from '../../lib/uxRuns'

type MergeMethod = 'squash' | 'merge' | 'rebase'

export interface OpenPullRequest {
  repo: string
  number: number
  title: string
  url: string
  draft: boolean
  author: string | null
  headRef: string
  baseRef: string
  updatedAt: string
  checks: UxPullRequest['checks']
}

const POLL_MS = 30_000

/**
 * Why Merge is off for this PR, in words for the person; null when it can merge.
 * @internal Exported for tests only.
 */
export function openPrMergeBlocker(pr: Pick<OpenPullRequest, 'checks'>): string | null {
  const checks = uxRequiredChecks(pr.checks)
  const failing = checks.filter((c) => c.result === 'fail').map((c) => c.name)
  if (failing.length) return `Required check failing: ${failing.join(', ')}.`
  const pending = checks.filter((c) => c.result === 'pending').map((c) => c.name)
  if (pending.length) return `Waiting for ${pending.join(', ')}.`
  return null
}

export function OpenPullRequests({ projectId }: { projectId: string }) {
  const list = usePageData<{ pullRequests: OpenPullRequest[]; repos: string[] }>(`/v1/admin/projects/${projectId}/pull-requests`)
  const prs = list.data?.pullRequests ?? []
  const multiRepo = (list.data?.repos.length ?? 0) > 1
  const anyPending = prs.some((p) => uxRequiredChecks(p.checks).some((c) => c.result === 'pending'))
  const { reload } = list

  useEffect(() => {
    if (!anyPending) return
    const id = window.setInterval(reload, POLL_MS)
    return () => window.clearInterval(id)
  }, [anyPending, reload])

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">Open pull requests</h2>
        <p className="text-xs text-fg-secondary">
          Every open PR in this app’s repositories. Merge one here once its required checks pass; your repository’s release workflow runs on the merge.
        </p>
      </div>
      {list.error && (
        <Callout tone={list.errorCode === 'GITHUB_NOT_CONNECTED' ? 'info' : 'danger'}>{list.errorMessage ?? list.error}</Callout>
      )}
      {list.loading && !list.data && <p className="text-xs text-fg-muted">Reading pull requests from GitHub…</p>}
      {list.data && prs.length === 0 && <p className="text-xs text-fg-muted">No open pull requests.</p>}
      {prs.length > 0 && (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {prs.map((pr) => (
            <OpenPullRequestRow key={`${pr.repo}#${pr.number}`} projectId={projectId} pr={pr} showRepo={multiRepo} onMerged={reload} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function OpenPullRequestRow({ projectId, pr, showRepo, onMerged }: { projectId: string; pr: OpenPullRequest; showRepo: boolean; onMerged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merged, setMerged] = useState(false)
  const inFlight = useRef(false)
  const checks = uxRequiredChecks(pr.checks)
  const blocker = openPrMergeBlocker(pr)
  const passed = checks.filter((c) => c.result === 'pass').length

  async function merge() {
    if (inFlight.current) return
    inFlight.current = true
    setMerging(true)
    setError(null)
    const [owner, repo] = pr.repo.split('/')
    const res = await apiFetchMutate<{ merged: boolean; alreadyMerged: boolean; message?: string }>(
      `/v1/admin/projects/${projectId}/pull-requests/${owner}/${repo}/${pr.number}/merge`,
      { method: 'POST', body: JSON.stringify({ method }) },
    )
    inFlight.current = false
    setMerging(false)
    if (res.ok && (res.data?.merged || res.data?.alreadyMerged)) {
      setMerged(true)
      setConfirming(false)
      onMerged()
      return
    }
    setError((res.ok ? res.data?.message : res.error?.message) ?? 'GitHub did not merge the PR.')
  }

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-fg hover:underline">
          <span className="truncate">
            #{pr.number} {pr.title}
          </span>
          <IconExternalLink className="h-3 w-3 shrink-0" />
        </a>
        <span className="flex items-center gap-1.5">
          {pr.draft && <Badge tone="neutral">Draft</Badge>}
          {merged ? (
            <Badge tone="okSubtle">Merged</Badge>
          ) : (
            <Btn size="sm" variant="success" disabled={blocker != null || merging} aria-expanded={confirming} onClick={() => { setConfirming(true); setError(null) }}>
              Merge
            </Btn>
          )}
        </span>
      </div>
      <p className="text-2xs text-fg-muted">
        {showRepo ? `${pr.repo} · ` : ''}
        {pr.headRef} → {pr.baseRef}
        {pr.author ? ` · ${pr.author}` : ''} · updated {formatRelative(pr.updatedAt)}
        {' · '}
        {merged ? 'merged' : blocker ?? (checks.length ? `all ${passed} required checks passed` : `${pr.baseRef} requires no checks`)}
      </p>
      {confirming && !merged && blocker == null && (
        <Callout tone="warn">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-fg">
              Merge #{pr.number} into {pr.baseRef}? {pr.draft ? 'It is a draft, so it is marked ready first. ' : ''}Your repository’s CI runs on {pr.baseRef} after the merge; for a mobile app this can start a store release.
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
      {error && <Callout tone="danger">{error}</Callout>}
    </li>
  )
}
