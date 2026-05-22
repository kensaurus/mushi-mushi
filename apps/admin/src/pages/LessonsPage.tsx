/**
 * FILE: apps/admin/src/pages/LessonsPage.tsx
 * PURPOSE: Mistake clusters + learning rules (lessons) management.
 *   Phase 1d of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Lessons      — promoted learning rules table, retire/restore, test query
 *     Clusters     — raw mistake clusters; promote manually, view members
 *     Query Sim    — paste a diff, see what rules would be injected (lessons.query)
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useLessonsUx, resolveQuickLessonsTab } from '../lib/lessonsModeUx'
import {
  PageHeader,
  PageHelp,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  SegmentedControl,
  Section,
  StatCard,
  FreshnessPill,
  RecommendedAction,
  Card,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { LessonsStatusBanner } from '../components/lessons/LessonsStatusBanner'
import {
  EMPTY_LESSONS_STATS,
  type LessonsStats,
  type LessonsTabId,
} from '../components/lessons/LessonsStatsTypes'
import { IconIntelligence, IconShield, IconChevronRight } from '../components/icons'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import {
  activeLessonsDetail,
  activeLessonsTooltip,
  candidatesDetail,
  candidatesTooltip,
  criticalLessonsDetail,
  criticalLessonsTooltip,
  highCoherenceDetail,
  highCoherenceTooltip,
  promotedClustersDetail,
  promotedClustersTooltip,
  reportsClusteredDetail,
  reportsClusteredTooltip,
} from '../lib/statTooltips/lessons'
import { lessonsLinks } from '../lib/statCardLinks'

// ─── Types ────────────────────────────────────────────────────

interface Lesson {
  id: string
  rule_text: string
  anti_pattern: string | null
  summary_paragraph: string | null
  severity: 'info' | 'warn' | 'critical'
  frequency: number
  last_reinforced_at: string
  promoted_at: string
  retired_at: string | null
  cluster_id: string | null
  mistake_clusters?: {
    name: string | null
    status: string
    judge_coherence_score: number | null
    cluster_size: number
  } | null
}

interface Cluster {
  id: string
  project_id: string
  cluster_size: number
  severity_distribution: Record<string, number>
  first_seen_at: string
  last_seen_at: string
  status: 'candidate' | 'promoted' | 'retired'
  name: string | null
  summary: string | null
  suggested_rule: string | null
  judge_coherence_score: number | null
}

interface QueryResult {
  lessons: Array<Lesson & { final_score: number; similarity: number }>
  tokens_used: number
  total_candidates: number
}

/** List routes return `{ ok, data: T[], meta }`; usePageData exposes `data` as `T[]`. */
function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

// ─── Severity pill ─────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === 'critical'
      ? 'bg-danger/10 text-danger border border-danger/20'
      : severity === 'warn'
        ? 'bg-warn/10 text-warn border border-warn/20'
        : 'bg-info/10 text-info border border-info/20'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {severity}
    </span>
  )
}

// ─── Tab bar (URL-driven) ─────────────────────────────────────

const TABS: Array<{ id: LessonsTabId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Posture banner and how mistake memory feeds PR review.' },
  { id: 'lessons',  label: 'Lessons',   description: 'Promoted learning rules — encoded mistake memory for your codebase.' },
  { id: 'clusters', label: 'Clusters',  description: 'Vector-clustered groups of similar bug reports awaiting promotion.' },
  { id: 'query',    label: 'Query Sim', description: 'Paste a diff and preview which rules would be injected by lessons.query.' },
]

function resolveLessonsTab(value: string | null): LessonsTabId {
  if (value === 'lessons' || value === 'clusters' || value === 'query') return value
  return 'overview'
}

// ─── Lessons tab ─────────────────────────────────────────────

