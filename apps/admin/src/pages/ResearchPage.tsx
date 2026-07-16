/**
 * FILE: apps/admin/src/pages/ResearchPage.tsx
 * PURPOSE: Banner + RESEARCH SNAPSHOT + tabs: Overview | Search | History.
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useResearchUx, resolveQuickResearchTab } from '../lib/researchModeUx'
import { SetupNudge } from '../components/SetupNudge'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Btn,
  Badge,
  Input,
  SegmentedControl,
  ErrorAlert,
  EmptyState,
  RelativeTime,
  FreshnessPill,
  RecommendedAction, } from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { ResearchStatusBanner } from '../components/research/ResearchStatusBanner'
import { ResearchSnapshotStrip } from '../components/research/ResearchSnapshotStrip'
import { ResearchReadout } from '../components/research/ResearchReadout'
import {
  EMPTY_RESEARCH_STATS,
  type ResearchStats,
  type ResearchTabId,
} from '../components/research/ResearchStatsTypes'
import { ResearchSnippetCard } from '../components/research/ResearchSnippetCard'
import { ResearchSessionTable } from '../components/research/ResearchSessionTable'
import type { SearchResponse, SessionRow } from '../components/research/types'
import { CHIP_TONE, HEADER_BADGE_TONE, LINK_ACCENT } from '../lib/chipTone'

type SessionMode = 'all' | 'search' | 'scrape'
type SessionAge = 'all' | '24h' | '7d'

const TABS: Array<{ id: ResearchTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Firecrawl posture, how web research fits triage, and recommended next steps.',
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Run a Firecrawl web query and attach snippets to a report as triage evidence.',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Reopen past sessions, filter by mode or age, and continue attaching evidence.',
  },
]

const SUGGESTIONS = [
  'react query 5 cache invalidation breaking change',
  'supabase auth getUser 401 with valid session',
  'vite 8 esbuild externalization regression',
  'pgvector cosine distance vs inner product accuracy',
  'cloudflare workers fetch ECONNRESET intermittent',
]

function resolveResearchTab(value: string | null): ResearchTabId {
  if (value === 'search' || value === 'history') return value
  return 'overview'
}

export function ResearchPage() {
  const copy = usePageCopy('/research')
  const ux = useResearchUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveResearchTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState<SearchResponse | null>(null)
  const [attachInput, setAttachInput] = useState<Record<string, string>>({})
  const [modeFilter, setModeFilter] = useState<SessionMode>('all')
  const [ageFilter, setAgeFilter] = useState<SessionAge>('all')

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ResearchStats>('/v1/admin/research/stats')
  usePublishPageHeroStats('/research', statsData)
  const stats = { ...EMPTY_RESEARCH_STATS, ...statsData }

  const sessionsPath = activeProjectId && activeTab === 'history' ? '/v1/admin/research/sessions?limit=50' : null

  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    reload: loadHistory,
    isValidating: historyValidating,
  } = usePageData<{ sessions: SessionRow[] }>(sessionsPath, { deps: [activeProjectId, activeTab] })

  const sessions = historyData?.sessions ?? []

  const reloadAll = useCallback(() => {
    reloadStats()
    loadHistory()
  }, [reloadStats, loadHistory])

  useRealtimeReload(['research_sessions', 'research_snippets'], reloadAll)

  const setActiveTab = useCallback(
    (tab: ResearchTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  usePublishPageContext({
    route: '/research',
    title: projectName ? `Research · ${projectName}` : 'Research',
    summary: statsLoading
      ? 'Loading research…'
      : !stats.firecrawlReady
        ? 'Firecrawl setup required'
        : `${stats.sessions} session${stats.sessions === 1 ? '' : 's'} · ${stats.attached} attached`,
    criticalCount: stats.unattachedSnippets,
  })

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'history' && stats.sessions > 0
            ? stats.sessions
            : t.id === 'search' && stats.unattachedSnippets > 0
              ? stats.unattachedSnippets
              : undefined,
      })),
    [copy?.tabLabels, stats.sessions, stats.unattachedSnippets],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickResearchTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const runSearch = useCallback(async (q: string) => {
    if (!activeProjectId) {
      toast.error('Select a project first')
      return
    }
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      toast.error('Type a search query first (at least 2 characters).')
      return
    }
    setSearching(true)
    const res = await apiFetch<SearchResponse>('/v1/admin/research/search', {
      method: 'POST',
      body: JSON.stringify({ query: trimmed, limit: 5 }),
    })
    setSearching(false)
    if (res.ok && res.data) {
      setActive(res.data)
      setActiveTab('search')
      reloadAll()
      toast.success(`Found ${res.data.results.length} result${res.data.results.length === 1 ? '' : 's'}`)
    } else {
      const code = res.error?.code
      if (code === 'FIRECRAWL_NOT_CONFIGURED') {
        toast.error('Add a Firecrawl API key in Settings → Firecrawl first.')
      } else if (code === 'FIRECRAWL_AUTH_FAILED') {
        toast.error('Firecrawl rejected the key. Re-check Settings → Firecrawl.')
      } else if (code === 'RATE_LIMITED') {
        toast.error('Firecrawl rate-limited — try again shortly.')
      } else {
        toast.error('Search failed', res.error?.message)
      }
    }
  }, [activeProjectId, reloadAll, setActiveTab, toast])

  const loadSession = useCallback(async (id: string) => {
    const res = await apiFetch<{ session: SessionRow; snippets: SearchResponse['results'] }>(
      `/v1/admin/research/sessions/${id}`,
    )
    if (res.ok && res.data) {
      setActive({
        sessionId: res.data.session.id,
        createdAt: res.data.session.created_at,
        query: res.data.session.query,
        results: res.data.snippets,
      })
      setActiveTab('search')
    } else {
      toast.error('Failed to load session', res.error?.message)
    }
  }, [setActiveTab, toast])

  const attach = useCallback(async (snippetId: string) => {
    const reportId = (attachInput[snippetId] ?? '').trim()
    if (!reportId) {
      toast.error('Paste the report UUID from the Reports page.')
      return
    }
    const res = await apiFetch(`/v1/admin/research/snippets/${snippetId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ reportId }),
    })
    if (res.ok) {
      toast.success(`Snippet attached to report ${reportId.slice(0, 8)}…`)
      setAttachInput((s) => ({ ...s, [snippetId]: '' }))
      if (active) {
        setActive({
          ...active,
          results: active.results.map((r) =>
            r.id === snippetId ? { ...r, attached_to_report_id: reportId } : r,
          ),
        })
      }
      reloadStats()
    } else if (res.error?.code === 'REPORT_NOT_FOUND') {
      toast.error('No report with that id in your project.')
    } else {
      toast.error('Attach failed', res.error?.message)
    }
  }, [active, attachInput, reloadStats, toast])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading research">
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

  if (statsError) {
    return <ErrorAlert message={`Failed to load research stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'firecrawl_auth_failed' || stats.topPriority === 'firecrawl_error'
        ? 'danger'
        : stats.topPriority === 'firecrawl_not_configured' || stats.topPriority === 'unattached_snippets'
          ? 'warn'
          : stats.topPriority === 'ready_no_sessions' || stats.topPriority === 'firecrawl_untested'
            ? 'brand'
            : stats.firecrawlReady
              ? 'ok'
              : 'info'

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-research">
      <PageHeaderBar
        title={copy?.title ?? 'Research'}
        projectScope={stats.projectName ?? projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About web research'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Search the web while reviewing a bug — look up release notes, Stack Overflow threads, or vendor changelogs and pin the result to a specific report.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Cross-reference an error signature against current upstream docs',
          'Find a Stack Overflow thread to attach as review evidence',
          'Check if a third-party library shipped a fix in the last 24 hours',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Press Enter to search. Paste a report UUID on any snippet and click Attach evidence.'}
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'danger'
                ? CHIP_TONE.dangerSubtle
                : bannerSeverity === 'warn'
                  ? CHIP_TONE.warnSubtle
                  : bannerSeverity === 'brand'
                    ? HEADER_BADGE_TONE.brand
                    : HEADER_BADGE_TONE.neutral
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : !stats.firecrawlConfigured
              ? 'NO KEY'
              : !stats.firecrawlReady
                ? 'NOT READY'
                : stats.sessions === 0
                  ? 'READY'
                  : `${stats.attached} ATTACHED`}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || historyValidating}>
          Refresh
        </Btn>
        {activeTab === 'search' && (
          <Btn
            size="sm"
            variant="primary"
            disabled={!activeProjectId || searching || !stats.firecrawlReady}
            loading={searching}
            onClick={() => void runSearch(query)}
            title={
              !activeProjectId
                ? 'Select a project first'
                : !stats.firecrawlReady
                  ? 'Configure and test Firecrawl first'
                  : undefined
            }
          >
            Search web
          </Btn>
        )}
          </>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <ResearchStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideResearchSnapshot,
            children: (
              <ResearchSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'RESEARCH SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ResearchTabId>
        size="sm"
        scrollable
        ariaLabel="Research sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!activeProjectId ? (
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Research sessions and Firecrawl settings are scoped to the active project in the header."
        />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <ResearchReadout
                stats={stats}
                fetchedAt={statsFetchedAt}
                isValidating={statsValidating}
              />
              {stats.topPriority === 'healthy' && (
                <RecommendedAction
                  tone="success"
                  title="Research pipeline healthy"
                  description={stats.topPriorityLabel ?? `${stats.sessions} sessions with Firecrawl ready.`}
                />
              )}
              {(stats.topPriority === 'firecrawl_not_configured' || stats.topPriority === 'firecrawl_untested') && (
                <RecommendedAction
                  tone="info"
                  title="Configure Firecrawl first"
                  description={stats.topPriorityLabel ?? 'Web search requires a BYOK Firecrawl key.'}
                  cta={{ label: 'Open Firecrawl settings', to: '/settings?tab=firecrawl' }}
                />
              )}
              {(stats.topPriority === 'firecrawl_auth_failed' || stats.topPriority === 'firecrawl_error') && (
                <RecommendedAction
                  tone="urgent"
                  title="Fix Firecrawl before searching"
                  description={stats.topPriorityLabel ?? 'Re-test the API key in Settings.'}
                  cta={{ label: 'Fix in Settings', to: '/settings?tab=firecrawl' }}
                />
              )}
              {stats.topPriority === 'ready_no_sessions' && (
                <RecommendedAction
                  tone="info"
                  title="Run your first search"
                  description={stats.topPriorityLabel ?? 'Firecrawl is ready — try an example query on the Search tab.'}
                  cta={{ label: 'Open Search', to: '/research?tab=search' }}
                />
              )}
              {stats.topPriority === 'unattached_snippets' && (
                <RecommendedAction
                  tone="info"
                  title="Attach snippets to reports"
                  description={stats.topPriorityLabel ?? 'Paste report UUIDs from the Reports page.'}
                  cta={{ label: 'Open Search', to: '/research?tab=search' }}
                />
              )}
              {stats.lastSessionAt && (
                <InlineProof>
                  Last search <RelativeTime value={stats.lastSessionAt} />
                  {' · '}
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`!px-0 !py-0 !border-0 !bg-transparent hover:!bg-transparent ${LINK_ACCENT}`}
                    onClick={() => setActiveTab('history')}
                  >
                    View history
                  </Btn>
                </InlineProof>
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void runSearch(query)
                }}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <Input
                  label="Web query"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="error signature, library name, doc topic…"
                  className="flex-1"
                  disabled={searching || !stats.firecrawlReady}
                />
                <Btn
                  type="submit"
                  variant="primary"
                  disabled={searching || !stats.firecrawlReady}
                  loading={searching}
                  className="shrink-0 sm:self-end"
                >
                  Search
                </Btn>
              </form>

              <ContainedBlock tone="muted" label="Example queries">
                <ActionPillRow>
                  {SUGGESTIONS.map((s) => (
                    <ActionPill
                      key={s}
                      onClick={() => {
                        setQuery(s)
                        void runSearch(s)
                      }}
                      tone="neutral"
                      className={`font-mono ${searching || !stats.firecrawlReady ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {s}
                    </ActionPill>
                  ))}
                </ActionPillRow>
              </ContainedBlock>

              {!stats.firecrawlReady && (
                <EmptyState
                  title="Firecrawl not ready"
                  description="Add and test your Firecrawl API key before searching. The fix-worker also uses this key when local RAG is sparse."
                  action={
                    <Link to="/settings?tab=firecrawl">
                      <Btn size="sm" variant="primary">Open Firecrawl settings</Btn>
                    </Link>
                  }
                  hints={[
                    'Set an allow-list of domains to keep results on-topic',
                    'Duplicate queries within 24h hit the Firecrawl cache',
                  ]}
                />
              )}

              {active && (
                <div className="space-y-3 border-t border-edge-subtle pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium text-fg">
                        Results — &ldquo;{active.query}&rdquo;
                      </h3>
                      <InlineProof className="mt-1">
                        Session {active.sessionId.slice(0, 8)}… ·{' '}
                        <RelativeTime value={active.createdAt} />
                      </InlineProof>
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => setActive(null)}>
                      Clear results
                    </Btn>
                  </div>

                  {active.results.length === 0 ? (
                    <EmptyState
                      title="No results returned"
                      description="Try a broader query or relax the domain allow-list in Settings → Firecrawl."
                      hints={[
                        'Check allowed domains include the site you expect',
                        `Page cap is ${stats.maxPagesPerCall} results per call`,
                      ]}
                    />
                  ) : (
                    <div className="space-y-3">
                      {active.results.map((r) => (
                        <ResearchSnippetCard
                          key={r.id}
                          snippet={r}
                          attachValue={attachInput[r.id] ?? ''}
                          onAttachValueChange={(v) =>
                            setAttachInput((s) => ({ ...s, [r.id]: v }))
                          }
                          onAttach={() => void attach(r.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              {historyLoading && (
                <TableSkeleton rows={4} columns={5} showFilters={false} label="Loading research history" />
              )}
              {historyError && (
                <ErrorAlert message={`Failed to load history: ${historyError}`} onRetry={loadHistory} />
              )}
              {!historyLoading && !historyError && (
                <ResearchSessionTable
                  sessions={sessions}
                  projectName={projectName}
                  modeFilter={modeFilter}
                  ageFilter={ageFilter}
                  onModeFilterChange={setModeFilter}
                  onAgeFilterChange={setAgeFilter}
                  onOpenSession={(id) => void loadSession(id)}
                  activeSessionId={active?.sessionId ?? null}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
