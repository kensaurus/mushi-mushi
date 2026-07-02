/**
 * FILE: apps/admin/src/pages/FeedbackPage.tsx
 * PURPOSE: My feedback hub — tab shell (Overview | Active | Shipped | All)
 *          with stats banner, KPI strip, and support ticket list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRealtimeReload } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { usePageCopy } from '../lib/copy'
import { useEntitlements } from '../lib/useEntitlements'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  type SupportTicket,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  hasUnreadReply,
  isShipped,
  releaseForTicket,
} from '../lib/supportTickets'
import { FeedbackModal } from '../components/FeedbackModal'
import { SupportTicketDetailModal } from '../components/support/SupportTicketDetailModal'
import { FeedbackStatusBanner } from '../components/feedback/FeedbackStatusBanner'
import { FeedbackSnapshotStrip } from '../components/feedback/FeedbackSnapshotStrip'
import { FeedbackReadout } from '../components/feedback/FeedbackReadout'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { EMPTY_FEEDBACK_STATS, type FeedbackStats, type FeedbackTabId } from '../components/feedback/types'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  Badge,
  Btn,
  Card,
  ErrorAlert,
  FreshnessPill,
  RelativeTime,
  SegmentedControl,
} from '../components/ui'
import { CHIP_TONE } from '../lib/chipTone'

type ListFilter = 'all' | 'bug' | 'feature'

const FEEDBACK_TABS: Array<{ id: FeedbackTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, top priority, and how feedback differs from user bug Reports.',
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Open and in-progress tickets — look for the pulsing “New reply” badge.',
  },
  {
    id: 'shipped',
    label: 'Shipped',
    description: 'Ideas linked to a release — version chip shows where your request landed.',
  },
  {
    id: 'all',
    label: 'All',
    description: 'Full history with bug vs feature filters.',
  },
]

function isFeedbackTab(value: string | null): value is FeedbackTabId {
  return FEEDBACK_TABS.some((t) => t.id === value)
}

function buildTicketsUrl(tab: FeedbackTabId, listFilter: ListFilter): string {
  const params = new URLSearchParams({ limit: '50' })
  if (tab === 'shipped') params.set('shipped', '1')
  if (tab === 'all' && listFilter === 'bug') params.set('category', 'bug')
  if (tab === 'all' && listFilter === 'feature') params.set('category', 'feature')
  return `/v1/admin/support/tickets?${params.toString()}`
}

export function FeedbackPage() {
  const copy = usePageCopy('/feedback')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: FeedbackTabId = isFeedbackTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = FEEDBACK_TABS.find((t) => t.id === activeTab) ?? FEEDBACK_TABS[0]

  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature'>('bug')
  const [openTicketId, setOpenTicketId] = useState<string | null>(null)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<FeedbackStats>('/v1/admin/feedback/stats')
  const stats = statsData ?? EMPTY_FEEDBACK_STATS

  const ticketsUrl = buildTicketsUrl(activeTab, listFilter)
  const ticketsQuery = usePageData<{ tickets: SupportTicket[] }>(ticketsUrl)
  const projectsQuery = usePageData<{ projects: { id: string; name: string }[] }>('/v1/admin/projects')

  const tickets = ticketsQuery.data?.tickets ?? []
  const projects = projectsQuery.data?.projects ?? []
  const activeProjectId = useActiveProjectId()
  const { isSuperAdmin } = useEntitlements()

  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—',
    [projects],
  )

  const openTicket = tickets.find((t) => t.id === openTicketId) ?? null

  const reloadAll = useCallback(() => {
    reloadStats()
    ticketsQuery.reload()
    projectsQuery.reload()
  }, [reloadStats, ticketsQuery, projectsQuery])

  useRealtimeReload(['support_tickets'], reloadAll, {
    debounceMs: 1500,
    enabled: stats.hasAnyProject,
  })

  const setActiveTab = useCallback(
    (id: FeedbackTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const displayTickets = useMemo(() => {
    if (activeTab === 'active') {
      return tickets.filter((t) => t.status === 'open' || t.status === 'in_progress')
    }
    return tickets
  }, [activeTab, tickets])

  const ticketFromUrl = searchParams.get('ticket')
  useEffect(() => {
    if (!ticketFromUrl || ticketsQuery.loading) return
    setOpenTicketId(ticketFromUrl)
  }, [ticketFromUrl, ticketsQuery.loading])

  const bannerSeverity: 'ok' | 'warn' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'reply'
        ? 'brand'
        : stats.topPriority === 'active'
          ? 'warn'
          : stats.topPriority === 'first_submit'
            ? 'info'
            : 'ok'

  usePublishPageContext({
    route: '/feedback',
    title: 'Support',
    summary: `${activeTabMeta.label} · ${stats.totalTickets} submission${stats.totalTickets === 1 ? '' : 's'} · ${stats.activeTickets} active`,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.awaitingReply,
    questions: [
      'Which of my feature requests shipped recently?',
      'Do I have any open tickets waiting for a reply?',
    ],
    actions: [{ id: 'feedback-refresh', label: 'Refresh', hint: 'Re-fetch stats + tickets', run: reloadAll }],
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'active' as const,
        label: 'Active',
        count: stats.activeTickets > 0 ? stats.activeTickets : undefined,
      },
      {
        id: 'shipped' as const,
        label: 'Shipped',
        count: stats.shippedTickets > 0 ? stats.shippedTickets : undefined,
      },
      { id: 'all' as const, label: 'All', count: stats.totalTickets > 0 ? stats.totalTickets : undefined },
    ],
    [stats],
  )

  function openFeedback(type: 'bug' | 'feature') {
    setFeedbackType(type)
    setFeedbackOpen(true)
  }

  function handleSubmitted() {
    reloadAll()
  }

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading feedback">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>
    )
  }
  if (statsError) return <ErrorAlert message={`Failed to load feedback stats: ${statsError}`} onRetry={reloadAll} />

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title={copy?.title ?? 'Support'}
        projectScope={stats.projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About Support'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'A personal inbox for bugs and feature requests you file to the Mushi team. When we ship your idea, the release version appears on the row.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Check Active tab for tickets still in triage',
            'Look for pulsing “New reply” badges when the team responds',
            'Shipped tab shows release version chips for credited ideas',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'This is not the same as Reports — those are end-user bugs from your app. Billing questions go to Billing support.'
        }
        helpFlowPath="/feedback"
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'brand'
                ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                : bannerSeverity === 'warn'
                  ? CHIP_TONE.warnSubtle
                  : CHIP_TONE.infoSubtle
          }
        >
          {stats.awaitingReply > 0
            ? `${stats.awaitingReply} REPLY`
            : stats.activeTickets > 0
              ? `${stats.activeTickets} ACTIVE`
              : stats.totalTickets === 0
                ? 'EMPTY'
                : 'CLEAR'}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating || ticketsQuery.isValidating} />
        <Btn size="sm" onClick={() => openFeedback('bug')}>
          Report a bug
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => openFeedback('feature')}>
          Request feature
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <FeedbackStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onSubmitBug={() => openFeedback('bug')}
                onSubmitFeature={() => openFeedback('feature')}
                onRefresh={reloadAll}
                refreshing={statsValidating || ticketsQuery.isValidating}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <FeedbackSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'FEEDBACK SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Feedback sections"
        size="sm"
        scrollable
      />

      {activeTab === 'overview' && (
        <>
          <FeedbackReadout
            stats={stats}
            fetchedAt={statsFetchedAt}
            isValidating={statsValidating}
          />

          <Card className="border-dashed border-edge-subtle bg-surface-raised/20 p-3">
            <p className="text-2xs leading-relaxed text-fg-muted">
              End-user bug reports from your app appear under{' '}
              <Link to="/reports" className="font-medium text-brand hover:text-brand-hover">
                Reports
              </Link>
              . Billing questions?{' '}
              <Link to="/billing" className="font-medium text-brand hover:text-brand-hover">
                Billing support
              </Link>
              .
            </p>
          </Card>
        </>
      )}

      {(activeTab === 'active' || activeTab === 'shipped' || activeTab === 'all') && (
        <Card className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {activeTab === 'all' ? (
              <SegmentedControl
                value={listFilter}
                onChange={(v) => setListFilter(v as ListFilter)}
                options={[
                  { id: 'all', label: 'All types' },
                  { id: 'bug', label: 'Bugs' },
                  { id: 'feature', label: 'Features' },
                ]}
                ariaLabel="Filter ticket type"
                size="sm"
              />
            ) : (
              <p className="text-xs font-medium text-fg-secondary">
                {activeTab === 'active' ? 'Open & in progress' : 'Shipped in releases'}
              </p>
            )}
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={ticketsQuery.isValidating}>
              Refresh
            </Btn>
          </div>

          {ticketsQuery.error && (
            <ErrorAlert message={ticketsQuery.error} onRetry={() => ticketsQuery.reload()} />
          )}

          {ticketsQuery.loading && displayTickets.length === 0 && (
            <p className="py-6 text-center text-xs text-fg-muted">Loading your submissions…</p>
          )}

          {!ticketsQuery.loading && displayTickets.length === 0 && (
            <div className="space-y-3 py-4">
              <EmptySectionMessage
                text={
                  activeTab === 'active'
                    ? 'No active submissions'
                    : activeTab === 'shipped'
                      ? 'Nothing shipped yet'
                      : 'No submissions in this view'
                }
                hint={
                  activeTab === 'shipped'
                    ? 'When we credit your idea in a release, it appears here with a version chip.'
                    : 'Found something broken or have an idea? We read every ticket.'
                }
              />
              {activeTab !== 'shipped' && (
                <ActionPillRow className="justify-center">
                  <ActionPill tone="brand" onClick={() => openFeedback('bug')}>
                    Report a bug
                  </ActionPill>
                  <ActionPill tone="neutral" onClick={() => openFeedback('feature')}>
                    Request a feature
                  </ActionPill>
                </ActionPillRow>
              )}
            </div>
          )}

          {displayTickets.length > 0 && (
            <ul className="divide-y divide-edge-subtle">
              {displayTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  projectLabel={projectName(t.project_id)}
                  isCurrentProject={t.project_id === activeProjectId}
                  onOpen={() => setOpenTicketId(t.id)}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {isSuperAdmin && activeTab === 'overview' && (
        <ContainedBlock tone="muted" className="border-dashed">
          <p className="text-2xs text-fg-muted">
            Operators can link tickets to releases when publishing on{' '}
            <Link to="/releases" className="font-medium text-brand hover:text-brand-hover">
              Releases
            </Link>
            .
          </p>
        </ContainedBlock>
      )}

      <SupportTicketDetailModal
        ticket={openTicket}
        projectName={openTicket ? projectName(openTicket.project_id) : ''}
        onClose={() => setOpenTicketId(null)}
        onChanged={() => {
          setOpenTicketId(null)
          handleSubmitted()
        }}
      />

      {feedbackOpen && (
        <FeedbackModal
          initialType={feedbackType}
          onClose={() => setFeedbackOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  )
}

function TicketRow({
  ticket: t,
  projectLabel,
  isCurrentProject,
  onOpen,
}: {
  ticket: SupportTicket
  projectLabel: string
  isCurrentProject: boolean
  onOpen: () => void
}) {
  const release = releaseForTicket(t)
  const shipped = isShipped(t)
  const reply = hasUnreadReply(t)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="-mx-1 flex w-full items-start justify-between gap-3 rounded-sm px-1 py-2.5 text-left hover:bg-surface-overlay/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs" aria-hidden>
              {CATEGORY_EMOJI[t.category] ?? '💬'}
            </span>
            <p className="truncate text-xs font-medium text-fg">{t.subject}</p>
            {reply && (t.status === 'open' || t.status === 'in_progress') && (
              <Badge className="shrink-0 border border-brand/30 bg-brand/15 text-3xs text-brand motion-safe:animate-pulse">
                New reply
              </Badge>
            )}
            {shipped && release && (
              <Badge className="shrink-0 font-mono text-3xs">v{release.version}</Badge>
            )}
          </div>
          <InlineProof className="truncate border-0 bg-transparent px-0 py-0">
            {CATEGORY_LABEL[t.category] ?? t.category}
            {' · '}
            {projectLabel}
            {isCurrentProject && t.project_id ? ' · current project' : ''}
            {' · '}
            <RelativeTime value={t.created_at} />
          </InlineProof>
          {shipped && release && (
            <SignalChip tone="ok" className="truncate max-w-full">
              Shipped in {release.title}
            </SignalChip>
          )}
        </div>
        <Badge className={`${TICKET_STATUS_TONE[t.status]} shrink-0`}>{TICKET_STATUS_LABEL[t.status]}</Badge>
      </button>
    </li>
  )
}
