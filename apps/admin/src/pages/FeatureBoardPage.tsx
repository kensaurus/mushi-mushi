/**
 * FILE: apps/admin/src/pages/FeatureBoardPage.tsx
 * PURPOSE: Community-driven feature board — shows all feature-category
 *          support tickets with vote counts, comments, and shipped status.
 *          Members can upvote requests; operators can mark them shipped.
 */

import { useCallback, useMemo, useState } from 'react'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { Badge, Btn, Card, ErrorAlert, PageHeader, RelativeTime, Section } from '../components/ui'

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

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Shipped',
  closed: 'Closed',
}

const STATUS_COLOR: Record<TicketStatus, string> = {
  open: 'bg-info-muted/60 text-info border-info/30',
  in_progress: 'bg-warn-muted/60 text-warn border-warn/30',
  resolved: 'bg-ok-muted/60 text-ok border-ok/30',
  closed: 'bg-surface-overlay text-fg-faint border-edge-subtle',
}

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

  const submit = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await apiFetch(`/v1/admin/feature-board/${requestId}/comments?project_id=${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      })
      setBody('')
      reload()
    } finally {
      setSubmitting(false)
    }
  }, [body, submitting, requestId, projectId, reload])

  if (loading && comments.length === 0) {
    return <div className="text-xs text-fg-faint py-2">Loading comments…</div>
  }

  return (
    <div className="mt-3 border-t border-edge-subtle pt-3 space-y-2">
      {comments.map((c) => (
        <div key={c.id} className="flex gap-2 text-sm">
          <div className="w-6 h-6 rounded-full bg-brand-subtle flex items-center justify-center text-xs font-medium text-brand flex-shrink-0">
            {c.author_email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-fg text-xs">{c.author_email}</span>
              <RelativeTime value={c.created_at} className="text-xs text-fg-faint" />
            </div>
            <p className="text-fg-secondary text-sm mt-0.5 whitespace-pre-wrap">{c.body}</p>
          </div>
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <textarea
          className="flex-1 text-sm border border-edge rounded-md px-2.5 py-1.5 resize-none bg-surface-raised text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/50 min-h-[60px]"
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

// ── Single ticket card ────────────────────────────────────────────────────────

function FeatureCard({
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

  const isShipped = Boolean(ticket.shipped_in_release_id)

  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="flex gap-3">
        {/* Vote button */}
        <button
          onClick={handleVote}
          disabled={voting}
          className={[
            'flex flex-col items-center justify-center w-12 h-14 rounded-lg border-2 transition-colors flex-shrink-0',
            ticket.my_vote
              ? 'border-brand bg-brand-subtle text-brand'
              : 'border-edge bg-surface-raised text-fg-muted hover:border-brand/50 hover:text-brand',
            voting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
          title={ticket.my_vote ? 'Remove your vote' : 'Upvote this request'}
        >
          <svg
            className="w-4 h-4 mb-0.5"
            fill={ticket.my_vote ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
          <span className="text-sm font-semibold leading-none">{ticket.vote_count}</span>
        </button>

        {/* Ticket content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-fg text-sm leading-snug">{ticket.subject}</h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isShipped && (
                <Badge className="bg-ok-muted/60 text-ok border-ok/30 text-xs">
                  ✓ Shipped
                </Badge>
              )}
              <Badge className={`${STATUS_COLOR[ticket.status]} text-xs border`}>
                {STATUS_LABEL[ticket.status]}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-fg-muted">
            <span>{ticket.user_email}</span>
            <span>·</span>
            <RelativeTime value={ticket.created_at} />
            {ticket.comment_count > 0 && (
              <>
                <span>·</span>
                <button
                  className="hover:text-brand underline underline-offset-2"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {ticket.comment_count} comment{ticket.comment_count !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>

          {ticket.body && (
            <p className="mt-2 text-sm text-fg-secondary line-clamp-2 whitespace-pre-wrap">
              {ticket.body}
            </p>
          )}

          {ticket.shipped_note && (
            <div className="mt-2 p-2 bg-ok-muted/40 border border-ok/20 rounded text-xs text-ok">
              <span className="font-medium">Shipped note:</span> {ticket.shipped_note}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs"
            >
              {expanded ? 'Hide comments' : 'Comments'}
              {ticket.comment_count > 0 && ` (${ticket.comment_count})`}
            </Btn>
            {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleShip}
                disabled={shipping}
                className="text-xs text-ok hover:bg-ok-muted/40"
              >
                {shipping ? 'Marking…' : '✓ Mark shipped'}
              </Btn>
            )}
          </div>

          {expanded && (
            <CommentThread requestId={ticket.id} projectId={projectId} />
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FeatureBoardPage() {
  const projectId = useActiveProjectId()
  const [sort, setSort] = useState<SortKey>('votes')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'shipped'>('all')

  const {
    data,
    loading,
    error,
    reload,
  } = usePageData<{ tickets: FeatureTicket[] }>(
    projectId ? `/v1/admin/feature-board?project_id=${projectId}` : null,
  )

  const tickets = data?.tickets ?? []

  const filtered = useMemo(() => {
    let list = tickets

    if (statusFilter === 'open') {
      list = list.filter((t) => t.status === 'open' || t.status === 'in_progress')
    } else if (statusFilter === 'shipped') {
      list = list.filter((t) => Boolean(t.shipped_in_release_id))
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
        await apiFetch(`/v1/admin/feature-board/${id}/vote?project_id=${projectId}`, {
          method: 'POST',
        })
        reload()
      } catch (err) {
        console.error('Vote failed', err)
      }
    },
    [projectId, reload],
  )

  const handleShip = useCallback(
    async (id: string) => {
      if (!projectId) return
      const releaseNote = prompt('Shipped note (shown to requester, optional):')
      // null means the user clicked Cancel — do not ship.
      // Empty string means "no note desired" — proceed without a note.
      if (releaseNote === null) return
      try {
        await apiFetch(`/v1/admin/feature-board/${id}/ship?project_id=${projectId}`, {
          method: 'POST',
          body: JSON.stringify({ note: releaseNote || null }),
        })
        reload()
      } catch (err) {
        console.error('Ship failed', err)
      }
    },
    [projectId, reload],
  )

  const totalVotes = tickets.reduce((sum, t) => sum + t.vote_count, 0)
  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length
  const shippedCount = tickets.filter((t) => Boolean(t.shipped_in_release_id)).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <PageHeader
        title="Feature Board"
        description="Vote on feature requests and track what's shipped. Your votes help prioritize what matters most."
      />

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Requests', value: tickets.length },
          { label: 'Open', value: openCount },
          { label: 'Shipped', value: shippedCount },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="card-elevated rounded-lg p-3 text-center"
          >
            <div className="text-2xl font-bold text-fg stat-value">{value}</div>
            <div className="text-xs text-fg-muted mt-0.5 font-mono uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search requests…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] border border-edge rounded-lg px-3 py-1.5 text-sm bg-surface-raised text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/50"
        />

        <div className="flex gap-1">
          {(['all', 'open', 'shipped'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                statusFilter === f
                  ? 'bg-brand text-brand-fg'
                  : 'bg-surface-raised text-fg-muted hover:bg-surface-overlay hover:text-fg',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Shipped'}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border border-edge rounded-lg px-2 py-1.5 text-sm bg-surface-raised text-fg focus:outline-none focus:ring-1 focus:ring-brand/50"
        >
          <option value="votes">Most voted</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      {/* Content */}
      {!projectId && (
        <div className="text-center py-12 text-fg-muted text-sm">
          Select a project to view its feature board.
        </div>
      )}

      {projectId && error && <ErrorAlert message={error} />}

      {projectId && loading && tickets.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-raised rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {projectId && !loading && filtered.length === 0 && (
        <Section title="Feature Requests">
          <div className="text-center py-12 text-fg-muted">
            <div className="text-4xl mb-3">✨</div>
            <div className="font-medium text-fg">
              {search || statusFilter !== 'all' ? 'No matching requests' : 'No feature requests yet'}
            </div>
            <p className="text-sm mt-1">
              {search || statusFilter !== 'all'
                ? 'Try adjusting your filters.'
                : 'Feature requests submitted via the Feedback form will appear here.'}
            </p>
          </div>
        </Section>
      )}

      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((ticket) => (
            <FeatureCard
              key={ticket.id}
              ticket={ticket}
              projectId={projectId!}
              onVote={handleVote}
              onShip={handleShip}
            />
          ))}
        </div>
      )}

      {tickets.length > 0 && (
        <p className="text-center text-xs text-fg-faint pb-4 font-mono">
          {totalVotes} total vote{totalVotes !== 1 ? 's' : ''} across {tickets.length} request
          {tickets.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
