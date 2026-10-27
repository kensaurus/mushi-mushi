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
 * A Mushi fix PR shows its Opus review (ADR 0030); a hold disables Merge here and
 * points to the fix, whose merge dialog shows the findings and the override.
 *
 * The list is grouped by what the person can do (console journeys 2026-10-27):
 * Mergeable now, Needs a fix, Hold, then Waiting (CI or a review still running,
 * drafts). Merge used to sit on every row, including Opus "hold" PRs.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, Card, SelectField } from '../ui'
import { IconExternalLink } from '../icons'
import { formatRelative } from '../ui/metrics'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { uxRequiredChecks, type UxPullRequest } from '../../lib/uxRuns'
import { fixDeepLinkPath } from '../../lib/fixDeepLink'
import { reviewTone, type FixReviewState } from '../../lib/fixReview'
import { META_CHIP_TONE } from '../../lib/chipTone'

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
  /** The Opus review when this PR is a Mushi fix (ADR 0030). */
  review?: {
    state: FixReviewState
    label: string
    fixId: string | null
    verdict?: 'merge' | 'fix_first' | 'hold' | null
    /** ANY review linked to the PR is still running, not only the one shown. */
    pending?: boolean
  }
}

const POLL_MS = 30_000

/**
 * Why Merge is off for this PR, in words for the person; null when it can merge.
 * @internal Exported for tests only.
 */
export function openPrMergeBlocker(pr: Pick<OpenPullRequest, 'checks' | 'review'>): string | null {
  if (pr.review?.verdict === 'hold') return 'The Opus review says hold: open the fix to read the findings.'
  const checks = uxRequiredChecks(pr.checks)
  const failing = checks.filter((c) => c.result === 'fail').map((c) => c.name)
  if (failing.length) return `Required check failing: ${failing.join(', ')}.`
  const pending = checks.filter((c) => c.result === 'pending').map((c) => c.name)
  if (pending.length) return `Waiting for ${pending.join(', ')}.`
  return null
}

export type OpenPrGroup = 'mergeable' | 'needs_fix' | 'hold' | 'waiting'

/**
 * What a person can do with this PR now. A Mushi fix PR is mergeable on an
 * Opus "merge" about its latest commit (countDefinitions "Ready to merge");
 * a PR Opus did not review merges on its checks alone, as before (ADR 0030).
 * @internal Exported for tests only.
 */
export function openPrGroup(pr: Pick<OpenPullRequest, 'checks' | 'review' | 'draft'>): OpenPrGroup {
  const state = pr.review?.state
  if (state === 'hold' || (pr.review?.verdict === 'hold' && state !== 'merge')) return 'hold'
  const checks = uxRequiredChecks(pr.checks)
  if (checks.some((c) => c.result === 'fail') || state === 'fix_first') return 'needs_fix'
  if (pr.draft || checks.some((c) => c.result === 'pending') || state === 'queued' || state === 'stale' || pr.review?.pending) return 'waiting'
  return 'mergeable'
}

const GROUPS: Array<{ id: OpenPrGroup; title: string; hint: string }> = [
  { id: 'mergeable', title: 'Mergeable now', hint: 'Required checks passed; a Mushi fix also has an Opus "merge" on its latest commit.' },
  { id: 'needs_fix', title: 'Needs a fix', hint: 'A required check fails, or Opus said fix first. Open the fix to send it back.' },
  { id: 'hold', title: 'Hold', hint: 'Opus said hold: a person decides. The fix page shows the findings.' },
  { id: 'waiting', title: 'Waiting', hint: 'CI or a review is still running, or the PR is a draft.' },
]

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
      {prs.length > 0 &&
        GROUPS.map((g) => {
          const mine = prs.filter((pr) => openPrGroup(pr) === g.id)
          if (mine.length === 0) return null
          return (
            <section key={g.id} aria-label={g.title} data-testid={`open-prs-${g.id}`}>
              <h3 className="text-xs font-semibold text-fg">
                {g.title} <span className="font-normal tabular-nums text-fg-muted">{mine.length}</span>
              </h3>
              <p className="text-2xs text-fg-muted">{g.hint}</p>
              <ul className="flex flex-col divide-y divide-edge-subtle">
                {mine.map((pr) => (
                  <OpenPullRequestRow key={`${pr.repo}#${pr.number}`} projectId={projectId} pr={pr} showRepo={multiRepo} onMerged={reload} primary={g.id === 'mergeable'} />
                ))}
              </ul>
            </section>
          )
        })}
    </Card>
  )
}

function OpenPullRequestRow({
  projectId,
  pr,
  showRepo,
  onMerged,
  primary,
}: {
  projectId: string
  pr: OpenPullRequest
  showRepo: boolean
  onMerged: () => void
  /** Mergeable now: Merge is the row's main button; elsewhere it is secondary. */
  primary: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merged, setMerged] = useState(false)
  const inFlight = useRef(false)
  const checks = uxRequiredChecks(pr.checks)
  const blocker = openPrMergeBlocker(pr)
  const passed = checks.filter((c) => c.result === 'pass').length
  // Any linked review still running (the server says which); older servers only send the shown state.
  const reviewPending = pr.review?.pending === true || pr.review?.state === 'queued'

  async function merge() {
    if (inFlight.current) return
    inFlight.current = true
    setMerging(true)
    setError(null)
    const [owner, repo] = pr.repo.split('/')
    const res = await apiFetchMutate<{ merged: boolean; alreadyMerged: boolean; message?: string }>(
      `/v1/admin/projects/${projectId}/pull-requests/${owner}/${repo}/${pr.number}/merge`,
      {
        method: 'POST',
        // The fix's first review is still running: confirming here is the person's choice (ADR 0030).
        body: JSON.stringify(reviewPending ? { method, confirmPendingReview: true } : { method }),
      },
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
          <span className="min-w-0 wrap-break-word sm:truncate">
            #{pr.number} {pr.title}
          </span>
          <IconExternalLink className="h-3 w-3 shrink-0" />
        </a>
        <span className="flex flex-wrap items-center gap-1.5">
          {pr.draft && <Badge tone="neutral">Draft</Badge>}
          {pr.review && (
            <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium ${META_CHIP_TONE[reviewTone({ state: pr.review.state, verdict: pr.review.verdict ?? null })]}`}>
              {pr.review.fixId ? <Link to={fixDeepLinkPath(pr.review.fixId)} className="hover:underline">{pr.review.label}</Link> : pr.review.label}
            </span>
          )}
          {merged ? (
            <Badge tone="okSubtle">Merged</Badge>
          ) : (
            <Btn size="sm" variant={primary ? 'success' : 'ghost'} disabled={blocker != null || merging} aria-expanded={confirming} onClick={() => { setConfirming(true); setError(null) }}>
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
              Merge #{pr.number} into {pr.baseRef}? {pr.draft ? 'It is a draft, so it is marked ready first. ' : ''}
              {reviewPending ? 'Its Opus review is still running; merging now skips it. ' : ''}Your repository’s CI runs on {pr.baseRef} after the merge; for a mobile app this can start a store release.
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
