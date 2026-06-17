/**
 * FILE: apps/admin/src/pages/ExperimentsPage.tsx
 * PURPOSE: A/B experiment console — banner + EXPERIMENTS SNAPSHOT + tabs:
 *          Overview | Experiments | New.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useExperimentsUx, resolveQuickExperimentsTab } from '../lib/experimentsModeUx'
import { useToast } from '../lib/toast'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { SnapshotSectionHint,
  Card,
  Section,
  Badge,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  StatCard,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction, } from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { ExperimentsStatusBanner } from '../components/experiments/ExperimentsStatusBanner'
import {
  EMPTY_EXPERIMENTS_STATS,
  type ExperimentsStats,
  type ExperimentsTabId,
} from '../components/experiments/ExperimentsStatsTypes'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import {
  conversionRateDetail,
  conversionRateTooltip,
  draftsReadyToLaunchDetail,
  draftsReadyToLaunchTooltip,
  runningCountDetail,
  runningCountTooltip,
  totalAssignmentsDetail,
  totalAssignmentsTooltip,
  totalExperimentsDetail,
  totalExperimentsTooltip,
  winnersFoundDetail,
  winnersFoundTooltip,
} from '../lib/statTooltips/experiments'
import { experimentsLinks } from '../lib/statCardLinks'

interface ExperimentVariant {
  id: string
  experiment_id: string
  name: string
  description: string | null
  config: Record<string, unknown>
  traffic_weight: number
  bandit_alpha: number
  bandit_beta: number
}

interface Experiment {
  id: string
  project_id: string
  name: string
  description: string | null
  hypothesis: string | null
  status: 'draft' | 'running' | 'stopped' | 'completed'
  bandit_enabled: boolean
  start_at: string | null
  end_at: string | null
  winner_variant_id: string | null
  created_at: string
  experiment_variants?: ExperimentVariant[]
}

interface AnalysisResult {
  srm_ok: boolean
  srm_p: number
  p_value: number
  log_lr: number
  lift: number
  relative_lift: number
  winner_variant_id: string | null
  recommendation: string
  variant_stats: Array<{ id: string; name: string; total: number; converted: number; rate: number }>
}

const STATUS_CLS: Record<Experiment['status'], string> = {
  draft: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
  running: 'bg-warn-muted/50 text-warning-foreground border border-warn/20',
  stopped: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
  completed: 'bg-ok-muted/50 text-ok-foreground border border-ok/20',
}

const STATUS_LABEL: Record<Experiment['status'], string> = {
  draft: 'Draft', running: 'Running', stopped: 'Stopped', completed: 'Completed',
}

function statusBadge(s: Experiment['status']) {
  return <Badge className={STATUS_CLS[s]}>{STATUS_LABEL[s]}</Badge>
}

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

const TABS: Array<{ id: ExperimentsTabId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Posture banner and how A/B assignment + mSPRT analysis works.' },
  { id: 'experiments', label: 'Experiments', description: 'Launch, monitor, analyze, and stop live variant tests.' },
  { id: 'new', label: 'New', description: 'Create an experiment with control + treatment variants.' },
]

function resolveExperimentsTab(value: string | null): ExperimentsTabId {
  if (value === 'experiments' || value === 'new') return value
  return 'overview'
}

export function ExperimentsPage() {
  const copy = usePageCopy('/experiments')
  const ux = useExperimentsUx()
  const toast = useToast()
  const projectId = useActiveProjectId()
  const setup = useSetupStatus(projectId)
  const projectName = setup.activeProject?.project_name ?? null
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveExperimentsTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const [selected, setSelected] = useState<Experiment | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ExperimentsStats>('/v1/admin/experiments/stats')
  const stats = { ...EMPTY_EXPERIMENTS_STATS, ...statsData }

  const {
    data: expData,
    loading,
    error,
    reload: reloadExperiments,
    isValidating: experimentsValidating,
  } = usePageData<{ data: Experiment[]; total: number }>(
    projectId && activeTab === 'experiments' ? `/v1/admin/experiments?project_id=${projectId}` : null,
    { deps: [projectId, activeTab] },
  )

  const experiments = listRows(expData)

  const setActiveTab = useCallback(
    (tab: ExperimentsTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadExperiments()
  }, [reloadStats, reloadExperiments])

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickExperimentsTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'experiments' && stats.runningCount > 0
            ? stats.runningCount
            : t.id === 'experiments' && stats.draftsReadyToLaunch > 0
              ? stats.draftsReadyToLaunch
              : undefined,
      })),
    [copy?.tabLabels, stats.runningCount, stats.draftsReadyToLaunch],
  )

  usePublishPageContext({
    route: '/experiments',
    title: projectName ? `Experiments · ${projectName}` : 'Experiments',
    summary: statsLoading
      ? 'Loading experiments…'
      : stats.totalExperiments === 0
        ? 'No experiments yet'
        : `${stats.runningCount} running · ${stats.totalExperiments} total`,
    criticalCount: stats.runningCount,
  })

  const launch = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/experiments/${id}/launch`, { method: 'POST' })
    if (!res.ok) { toast.error(res.error?.message ?? 'Launch failed'); return }
    toast.success('Experiment launched')
    reloadAll()
  }, [reloadAll, toast])

  const stop = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/experiments/${id}/stop`, { method: 'POST' })
    if (!res.ok) { toast.error(res.error?.message ?? 'Stop failed'); return }
    toast.success('Experiment stopped')
    reloadAll()
  }, [reloadAll, toast])

  const openDetail = useCallback(async (exp: Experiment) => {
    const res = await apiFetch<{ data: Experiment }>(`/v1/admin/experiments/${exp.id}`)
    setSelected(res.data?.data ?? exp)
    setDrawerOpen(true)
  }, [])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading experiments">
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
    return <ErrorAlert message={`Failed to load experiment stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'running' || stats.topPriority === 'draft_incomplete'
        ? 'warn'
        : stats.topPriority === 'no_experiments' || stats.topPriority === 'draft_ready'
          ? 'brand'
          : stats.topPriority === 'winners_found' || stats.topPriority === 'healthy'
            ? 'ok'
            : 'info'

  return (
    <div className="space-y-4" data-testid="mushi-page-experiments">
      <PageHeaderBar
        title={copy?.title ?? 'Experiments'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={copy?.description ?? 'Banner + EXPERIMENTS SNAPSHOT — Overview for posture, Experiments to launch/monitor, New to create variants.'}
        helpTitle={copy?.help?.title ?? 'A/B experiments'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Each experiment auto-assigns reporters to variants via deterministic hash or Thompson sampling (bandit mode). Run Analyze at any time for an always-valid p-value — no peeking penalty.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Test button copy, colour, or layout variants',
          'Measure impact of a new feature on report rate',
          'Use bandit mode for fast exploration with small samples',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Create an experiment, add variants, launch it. The SDK assigns users via mushi.experiment(). Analyze at any time — mSPRT prevents false positives.'}
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'warn'
                ? 'bg-warn-muted/50 text-warning-foreground'
                : bannerSeverity === 'brand'
                  ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                  : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.runningCount > 0
              ? `${stats.runningCount} LIVE`
              : stats.draftsReadyToLaunch > 0
                ? `${stats.draftsReadyToLaunch} READY`
                : stats.totalExperiments === 0
                  ? 'EMPTY'
                  : `${stats.totalExperiments} TOTAL`}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || experimentsValidating}>
          Refresh
        </Btn>
        <Btn size="sm" variant="primary" onClick={() => setActiveTab('new')}>+ New</Btn>
          </>
        )}
      </PageHeaderBar>

      <ExperimentsStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ExperimentsTabId>
        size="sm"
        ariaLabel="Experiments sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideExperimentsSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'EXPERIMENTS SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.total ?? 'Total'} value={stats.totalExperiments} accent={stats.totalExperiments > 0 ? 'text-brand' : undefined} tooltip={totalExperimentsTooltip(stats)} detail={totalExperimentsDetail(stats)} to={experimentsLinks.total} />
          <StatCard label={copy?.statLabels?.running ?? 'Running'} value={stats.runningCount} accent={stats.runningCount > 0 ? 'text-warn' : 'text-ok'} tooltip={runningCountTooltip(stats)} detail={runningCountDetail()} to={experimentsLinks.running} />
          <StatCard label={copy?.statLabels?.readyToLaunch ?? 'Ready to launch'} value={stats.draftsReadyToLaunch} accent={stats.draftsReadyToLaunch > 0 ? 'text-brand' : undefined} tooltip={draftsReadyToLaunchTooltip(stats)} detail={draftsReadyToLaunchDetail()} to={experimentsLinks.readyToLaunch} />
          <StatCard label={copy?.statLabels?.winners ?? 'Winners'} value={stats.winnersFound} accent={stats.winnersFound > 0 ? 'text-ok' : undefined} tooltip={winnersFoundTooltip(stats)} detail={winnersFoundDetail()} to={experimentsLinks.winners} />
          <StatCard label={copy?.statLabels?.assignments ?? 'Assignments'} value={stats.totalAssignments} accent={stats.totalAssignments > 0 ? 'text-brand' : undefined} tooltip={totalAssignmentsTooltip(stats)} detail={totalAssignmentsDetail(stats)} to={experimentsLinks.assignments} />
          <StatCard label={copy?.statLabels?.conversion ?? 'Conversion'} value={`${stats.conversionRatePct}%`} accent={stats.conversionRatePct > 0 ? 'text-ok' : undefined} tooltip={conversionRateTooltip(stats)} detail={conversionRateDetail(stats)} to={experimentsLinks.conversion} />
        </div>
      </Section>
      )}

      {stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'running'
              ? 'border-warn/30 bg-warn/5'
              : stats.topPriority === 'no_experiments' || stats.topPriority === 'draft_ready'
                ? 'border-brand/30 bg-brand/5'
                : 'border-ok/30 bg-ok/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'running'
                ? 'warn'
                : stats.topPriority === 'no_experiments' || stats.topPriority === 'draft_ready'
                  ? 'brand'
                  : 'ok'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone="info">
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
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Experiment library is idle"
              description={`${stats.totalExperiments} experiment${stats.totalExperiments === 1 ? '' : 's'} · none running · launch a draft or create a new test.`}
            />
          )}
          {stats.topPriority === 'no_experiments' && (
            <RecommendedAction
              tone="info"
              title="Start your first A/B test"
              description="Compare two UI variants with SDK assignment and mSPRT significance — no peeking penalty."
              cta={{ label: 'Create experiment', to: '/experiments?tab=new' }}
            />
          )}
          {stats.topPriority === 'draft_ready' && (
            <RecommendedAction
              tone="info"
              title="Launch a ready draft"
              description={stats.topPriorityLabel ?? 'Drafts with ≥2 variants can go live immediately.'}
              cta={{ label: 'Open Experiments', to: '/experiments?tab=experiments' }}
            />
          )}
        </div>
      )}

      {activeTab === 'experiments' && (
        <ExperimentsTab
          experiments={experiments}
          loading={loading}
          error={error}
          onOpen={openDetail}
          onLaunch={launch}
          onStop={stop}
          projectId={projectId ?? ''}
          onCreate={() => setActiveTab('new')}
        />
      )}

      {activeTab === 'new' && (
        <NewExperimentForm projectId={projectId ?? ''} onCreated={() => { setActiveTab('experiments'); reloadAll() }} />
      )}

      {drawerOpen && selected && (
        <ExperimentDrawer
          experiment={selected}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelected(null) }}
          onLaunch={launch}
          onStop={stop}
          onRefresh={async () => {
            const res = await apiFetch<{ data: Experiment }>(`/v1/admin/experiments/${selected.id}`)
            if (res.ok && res.data) setSelected((res.data as { data: Experiment }).data ?? selected)
          }}
        />
      )}
    </div>
  )
}

function ExperimentsTab({ experiments, loading, error, onOpen, onLaunch, onStop, projectId, onCreate }: {
  experiments: Experiment[]
  loading: boolean
  error: string | null
  onOpen: (e: Experiment) => void
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  projectId: string
  onCreate: () => void
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher to manage experiments." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!experiments.length) {
    return (
      <EmptyState
        title="No experiments"
        description="Create your first A/B experiment to start testing variants with SDK assignment."
        action={<Btn size="sm" variant="primary" onClick={onCreate}>Create experiment</Btn>}
      />
    )
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge-subtle bg-surface-overlay text-xs text-fg-muted">
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Variants</th>
            <th className="px-3 py-2 text-left">Mode</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {experiments.map((e) => (
            <tr key={e.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-overlay/50 transition-colors">
              <td className="px-3 py-2">
                <div className="font-medium text-fg-primary">{e.name}</div>
                {e.hypothesis && <div className="text-xs text-fg-muted truncate max-w-[200px]">{e.hypothesis}</div>}
              </td>
              <td className="px-3 py-2">{statusBadge(e.status)}</td>
              <td className="px-3 py-2 tabular-nums text-xs">{e.experiment_variants?.length ?? 0}</td>
              <td className="px-3 py-2">
                {e.bandit_enabled
                  ? <Badge className="bg-brand/10 text-brand border border-brand/20">Bandit</Badge>
                  : <span className="text-xs text-fg-muted">Static</span>}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted"><RelativeTime value={e.created_at} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-1 justify-end">
                  {e.status === 'draft' && (e.experiment_variants?.length ?? 0) >= 2 && (
                    <Btn size="sm" variant="primary" onClick={() => onLaunch(e.id)}>Launch</Btn>
                  )}
                  {e.status === 'running' && <Btn size="sm" variant="ghost" onClick={() => onStop(e.id)}>Stop</Btn>}
                  <Btn size="sm" variant="ghost" onClick={() => onOpen(e)}>View</Btn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function NewExperimentForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', hypothesis: '', bandit_enabled: false })
  const [variants, setVariants] = useState([
    { name: 'Control', description: '', traffic_weight: 0.5 },
    { name: 'Treatment A', description: '', traffic_weight: 0.5 },
  ])

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    if (!projectId) { toast.error('Select a project'); return }
    setLoading(true)
    try {
      const expRes = await apiFetch<{ id: string }>('/v1/admin/experiments', {
        method: 'POST',
        body: JSON.stringify({ ...form, project_id: projectId }),
      })
      if (!expRes.ok) throw new Error(expRes.error?.message ?? 'Create failed')
      const expId = (expRes.data as { id: string }).id
      for (const v of variants) {
        await apiFetch(`/v1/admin/experiments/${expId}/variants`, {
          method: 'POST',
          body: JSON.stringify(v),
        })
      }
      toast.success('Experiment created')
      onCreated()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally { setLoading(false) }
  }

  return (
    <Card className="max-w-2xl p-6 space-y-5">
      <h2 className="text-base font-semibold text-fg-primary">New experiment</h2>
      {!projectId && (
        <p className="text-xs text-warn">Select a project from the switcher before creating an experiment.</p>
      )}
      <div className="grid gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-fg-primary">Name *</span>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Button colour CTA test" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-fg-primary">Hypothesis</span>
          <Input value={form.hypothesis} onChange={(e) => set('hypothesis', e.target.value)} placeholder="Changing CTA to orange will increase clicks by 5%" />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-primary">
          <input type="checkbox" checked={form.bandit_enabled} onChange={(e) => set('bandit_enabled', e.target.checked)} className="h-4 w-4" />
          Enable Thompson Sampling bandit (auto-shifts traffic to winning variant)
        </label>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-fg-primary">Variants</h3>
        {variants.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-fg-muted">Name</span>}
              <Input value={v.name} onChange={(e) => setVariants((vs) => vs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            </label>
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-fg-muted">Weight (0–1)</span>}
              <Input type="number" step={0.1} min={0} max={1} value={v.traffic_weight}
                onChange={(e) => setVariants((vs) => vs.map((x, j) => j === i ? { ...x, traffic_weight: parseFloat(e.target.value) } : x))} />
            </label>
            {i >= 2 && (
              <Btn size="sm" variant="ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>✕</Btn>
            )}
          </div>
        ))}
        <Btn size="sm" variant="ghost" onClick={() => setVariants((vs) => [...vs, { name: `Treatment ${String.fromCharCode(64 + vs.length)}`, description: '', traffic_weight: 0.33 }])}>
          + Add variant
        </Btn>
      </div>

      <Btn variant="primary" onClick={submit} loading={loading} disabled={!projectId}>Create experiment</Btn>
    </Card>
  )
}

function ExperimentDrawer({ experiment, open, onClose, onLaunch, onStop, onRefresh }: {
  experiment: Experiment
  open: boolean
  onClose: () => void
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  onRefresh: () => void
}) {
  const toast = useToast()
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await apiFetch<AnalysisResult>(`/v1/admin/experiments/${experiment.id}/analyze`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Analysis failed')
      setAnalysis(res.data ?? null)
      onRefresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed')
    } finally { setAnalyzing(false) }
  }

  const variants = experiment.experiment_variants ?? []

  return (
    <Drawer open={open} onClose={onClose} title={experiment.name} width="lg">
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap gap-2 items-center">
          {statusBadge(experiment.status)}
          {experiment.bandit_enabled && (
            <Badge className="bg-brand/10 text-brand border border-brand/20">Bandit</Badge>
          )}
          {experiment.winner_variant_id && (
            <Badge className="bg-ok-muted/50 text-ok-foreground border border-ok/20">Winner found</Badge>
          )}
          <div className="ml-auto flex gap-2">
            {experiment.status === 'draft' && variants.length >= 2 && (
              <Btn size="sm" variant="primary" onClick={() => { onLaunch(experiment.id); onRefresh() }}>Launch</Btn>
            )}
            {experiment.status === 'running' && (
              <Btn size="sm" variant="ghost" onClick={() => { onStop(experiment.id); onRefresh() }}>Stop</Btn>
            )}
            <Btn size="sm" variant="ghost" onClick={analyze} loading={analyzing}>Analyze</Btn>
          </div>
        </div>

        {experiment.hypothesis && (
          <div className="rounded-md bg-surface-overlay px-4 py-3 text-sm italic text-fg-primary">{experiment.hypothesis}</div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-fg-muted uppercase tracking-wide">Variants</p>
          <div className="space-y-2">
            {variants.map((v) => (
              <div key={v.id} className={`flex items-center gap-3 rounded-md border p-3 ${experiment.winner_variant_id === v.id ? 'border-ok/40 bg-ok/5' : 'border-edge-subtle'}`}>
                <div className="flex-1">
                  <div className="font-medium text-sm text-fg-primary">{v.name}</div>
                  <div className="text-xs text-fg-muted">
                    Weight: {(v.traffic_weight * 100).toFixed(0)}%
                    {experiment.bandit_enabled && ` · α=${v.bandit_alpha.toFixed(1)} β=${v.bandit_beta.toFixed(1)}`}
                  </div>
                </div>
                {experiment.winner_variant_id === v.id && (
                  <Badge className="bg-ok-muted/50 text-ok-foreground border border-ok/20">Winner</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        {analysis && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Analysis</p>

            <div className={`rounded-md border px-4 py-3 text-sm ${analysis.srm_ok ? 'border-ok/30 bg-ok/5' : 'border-danger/30 bg-danger/5'}`}>
              <div className="font-medium text-fg-primary">{analysis.srm_ok ? 'SRM check passed' : 'SRM detected'}</div>
              <div className="text-xs mt-0.5 text-fg-muted">chi-square p = {analysis.srm_p.toFixed(4)}</div>
            </div>

            <Card className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-fg-muted text-xs">p-value</span><div className="font-mono font-medium">{analysis.p_value.toFixed(4)}</div></div>
                <div><span className="text-fg-muted text-xs">mSPRT log-LR</span><div className="font-mono font-medium">{analysis.log_lr.toFixed(3)}</div></div>
                <div><span className="text-fg-muted text-xs">Relative lift</span><div className="font-mono font-medium">{(analysis.relative_lift * 100).toFixed(1)}%</div></div>
              </div>
              <p className="text-sm mt-2 border-t border-edge-subtle pt-2 text-fg-primary">{analysis.recommendation}</p>
            </Card>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge-subtle text-fg-muted">
                  <th className="py-1 text-left">Variant</th>
                  <th className="py-1 text-right">N</th>
                  <th className="py-1 text-right">Converted</th>
                  <th className="py-1 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {analysis.variant_stats.map((v) => (
                  <tr key={v.id} className="border-b border-edge-subtle last:border-0">
                    <td className="py-1">{v.name}</td>
                    <td className="py-1 text-right tabular-nums">{v.total}</td>
                    <td className="py-1 text-right tabular-nums">{v.converted}</td>
                    <td className="py-1 text-right tabular-nums">{(v.rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ContainedBlock tone="muted" label="Timeline">
          {experiment.start_at && (
            <InlineProof>
              Started <RelativeTime value={experiment.start_at} />
            </InlineProof>
          )}
          {experiment.end_at && (
            <InlineProof className={experiment.start_at ? 'mt-1.5' : ''}>
              Stopped <RelativeTime value={experiment.end_at} />
            </InlineProof>
          )}
        </ContainedBlock>
      </div>
    </Drawer>
  )
}
