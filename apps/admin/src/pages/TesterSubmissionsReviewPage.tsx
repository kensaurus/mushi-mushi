/**
 * FILE: apps/admin/src/pages/TesterSubmissionsReviewPage.tsx
 * PURPOSE: Org-scoped reviewer queue for Mushi Bounties tester submissions.
 *
 * OVERVIEW:
 * - Lists pending (or filtered) submissions for the active project
 * - Wires TesterSubmissionCard accept / informative / duplicate / spam actions
 *
 * DEPENDENCIES:
 * - apiFetch, useActiveProjectId, TesterSubmissionCard
 *
 * USAGE:
 * - Route: /rewards/tester-review (protected admin layout)
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { usePublishPageContext } from '../lib/pageContext'
import { plainApiError } from '../lib/humanizeApiError'
import { EmptyState, ErrorAlert, Badge, Btn, SegmentedControl } from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { TesterSubmissionCard } from '../components/report-detail/TesterSubmissionCard'

interface QueueItem {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'accepted' | 'informative' | 'duplicate' | 'spam'
  severity: string | null
  points_awarded: number
  tester_handle: string | null
  app_name: string | null
  reviewer_note: string | null
  submitted_at: string
}

type StatusFilter = 'pending' | 'all' | 'accepted'

/** Server page size for GET /v1/admin/tester-submissions. */
export const REVIEW_PAGE_SIZE = 20

/** Pages needed for `total` rows (at least 1). */
export function reviewPageCount(total: number, pageSize = REVIEW_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

export function TesterSubmissionsReviewPage() {
  const projectId = useActiveProjectId()
  const [status, setStatus] = useState<StatusFilter>('pending')
  // The queue used to fetch page 1 only: with more than 20 submissions the
  // badge said "35" while 20 rendered and the rest were unreachable.
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ items: QueueItem[]; total: number }>(
        `/v1/admin/tester-submissions?projectId=${encodeURIComponent(projectId)}&status=${status}&page=${page}`,
      )
      if (!res.ok) {
        setError(plainApiError(res.error, 'Could not load submissions.'))
        setItems([])
        setTotal(0)
        return
      }
      setItems(res.data?.items ?? [])
      setTotal(res.data?.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [projectId, status, page])

  useEffect(() => {
    void load()
  }, [load])

  // A grade moves the row out of the Pending filter; step back if that
  // emptied the last page.
  const pageCount = reviewPageCount(total)
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  // TesterSubmissionCard shows its own success toast; a second one here
  // stacked two toasts per grade.
  const handleReviewed = () => {
    void load()
  }

  usePublishPageContext({
    route: '/rewards/tester-review',
    title: 'Tester submissions',
    summary: `${total} ${status === 'all' ? '' : `${status} `}submission${total === 1 ? '' : 's'}`,
    filters: { status, page: String(page) },
  })

  if (!projectId) {
    return (
      <EmptyState
        title="Select a project"
        description="Choose a project from the top bar to review tester submissions."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeaderBar
        title="Tester submissions"

        helpTitle="About tester submissions"
        helpWhatIsIt="Org-scoped reviewer queue for bug reports submitted via Mushi Bounties — accept, mark informative, duplicate, or spam, and award points."
        helpUseCases={[
          'Review pending tester bug reports before points are awarded',
          'Filter by pending, accepted, or all submissions',
          'Link back to Rewards marketplace publishing settings',
        ]}
        helpHowToUse="Filter the queue, expand a submission, and use accept or reject actions. Points are awarded on accept per your Rewards tier rules."
      >
        <Link
          to="/rewards?tab=publishing"
          className="text-xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity shrink-0"
        >
          ← Marketplace settings
        </Link>
      </PageHeaderBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          options={[
            { id: 'pending', label: 'Pending' },
            { id: 'accepted', label: 'Accepted' },
            { id: 'all', label: 'All' },
          ]}
        />
        <Badge className="bg-surface-overlay text-fg-muted">
          {total} submission{total === 1 ? '' : 's'}
        </Badge>
      </div>

      {loading && <TableSkeleton rows={4} />}
      {!loading && error && <ErrorAlert message={error} onRetry={load} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={status === 'pending' ? 'Nothing to review' : 'No submissions yet'}
          description={
            status === 'pending'
              ? 'When testers submit bugs for your published app, they appear here for grading.'
              : 'Publish your app on the marketplace and invite testers to start receiving reports.'
          }
          action={
            <Link
              to="/rewards?tab=publishing"
              className="text-sm font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
            >
              Open marketplace listing →
            </Link>
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-edge-subtle bg-surface p-4 space-y-3"
            >
              <div>
                <h3 className="text-sm font-semibold text-fg">{item.title}</h3>
                {item.description && (
                  <p className="mt-1 text-xs text-fg-secondary line-clamp-4">{item.description}</p>
                )}
                <p className="mt-2 text-2xs text-fg-muted">
                  {item.severity && <span className="mr-2 capitalize">{item.severity}</span>}
                  {item.points_awarded > 0 && (
                    <span>{item.points_awarded.toLocaleString()} pts if accepted</span>
                  )}
                </p>
              </div>
              <TesterSubmissionCard
                submission={{
                  id: item.id,
                  status: item.status,
                  points_awarded: item.points_awarded,
                  tester_handle: item.tester_handle,
                  app_name: item.app_name,
                  reviewer_note: item.reviewer_note,
                }}
                onReviewed={handleReviewed}
              />
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && pageCount > 1 && (
        <nav aria-label="Submission pages" className="flex items-center justify-between gap-3 text-xs">
          <span className="text-fg-muted">
            Showing {(page - 1) * REVIEW_PAGE_SIZE + 1}–{Math.min(page * REVIEW_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-1.5">
            <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Previous
            </Btn>
            <Btn variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Btn>
          </div>
        </nav>
      )}
    </div>
  )
}
