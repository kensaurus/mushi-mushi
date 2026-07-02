/**
 * FILE: apps/admin/src/pages/FeatureBoardPage.tsx
 * PURPOSE: Community-driven feature board — shows all feature-category
 *          support tickets with vote counts, comments, and shipped status.
 *          Members can upvote requests; operators can mark them shipped.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { ContainedBlock, InlineProof } from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { FeatureBoardReadout } from '../components/feature-board/FeatureBoardReadout'
import { FeatureBoardSnapshotStrip } from '../components/feature-board/FeatureBoardSnapshotStrip'
import { type FeatureBoardClientStats } from '../components/feature-board/FeatureBoardStatsTypes'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  ErrorAlert,
  FreshnessPill,
  Loading,
  RelativeTime,
  SegmentedControl,
} from '../components/ui'
import { CHIP_TONE, runStatusChipTone } from '../lib/chipTone'

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

interface FeatureTicket {
  id: string
  project_id: string
  user_id: string | null
  user_email: string
  subject: string
  body: string
  status: TicketStatus
  plan_id: string | null
  admin_response: string | null
  shipped_in_release_id: string | null
  shipped_at: string | null
  shipped_note: string | null
  created_at: string
  updated_at: string
  vote_count: number
  comment_count: number
  my_vote: boolean
}

interface FeatureComment {
  id: string
  request_id: string
  author_user_id: string | null
  author_email: string
  parent_id: string | null
  body: string
  created_at: string
  updated_at: string
}

type SortKey = 'votes' | 'newest' | 'oldest'
type StatusFilter = 'all' | 'open' | 'shipped'

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Shipped',
  closed: 'Closed',
}

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: runStatusChipTone('open'),
  in_progress: runStatusChipTone('in_progress'),
  resolved: runStatusChipTone('resolved'),
  closed: runStatusChipTone('closed'),
}

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'votes', label: 'Most voted' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
]

const FIELD_BASE =
  'w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg ' +
  'placeholder:text-fg-faint hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 ' +
  'motion-safe:transition-colors motion-safe:duration-150'

// ── Comment thread ────────────────────────────────────────────────────────────

function CommentThread({
  requestId,
  projectId,
}: {
  requestId: string
  projectId: string
}) {
  const { data, loading, reload } = usePageData<{ comments: FeatureComment[] }>(
    `/v1/admin/feature-board/${requestId}/comments?project_id=${projectId}`,
  )
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const comments = data?.comments ?? []

  const toast = useToast()

  const submit = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      const res = await apiFetch(`/v1/admin/feature-board/${requestId}/comments?project_id=${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      })
      if (!res.ok) {
        toast.error(res.error?.message ?? 'Could not post comment')
        return
      }
      setBody('')
      reload()
    } finally {
      setSubmitting(false)
    }
  }, [body, submitting, requestId, projectId, reload, toast])

  if (loading && comments.length === 0) {
    return <Loading text="Loading comments…" />
  }

  return (
    <div className="mt-3 border-t border-edge-subtle pt-3 space-y-2">
      {comments.map((c) => (
        <div key={c.id} className="flex gap-2 text-sm">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-medium text-brand">
            {c.author_email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-fg">{c.author_email}</span>
              <RelativeTime value={c.created_at} className="text-xs text-fg-faint" />
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg-secondary">{c.body}</p>
          </div>
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <textarea
          className={`${FIELD_BASE} min-h-[60px] resize-none`}
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <Btn
          size="sm"
          variant="ghost"
          onClick={submit}
          disabled={!body.trim() || submitting}
          className="self-end"
        >
          {submitting ? 'Posting…' : 'Post'}
        </Btn>
      </div>
    </div>
  )
}

// ── Single ticket row ─────────────────────────────────────────────────────────

function FeatureRow({
  ticket,
  projectId,
  onVote,
  onShip,
}: {
  ticket: FeatureTicket
  projectId: string
  onVote: (id: string) => Promise<void>
  onShip: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [voting, setVoting] = useState(false)
  const [shipping, setShipping] = useState(false)

  const handleVote = async () => {
    if (voting) return
    setVoting(true)
    try {
      await onVote(ticket.id)
    } finally {
      setVoting(false)
    }
  }

  const handleShip = async () => {
    if (shipping) return
    setShipping(true)
    try {
      await onShip(ticket.id)
    } finally {
      setShipping(false)
    }
  }

  const isShipped = ticket.status === 'resolved' || Boolean(ticket.shipped_in_release_id)

  return (
    <li className="flex gap-3 px-3 py-3 first:pt-2 last:pb-2">
      <button
        type="button"
        onClick={handleVote}
        disabled={voting}
        aria-pressed={ticket.my_vote}
        aria-label={ticket.my_vote ? 'Remove your vote' : 'Upvote this request'}
        title={ticket.my_vote ? 'Remove your vote' : 'Upvote this request'}
        className={[
          'flex h-14 w-11 shrink-0 flex-col items-center justify-center rounded-sm border motion-safe:transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
          ticket.my_vote
            ? 'border-brand/50 bg-brand/10 text-brand'
            : 'border-edge-subtle bg-surface-raised/60 text-fg-muted hover:border-brand/40 hover:text-brand',
          voting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        ].join(' ')}
      >
        <svg
          className="mb-0.5 h-3.5 w-3.5"
          fill={ticket.my_vote ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
        <span className="font-mono text-xs font-semibold leading-none tabular-nums">{ticket.vote_count}</span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-snug text-fg">{ticket.subject}</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {isShipped && (
              <Badge className={`border border-ok/30 ${CHIP_TONE.okSubtle} text-3xs`}>
                Shipped
              </Badge>
            )}
            <Badge className={STATUS_BADGE[ticket.status]}>
              {STATUS_LABEL[ticket.status]}
            </Badge>
          </div>
        </div>

        <InlineProof className="mt-1">
          {ticket.user_email}
          <span aria-hidden className="text-fg-faint">
            {' '}
            ·{' '}
          </span>
          <RelativeTime value={ticket.created_at} />
          {ticket.comment_count > 0 && (
            <>
              <span aria-hidden className="text-fg-faint">
                {' '}
                ·{' '}
              </span>
              <button
                type="button"
                className="text-brand hover:text-brand-hover hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {ticket.comment_count} comment{ticket.comment_count !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </InlineProof>

        {ticket.body && (
          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">
            {ticket.body}
          </p>
        )}

        {ticket.shipped_note && (
          <ContainedBlock tone="ok" className="mt-2 text-2xs">
            <span className="font-medium text-ok">Shipped note:</span>{' '}
            <span className="text-fg-secondary">{ticket.shipped_note}</span>
          </ContainedBlock>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide comments' : 'Comments'}
            {ticket.comment_count > 0 ? ` (${ticket.comment_count})` : ''}
          </Btn>
          {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
            <Btn size="sm" variant="ghost" onClick={handleShip} disabled={shipping} className="text-ok">
              {shipping ? 'Marking…' : 'Mark shipped'}
            </Btn>
          )}
        </div>

        {expanded && <CommentThread requestId={ticket.id} projectId={projectId} />}
      </div>
    </li>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FeatureBoardPage() {
  const toast = useToast()
  const projectId = useActiveProjectId()
  const [sort, setSort] = useState<SortKey>('votes')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const {
    data,
    loading,
    error,
    reload,
    lastFetchedAt,
    isValidating,
  } = usePageData<{ tickets: FeatureTicket[] }>(
    projectId ? `/v1/admin/feature-board?project_id=${projectId}` : null,
  )

  const tickets = data?.tickets ?? []

  const openCount = useMemo(
    () => tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    [tickets],
  )
  const shippedCount = useMemo(
    () => tickets.filter((t) => Boolean(t.shipped_in_release_id)).length,
    [tickets],
  )
  const totalVotes = useMemo(
    () => tickets.reduce((sum, t) => sum + t.vote_count, 0),
    [tickets],
  )

  const topRequest = useMemo(() => {
    if (tickets.length === 0) return null
    return [...tickets].sort((a, b) => b.vote_count - a.vote_count)[0] ?? null
  }, [tickets])

  const clientStats: FeatureBoardClientStats = useMemo(
    () => ({
      projectId,
      openCount,
      shippedCount,
      totalVotes,
      totalTickets: tickets.length,
      topRequestSubject: topRequest?.subject ?? null,
    }),
    [projectId, openCount, shippedCount, totalVotes, tickets.length, topRequest?.subject],
  )

  const filtered = useMemo(() => {
    let list = tickets

    if (statusFilter === 'open') {
      list = list.filter((t) => t.status === 'open' || t.status === 'in_progress')
    } else if (statusFilter === 'shipped') {
      list = list.filter((t) => t.status === 'resolved' || Boolean(t.shipped_in_release_id))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          t.user_email.toLowerCase().includes(q),
      )
    }

    return [...list].sort((a, b) => {
      if (sort === 'votes') return b.vote_count - a.vote_count
      if (sort === 'newest')
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
  }, [tickets, sort, search, statusFilter])

  const handleVote = useCallback(
    async (id: string) => {
      if (!projectId) return
      try {
        const res = await apiFetch(`/v1/admin/feature-board/${id}/vote?project_id=${projectId}`, {
          method: 'POST',
        })
        if (!res.ok) {
          toast.error(res.error?.message ?? 'Vote failed')
          return
        }
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Vote failed')
      }
    },
    [projectId, reload, toast],
  )

  const handleShip = useCallback(
    async (id: string) => {
      if (!projectId) return
      const releaseNote = prompt('Shipped note (shown to requester, optional):')
      if (releaseNote === null) return
      try {
        const res = await apiFetch(`/v1/admin/feature-board/${id}/ship?project_id=${projectId}`, {
          method: 'POST',
          body: JSON.stringify({ note: releaseNote || null }),
        })
        if (!res.ok) {
          toast.error(res.error?.message ?? 'Could not mark shipped')
          return
        }
        toast.success('Marked shipped')
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not mark shipped')
      }
    },
    [projectId, reload, toast],
  )

  usePublishPageContext({
    route: '/feature-board',
    title: 'Feature board',
    summary: `${tickets.length} requests · ${openCount} open · ${totalVotes} votes`,
    filters: { project_id: projectId ?? undefined, status: statusFilter, sort },
    questions: [
      'Which feature request has the most votes?',
      'What shipped recently on the feature board?',
    ],
    actions: [{ id: 'feature-board-refresh', label: 'Refresh', hint: 'Reload requests', run: reload }],
  })

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title="Feature board"
        withPageHero={false}
        helpTitle="About the feature board"
        helpWhatIsIt="Community feature requests from the Feedback form, ranked by votes. Operators can mark items shipped and notify requesters."
        helpUseCases={[
          'See which ideas your users care about most',
          'Upvote requests to signal priority',
          'Mark shipped work and attach a release note',
        ]}
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
        <Btn size="sm" variant="ghost" onClick={reload} loading={isValidating}>
          Refresh
        </Btn>
        <Link to="/feedback">
          <Btn size="sm" variant="ghost">
            My feedback
          </Btn>
        </Link>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <FeatureBoardSnapshotStrip
                stats={clientStats}
                fetchedAt={lastFetchedAt}
                isValidating={isValidating}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            children: (
              <FeatureBoardReadout
                stats={clientStats}
                fetchedAt={lastFetchedAt}
                isValidating={isValidating}
              />
            ),
          },
        ]}
      />

      {!projectId && (
        <EmptyState
          title="Select a project"
          description="Choose a project in the header to load its community feature board."
        />
      )}

      {projectId && (
        <Card className="space-y-3 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1">
              <span className="sr-only">Search requests</span>
              <input
                type="search"
                placeholder="Search subject, body, or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={FIELD_BASE}
              />
            </label>

            <SegmentedControl
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { id: 'all', label: 'All', count: tickets.length || undefined },
                { id: 'open', label: 'Open', count: openCount || undefined },
                { id: 'shipped', label: 'Shipped', count: shippedCount || undefined },
              ]}
              ariaLabel="Filter by status"
              size="sm"
              scrollable
            />

            <label className="inline-flex flex-col gap-0.5">
              <span className="text-3xs uppercase tracking-wider text-fg-faint">Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <ErrorAlert message={error} onRetry={reload} />}

          {loading && tickets.length === 0 && (
            <Loading text="Loading feature requests…" />
          )}

          {!loading && filtered.length === 0 && !error && (
            <div className="py-4">
              {search || statusFilter !== 'all' ? (
                <EmptySectionMessage
                  text="No matching requests"
                  hint="Try clearing search or switching the status filter."
                />
              ) : (
                <EmptyState
                  icon={<HeroPlugIntegration />}
                  title="No feature requests yet"
                  description="Feature requests submitted via the Feedback form will appear here for voting."
                  hints={[
                    'Users pick “Request a feature” in the widget or My feedback',
                    'Votes are idempotent — click again to remove yours',
                    'Mark shipped when the idea lands in a release',
                  ]}
                  action={
                    <Link to="/feedback">
                      <Btn size="sm">Open My feedback</Btn>
                    </Link>
                  }
                />
              )}
            </div>
          )}

          {filtered.length > 0 && (
            <ul className="divide-y divide-edge-subtle rounded-sm border border-edge-subtle">
              {filtered.map((ticket) => (
                <FeatureRow
                  key={ticket.id}
                  ticket={ticket}
                  projectId={projectId}
                  onVote={handleVote}
                  onShip={handleShip}
                />
              ))}
            </ul>
          )}

          {tickets.length > 0 && (
            <InlineProof className="justify-center border-t border-edge-subtle/60 pt-2 tabular-nums">
              {totalVotes} total vote{totalVotes !== 1 ? 's' : ''} across {tickets.length} request
              {tickets.length !== 1 ? 's' : ''}
            </InlineProof>
          )}
        </Card>
      )}
    </div>
  )
}
