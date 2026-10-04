/**
 * FILE: apps/admin/src/pages/SkillPipelinesPage.tsx
 * PURPOSE: Skill Pipelines page — skill catalog browser + pipeline run list +
 *          live pipeline flow visualiser (React Flow).
 *
 * TABS:
 *   Catalog   — browse all 73+ skills from kenji skills, grouped by category.
 *               Clicking a skill opens a detail drawer with the full SKILL.md.
 *   Pipelines — list of all pipeline runs for the project with status chips.
 *               Clicking a run opens the live React Flow pipeline visualiser.
 *   Sources   — manage skill source repos (add kensaurus/skills or any
 *               skills.sh-compatible repo; trigger manual sync).
 *
 * REALTIME:
 *   skill_pipeline_step_runs is Realtime-enabled. The pipeline flow canvas
 *   subscribes to INSERT/UPDATE events and re-fetches the run on change,
 *   keeping step status rings live without polling.
 *
 * DEPENDENCIES:
 *   - useActiveProjectId, apiFetch, usePageData, useToast
 *   - skill_pipeline_runs, skill_pipeline_step_runs, agent_skills tables
 *   - React Flow (@xyflow/react)
 *   - SkillStepNode, pipelineFlow.data.ts
 *   - PdcaGradientEdge (reused from pdca-flow)
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePublishPageContext } from '../lib/pageContext'
import { IconSkills, IconQueue, IconGithub, IconClose } from '../components/icons'
import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { Card, SurfacePanel, HelpBanner, SegmentedControl, FreshnessPill, Btn } from '../components/ui'
import { LINK_ACCENT } from '../lib/chipTone'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Drawer } from '../components/Drawer'
import { useSkillsUx, resolveQuickSkillsTab } from '../lib/skillsModeUx'
import { useRealtime } from '../lib/realtime'
import { SkillStepNode } from '../components/skill-pipeline/SkillStepNode'
import { PdcaGradientEdge } from '../components/pdca-flow/PdcaGradientEdge'
import {
  buildPipelineNodes,
  buildPipelineEdges,
  STEP_STATUS_LABEL,
  resolveStepStatusColor,
} from '../components/skill-pipeline/pipelineFlow.data'
import type { PipelineStep, SkillInfo } from '../components/skill-pipeline/pipelineFlow.data'
import { getSkillCategoryMeta } from '../components/skill-pipeline/skillCategoryMeta'
import {
  SkillsStatusBanner,
  isSkillsBannerVisible,
} from '../components/skills/SkillsStatusBanner'
import { SkillsPipelineGuide } from '../components/skills/SkillsPipelineGuide'
import { SkillsSnapshotStrip } from '../components/skills/SkillsSnapshotStrip'
import { SkillsEndpointReadout } from '../components/skills/SkillsEndpointReadout'
import {
  EMPTY_SKILLS_STATS,
  type SkillsStats,
} from '../components/skills/SkillsStatsTypes'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageLoadError } from '../components/PageLoadError'
import {
  describePipelineCancel,
  nextCheckinStep,
  parseReportIdInput,
  pipelineCancelBody,
  resolveSkillsTab,
  type PipelineCancelResult,
  type SkillsTab,
} from '../lib/skillPipelines'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentSkill {
  id: string
  slug: string
  category: string
  title: string
  description: string
  chain_slugs: string[]
  license?: string
  body_md?: string
  updated_at: string
}

interface SkillSource {
  id: string
  repo_slug: string
  ref: string
  enabled: boolean
  last_synced_at: string | null
  last_synced_count: number | null
  last_sync_error: string | null
  catalog_count?: number
}

interface CloudReadiness {
  cursorKeyConfigured: boolean
  githubRepoConfigured: boolean
  cloudReady: boolean
}

interface PipelineRun {
  id: string
  report_id: string | null
  root_skill_slug: string
  chain_slugs: string[]
  mode: 'handoff' | 'cloud'
  status: string
  context_packet: string | null
  created_at: string
  finished_at: string | null
  skill_pipeline_step_runs?: PipelineStep[]
  steps?: PipelineStep[]
}

type Tab = SkillsTab

const TAB_META: Record<Tab, { label: string; Icon: typeof IconSkills }> = {
  catalog: { label: 'Skill Catalog', Icon: IconSkills },
  pipelines: { label: 'Pipeline Runs', Icon: IconQueue },
  sources: { label: 'Sources', Icon: IconGithub },
}

const NODE_TYPES = { skillStep: SkillStepNode }
const EDGE_TYPES = { pdcaGradient: PdcaGradientEdge }

const CATEGORY_ORDER = [
  'workflow', 'debug', 'test', 'audit', 'enhance', 'backend',
  'design', 'deploy', 'data', 'mobile', 'docs', 'mushi', 'meta', 'protocol', 'other',
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function SkillPipelinesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Unknown `?tab=` values fall back to the catalog instead of indexing
  // TAB_META with `undefined` and crashing the page.
  const tab = resolveSkillsTab(searchParams.get('tab'))
  const projectId = useActiveProjectId()
  const ux = useSkillsUx()
  const { push } = useToast()
  const addToast = (t: { type: string; message: string }) =>
    push({ tone: t.type as 'success' | 'error' | 'info' | 'warn', message: t.message })

  const setTab = (t: Tab, extra?: Record<string, string | undefined>) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', t)
      if (t !== 'catalog') next.delete('skill')
      if (t !== 'pipelines') next.delete('run')
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
      }
      return next
    }, { replace: true })

  const pipelineRunId = searchParams.get('run')

  const skillSlug = searchParams.get('skill')

  const statsPath = projectId ? `/v1/admin/skills/stats?project_id=${projectId}` : null
  const { data: skillsStatsData, lastFetchedAt: statsFetchedAt, isValidating: statsValidating } =
    usePageData<SkillsStats>(statsPath, { deps: [projectId] })
  usePublishPageHeroStats('/skills', skillsStatsData)
  const skillsStats = skillsStatsData ?? EMPTY_SKILLS_STATS

  useEffect(() => {
    if (!ux.isQuickstart || !projectId || statsValidating) return
    const quickTab = resolveQuickSkillsTab(skillsStats)
    if (tab !== quickTab) setTab(quickTab)
  }, [ux.isQuickstart, projectId, statsValidating, skillsStats, tab, setTab])

  usePublishPageContext({
    route: '/skills',
    title: TAB_META[tab].label,
    summary:
      tab === 'catalog'
        ? 'Browse agent skills from kenji skills by category'
        : tab === 'pipelines'
          ? 'Track handoff and cloud pipeline runs'
          : 'Sync SKILL.md repos into the catalog',
    questions: [
      'Which skill should I run for a UI audit?',
      'How do I attach a skill to a bug report?',
      'What is the difference between handoff and cloud mode?',
    ],
    actions: [
      {
        id: 'open-catalog',
        label: 'Open Skill Catalog',
        hint: 'Browse all agent skills — try Ctrl+K and type "catalog"',
        run: () => setTab('catalog'),
      },
      {
        id: 'open-pipelines',
        label: 'View pipeline runs',
        hint: 'See active and completed runs',
        run: () => setTab('pipelines'),
      },
      {
        id: 'try-uiux-audit',
        label: 'Try audit-uiux-design-system',
        hint: 'Popular design-system audit workflow',
        run: () => setTab('catalog', { skill: 'audit-uiux-design-system' }),
      },
      {
        id: 'open-sources',
        label: 'Manage skill sources',
        hint: 'Add or sync GitHub repos like kensaurus/skills',
        run: () => setTab('sources'),
      },
    ],
  })

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-skills">
      <PageHeaderBar
        title="Skill Pipelines"

        helpTitle="About Skill Pipelines"
        helpWhatIsIt="Browse the kenji skills catalog, attach skills to bug reports, and run handoff or cloud pipeline steps with live status."
        helpUseCases={[
          'Run audit-uiux-design-system or other skills against a report',
          'Track pipeline step runs in real time via React Flow',
          'Sync skill sources from GitHub repos like kensaurus/skills',
        ]}
        helpHowToUse="Pick Catalog to browse skills, Pipelines to watch runs, or Sources to sync repos. Start a handoff run from a skill card with a report ID."
      >
        {projectId ? (
          <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        ) : null}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: isSkillsBannerVisible(skillsStats),
            children: (
              <SkillsStatusBanner stats={skillsStats} onTab={setTab} plainBanner={ux.plainBanner} />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: Boolean(projectId) && !ux.hideSkillsSnapshot,
            children: (
              <SkillsSnapshotStrip
                stats={skillsStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                hint="Catalog size, active pipeline runs, and sync posture for kenji skills."
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: !shouldHideGuideWhenBannerActive(
              isSkillsBannerVisible(skillsStats),
              COMMON_HEALTHY_PRIORITIES,
              skillsStats.topPriority,
            ),
            children: <SkillsPipelineGuide topPriority={skillsStats.topPriority} stats={skillsStats} />,
          },
        ]}
      />

      {!ux.hideTabs && (
        <SegmentedControl<Tab>
          size="sm"
          scrollable
          ariaLabel="Skill pipelines sections"
          value={tab}
          onChange={(t) => setTab(t)}
          options={(['catalog', 'pipelines', 'sources'] as Tab[]).map((t) => ({
            id: t,
            label: TAB_META[t].label,
          }))}
        />
      )}

      {!projectId ? (
        <Card className="p-6 border-dashed border-edge">
          <h2 className="text-sm font-semibold text-fg">Pick a project first</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Skill pipelines attach kenji skills workflows to bug reports. Select a project in the header, then sync skill sources or start a handoff run.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/onboarding" className="text-xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">Open setup cockpit</Link>
            <Link to="/skills?tab=sources" className="text-xs text-fg-muted underline">Manage skill sources</Link>
          </div>
        </Card>
      ) : (
        <>
          {tab === 'catalog' && (
            <CatalogTab
              projectId={projectId}
              addToast={addToast}
              initialSkillSlug={skillSlug}
              onPipelineStarted={(runId) => setTab('pipelines', { run: runId })}
              onSkillChange={(slug) => setTab('catalog', { skill: slug ?? undefined })}
              onGoToSources={() => setTab('sources')}
            />
          )}
          {tab === 'pipelines' && (
            <PipelinesTab
              projectId={projectId}
              addToast={addToast}
              initialRunId={pipelineRunId}
              onOpenSkill={(slug) => setTab('catalog', { skill: slug })}
              onGoToCatalog={() => setTab('catalog', { skill: 'workflow-fix-and-ship' })}
            />
          )}
          {tab === 'sources' && (
            <SourcesTab
              projectId={projectId}
              addToast={addToast}
              stats={skillsStats}
              statsFetchedAt={statsFetchedAt}
              statsValidating={statsValidating}
              showEndpointReadout={!ux.hideEndpointReadout}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Catalog Tab ───────────────────────────────────────────────────────────────

function SkillDetailPanel({
  selected,
  projectId,
  reportId,
  setReportId,
  mode,
  setMode,
  cloudReadiness,
  startingSlug,
  onClose,
  onStartPipeline,
  embedded = false,
}: {
  selected: AgentSkill
  projectId: string | null
  reportId: string
  setReportId: (v: string) => void
  mode: 'handoff' | 'cloud'
  setMode: (v: 'handoff' | 'cloud') => void
  cloudReadiness: CloudReadiness | null | undefined
  startingSlug: string | null
  onClose: () => void
  onStartPipeline: () => void
  /** When true, renders without SurfacePanel wrapper (inside Drawer). */
  embedded?: boolean
}) {
  const meta = getSkillCategoryMeta(selected.category)
  const reportIdCheck = parseReportIdInput(reportId)
  const reportIdHelpId = embedded ? 'skill-report-id-drawer-help' : 'skill-report-id-help'
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <span className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${meta.badgeClass}`}>
          <meta.Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium text-fg-muted">{meta.label}</p>
          <h2 className="text-sm font-bold text-fg">{selected.title}</h2>
          <p className="text-2xs font-mono text-fg-muted">{selected.slug}</p>
        </div>
        {!embedded ? (
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="flex-shrink-0"
            aria-label="Close skill details"
          >
            <IconClose size={14} />
          </Btn>
        ) : null}
      </div>
      <p className="text-xs text-fg-muted">{selected.description}</p>

      {selected.body_md ? (
        <details className="text-2xs text-fg-muted">
          <summary className="cursor-pointer font-semibold text-fg">SKILL.md preview</summary>
          <pre className="mushi-code-block mushi-code-body mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-2xs rounded-lg p-2 border border-edge-subtle">
            {selected.body_md.slice(0, 4000)}
            {selected.body_md.length > 4000 ? '\n…' : ''}
          </pre>
        </details>
      ) : null}

      {selected.chain_slugs?.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold text-fg mb-1">Chain ({selected.chain_slugs.length} steps)</p>
          <div className="flex flex-col gap-1">
            {selected.chain_slugs.map((s, i) => (
              <span key={s} className="text-2xs text-fg-muted font-mono">
                {i + 1}. {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-edge-subtle pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-2xs font-semibold text-fg">Apply to a report</p>
          <Link to="/reports" className="text-2xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">Browse reports →</Link>
        </div>
        <div className="space-y-1">
          <label className="text-2xs text-fg-muted" htmlFor={embedded ? 'skill-report-id-drawer' : 'skill-report-id'}>
            Report ID <span className="text-fg-faint">(optional — gives the agent exact bug context)</span>
          </label>
          <input
            id={embedded ? 'skill-report-id-drawer' : 'skill-report-id'}
            type="text"
            placeholder="Paste the report link or its full ID"
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            aria-invalid={reportIdCheck.kind === 'invalid'}
            aria-describedby={reportIdCheck.kind === 'invalid' ? reportIdHelpId : undefined}
            className="input text-xs"
          />
          {reportIdCheck.kind === 'invalid' ? (
            <p id={reportIdHelpId} className="text-2xs text-danger">{reportIdCheck.message}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label className="text-2xs text-fg-muted" htmlFor={embedded ? 'skill-mode-drawer' : 'skill-mode'}>Mode</label>
          <select
            id={embedded ? 'skill-mode-drawer' : 'skill-mode'}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'handoff' | 'cloud')}
            className="input text-xs"
            aria-label="Pipeline mode"
          >
            <option value="handoff">Handoff — copy context packet into your local Cursor agent</option>
            <option value="cloud" disabled={!cloudReadiness?.cloudReady}>
              Cloud — auto-dispatch each step via Cursor Cloud
            </option>
          </select>
        </div>
        {mode === 'cloud' && cloudReadiness && !cloudReadiness.cloudReady ? (
          <HelpBanner tone="neutral" className="rounded-lg">
            Cloud mode needs a Cursor API key and GitHub repo URL.{' '}
            <Link to="/integrations/config#cursor_cloud" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
              Open Integrations → Cursor Cloud
            </Link>
            {!cloudReadiness.githubRepoConfigured ? (
              <>
                {' '}and{' '}
                <Link to="/integrations/config#github" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
                  GitHub repo
                </Link>
              </>
            ) : null}
          </HelpBanner>
        ) : null}
        <Btn
          type="button"
          variant="primary"
          size="sm"
          onClick={onStartPipeline}
          disabled={
            startingSlug === selected.slug ||
            !projectId ||
            reportIdCheck.kind === 'invalid' ||
            (mode === 'cloud' && !cloudReadiness?.cloudReady)
          }
        >
          {startingSlug === selected.slug ? 'Starting…' : mode === 'cloud' ? 'Start cloud pipeline' : 'Start pipeline →'}
        </Btn>
        {!reportId ? (
          <p className="text-2xs text-fg-faint">
            Tip: paste a report ID above so the skill gets your exact bug context. Find IDs in{' '}
            <Link to="/reports" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">Reports</Link>.
          </p>
        ) : null}
      </div>
    </>
  )

  if (embedded) {
    return <div className="flex flex-col gap-3">{body}</div>
  }

  return (
    <SurfacePanel className="w-full lg:w-80 flex-shrink-0 rounded-xl p-4 flex flex-col gap-3">
      {body}
    </SurfacePanel>
  )
}

function CatalogTab({
  projectId,
  addToast,
  initialSkillSlug,
  onPipelineStarted,
  onSkillChange,
  onGoToSources,
}: {
  projectId: string | null
  addToast: (t: { type: string; message: string }) => void
  initialSkillSlug: string | null
  onPipelineStarted: (runId: string) => void
  onSkillChange: (slug: string | null) => void
  onGoToSources: () => void
}) {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<AgentSkill | null>(null)
  const [startingSlug, setStartingSlug] = useState<string | null>(null)
  const [reportId, setReportId] = useState('')
  const [mode, setMode] = useState<'handoff' | 'cloud'>('handoff')

  const { data: cloudReadiness } = usePageData<CloudReadiness>(
    projectId ? `/v1/admin/skills/cloud-readiness?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const catalogUrl = (() => {
    const qs = new URLSearchParams({ limit: '200' })
    if (debouncedSearch) qs.set('q', debouncedSearch)
    return `/v1/admin/skills?${qs}`
  })()

  const { data, loading, error, reload, isValidating } = usePageData<{
    data: AgentSkill[]
    grouped: Record<string, AgentSkill[]>
    total: number
  }>(catalogUrl)

  const skills = data?.data ?? []
  const grouped = data?.grouped ?? {}
  const catalogTotal = data?.total ?? skills.length

  const orderedCategories = CATEGORY_ORDER.filter((c) => grouped[c]?.length)
  const otherCategories = Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c]?.length)

  const isLgUp = useMediaMin(1024)

  // Deep-link: ?skill=… opens drawer — fetch by slug if not in loaded catalog page
  useEffect(() => {
    if (!initialSkillSlug) return
    const match = skills.find((s) => s.slug === initialSkillSlug)
    if (match) {
      setSelected(match)
      return
    }
    if (loading) return
    let cancelled = false
    ;(async () => {
      const res = await apiFetch<AgentSkill>(`/v1/admin/skills/${encodeURIComponent(initialSkillSlug)}`)
      if (!cancelled && res.ok && res.data) setSelected(res.data)
    })()
    return () => { cancelled = true }
  }, [initialSkillSlug, skills, loading])

  const selectSkill = useCallback(async (skill: AgentSkill | null) => {
    if (!skill) {
      setSelected(null)
      onSkillChange(null)
      return
    }
    setSelected(skill)
    onSkillChange(skill.slug)
    const res = await apiFetch<AgentSkill>(`/v1/admin/skills/${encodeURIComponent(skill.slug)}`)
    if (res.ok && res.data) setSelected(res.data)
  }, [onSkillChange])

  const startPipeline = useCallback(async (slug: string) => {
    if (!projectId) {
      addToast({ type: 'error', message: 'Pick a project from the toolbar first' })
      return
    }
    if (startingSlug) return
    const parsedReport = parseReportIdInput(reportId)
    if (parsedReport.kind === 'invalid') {
      addToast({ type: 'error', message: parsedReport.message })
      return
    }
    setStartingSlug(slug)
    try {
      const res = await apiFetch(`/v1/admin/skills/pipelines`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          root_skill_slug: slug,
          report_id: parsedReport.kind === 'ok' ? parsedReport.id : null,
          mode,
        }),
      })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Couldn't start the pipeline — try again" })
        return
      }
      const runId = (res.data as { id?: string } | undefined)?.id
      if (!runId) {
        addToast({ type: 'error', message: 'Pipeline started but run id missing — check Pipeline Runs' })
        onPipelineStarted('')
        return
      }
      addToast({
        type: 'success',
        message: mode === 'cloud'
          ? 'Cloud pipeline started — Cursor Cloud is dispatching step 1'
          : 'Pipeline started — copy the context packet from Pipeline Runs',
      })
      onPipelineStarted(runId)
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setStartingSlug(null)
    }
  }, [projectId, reportId, mode, addToast, startingSlug, onPipelineStarted])

  const searchPending = searchInput.trim() !== debouncedSearch
  const searching = searchPending || isValidating

  // The search box stays mounted through every state below — a skeleton or
  // empty state that replaced it dropped focus on each keystroke and left a
  // no-match query with nothing to edit (console QA 22).
  const searchBar = (
    <div className="flex gap-2 items-center">
      <input
        type="search"
        placeholder="Search by name, slug, or category…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="input flex-1 max-w-sm"
        aria-label="Search skills"
      />
      <span className="text-xs text-fg-muted" aria-live="polite">
        {searching
          ? 'Searching…'
          : !data
            ? null
            : skills.length === catalogTotal
            ? `${catalogTotal} skills`
            : `${skills.length} of ${catalogTotal} skills`}
      </span>
    </div>
  )

  // A new query is a new URL, so usePageData drops the old rows while it
  // loads: show the skeleton under the search box, never instead of it.
  const listState: 'loading' | 'error' | 'empty' | 'no-match' | 'list' =
    loading && !data
      ? 'loading'
      : error && !data
        ? 'error'
        : skills.length === 0
          ? debouncedSearch
            ? 'no-match'
            : 'empty'
          : 'list'

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-w-0">
      {/* Skill list */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {searchBar}

        {listState === 'loading' ? <SkeletonRows count={8} /> : null}
        {listState === 'error' ? (
          <PageLoadError error={error} resource="the skill catalog" onRetry={reload} />
        ) : null}
        {listState === 'empty' ? <EmptySkills onGoToSources={onGoToSources} /> : null}
        {listState === 'no-match' ? (
          <EmptySearchResults query={debouncedSearch} onClear={() => setSearchInput('')} />
        ) : null}

        {listState === 'list' && [...orderedCategories, ...otherCategories].map((cat) => {
          const meta = getSkillCategoryMeta(cat)
          const catSkills = grouped[cat] ?? []
          return (
            <section
              key={cat}
              // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
              className={`rounded-lg border border-edge-subtle bg-surface-raised p-3 shadow-card border-l-[3px] ${meta.accentClass}`}
            >
              <SkillCategoryHeader meta={meta} count={catSkills.length} />
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${selected ? 'xl:grid-cols-2' : 'lg:grid-cols-3'}`}>
                {catSkills.map((skill) => (
                  <Btn
                    key={skill.slug}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectSkill(skill)}
                    className={[
                      '!justify-start !items-start !text-left !p-3 !rounded-lg !w-full !h-auto transition-opacity',
                      selected?.slug === skill.slug
                        ? '!border-brand !bg-surface-raised ring-1 ring-brand/30'
                        : '!border-edge-subtle !bg-surface-raised hover:!border-brand/40 hover:!bg-surface-overlay',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md ${meta.badgeClass}`}>
                        <meta.Icon size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-fg line-clamp-1">{skill.title}</p>
                        <p className="text-2xs text-fg-muted font-mono mt-0.5">{skill.slug}</p>
                        <p className="text-2xs text-fg-muted mt-1 line-clamp-2">{skill.description}</p>
                        {skill.chain_slugs?.length > 0 && (
                          <p className="text-2xs text-brand mt-1">Chain: {skill.chain_slugs.length} steps</p>
                        )}
                      </div>
                    </div>
                  </Btn>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {/* Desktop skill detail panel */}
      {selected && isLgUp ? (
        <SkillDetailPanel
          selected={selected}
          projectId={projectId}
          reportId={reportId}
          setReportId={setReportId}
          mode={mode}
          setMode={setMode}
          cloudReadiness={cloudReadiness}
          startingSlug={startingSlug}
          onClose={() => selectSkill(null)}
          onStartPipeline={() => startPipeline(selected.slug)}
        />
      ) : null}

      {/* Mobile skill detail drawer */}
      {!isLgUp ? (
        <Drawer
          open={!!selected}
          onClose={() => selectSkill(null)}
          title={selected?.title}
          ariaLabel="Skill detail"
          width="md"
        >
          {selected ? (
            <SkillDetailPanel
              selected={selected}
              projectId={projectId}
              reportId={reportId}
              setReportId={setReportId}
              mode={mode}
              setMode={setMode}
              cloudReadiness={cloudReadiness}
              startingSlug={startingSlug}
              onClose={() => selectSkill(null)}
              onStartPipeline={() => startPipeline(selected.slug)}
              embedded
            />
          ) : null}
        </Drawer>
      ) : null}
    </div>
  )
}

// ── Pipelines Tab ─────────────────────────────────────────────────────────────

function PipelinesTab({
  projectId,
  addToast,
  initialRunId,
  onOpenSkill,
  onGoToCatalog,
}: {
  projectId: string | null
  addToast: (t: { type: string; message: string }) => void
  initialRunId: string | null
  onOpenSkill: (slug: string) => void
  onGoToCatalog: () => void
}) {
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null)
  const autoSelectedRef = useRef<string | null>(null)
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null)
  const [abortingId, setAbortingId] = useState<string | null>(null)

  const { data, loading, error, reload } = usePageData<{ data: PipelineRun[]; total: number }>(
    projectId ? `/v1/admin/skills/pipelines?project_id=${projectId}&limit=100` : null,
  )

  const { data: catalogMeta } = usePageData<{ data: AgentSkill[] }>(
    '/v1/admin/skills?limit=200',
  )

  // Memoise so the reference only changes when the catalog actually loads —
  // RunDetail's flow-node effect depends on this to re-label slug → title.
  const skillTitleMap = useMemo(
    () => new Map((catalogMeta?.data ?? []).map((s) => [s.slug, s.title] as const)),
    [catalogMeta],
  )

  const runs = data?.data ?? []
  const runsTotal = data?.total ?? runs.length

  const isLgUp = useMediaMin(1024)

  // Realtime: reload list when any step changes
  useRealtime(
    { table: 'skill_pipeline_step_runs', enabled: !!projectId },
    reload,
  )

  const loadRunDetail = useCallback(async (run: PipelineRun) => {
    setLoadingRunId(run.id)
    try {
      const res = await apiFetch<PipelineRun>(`/v1/admin/skills/pipelines/${run.id}`)
      if (res.ok && res.data) {
        setSelectedRun(res.data)
      } else {
        setSelectedRun(run)
        if (!res.ok) addToast({ type: 'error', message: res.error?.message ?? "Couldn't load run details — showing summary only" })
      }
    } catch {
      setSelectedRun(run)
    } finally {
      setLoadingRunId(null)
    }
  }, [addToast])

  useEffect(() => {
    if (!initialRunId || loading || runs.length === 0) return
    if (autoSelectedRef.current === initialRunId) return
    const match =
      runs.find((r) => r.id === initialRunId) ??
      runs.find((r) => r.id.startsWith(initialRunId))
    if (match) {
      autoSelectedRef.current = initialRunId
      void loadRunDetail(match)
    }
  }, [initialRunId, loading, runs, loadRunDetail])

  const refetchSelected = useCallback(async (runId: string) => {
    const res = await apiFetch<PipelineRun>(`/v1/admin/skills/pipelines/${runId}`)
    if (res.ok && res.data) setSelectedRun((cur) => (cur?.id === runId ? res.data! : cur))
  }, [])

  // Cancel is irreversible and, for cloud runs, reaches out to Cursor Cloud,
  // so it goes through a confirm dialog (console QA 24).
  const [cancelTarget, setCancelTarget] = useState<PipelineRun | null>(null)

  const abortRun = useCallback(async (runId: string) => {
    setAbortingId(runId)
    try {
      const res = await apiFetch<PipelineCancelResult>(`/v1/admin/skills/pipelines/${runId}`, { method: 'DELETE' })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Couldn't cancel this pipeline — try again" })
        return
      }
      const outcome = describePipelineCancel(res.data)
      addToast({ type: outcome.tone, message: outcome.message })
      reload()
      await refetchSelected(runId)
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setAbortingId(null)
      setCancelTarget(null)
    }
  }, [addToast, reload, refetchSelected])

  const requestCancel = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.id === runId) ?? (selectedRun?.id === runId ? selectedRun : null)
      if (run) setCancelTarget(run)
    },
    [runs, selectedRun],
  )

  // Manual check-in for the current step (console QA 105). Handoff runs
  // have no agent to report back, so the console needs its own control.
  const [checkingIn, setCheckingIn] = useState(false)
  const checkinStep = useCallback(
    async (runId: string, stepIndex: number, status: 'passed' | 'failed' | 'skipped') => {
      setCheckingIn(true)
      try {
        const res = await apiFetch(`/v1/admin/skills/pipelines/${runId}/steps/${stepIndex}/checkin`, {
          method: 'POST',
          body: JSON.stringify({ status, notes: 'Checked in from the console.' }),
        })
        if (!res.ok) {
          addToast({ type: 'error', message: res.error?.message ?? "Couldn't update this step — try again" })
          return
        }
        addToast({
          type: 'success',
          message: `Step ${stepIndex + 1} marked ${status}.`,
        })
        reload()
        await refetchSelected(runId)
      } finally {
        setCheckingIn(false)
      }
    },
    [addToast, reload, refetchSelected],
  )

  // Also realtime-reload the selected run detail
  useRealtime(
    {
      table: 'skill_pipeline_step_runs',
      filter: selectedRun ? `run_id=eq.${selectedRun.id}` : undefined,
      enabled: !!selectedRun,
    },
    useCallback(async () => {
      if (!selectedRun) return
      const res = await apiFetch<PipelineRun>(`/v1/admin/skills/pipelines/${selectedRun.id}`)
      if (res.ok && res.data) setSelectedRun(res.data)
    }, [selectedRun]),
  )

  if (loading) return <SkeletonRows count={5} />
  if (error) return <PageLoadError error={error} resource="pipeline runs" onRetry={reload} />

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-w-0">
      {cancelTarget ? (
        <ConfirmDialog
          title={`Cancel the ${cancelTarget.root_skill_slug} pipeline?`}
          body={pipelineCancelBody(cancelTarget.mode)}
          confirmLabel="Cancel pipeline"
          cancelLabel="Keep running"
          tone="danger"
          loading={abortingId === cancelTarget.id}
          onConfirm={() => abortRun(cancelTarget.id)}
          onCancel={() => {
            if (abortingId !== cancelTarget.id) setCancelTarget(null)
          }}
        />
      ) : null}
      {/* Run list */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {runs.length > 0 && (
          <p className="text-2xs text-fg-muted mb-1">
            {runs.length === runsTotal ? `${runsTotal} runs` : `${runs.length} of ${runsTotal} runs`}
          </p>
        )}
        {runs.length === 0 ? (
          <div className="py-10 text-center flex flex-col items-center gap-4 max-w-md mx-auto">
            <p className="text-sm font-medium text-fg">No pipeline runs yet</p>
            <Card  className="text-xs text-fg-muted text-left w-full px-4 py-3 space-y-2">
              <p className="font-semibold text-fg text-2xs uppercase tracking-wide">How to start your first run</p>
              <ol className="list-decimal pl-4 space-y-1 text-fg-secondary">
                <li>Open a report and copy its ID from the URL</li>
                <li>Go to <Btn type="button" variant="ghost" size="sm" onClick={onGoToCatalog} className={`!px-0 !py-0 !border-0 !bg-transparent hover:!bg-transparent ${LINK_ACCENT}`}>Catalog</Btn> and pick a skill (try <em>workflow-fix-and-ship</em> to close a bug end-to-end)</li>
                <li>Paste the report ID in the "Apply to a report" field, click <strong>Start pipeline</strong></li>
                <li>Copy the context packet into your Cursor agent — the skill walks you through each step</li>
              </ol>
            </Card>
            <div className="flex gap-2">
              <Btn type="button" variant="primary" size="sm" onClick={onGoToCatalog}>
                Browse Catalog →
              </Btn>
              <Btn to="/reports" size="sm" variant="ghost">Open Reports</Btn>
            </div>
          </div>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className={[
                'p-3 rounded-lg border transition-opacity flex items-start gap-3',
                selectedRun?.id === run.id
                  ? 'border-brand bg-surface-raised ring-1 ring-brand/30'
                  : 'border-edge-subtle bg-surface-raised hover:bg-surface-overlay',
              ].join(' ')}
            >
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => loadRunDetail(run)}
                className="!flex !flex-1 !items-start !gap-3 !min-w-0 !text-left hover:opacity-90 !border-0 !bg-transparent !p-0 !justify-start !h-auto !shadow-none hover:!bg-transparent hover:!translate-y-0"
              >
                <StatusDot status={run.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-fg truncate block">{run.root_skill_slug}</span>
                  <p className="text-2xs text-fg-muted">{run.id.slice(0, 8)} · {run.mode} · {new Date(run.created_at).toLocaleString()}</p>
                  {run.report_id && <p className="text-2xs text-fg-muted">Report: {run.report_id.slice(0, 8)}</p>}
                </div>
                {loadingRunId === run.id && <span className="text-2xs text-fg-muted animate-pulse">Loading…</span>}
              </Btn>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenSkill(run.root_skill_slug)}
                  className="text-brand"
                  title="Open skill in catalog"
                >
                  Skill
                </Btn>
                {['pending', 'running'].includes(run.status) && (
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => requestCancel(run.id)}
                    disabled={abortingId === run.id}
                    className="text-fg-muted hover:text-danger"
                    title="Cancel pipeline run"
                  >
                    {abortingId === run.id ? '…' : 'Cancel'}
                  </Btn>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop pipeline detail */}
      {selectedRun && isLgUp ? (
        <RunDetail
          run={selectedRun}
          skillTitleMap={skillTitleMap}
          onClose={() => setSelectedRun(null)}
          onOpenSkill={onOpenSkill}
          onAbort={requestCancel}
          aborting={abortingId === selectedRun.id}
          onCheckin={checkinStep}
          checkingIn={checkingIn}
          addToast={addToast}
        />
      ) : null}

      {/* Mobile pipeline drawer */}
      {!isLgUp ? (
        <Drawer
          open={!!selectedRun}
          onClose={() => setSelectedRun(null)}
          title={selectedRun?.root_skill_slug ?? 'Pipeline run'}
          ariaLabel="Pipeline run detail"
          width="lg"
        >
          {selectedRun ? (
            <RunDetail
              run={selectedRun}
              skillTitleMap={skillTitleMap}
              onClose={() => setSelectedRun(null)}
              onOpenSkill={onOpenSkill}
              onAbort={requestCancel}
              aborting={abortingId === selectedRun.id}
              onCheckin={checkinStep}
              checkingIn={checkingIn}
              addToast={addToast}
              embedded
            />
          ) : null}
        </Drawer>
      ) : null}
    </div>
  )
}

