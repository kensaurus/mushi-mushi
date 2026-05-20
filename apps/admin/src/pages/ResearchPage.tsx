/**
 * FILE: apps/admin/src/pages/ResearchPage.tsx
 * PURPOSE: Manual web research powered by BYOK Firecrawl during triage.
 *          Search the web, persist sessions + snippets, attach evidence to reports.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import {
  PageHeader,
  PageHelp,
  Section,
  Btn,
  Input,
  SegmentedControl,
  ErrorAlert,
  EmptyState,
  StatCard,
  RelativeTime,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { FirecrawlStatusBanner } from '../components/research/FirecrawlStatusBanner'
import { ResearchSnippetCard } from '../components/research/ResearchSnippetCard'
import { ResearchSessionTable } from '../components/research/ResearchSessionTable'
import type {
  FirecrawlConfig,
  SearchResponse,
  SessionRow,
} from '../components/research/types'

type TabId = 'search' | 'history'
type SessionMode = 'all' | 'search' | 'scrape'
type SessionAge = 'all' | '24h' | '7d'

interface ResearchStats {
  sessions: number
  snippets: number
  attached: number
  lastSessionAt: string | null
}

const TABS: Array<{ id: TabId; label: string; description: string }> = [
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

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'search'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

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

  const sessionsPath = activeProjectId ? '/v1/admin/research/sessions?limit=50' : null
  const statsPath = activeProjectId ? '/v1/admin/research/stats' : null
  const firecrawlPath = activeProjectId ? '/v1/admin/byok/firecrawl' : null

  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    reload: loadHistory,
    lastFetchedAt,
    isValidating,
  } = usePageData<{ sessions: SessionRow[] }>(sessionsPath, { deps: [activeProjectId] })

  const {
    data: statsData,
    reload: reloadStats,
  } = usePageData<ResearchStats>(statsPath, { deps: [activeProjectId] })

  const {
    data: firecrawlData,
    loading: firecrawlLoading,
    reload: reloadFirecrawl,
  } = usePageData<FirecrawlConfig | null>(firecrawlPath, { deps: [activeProjectId] })

  const sessions = historyData?.sessions ?? []
  const stats = statsData ?? { sessions: 0, snippets: 0, attached: 0, lastSessionAt: null }
  const firecrawlReady =
    Boolean(firecrawlData?.configured) &&
    (!firecrawlData?.testStatus || firecrawlData.testStatus === 'ok')

  const reloadAll = useCallback(() => {
    loadHistory()
    reloadStats()
    reloadFirecrawl()
  }, [loadHistory, reloadStats, reloadFirecrawl])

  useRealtimeReload(['research_sessions', 'research_snippets'], reloadAll)

  const setTab = useCallback((tab: TabId) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'search') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }, [searchParams, setSearchParams])

  usePublishPageContext({
    route: '/research',
    title: `${activeMeta.label} · Research`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.attached,
  })

  const tabOptions = useMemo(() => [
    { id: 'search' as const, label: 'Search' },
    { id: 'history' as const, label: 'History', count: sessions.length },
  ], [sessions.length])

  async function runSearch(q: string) {
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
      setTab('search')
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
  }

  async function loadSession(id: string) {
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
      setTab('search')
    } else {
      toast.error('Failed to load session', res.error?.message)
    }
  }

  async function attach(snippetId: string) {
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
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Research"
        description="Firecrawl web search during triage — find docs, threads, and changelogs, then attach snippets as report evidence."
      >
        {activeTab === 'search' && (
          <Btn
            variant="primary"
            disabled={!activeProjectId || searching || !firecrawlReady}
            loading={searching}
            onClick={() => void runSearch(query)}
            title={
              !activeProjectId
                ? 'Select a project first'
                : !firecrawlReady
                  ? 'Configure and test Firecrawl first'
                  : undefined
            }
          >
            Search web
          </Btn>
        )}
      </PageHeader>

      <PageHelp
        title="About Research"
        whatIsIt="BYOK Firecrawl-powered web search you run during triage. Look up release notes for a stubborn report, find Stack Overflow threads matching an error signature, or pull a vendor changelog into the report's evidence trail."
        useCases={[
          'Cross-reference an error signature against current upstream docs.',
          'Find a Stack Overflow thread to attach as triage evidence.',
          'Check if a third-party library shipped a fix in the last 24 hours.',
        ]}
        howToUse="Press Enter to search. Click Attach evidence on any snippet and paste a report UUID from Reports. Sessions persist per project — reopen them from History. Configure Firecrawl under Settings → Firecrawl (allow-list domains and page cap)."
      />

      {!activeProjectId ? (
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Research sessions and Firecrawl settings are scoped to the active project in the header."
        />
      ) : (
        <FirecrawlStatusBanner
          config={firecrawlData ?? null}
          loading={firecrawlLoading}
          projectName={projectName}
        />
      )}

      <Section
        title="Research workspace"
        freshness={{ at: lastFetchedAt, isValidating }}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Sessions" value={stats.sessions} hint="Saved Firecrawl queries" />
          <StatCard label="Snippets" value={stats.snippets} hint="Web results returned" />
          <StatCard
            label="Attached"
            value={stats.attached}
            hint="Linked to reports as evidence"
          />
          <StatCard
            label="Firecrawl"
            value={firecrawlLoading ? '…' : firecrawlReady ? 'Ready' : 'Setup'}
            hint={
              firecrawlReady
                ? (firecrawlData?.keyHint ?? 'Key configured')
                : 'Configure BYOK in Settings'
            }
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={setTab}
          options={tabOptions}
          ariaLabel="Research sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {!activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Pick a project in the header to search the web and view session history."
          />
        ) : activeTab === 'search' ? (
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
                disabled={searching || !firecrawlReady}
              />
              <Btn
                type="submit"
                variant="primary"
                disabled={searching || !firecrawlReady}
                loading={searching}
                className="shrink-0 sm:self-end"
              >
                Search
              </Btn>
            </form>

            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-3xs text-fg-faint">Try:</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQuery(s)
                    void runSearch(s)
                  }}
                  disabled={searching || !firecrawlReady}
                  className="rounded-sm border border-edge bg-surface-raised px-1.5 py-0.5 font-mono text-2xs text-fg-muted hover:text-fg-secondary disabled:opacity-50"
                  title="Run this example query"
                >
                  {s}
                </button>
              ))}
            </div>

            {!firecrawlReady && !firecrawlLoading && (
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
                    <p className="text-2xs text-fg-muted">
                      Session {active.sessionId.slice(0, 8)}… ·{' '}
                      <RelativeTime value={active.createdAt} />
                    </p>
                  </div>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setActive(null)}
                  >
                    Clear results
                  </Btn>
                </div>

                {active.results.length === 0 ? (
                  <EmptyState
                    title="No results returned"
                    description="Try a broader query or relax the domain allow-list in Settings → Firecrawl."
                    hints={[
                      'Check allowed domains include the site you expect',
                      `Page cap is ${firecrawlData?.maxPagesPerCall ?? 5} results per call`,
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

            {!active && firecrawlReady && stats.lastSessionAt && (
              <p className="text-2xs text-fg-muted">
                Last search{' '}
                <RelativeTime value={stats.lastSessionAt} />
                {' · '}
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() => setTab('history')}
                >
                  View history
                </button>
              </p>
            )}
          </div>
        ) : (
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
      </Section>
    </div>
  )
}
