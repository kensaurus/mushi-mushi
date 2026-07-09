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
import { useToast } from '../lib/toast'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { EmptyState, ErrorAlert, Badge, SegmentedControl } from '../components/ui'
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

export function TesterSubmissionsReviewPage() {
  const projectId = useActiveProjectId()
  const toast = useToast()
  const [status, setStatus] = useState<StatusFilter>('pending')
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
        `/v1/admin/tester-submissions?projectId=${encodeURIComponent(projectId)}&status=${status}`,
      )
      if (!res.ok) {
        setError(res.error?.message ?? 'Could not load submissions.')
        setItems([])
        setTotal(0)
        return
      }
      setItems(res.data?.items ?? [])
      setTotal(res.data?.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [projectId, status])

  useEffect(() => {
    void load()
  }, [load])

  const handleReviewed = () => {
    toast.success('Submission updated.')
    void load()
  }

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
          className="text-xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors shrink-0"
        >
          ← Marketplace settings
        </Link>
      </PageHeaderBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={status}
          onChange={(v) => setStatus(v)}
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
              className="text-sm font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors"
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
    </div>
  )
}