function RunDetail({
  run,
  skillTitleMap,
  onClose,
  onOpenSkill,
  onAbort,
  aborting,
  onCheckin,
  checkingIn,
  addToast,
  embedded = false,
}: {
  run: PipelineRun
  skillTitleMap: Map<string, string>
  onClose: () => void
  onOpenSkill: (slug: string) => void
  onAbort: (runId: string) => void
  aborting: boolean
  onCheckin: (runId: string, stepIndex: number, status: 'passed' | 'failed' | 'skipped') => void
  checkingIn: boolean
  addToast: (t: { type: string; message: string }) => void
  embedded?: boolean
}) {
  const steps: PipelineStep[] = run.steps ?? run.skill_pipeline_step_runs ?? []
  const runOpen = ['pending', 'running'].includes(run.status)
  const checkinTarget = runOpen ? nextCheckinStep(steps) : null

  // Memoised so the title lookup is stable until the run or catalog changes;
  // included in the flow effect deps so nodes re-label once the catalog loads.
  const skillInfoMap = useMemo(
    () => new Map<string, SkillInfo>(
      [run.root_skill_slug, ...run.chain_slugs].map(
        (slug) => [slug, { slug, title: skillTitleMap.get(slug) ?? slug }],
      ),
    ),
    [run.root_skill_slug, run.chain_slugs, skillTitleMap],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(
    buildPipelineNodes(steps, skillInfoMap),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    buildPipelineEdges(steps),
  )

  // steps are compared by value via JSON.stringify so the React Flow nodes
  // rebuild whenever a step status changes or the skill catalog (skillInfoMap) loads.
  useEffect(() => {
    setNodes(buildPipelineNodes(steps, skillInfoMap))
    setEdges(buildPipelineEdges(steps))
  }, [run.id, JSON.stringify(steps), skillInfoMap, setNodes, setEdges])

  const [copying, setCopying] = useState(false)

  const copyPacket = async () => {
    if (!run.context_packet) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(run.context_packet)
      addToast({ type: 'success', message: 'Copied to clipboard — paste into Cursor' })
    } catch {
      addToast({ type: 'error', message: "Couldn't copy — try selecting the text manually" })
    } finally {
      setTimeout(() => setCopying(false), 1500)
    }
  }

  const panelBody = (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge-subtle flex items-center gap-2">
        <StatusDot status={run.status} />
        <div className="flex-1 min-w-0">
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenSkill(run.root_skill_slug)}
            className={`!px-0 !py-0 !border-0 !bg-transparent hover:!bg-transparent truncate block text-left font-bold ${LINK_ACCENT}`}
          >
            {run.root_skill_slug}
          </Btn>
          <p className="text-2xs text-fg-muted">
            {run.id.slice(0, 8)} · {run.mode}
            {run.mode === 'cloud' && run.status === 'running' && ' · Cursor Cloud dispatching'}
          </p>
        </div>
        <div className="flex gap-1">
          {run.context_packet ? (
            <Btn type="button" variant="ghost" size="sm" onClick={copyPacket} disabled={copying} title="Copy run packet for local Cursor agent">
              {copying ? 'Copied!' : 'Copy packet'}
            </Btn>
          ) : null}
          {['pending', 'running'].includes(run.status) ? (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAbort(run.id)}
              disabled={aborting}
              className="text-danger"
              title="Cancel pipeline run"
            >
              {aborting ? '…' : 'Cancel'}
            </Btn>
          ) : null}
          {!embedded ? (
            <Btn type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Btn>
          ) : null}
        </div>
      </div>

      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
      {/* React Flow pipeline canvas */}
      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
      <div className="min-h-[220px]" style={{ height: embedded ? 220 : 240 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Step list */}
      <div className="border-t border-edge-subtle px-4 py-3 overflow-y-auto max-h-60 flex flex-col gap-2">
        {steps.map((step) => (
          <div key={step.step_index} className="flex items-center gap-2 text-xs">
            <StatusDot status={step.status} size="sm" />
            <span className="font-mono text-fg-muted w-4 text-right">{step.step_index + 1}</span>
            <span className="font-semibold text-fg flex-1 truncate" title={step.skill_slug}>
              {skillTitleMap.get(step.skill_slug) ?? step.skill_slug}
            </span>
            <span className="text-fg-muted text-2xs">{STEP_STATUS_LABEL[step.status] ?? step.status}</span>
            {step.agent_ref ? (
              <a
                href={`https://cursor.com/agents/${step.agent_ref}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity text-2xs"
                title={`Cursor agent ${step.agent_ref}`}
              >
                Agent
              </a>
            ) : null}
            {step.pr_url ? (
              <a href={step.pr_url} target="_blank" rel="noopener noreferrer" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity text-2xs">PR</a>
            ) : null}
          </div>
        ))}
        {steps.length === 0 ? (
          <p className="text-xs text-fg-muted italic">Steps pending…</p>
        ) : null}
      </div>

      {checkinTarget ? (
        <div className="border-t border-edge-subtle px-4 py-3 flex flex-col gap-2" data-testid="pipeline-step-checkin">
          <p className="text-xs text-fg">
            Step {checkinTarget.step_index + 1}:{' '}
            <span className="font-semibold">
              {skillTitleMap.get(checkinTarget.skill_slug) ?? checkinTarget.skill_slug}
            </span>{' '}
            {run.mode === 'cloud'
              ? 'is with the Cursor Cloud agent. It checks in by itself; mark it here only if it is stuck.'
              : 'is waiting for you. When your local agent finishes it, mark the result here.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Btn
              type="button"
              size="sm"
              variant="primary"
              disabled={checkingIn}
              onClick={() => onCheckin(run.id, checkinTarget.step_index, 'passed')}
            >
              Mark done
            </Btn>
            <Btn
              type="button"
              size="sm"
              variant="ghost"
              disabled={checkingIn}
              onClick={() => onCheckin(run.id, checkinTarget.step_index, 'skipped')}
            >
              Skip step
            </Btn>
            <Btn
              type="button"
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={checkingIn}
              onClick={() => onCheckin(run.id, checkinTarget.step_index, 'failed')}
            >
              Mark failed
            </Btn>
          </div>
        </div>
      ) : null}

      {/* CLI handoff hint */}
      {run.mode === 'handoff' ? (
        <div className="border-t border-edge-subtle px-4 py-2 bg-surface-overlay text-2xs text-fg-muted">
          Dev: <code className="font-mono">mushi pipeline watch {run.id.slice(0, 8)}</code> · check in each step with{' '}
          <code className="font-mono">mushi pipeline checkin {run.id.slice(0, 8)} --step 0 --status passed</code>
        </div>
      ) : (
        <div className="border-t border-edge-subtle px-4 py-2 bg-surface-overlay text-2xs text-fg-muted">
          Cloud mode dispatches each step to Cursor Cloud automatically. Agents check in via MCP when done — or use the CLI checkin command above.
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="flex flex-col overflow-hidden rounded-xl border border-edge">{panelBody}</div>
  }

  // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
  return (
    // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
    <SurfacePanel className="w-full lg:w-[560px] flex-shrink-0 rounded-xl flex flex-col overflow-hidden p-0">
      {panelBody}
    </SurfacePanel>
  )
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function SourcesTab({
  projectId,
  addToast,
  stats,
  statsFetchedAt,
  statsValidating,
  showEndpointReadout,
}: {
  projectId: string | null
  addToast: (t: { type: string; message: string }) => void
  stats: SkillsStats
  statsFetchedAt: string | null
  statsValidating: boolean
  showEndpointReadout: boolean
}) {
  const [repoSlug, setRepoSlug] = useState('')
  const [ref, setRef] = useState('main')
  const [adding, setAdding] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [forceSyncingId, setForceSyncingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<SkillSource | null>(null)
  const [removing, setRemoving] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: sourcesRaw, loading, error, reload } = usePageData<SkillSource[]>(
    projectId ? `/v1/admin/skills/sources?project_id=${projectId}` : null,
  )

  const sources = sourcesRaw ?? []

  const addSource = async () => {
    if (!projectId || !repoSlug) return
    setAdding(true)
    try {
      const res = await apiFetch('/v1/admin/skills/sources', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, repo_slug: repoSlug, ref }),
      })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Couldn't add that repo — check the slug and try again" })
        return
      }
      setRepoSlug('')
      setRef('main')
      addToast({ type: 'success', message: 'Source added — tap Sync now to pull skills' })
      reload()
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setAdding(false)
    }
  }

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  const startSyncPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    let ticks = 0
    pollRef.current = setInterval(() => {
      ticks += 1
      reload()
      if (ticks >= 12) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 5000)
  }

  const syncSource = async (id: string, force = false) => {
    if (force) setForceSyncingId(id)
    else setSyncingId(id)
    try {
      const res = await apiFetch(`/v1/admin/skills/sources/${id}/sync`, {
        method: 'POST',
        body: JSON.stringify({ force }),
      })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Sync didn't start — try again in a moment" })
        return
      }
      const synced = (res.data as { synced?: number } | undefined)?.synced
      addToast({
        type: 'success',
        message: force
          ? `Full re-sync started${typeof synced === 'number' ? ` — ${synced} skills updated` : ''}`
          : 'Sync started — catalog count updates within a minute',
      })
      startSyncPoll()
      reload()
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setSyncingId(null)
      setForceSyncingId(null)
    }
  }

  const removeSource = async (src: SkillSource) => {
    setRemoving(true)
    try {
      const res = await apiFetch(`/v1/admin/skills/sources/${src.id}`, { method: 'DELETE' })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Couldn't remove that source — try again" })
        return
      }
      addToast({ type: 'success', message: `Removed ${src.repo_slug}. Its skills left the catalog.` })
      reload()
    } finally {
      setRemoving(false)
      setRemoveTarget(null)
    }
  }

  if (loading) return <SkeletonRows count={3} />
  if (error) return <PageLoadError error={error} resource="skill sources" onRetry={reload} />

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {removeTarget ? (
        <ConfirmDialog
          title={`Remove ${removeTarget.repo_slug}?`}
          body={`Mushi stops syncing this repo and takes its ${removeTarget.catalog_count ?? 0} skills out of the catalog. Pipeline runs that already used them keep their history. You can add the repo again later.`}
          confirmLabel="Remove source"
          tone="danger"
          loading={removing}
          onConfirm={() => removeSource(removeTarget)}
          onCancel={() => {
            if (!removing) setRemoveTarget(null)
          }}
        />
      ) : null}
      {showEndpointReadout ? (
        <SkillsEndpointReadout
          stats={stats}
          fetchedAt={statsFetchedAt}
          isValidating={statsValidating}
        />
      ) : null}
      <SurfacePanel className="rounded-xl p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-fg">Add skill source</p>
        <p className="text-xs text-fg-muted">Any GitHub repo containing <code className="font-mono">skills/*/SKILL.md</code> (skills.sh-compatible).</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="owner/repo (e.g. kensaurus/skills)"
            value={repoSlug}
            onChange={(e) => setRepoSlug(e.target.value)}
            className="input flex-1 text-sm"
          />
          <input
            type="text"
            placeholder="main"
            title="Git branch or tag (default: main)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className="input w-24 text-sm"
          />
          <Btn type="button" variant="primary" size="md" onClick={addSource} disabled={adding || !repoSlug}>
            {adding ? 'Adding…' : 'Add source'}
          </Btn>
        </div>
      </SurfacePanel>

      {sources.length === 0 ? (
        <div className="text-sm text-fg-muted flex flex-col gap-2">
          <p>No skill sources yet.</p>
          <p className="text-xs">
            Add <code className="font-mono text-brand">kensaurus/skills</code> above, then sync to load 70+ agent skills into the catalog.
          </p>
        </div>
      ) : (
        sources.map((src) => (
          <SurfacePanel key={src.id} className="rounded-xl p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-fg">{src.repo_slug}</p>
              <p className="text-2xs text-fg-muted">ref: {src.ref} · {src.enabled ? 'enabled' : 'disabled'}</p>
              <p className="text-2xs text-fg-muted">
                Catalog: {src.catalog_count ?? src.last_synced_count ?? 0} active skills
                {src.last_synced_at && (
                  <> · Last synced {new Date(src.last_synced_at).toLocaleString()}</>
                )}
              </p>
              {src.last_sync_error && (
                <p className="text-2xs text-danger">{src.last_sync_error}</p>
              )}
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => syncSource(src.id, false)}
                disabled={syncingId === src.id || forceSyncingId === src.id}
              >
                {syncingId === src.id ? 'Syncing…' : 'Sync now'}
              </Btn>
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => syncSource(src.id, true)}
                disabled={syncingId === src.id || forceSyncingId === src.id}
                className="text-brand"
                title="Re-fetch every SKILL.md even if unchanged"
              >
                {forceSyncingId === src.id ? 'Re-syncing…' : 'Full re-sync'}
              </Btn>
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRemoveTarget(src)}
                disabled={removing || syncingId === src.id || forceSyncingId === src.id}
                className="text-fg-muted hover:text-danger"
                title="Stop syncing this repo and take its skills out of the catalog"
              >
                Remove
              </Btn>
            </div>
          </SurfacePanel>
        ))
      )}
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Tailwind `lg` breakpoint (1024px) — side panel vs drawer split. */
function useMediaMin(minPx: number): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(min-width: ${minPx}px)`).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minPx}px)`)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    setMatches(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [minPx])
  return matches
}

function SkillCategoryHeader({
  meta,
  count,
}: {
  meta: ReturnType<typeof getSkillCategoryMeta>
  count: number
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 ${meta.badgeClass}`}>
        <meta.Icon size={15} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{meta.label}</h3>
        <p className="text-2xs text-fg-muted">
          {count} skill{count === 1 ? '' : 's'} · {meta.hint}
        </p>
      </div>
    </div>
  )
}

function StatusDot({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const color = resolveStepStatusColor(status)
  const cls = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  return (
    <span
      className={`${cls} flex-shrink-0 rounded-full`}
      style={{ background: color }}
      title={STEP_STATUS_LABEL[status] ?? status}
    />
  )
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-surface-overlay animate-pulse" />
      ))}
    </div>
  )
}

function EmptySearchResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="text-center py-16 flex flex-col items-center gap-3">
      <p className="text-sm text-fg-muted">No skills match &ldquo;{query}&rdquo;</p>
      <p className="text-xs text-fg-muted max-w-sm">
        Try a shorter term, a category like &ldquo;audit&rdquo;, or the skill slug (e.g. workflow-fix-and-ship).
      </p>
      <Btn type="button" variant="ghost" size="sm" onClick={onClear}>
        Clear search
      </Btn>
    </div>
  )
}

function EmptySkills({ onGoToSources }: { onGoToSources: () => void }) {
  return (
    <div className="text-center py-16 flex flex-col items-center gap-3">
      <p className="text-sm text-fg-muted">Your skill catalog is empty.</p>
      <p className="text-xs text-fg-muted max-w-sm">
        Add a GitHub source and sync it to load skills.{' '}
        <code className="font-mono text-brand">kensaurus/skills</code> brings in 70+ workflows instantly.
      </p>
      <Btn type="button" variant="primary" size="sm" onClick={onGoToSources}>
        Go to Sources
      </Btn>
    </div>
  )
}
