import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { QueryStatusBanner } from '../components/query/QueryStatusBanner'
import { QueryGuide } from '../components/query/QueryGuide'
import { QuerySnapshotStrip } from '../components/query/QuerySnapshotStrip'
import { QueryReadout } from '../components/query/QueryReadout'
import { QueryCopyButton } from '../components/query/QueryCopyButton'
import { QueryResultsTable } from '../components/query/QueryResultsTable'
import { HistoryItem, TeamItem } from '../components/query/QueryHistoryPanel'
import { QueryPromptLibrary, PROMPT_CATEGORIES } from '../components/query/QueryPromptLibrary'
import {
  EMPTY_QUERY_STATS,
  type HistoryRow,
  type QueryMode,
  type QueryStats,
  type QueryTabId,
  type TeamRow,
} from '../components/query/types'
import { SetupNudge } from '../components/SetupNudge'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  Card,
  Btn,
  Loading,
  Skeleton,
  ErrorAlert,
  SegmentedControl,
  Kbd,
  Tooltip,
  Badge,
  Section,
} from '../components/ui'
import {
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { useToast } from '../lib/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { CHIP_TONE } from '../lib/chipTone'

interface QueryResult {
  sql: string
  explanation?: string
  results: unknown[]
  summary?: string
  latencyMs?: number
  rowCount?: number
}

interface RunItem {
  id: string
  question: string
  mode: QueryMode
  result?: QueryResult
  error?: string
  latencyMs?: number
}

type SidebarTab = 'saved' | 'recent' | 'team'

// Approved tables for raw SQL mode — mirrors the backend APPROVED_TABLES set.
// Shown in the schema reference panel so users know what to query.
const SCHEMA_REFERENCE = [
  {
    table: 'reports',
    columns: 'id, project_id, status, category, severity, summary, component, description, confidence, created_at, judge_score, bug_ontology_tags, fix_pr_url, fixed_at, app_version, sdk_version',
    note: 'severity: critical=P0, high=P1, medium=P2, low=P3',
  },
  {
    table: 'report_groups',
    columns: 'id, project_id, canonical_report_id, status, report_count, created_at',
    note: null,
  },
  {
    table: 'classification_evaluations',
    columns: 'id, project_id, report_id, judge_score, accuracy_score, severity_score, component_score, repro_score, created_at',
    note: null,
  },
  {
    table: 'reporter_reputation',
    columns: 'id, project_id, reporter_token_hash, reputation_score, total_points, confirmed_bugs, dismissed_reports, total_reports',
    note: null,
  },
  {
    table: 'fix_attempts',
    columns: 'id, report_id, project_id, agent, status, pr_url, files_changed, lines_changed, summary, started_at, completed_at',
    note: null,
  },
  {
    table: 'fix_verifications',
    columns: 'id, report_id, verification_status, visual_diff_score, verified_at',
    note: null,
  },
  {
    table: 'graph_nodes',
    columns: 'id, project_id, node_type, label, metadata, created_at',
    note: null,
  },
  {
    table: 'bug_ontology',
    columns: 'id, project_id, tag, parent_tag, description, usage_count',
    note: null,
  },
] as const

const RAW_SQL_TEMPLATE = `SELECT
  severity,
  COUNT(*) AS count
FROM reports
WHERE project_id = $1
  AND created_at >= date_trunc('week', now())
GROUP BY severity
ORDER BY count DESC
LIMIT 100`

const QUERY_TABS: Array<{ id: QueryTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Run health, snapshot KPIs, and query posture for the active project.',
  },
  {
    id: 'ask',
    label: 'Ask',
    description: 'Natural-language or raw SQL composer with live results and prompt library.',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved pins, recent runs, and teammate queries — rerun with one click.',
  },
  {
    id: 'schema',
    label: 'Schema',
    description: 'Approved read-only tables and columns — use $1 for project_id in raw SQL.',
  },
]

function isQueryTab(value: string | null): value is QueryTabId {
  return QUERY_TABS.some((t) => t.id === value)
}