function LessonsTab() {
  const { data, loading, error, reload } = usePageData<{ data: Lesson[]; meta: { total: number } }>(
    '/v1/admin/lessons?limit=100',
  )
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)
  const [retiring, setRetiring] = useState<string | null>(null)
  const toast = useToast()
  const [showRetired, setShowRetired] = useState<'active' | 'retired'>('active')

  const { data: retiredData } = usePageData<{ data: Lesson[] }>(
    showRetired === 'retired' ? '/v1/admin/lessons?limit=100&retired=true' : null,
  )

  const lessons = showRetired === 'active'
    ? listRows(data)
    : listRows(retiredData)

  const handleRetire = useCallback(async (id: string, currentlyRetired: boolean) => {
    setRetiring(id)
    try {
      const res = await apiFetch(`/v1/admin/lessons/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ retired: !currentlyRetired }),
      }) as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Failed')
      toast.success(currentlyRetired ? 'Lesson restored' : 'Lesson retired')
      reload?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRetiring(null)
    }
  }, [reload])

  if (error) return <ErrorAlert message={error} />

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-zinc-500">
            Promoted learning rules derived from clustered bug reports.
            Injected into PR review context via the <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">lessons.query</code> MCP tool.
          </p>
        </div>
        <SegmentedControl
          value={showRetired}
          onChange={(v) => setShowRetired(v as 'active' | 'retired')}
          options={[
            { id: 'active', label: 'Active' },
            { id: 'retired', label: 'Retired' },
          ]}
        />
      </div>

      {loading && <TableSkeleton rows={8} />}

      {!loading && lessons.length === 0 && (
        <EmptyState
          icon={<IconIntelligence className="w-8 h-8" />}
          title="No lessons yet"
          description="Lessons are promoted automatically when a mistake cluster reaches coherence ≥ 0.75 and has ≥ 3 reports. Run the mistake-clusterer function or submit more reports."
        />
      )}

      {lessons.length > 0 && (
        <div className="space-y-2">
          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              className="flex items-start gap-3 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
              onClick={() => setSelectedLesson(lesson)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <SeverityBadge severity={lesson.severity} />
                  <span className="text-xs text-zinc-400">freq: {lesson.frequency}</span>
                  {lesson.mistake_clusters?.name && (
                    <span className="text-xs text-zinc-400">
                      cluster: {lesson.mistake_clusters.name}
                    </span>
                  )}
                  {lesson.retired_at && (
                    <Badge className="bg-muted text-muted-foreground">retired</Badge>
                  )}
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2">
                  {lesson.rule_text}
                </p>
                {lesson.anti_pattern && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                    Anti-pattern: {lesson.anti_pattern}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-zinc-400 hidden sm:block">
                  <RelativeTime value={lesson.last_reinforced_at} />
                </span>
                <button
                  className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-2 py-1 rounded border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRetire(lesson.id, !!lesson.retired_at)
                  }}
                  disabled={retiring === lesson.id}
                >
                  {lesson.retired_at ? 'Restore' : 'Retire'}
                </button>
                <IconChevronRight className="w-4 h-4 text-zinc-400" />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedLesson && (
        <Drawer
          open={!!selectedLesson}
          title={selectedLesson.mistake_clusters?.name ?? 'Lesson detail'}
          onClose={() => setSelectedLesson(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={selectedLesson.severity} />
              <span className="text-xs text-zinc-400">frequency: {selectedLesson.frequency}</span>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Rule</h3>
              <pre className="text-sm bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg whitespace-pre-wrap border border-zinc-200 dark:border-zinc-700">
                {selectedLesson.rule_text}
              </pre>
            </div>
            {selectedLesson.anti_pattern && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Anti-pattern</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{selectedLesson.anti_pattern}</p>
              </div>
            )}
            {selectedLesson.summary_paragraph && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Summary</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{selectedLesson.summary_paragraph}</p>
              </div>
            )}
            {selectedLesson.cluster_id && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Cluster</h3>
                <p className="text-xs font-mono text-zinc-400">{selectedLesson.cluster_id}</p>
                {selectedLesson.mistake_clusters && (
                  <div className="mt-1 text-xs text-zinc-500">
                    Coherence: {((selectedLesson.mistake_clusters.judge_coherence_score ?? 0) * 100).toFixed(0)}%
                    · Size: {selectedLesson.mistake_clusters.cluster_size} reports
                  </div>
                )}
              </div>
            )}
            <div className="pt-2 flex gap-2">
              <Btn
                size="sm"
                variant={selectedLesson.retired_at ? 'ghost' : 'danger'}
                onClick={() => {
                  handleRetire(selectedLesson.id, !!selectedLesson.retired_at)
                  setSelectedLesson(null)
                }}
              >
                {selectedLesson.retired_at ? 'Restore lesson' : 'Retire lesson'}
              </Btn>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  )
}

// ─── Clusters tab ─────────────────────────────────────────────

function ClustersTab() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'candidate' | 'promoted'>('candidate')
  const { data, loading, error } = usePageData<{ data: Cluster[]; meta: { total: number } }>(
    `/v1/admin/clusters?limit=100${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`,
  )
  const [promoting, setPromoting] = useState<string | null>(null)
  const toast = useToast()

  const clusters = listRows(data)

  const handlePromote = useCallback(async (cluster: Cluster) => {
    if (!cluster.suggested_rule) {
      toast.error('No suggested rule available — add reports first')
      return
    }
    setPromoting(cluster.id)
    try {
      const res = await apiFetch(`/v1/admin/clusters/${cluster.id}/promote`, {
        method: 'POST',
        body: JSON.stringify({ rule_text: cluster.suggested_rule }),
      }) as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Failed')
      toast.success('Cluster promoted to lesson')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPromoting(null)
    }
  }, [toast])

  if (error) return <ErrorAlert message={error} />

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-zinc-500">
          Vector-clustered groups of similar bug reports. Candidates with ≥ 3 reports and coherence ≥ 0.75 auto-promote to lessons every 6 hours.
        </p>
        <SegmentedControl
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          options={[
            { id: 'candidate', label: 'Candidates' },
            { id: 'promoted', label: 'Promoted' },
            { id: 'all', label: 'All' },
          ]}
        />
      </div>

      {loading && <TableSkeleton rows={6} />}

      {!loading && clusters.length === 0 && (
        <EmptyState
          icon={<IconShield className="w-8 h-8" />}
          title="No clusters yet"
          description="Clusters form automatically as bug reports accumulate. Submit reports or trigger the mistake-clusterer function."
        />
      )}

      <div className="space-y-2">
        {clusters.map((cluster) => (
          <div
            key={cluster.id}
            className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge
                    className={cluster.status === 'promoted' ? 'bg-ok-muted/20 text-ok' : cluster.status === 'candidate' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}
                  >
                    {cluster.status}
                  </Badge>
                  <span className="text-xs text-zinc-400">{cluster.cluster_size} reports</span>
                  {cluster.judge_coherence_score !== null && (
                    <span className="text-xs text-zinc-400">
                      coherence: {(cluster.judge_coherence_score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {cluster.name ?? <span className="text-zinc-400 italic">Unnamed cluster</span>}
                </p>
                {cluster.suggested_rule && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                    Suggested rule: {cluster.suggested_rule}
                  </p>
                )}
                <p className="text-xs text-zinc-400 mt-1">
                  Last seen: <RelativeTime value={cluster.last_seen_at} />
                </p>
              </div>
              {cluster.status === 'candidate' && cluster.cluster_size >= 3 && (
                <Btn
                  size="sm"
                  variant="ghost"
                  loading={promoting === cluster.id}
                  onClick={() => handlePromote(cluster)}
                >
                  Promote
                </Btn>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Query Simulator tab ──────────────────────────────────────

function QuerySimTab() {
  const [diffText, setDiffText] = useState('')
  const [maxTokens, setMaxTokens] = useState(3000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const handleQuery = useCallback(async () => {
    if (!diffText.trim()) {
      toast.error('Paste a code diff or description first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/v1/admin/lessons/query', {
        method: 'POST',
        body: JSON.stringify({ diff_text: diffText, max_tokens: maxTokens, top_k: 15 }),
      }) as { ok: boolean; data?: QueryResult; error?: string }
      if (!res.ok) throw new Error(res.error ?? 'Query failed')
      setResult(res.data ?? null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [diffText, maxTokens])

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Simulate the <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">lessons.query</code> MCP call.
        Paste a PR diff or code description and see which lessons would be injected into the review context.
      </p>

      <div>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          Code diff or description
        </label>
        <textarea
          value={diffText}
          onChange={(e) => setDiffText(e.target.value)}
          placeholder="Paste a PR diff, file contents, or description of the change..."
          className="w-full h-40 px-3 py-2 text-sm font-mono border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
            Token budget:
          </label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Math.min(8000, Math.max(100, parseInt(e.target.value) || 3000)))}
            className="w-24 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
          />
        </div>
        <Btn loading={loading} onClick={handleQuery}>
          Query lessons
        </Btn>
      </div>

      {error && <ErrorAlert message={error} />}

      {result && (
        <div>
          <div className="flex items-center gap-3 mb-3 text-sm text-zinc-500">
            <span>{result.lessons.length} lessons returned</span>
            <span>·</span>
            <span>~{result.tokens_used} tokens used</span>
            <span>·</span>
            <span>{result.total_candidates} candidates considered</span>
          </div>
          <div className="space-y-3">
            {result.lessons.map((lesson, i) => (
              <div
                key={lesson.id}
                className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-zinc-400">#{i + 1}</span>
                  <SeverityBadge severity={lesson.severity} />
                  <span className="text-xs text-zinc-400">
                    score: {(lesson.final_score * 100).toFixed(0)}% · similarity: {(lesson.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-zinc-800 dark:text-zinc-200">{lesson.rule_text}</p>
                {lesson.anti_pattern && (
                  <p className="text-xs text-zinc-500 mt-1">Anti-pattern: {lesson.anti_pattern}</p>
                )}
              </div>
            ))}
            {result.lessons.length === 0 && (
              <p className="text-sm text-zinc-400 text-center py-4">No matching lessons found. Add more reports to build the lesson library.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────

export function LessonsPage() {
  const copy = usePageCopy('/lessons')
  const ux = useLessonsUx()
  const projectId = useActiveProjectId()
  const setup = useSetupStatus(projectId)
  const projectName = setup.activeProject?.project_name ?? null
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveLessonsTab(tabParam)
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<LessonsStats>('/v1/admin/lessons/stats')
  const stats = { ...EMPTY_LESSONS_STATS, ...statsData }

  const setActiveTab = useCallback(
    (tab: LessonsTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickLessonsTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'clusters' && stats.readyToPromote > 0
            ? stats.readyToPromote
            : t.id === 'lessons' && stats.criticalLessons > 0
              ? stats.criticalLessons
              : undefined,
      })),
    [copy?.tabLabels, stats.readyToPromote, stats.criticalLessons],
  )

  usePublishPageContext({
    route: '/lessons',
    title: projectName ? `Lessons · ${projectName}` : 'Lessons',
    summary: statsLoading
      ? 'Loading lesson memory…'
      : stats.activeLessons === 0 && stats.candidateClusters === 0
        ? 'No clusters or lessons yet'
        : `${stats.activeLessons} active · ${stats.candidateClusters} candidate clusters`,
    criticalCount: stats.criticalLessons,
    questions: stats.activeLessons > 0
      ? [
          'Which lessons would fire on my latest PR diff?',
          'What mistake patterns are we missing from the library?',
        ]
      : ['How do mistake clusters become promoted lessons?'],
  })

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading lessons">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load lessons stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'critical_lessons'
        ? 'danger'
        : stats.topPriority === 'candidates_ready' || stats.topPriority === 'no_lessons'
          ? 'warn'
          : stats.topPriority === 'no_data'
            ? 'brand'
            : stats.topPriority === 'healthy'
              ? 'ok'
              : 'info'

  return (
    <div className="space-y-4" data-testid="mushi-page-lessons">
      <PageHelp
        title={copy?.help?.title ?? 'About Lessons'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Lessons are the institutional memory of your project — named classes of bugs that have recurred ≥ 3 times, been judged coherent by the LLM judge, and promoted to permanent rules.'}
        useCases={copy?.help?.useCases ?? [
          'Inject relevant lessons into PR review context via the lessons.query MCP tool',
          'Test what rules a diff would trigger using the Query Sim tab',
          'Export active lessons to .mushi/lessons.json for offline CI use',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Browse promoted lessons, retire obsolete ones, or run mushi sync-lessons to sync to your repo. Clusters auto-promote when coherence ≥ 0.75 and size ≥ 3.'}
      />

      <PageHeader
        title={copy?.title ?? 'Lessons'}
        projectScope={stats.projectName ?? projectName ?? undefined}
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger/10 text-danger'
                : bannerSeverity === 'warn'
                  ? 'bg-warn/10 text-warn'
                  : bannerSeverity === 'brand'
                    ? 'bg-brand/15 text-brand'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.topPriority === 'critical_lessons'
              ? `${stats.criticalLessons} CRIT`
              : stats.readyToPromote > 0
                ? `${stats.readyToPromote} READY`
                : stats.activeLessons === 0 && stats.candidateClusters === 0
                  ? 'EMPTY'
                  : `${stats.activeLessons} ACTIVE`}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadStats} loading={statsValidating}>
          Refresh
        </Btn>
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Banner + LESSONS SNAPSHOT — Overview for posture, Lessons for rules, Clusters to promote, Query Sim to preview injection.'}
        </p>
      </ContainedBlock>

      <LessonsStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadStats}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<LessonsTabId>
        size="sm"
        ariaLabel="Lessons sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideLessonsSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'LESSONS SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.activeLessons ?? 'Active lessons'} value={stats.activeLessons} accent={stats.activeLessons > 0 ? 'text-ok' : undefined} tooltip={activeLessonsTooltip(stats)} detail={activeLessonsDetail(stats)} to={lessonsLinks.activeLessons} />
          <StatCard label={copy?.statLabels?.critical ?? 'Critical'} value={stats.criticalLessons} accent={stats.criticalLessons > 0 ? 'text-danger' : 'text-ok'} tooltip={criticalLessonsTooltip(stats)} detail={criticalLessonsDetail()} to={lessonsLinks.critical} />
          <StatCard label={copy?.statLabels?.candidates ?? 'Candidates'} value={stats.candidateClusters} accent={stats.candidateClusters > 0 ? 'text-warn' : undefined} tooltip={candidatesTooltip(stats)} detail={candidatesDetail(stats)} to={lessonsLinks.candidates} />
          <StatCard label={copy?.statLabels?.promoted ?? 'Promoted clusters'} value={stats.promotedClusters} accent={stats.promotedClusters > 0 ? 'text-brand' : undefined} tooltip={promotedClustersTooltip(stats)} detail={promotedClustersDetail()} to={lessonsLinks.promoted} />
          <StatCard label={copy?.statLabels?.reportsClustered ?? 'Reports clustered'} value={stats.totalClusterReports} accent={stats.totalClusterReports > 0 ? 'text-brand' : undefined} tooltip={reportsClusteredTooltip(stats)} detail={reportsClusteredDetail()} to={lessonsLinks.reportsClustered} />
          <StatCard label={copy?.statLabels?.highCoherence ?? 'High coherence'} value={stats.highCoherenceCandidates} accent={stats.highCoherenceCandidates > 0 ? 'text-ok' : undefined} tooltip={highCoherenceTooltip(stats)} detail={highCoherenceDetail()} to={lessonsLinks.highCoherence} />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'critical_lessons'
              ? 'border-danger/30 bg-danger/5'
              : stats.topPriority === 'no_data'
                ? 'border-brand/30 bg-brand/5'
                : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'critical_lessons'
                ? 'danger'
                : stats.topPriority === 'no_data'
                  ? 'brand'
                  : 'warn'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone={stats.topPriority === 'critical_lessons' ? 'warn' : 'info'}>
            <p className="text-xs font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {!ux.hideOverviewChrome && stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Lesson library is active"
              description={`${stats.activeLessons} promoted rules feeding PR context · ${stats.candidateClusters} clusters still forming.`}
            />
          )}
          {!ux.hideOverviewChrome && stats.topPriority === 'no_data' && (
            <RecommendedAction
              tone="info"
              title="Seed mistake memory with reports"
              description="Clusters form automatically as similar bug reports accumulate. Triage and classify reports first — the clusterer runs every 6 hours."
              cta={{ label: 'Open Reports', to: '/reports' }}
            />
          )}
          {!ux.hideOverviewChrome && (stats.topPriority === 'candidates_ready' || stats.topPriority === 'no_lessons') && (
            <RecommendedAction
              tone="info"
              title="Promote a cluster to a lesson"
              description={stats.topPriorityLabel ?? 'Review candidate clusters and promote when coherence ≥ 75%.'}
            />
          )}
        </div>
      )}

      {activeTab === 'lessons' && <LessonsTab />}
      {activeTab === 'clusters' && <ClustersTab />}
      {activeTab === 'query' && <QuerySimTab />}
    </div>
  )
}