export function QueryPage() {
  const copy = usePageCopy('/query')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: QueryTabId = isQueryTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = QUERY_TABS.find((t) => t.id === activeTab) ?? QUERY_TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/query/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<QueryStats>(statsPath)
  const stats = statsData ?? EMPTY_QUERY_STATS

  const toast = useToast()
  const [queryMode, setQueryMode] = useState<QueryMode>('nl')
  const [question, setQuestion] = useState('')
  const [rawSql, setRawSql] = useState(RAW_SQL_TEMPLATE)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [runs, setRuns] = useState<RunItem[]>([])
  const [pendingDeleteHistory, setPendingDeleteHistory] = useState<HistoryRow | null>(null)
  const [deletingHistory, setDeletingHistory] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('saved')
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    data: historyData,
    loading: historyLoading,
    reload: loadHistory,
    error: historyError,
  } = usePageData<{ history: HistoryRow[] }>(
    activeProjectId ? '/v1/admin/query/history?limit=25' : null,
  )
  const history = historyData?.history ?? []

  const {
    data: teamData,
    loading: teamLoading,
    reload: loadTeam,
    error: teamError,
  } = usePageData<{ team: TeamRow[] }>(
    activeProjectId ? '/v1/admin/query/team?limit=25' : null,
  )
  const team = teamData?.team ?? []

  const reloadAll = useCallback(() => {
    reloadStats()
    loadHistory()
    loadTeam()
  }, [reloadStats, loadHistory, loadTeam])

  useRealtimeReload(['nl_query_history'], reloadAll)

  const setActiveTab = useCallback(
    (id: QueryTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  async function handleSubmit(q?: string, overrideMode?: QueryMode) {
    const mode = overrideMode ?? queryMode
    const queryText = mode === 'raw'
      ? (q ?? rawSql).trim()
      : (q ?? question).trim()
    if (!queryText) return
    const id = `q${Date.now()}`
    setLoading(true)
    setRuns((prev) => [{ id, question: queryText, mode }, ...prev])
    if (mode === 'nl') setQuestion('')

    let res: Awaited<ReturnType<typeof apiFetch<QueryResult>>>
    if (mode === 'raw') {
      res = await apiFetch<QueryResult>('/v1/admin/query/raw', {
        method: 'POST',
        body: JSON.stringify({ sql: queryText }),
      })
    } else {
      res = await apiFetch<QueryResult>('/v1/admin/query', {
        method: 'POST',
        body: JSON.stringify({ question: queryText }),
      })
    }

    setLoading(false)
    if (res.ok && res.data) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, result: res.data, latencyMs: res.data?.latencyMs } : r,
        ),
      )
    } else {
      const err = res.error?.message ?? 'Query failed'
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, error: err } : r)))
      toast.error(mode === 'raw' ? 'SQL error' : 'Query failed', err)
    }
    loadHistory()
    loadTeam()
    reloadStats()
  }

  async function confirmDeleteHistory() {
    if (!pendingDeleteHistory) return
    setDeletingHistory(true)
    const res = await apiFetch(`/v1/admin/query/history/${pendingDeleteHistory.id}`, {
      method: 'DELETE',
    })
    setDeletingHistory(false)
    setPendingDeleteHistory(null)
    if (res.ok) {
      toast.success('Query removed from history')
      loadHistory()
    } else {
      toast.error('Failed to delete', res.error?.message)
    }
  }

  async function toggleSaved(row: HistoryRow) {
    const next = !(row.is_saved ?? false)
    const res = await apiFetch(`/v1/admin/query/history/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_saved: next }),
    })
    if (res.ok) {
      toast.success(next ? 'Pinned to Saved' : 'Unpinned from Saved')
      loadHistory()
      loadTeam()
    } else {
      toast.error('Could not update', res.error?.message)
    }
  }

  // Save the most recent run by re-issuing the prompt's history row PATCH —
  // we need its id, which is in the history list. Match by prompt text on
  // the most recent row (race-safe enough: the user just ran it). If the
  // history list is still loading, fall back to a no-op + toast so the
  // affordance never lies.
  async function saveQuestion(prompt: string) {
    const match = history.find((h) => h.prompt === prompt)
    if (!match) {
      toast.error('Could not save', 'History row not found yet — try again in a moment.')
      return
    }
    if (match.is_saved) return
    await toggleSaved(match)
  }

  const saved = useMemo(() => history.filter((h) => h.is_saved), [history])
  const recent = useMemo(() => history.filter((h) => !h.is_saved), [history])

  usePublishPageContext({
    route: '/query',
    title: `${activeTabMeta.label} · Ask Your Data`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.errors24h,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'ask' as const,
        label: 'Ask',
        count: stats.runs24h > 0 ? stats.runs24h : undefined,
      },
      {
        id: 'history' as const,
        label: 'History',
        count: saved.length + recent.length > 0 ? saved.length + recent.length : undefined,
      },
      { id: 'schema' as const, label: 'Schema' },
    ],
    [stats.runs24h, saved.length, recent.length],
  )

  // Map prompt → boolean so a run card can render "Saved" once the row
  // exists in history. Keyed by prompt text because the run-card only
  // owns the question string, not the eventual history-row id.
  const isSavedPrompt = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const h of history) map.set(h.prompt, !!h.is_saved)
    return map
  }, [history])

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeaderBar
          title={copy?.title ?? 'Ask Your Data'}

          helpTitle={copy?.help?.title ?? 'About Ask Your Data'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'Natural-language or raw SQL interface to approved bug tables — every run is sandboxed and logged.'
          }
          helpUseCases={copy?.help?.useCases ?? []}
          helpHowToUse={copy?.help?.howToUse ?? 'Use the Ask tab to run queries. History pins favorites. Schema lists approved tables.'}
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Queries are scoped per project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <TableSkeleton rows={5} columns={4} showFilters label="Loading query stats" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load query stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title={copy?.title ?? 'Ask Your Data'}
        projectScope={stats.projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About Ask Your Data'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Natural-language or raw SQL interface to approved bug tables — every run is sandboxed and logged.'
        }
        helpUseCases={copy?.help?.useCases ?? []}
        helpHowToUse={copy?.help?.howToUse ?? 'Use the Ask tab to run queries. History pins favorites. Schema lists approved tables.'}
      >
        <Badge className={stats.errors24h > 0 ? CHIP_TONE.dangerSubtle : stats.runs24h > 0 ? CHIP_TONE.okSubtle : CHIP_TONE.infoSubtle}>
          {stats.errors24h > 0 ? `${stats.errors24h} FAIL 24H` : stats.runs24h > 0 ? `${stats.runs24h} RUNS 24H` : 'READY'}
        </Badge>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: stats.schemaDegraded || stats.errors24h > 0,
            children: (
              <QueryStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onViewErrors={() => {
                  setActiveTab('history')
                  setSidebarTab('recent')
                }}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <QuerySnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'Query snapshot'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            children: <QueryGuide errors24h={stats.errors24h} />,
          },
        ]}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Query sections"
        size="sm"
      />

      {activeTab === 'overview' && (
        <QueryReadout
          stats={stats}
          fetchedAt={statsFetchedAt}
          isValidating={statsValidating}
        />
      )}

      {activeTab === 'schema' && (
        <Card className="p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider">Approved tables</div>
          <ContainedBlock tone="muted" className="mb-3">
            <p className="text-2xs leading-relaxed text-fg-muted">
              Raw SQL mode accepts SELECT-only statements. Bind your project with <code className="text-brand">$1</code> — max 100 rows returned.
            </p>
          </ContainedBlock>
          <div className="divide-y divide-edge-subtle/30 rounded-sm border border-edge-subtle overflow-hidden">
            {SCHEMA_REFERENCE.map((t) => (
              <div key={t.table} className="px-3 py-2 grid grid-cols-[7rem_1fr] gap-2 items-start bg-surface-raised border-b border-edge-subtle/30 last:border-b-0">
                <code className="text-2xs font-mono text-brand shrink-0">{t.table}</code>
                <span className="text-2xs text-fg-faint font-mono leading-relaxed">
                  {t.columns}
                  {t.note ? <span className="block text-info/80 not-italic mt-0.5">{t.note}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(activeTab === 'ask' || activeTab === 'history') && (
        <>
      {activeTab === 'ask' && (
      <>
      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <Card className="p-4 md:p-5 border-brand/20 bg-gradient-to-b from-brand/[0.04] to-transparent">
        {/* Mode toggle */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="inline-flex items-center gap-0.5 rounded-sm border border-edge-subtle bg-surface-raised p-0.5">
            <Btn
              variant={queryMode === 'nl' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setQueryMode('nl')}
              aria-pressed={queryMode === 'nl'}
              className={`px-3 py-1 rounded-[2px] text-2xs shadow-none hover:-translate-y-0 ${
                queryMode === 'nl'
                  ? ''
                  : 'border-0 bg-transparent hover:bg-surface-overlay/50'
              }`}
            >
              Natural language
            </Btn>
            <Btn
              variant={queryMode === 'raw' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => { setQueryMode('raw'); setTimeout(() => rawTextareaRef.current?.focus(), 0) }}
              aria-pressed={queryMode === 'raw'}
              className={`px-3 py-1 rounded-[2px] text-2xs shadow-none hover:-translate-y-0 ${
                queryMode === 'raw'
                  ? ''
                  : 'border-0 bg-transparent hover:bg-surface-overlay/50'
              }`}
            >
              Raw SQL
            </Btn>
          </div>
          {queryMode === 'raw' && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => setSchemaOpen((o) => !o)}
              aria-expanded={schemaOpen}
              className="text-2xs inline-flex items-center gap-1 hover:-translate-y-0"
            >
              {schemaOpen ? '▾' : '▸'} Schema
            </Btn>
          )}
        </div>

        {/* Schema reference — shown only in raw SQL mode */}
        {queryMode === 'raw' && schemaOpen && (
          <div className="mb-3 rounded-sm border border-edge-subtle bg-surface-raised/50 overflow-hidden">
            <div className="px-3 py-2 border-b border-edge-subtle/50 flex items-center justify-between">
              <span className="text-2xs font-medium text-fg-secondary">Approved tables · <code className="text-brand">$1</code> = your project_id</span>
              <span className="text-2xs text-fg-faint">severity: critical=P0 high=P1 medium=P2 low=P3</span>
            </div>
            <div className="divide-y divide-edge-subtle/30 max-h-48 overflow-y-auto">
              {SCHEMA_REFERENCE.map((t) => (
                <div key={t.table} className="px-3 py-1.5 grid grid-cols-[7rem_1fr] gap-2 items-start">
                  <code className="text-2xs font-mono text-brand shrink-0">{t.table}</code>
                  <span className="text-2xs text-fg-faint font-mono leading-relaxed">
                    {t.columns}
                    {t.note && <span className="block text-info/80 not-italic mt-0.5">{t.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3" data-dav-anchor="query:act">
          {queryMode === 'nl' ? (
            <>
              <label htmlFor="query-composer" className="block text-xs font-medium text-fg-muted">
                Ask a question about your bug data
              </label>
              <div className="flex gap-2 items-stretch">
                <textarea
                  id="query-composer"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
                  }}
                  placeholder="e.g. How many P0/P1 reports landed this week vs last week?"
                  disabled={loading}
                  rows={2}
                  className="flex-1 min-w-0 bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors resize-y"
                  aria-label="Question composer"
                />
                <Btn
                  onClick={() => handleSubmit()}
                  disabled={loading || !question.trim()}
                  loading={loading}
                  className="px-6 text-sm shrink-0 self-stretch"
                >
                  {loading ? 'Running…' : 'Ask →'}
                </Btn>
              </div>
              <div className="flex items-center justify-between gap-2 text-2xs text-fg-faint flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd><span>to run</span>
                  <span className="opacity-40">·</span>
                  <span>Read-only · sandboxed · every query is logged</span>
                </span>
                {question.trim() && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuestion('')}
                    className="border-0 shadow-none px-0 py-0 text-2xs text-fg-faint hover:bg-transparent hover:-translate-y-0"
                  >
                    Clear
                  </Btn>
                )}
              </div>
            </>
          ) : (
            <>
              <label htmlFor="raw-sql-composer" className="block text-xs font-medium text-fg-muted">
                Write SQL directly — use <code className="text-brand">$1</code> for your project_id
              </label>
              <div className="flex gap-2 items-stretch">
                <textarea
                  id="raw-sql-composer"
                  ref={rawTextareaRef}
                  value={rawSql}
                  onChange={(e) => setRawSql(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmit() }
                  }}
                  disabled={loading}
                  rows={6}
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2.5 text-sm text-fg font-mono placeholder:text-fg-faint hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors resize-y"
                  aria-label="Raw SQL composer"
                />
                <Btn
                  onClick={() => handleSubmit()}
                  disabled={loading || !rawSql.trim()}
                  loading={loading}
                  className="px-6 text-sm shrink-0 self-stretch"
                >
                  {loading ? 'Running…' : 'Run →'}
                </Btn>
              </div>
              <div className="flex items-center justify-between gap-2 text-2xs text-fg-faint flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>⌘↵</Kbd><span>to run</span>
                  <span className="opacity-40">·</span>
                  <span>SELECT only · $1 = project_id · max 100 rows · every query is logged</span>
                </span>
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => setRawSql(RAW_SQL_TEMPLATE)}
                  className="border-0 shadow-none px-0 py-0 text-2xs text-fg-faint hover:bg-transparent hover:-translate-y-0"
                >
                  Reset template
                </Btn>
              </div>
            </>
          )}
        </div>

        {/* Quick-fire suggestion chips — NL mode only */}
        {queryMode === 'nl' && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-edge-subtle/50">
            {PROMPT_CATEGORIES.flatMap((c) => c.prompts)
              .slice(0, 5)
              .map((p) => (
                <Btn
                  key={p.prompt}
                  variant="ghost"
                  size="sm"
                  onClick={() => { setQuestion(p.prompt); handleSubmit(p.prompt, 'nl') }}
                  disabled={loading}
                  className="text-2xs px-2.5 py-1 rounded-full hover:bg-brand/10 hover:border-brand/30 hover:text-fg hover:-translate-y-0"
                >
                  {p.prompt.length > 48 ? p.prompt.slice(0, 48) + '…' : p.prompt}
                </Btn>
              ))}
          </div>
        )}
      </Card>
      </>
      )}

      <div className={`grid gap-3 ${activeTab === 'history' ? '' : 'md:grid-cols-[1fr_18rem]'}`}>
        {activeTab === 'ask' && (
        <div className="space-y-3 min-w-0">
          {/* Run results — live results push down, prompt library hides when runs exist */}
          {runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map((run) => {
                const alreadySaved = run.mode === 'nl' && (isSavedPrompt.get(run.question) ?? false)
                const rowCount = run.result?.results?.length ?? run.result?.rowCount ?? 0
                return (
                  <Card key={run.id} className="p-3 space-y-2">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {run.mode === 'raw' && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-2xs font-mono font-medium ${CHIP_TONE.warnSubtle} border border-warn/20`}>SQL</span>
                          )}
                          <p className="text-sm text-fg font-medium break-words line-clamp-3">
                            {run.question}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {run.latencyMs != null && (
                          <Badge title={run.mode === 'raw' ? 'Query latency' : 'LLM + SQL latency'}>
                            {run.latencyMs}ms
                          </Badge>
                        )}
                        {run.result && run.mode === 'nl' && (
                          <Tooltip content={alreadySaved ? 'Already in Saved' : 'Pin to Saved'} side="left">
                            <Btn
                              variant="ghost"
                              size="sm"
                              onClick={() => void saveQuestion(run.question)}
                              disabled={alreadySaved}
                              aria-label={alreadySaved ? 'Already saved' : 'Pin to Saved'}
                              className={`text-base border-0 shadow-none px-1 py-0 min-w-0 hover:bg-transparent hover:-translate-y-0 ${alreadySaved ? 'text-brand cursor-default' : 'text-fg-faint hover:text-brand'}`}
                            >
                              {alreadySaved ? '★' : '☆'}
                            </Btn>
                          </Tooltip>
                        )}
                        {run.result && (
                          <Btn variant="ghost" size="sm" onClick={() => handleSubmit(run.question, run.mode)} disabled={loading}>
                            Rerun
                          </Btn>
                        )}
                      </div>
                    </div>

                    {/* Loading */}
                    {!run.result && !run.error && (
                      <Loading text={run.mode === 'raw' ? 'Running SQL…' : 'Generating SQL and running…'} />
                    )}

                    {/* Error */}
                    {run.error && (
                      <ContainedBlock tone="warn">
                        <p className="text-xs text-danger">
                          <strong>Error.</strong> {run.error}
                        </p>
                      </ContainedBlock>
                    )}

                    {/* Success */}
                    {run.result && (
                      <>
                        {/* NL summary — prominent answer */}
                        {run.result.summary && (
                          <p className="text-sm text-fg leading-relaxed font-medium">{run.result.summary}</p>
                        )}
                        {run.result.explanation && (
                          <InlineProof className="italic -mt-1">{run.result.explanation}</InlineProof>
                        )}

                        {/* Results table (shown before SQL so users see data first) */}
                        {rowCount > 0 && (
                          <div className="rounded-sm border border-edge-subtle overflow-hidden">
                            <QueryResultsTable rows={run.result.results} />
                            <div className="flex items-center justify-between gap-2 border-t border-edge-subtle/50 bg-surface-raised px-3 py-1.5">
                              <SignalChip tone="neutral">
                                {rowCount} row{rowCount === 1 ? '' : 's'}
                              </SignalChip>
                            </div>
                          </div>
                        )}
                        {rowCount === 0 && !run.error && (
                          <EmptySectionMessage
                            text="Query ran successfully but returned 0 rows."
                            hint="Check your filters or date range."
                          />
                        )}

                        {/* SQL block — collapsible, open by default in raw mode */}
                        <div className="rounded-sm border border-edge-subtle/60 overflow-hidden">
                          <details open={run.mode === 'raw'}>
                            <summary className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-raised/50 cursor-pointer select-none hover:bg-surface-overlay/20 motion-safe:transition-colors group">
                              <span className="text-2xs font-mono text-fg-faint group-hover:text-fg-muted transition-colors">
                                ▸ SQL
                              </span>
                              <QueryCopyButton value={run.result.sql} label="Copy SQL" />
                            </summary>
                            <pre className="mushi-code-block mushi-code-body px-3 py-2.5 text-2xs font-mono overflow-x-auto whitespace-pre-wrap border-t border-code-surface-border max-h-56 leading-relaxed">
                              {run.result.sql}
                            </pre>
                          </details>
                        </div>
                      </>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : (
            queryMode === 'nl' ? (
              <QueryPromptLibrary
                onInsert={(p) => setQuestion(p)}
                onRun={(p) => { setQuestion(p); handleSubmit(p, 'nl') }}
              />
            ) : (
              <ContainedBlock tone="muted" className="py-4 text-center">
                <p className="text-2xs italic text-fg-muted">
                  Write a SQL query above and press <Kbd>⌘↵</Kbd> or click Run.
                </p>
              </ContainedBlock>
            )
          )}
        </div>
        )}

        <div className={`space-y-3 ${activeTab === 'history' ? '' : 'self-start'}`}>
          <Section title="Library">
            <SegmentedControl<SidebarTab>
              value={sidebarTab}
              onChange={setSidebarTab}
              ariaLabel="Switch between saved, recent, and team queries"
              size="sm"
              options={[
                { id: 'saved', label: 'Saved', count: saved.length },
                { id: 'recent', label: 'Recent', count: recent.length },
                { id: 'team', label: 'Team', count: team.length },
              ]}
              className="w-full justify-between"
            />

            <div className="mt-2">
              {sidebarTab === 'saved' && (
                <>
                  {historyLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading saved">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : saved.length === 0 ? (
                    <EmptySectionMessage
                      text="No saved queries yet"
                      hint="Pin a query (☆) and it shows up here for quick rerun."
                    />
                  ) : (
                    <ul className="space-y-1.5" data-dav-anchor="query:decide">
                      {saved.map((h) => (
                        <HistoryItem key={h.id} row={h} onRerun={() => handleSubmit(h.prompt, h.mode ?? 'nl')} onToggleSave={() => toggleSaved(h)} onDelete={() => setPendingDeleteHistory(h)} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {sidebarTab === 'recent' && (
                <>
                  {historyLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading recent">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : historyError ? (
                    <ErrorAlert message={`Could not load history: ${historyError}`} onRetry={loadHistory} />
                  ) : recent.length === 0 ? (
                    <EmptySectionMessage
                      text="No recent queries"
                      hint="Ask a question — the prompt + row count land here."
                    />
                  ) : (
                    <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto -mr-1 pr-1" data-dav-anchor="query:verify">
                      {recent.map((h) => (
                        <HistoryItem key={h.id} row={h} onRerun={() => handleSubmit(h.prompt, h.mode ?? 'nl')} onToggleSave={() => toggleSaved(h)} onDelete={() => setPendingDeleteHistory(h)} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {sidebarTab === 'team' && (
                <>
                  {teamLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading team queries">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : teamError ? (
                    <ErrorAlert message={`Could not load team queries: ${teamError}`} onRetry={loadTeam} />
                  ) : team.length === 0 ? (
                    <EmptySectionMessage
                      text="No team queries shared"
                      hint="When a teammate pins a query in their console it shows up here."
                    />
                  ) : (
                    <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto -mr-1 pr-1">
                      {team.map((row) => (
                        <TeamItem key={row.id} row={row} onRerun={() => handleSubmit(row.prompt, row.mode ?? 'nl')} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Section>
        </div>
      </div>
      </>
      )}

      {pendingDeleteHistory && (
        <ConfirmDialog
          title="Remove this query from history?"
          body={
            pendingDeleteHistory.is_saved
              ? 'This query is in your saved list. Removing it deletes both the saved bookmark and the run history. The original results are not stored — re-run to fetch them again.'
              : 'The history entry and its results will be deleted. Saved queries are not affected. You can always paste the prompt back in to re-run it.'
          }
          confirmLabel="Remove"
          cancelLabel="Keep"
          tone="danger"
          loading={deletingHistory}
          onConfirm={() => void confirmDeleteHistory()}
          onCancel={() => {
            if (!deletingHistory) setPendingDeleteHistory(null)
          }}
        />
      )}
    </div>
  )
}
