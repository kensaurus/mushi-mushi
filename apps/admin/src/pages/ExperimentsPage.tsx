/**
 * FILE: apps/admin/src/pages/ExperimentsPage.tsx
 * PURPOSE: A/B experiment console — banner + EXPERIMENTS SNAPSHOT + tabs:
 *          Overview | Experiments | New.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useExperimentsUx, resolveQuickExperimentsRedirect, parseVariantWeight } from '../lib/experimentsModeUx'
import { describeApiError } from '../lib/humanizeApiError'
import { PageLoadError } from '../components/PageLoadError'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../lib/toast'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  Card,
  Badge,
  Btn,
  Input,
  EmptyState,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  Tooltip,
} from '../components/ui'
import { IconEye, IconPause } from '../components/icons'
import {
  ContainedBlock,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { ExperimentsStatusBanner } from '../components/experiments/ExperimentsStatusBanner'
import { ExperimentsSnapshotStrip } from '../components/experiments/ExperimentsSnapshotStrip'
import { ExperimentsReadout } from '../components/experiments/ExperimentsReadout'
import {
  EMPTY_EXPERIMENTS_STATS,
  type ExperimentsStats,
  type ExperimentsTabId,
} from '../components/experiments/ExperimentsStatsTypes'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { CHIP_TONE, runStatusChipTone, HEADER_BADGE_TONE } from '../lib/chipTone'

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

/** Draft stays quiet (not lifecycle warn); other statuses use the shared map. */
const STATUS_CLS: Record<Experiment['status'], string> = {
  draft: CHIP_TONE.neutral,
  running: runStatusChipTone('running'),
  stopped: runStatusChipTone('stopped'),
  completed: runStatusChipTone('completed'),
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
    errorCode: statsErrorCode,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ExperimentsStats>('/v1/admin/experiments/stats')
  usePublishPageHeroStats('/experiments', statsData)
  const stats = { ...EMPTY_EXPERIMENTS_STATS, ...statsData }

  const {
    data: expData,
    loading,
    error,
    errorCode,
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

  // Quickstart picks the landing tab once (no ?tab= yet); an explicit tab —
  // e.g. "New experiment" — is respected, so a second experiment can be made.
  const rawTab = searchParams.get('tab')
  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const target = resolveQuickExperimentsRedirect(stats, rawTab)
    if (target) setActiveTab(target)
  }, [ux.isQuickstart, statsLoading, stats, rawTab, setActiveTab])

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

  // Both return the updated experiment (with variants) so the drawer can show
  // the new status at once, or null when the server refused.
  const launch = useCallback(async (id: string): Promise<Experiment | null> => {
    const res = await apiFetch<Experiment>(`/v1/admin/experiments/${id}/launch`, { method: 'POST' })
    if (!res.ok) {
      const e = describeApiError(res.error, 'Could not launch the experiment')
      toast.error(e.title, e.hint)
      return null
    }
    toast.success('Experiment launched')
    reloadAll()
    return res.data ?? null
  }, [reloadAll, toast])

  const stop = useCallback(async (id: string): Promise<Experiment | null> => {
    const res = await apiFetch<Experiment>(`/v1/admin/experiments/${id}/stop`, { method: 'POST' })
    if (!res.ok) {
      const e = describeApiError(res.error, 'Could not stop the experiment')
      toast.error(e.title, e.hint)
      return null
    }
    toast.success('Experiment stopped')
    reloadAll()
    return res.data ?? null
  }, [reloadAll, toast])

  const openDetail = useCallback(async (exp: Experiment) => {
    // apiFetch already unwraps the `{ ok, data }` envelope.
    const res = await apiFetch<Experiment>(`/v1/admin/experiments/${exp.id}`)
    setSelected(res.ok && res.data ? res.data : exp)
    setDrawerOpen(true)
  }, [])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading experiments">
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
    return <PageLoadError error={statsError} code={statsErrorCode} onRetry={reloadStats} />
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
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-experiments">
      <PageHeaderBar
        title={copy?.title ?? 'Experiments'}
        projectScope={stats.projectName ?? projectName ?? undefined}

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
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'warn'
                ? CHIP_TONE.warnSubtle
                : bannerSeverity === 'brand'
                  ? HEADER_BADGE_TONE.brand
                  : HEADER_BADGE_TONE.neutral
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

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <ExperimentsStatusBanner
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
            show: !ux.hideExperimentsSnapshot,
            children: (
              <ExperimentsSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'EXPERIMENTS SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ExperimentsTabId>
        size="sm"
        scrollable
        ariaLabel="Experiments sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <ExperimentsReadout
            stats={stats}
            fetchedAt={statsFetchedAt}
            isValidating={statsValidating}
          />
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
          errorCode={errorCode}
          onRetry={reloadExperiments}
          onOpen={openDetail}
          onLaunch={launch}
          onStop={stop}
          projectId={projectId ?? ''}
          onCreate={() => setActiveTab('new')}
          showNewButton={ux.hideOverviewChrome}
        />
      )}

      {activeTab === 'new' && (
        <NewExperimentForm
          projectId={projectId ?? ''}
          onCreated={() => { setActiveTab('experiments'); reloadAll() }}
          onCancel={ux.hideTabs && stats.totalExperiments > 0 ? () => setActiveTab('experiments') : undefined}
        />
      )}

      {drawerOpen && selected && (
        <ExperimentDrawer
          experiment={selected}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelected(null) }}
          onLaunch={launch}
          onStop={stop}
          onUpdated={setSelected}
          onDeleted={() => { setDrawerOpen(false); setSelected(null); reloadAll() }}
          onRefresh={async () => {
            const res = await apiFetch<Experiment>(`/v1/admin/experiments/${selected.id}`)
            if (res.ok && res.data) setSelected(res.data)
            reloadAll()
          }}
        />
      )}
    </div>
  )
}

function ExperimentsTab({ experiments, loading, error, errorCode, onRetry, onOpen, onLaunch, onStop, projectId, onCreate, showNewButton }: {
  experiments: Experiment[]
  loading: boolean
  error: string | null
  errorCode: string | null
  onRetry: () => void
  onOpen: (e: Experiment) => void
  onLaunch: (id: string) => Promise<unknown>
  onStop: (id: string) => Promise<unknown>
  projectId: string
  onCreate: () => void
  /** Quickstart / beginner hide the header "+ New", so the list carries it. */
  showNewButton: boolean
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher to manage experiments." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <PageLoadError error={error} code={errorCode} resource="experiments" onRetry={onRetry} />
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
    <div className="space-y-2">
    {showNewButton && (
      <div className="flex justify-end">
        <Btn size="sm" variant="primary" onClick={onCreate}>+ New experiment</Btn>
      </div>
    )}
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
            <tr key={e.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-overlay/50 transition-opacity">
              <td className="px-3 py-2">
                <div className="font-medium text-fg-primary">{e.name}</div>
                {e.hypothesis && <div className="text-xs text-fg-muted truncate max-w-48">{e.hypothesis}</div>}
              </td>
              <td className="px-3 py-2">{statusBadge(e.status)}</td>
              <td className="px-3 py-2 tabular-nums text-xs">{e.experiment_variants?.length ?? 0}</td>
              <td className="px-3 py-2">
                {e.bandit_enabled
                  ? <Badge className={CHIP_TONE.brandSubtle}>Bandit</Badge>
                  : <span className="text-xs text-fg-muted">Static</span>}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted"><RelativeTime value={e.created_at} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-1 justify-end">
                  {e.status === 'draft' && (e.experiment_variants?.length ?? 0) >= 2 && (
                    <Btn size="sm" variant="primary" onClick={() => onLaunch(e.id)}>Launch</Btn>
                  )}
                  {e.status === 'running' && (
                    <Tooltip content="Stop experiment">
                      <Btn
                        size="sm"
                        variant="ghost"
                        className="px-2"
                        aria-label={`Stop experiment ${e.name}`}
                        onClick={() => onStop(e.id)}
                      >
                        <IconPause />
                      </Btn>
                    </Tooltip>
                  )}
                  <Tooltip content="View experiment">
                    <Btn
                      size="sm"
                      variant="ghost"
                      className="px-2"
                      aria-label={`View experiment ${e.name}`}
                      onClick={() => onOpen(e)}
                    >
                      <IconEye />
                    </Btn>
                  </Tooltip>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    </div>
  )
}

function NewExperimentForm({ projectId, onCreated, onCancel }: { projectId: string; onCreated: () => void; onCancel?: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', hypothesis: '', bandit_enabled: false })
  // Weights stay as typed text; parseVariantWeight validates on submit so an
  // empty field never reaches the API as NaN → null.
  const [variants, setVariants] = useState([
    { name: 'Control', description: '', traffic_weight: '0.5' },
    { name: 'Treatment A', description: '', traffic_weight: '0.5' },
  ])

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    if (!projectId) { toast.error('Select a project'); return }
    const parsedVariants = variants.map((v) => ({ ...v, name: v.name.trim(), traffic_weight: parseVariantWeight(v.traffic_weight) }))
    const badVariant = parsedVariants.find((v) => !v.name || v.traffic_weight == null)
    if (badVariant) {
      toast.error('Check the variants', 'Every variant needs a name and a weight between 0 and 1.')
      return
    }
    setLoading(true)
    let createdId: string | null = null
    try {
      const expRes = await apiFetch<{ id: string }>('/v1/admin/experiments', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          name: form.name,
          description: form.description || null,
          hypothesis: form.hypothesis || null,
          bandit_enabled: form.bandit_enabled,
        }),
      })
      if (!expRes.ok) {
        const e = describeApiError(expRes.error, 'Could not create the experiment')
        toast.error(e.title, e.hint)
        return
      }
      const expId = (expRes.data as { id: string }).id
      createdId = expId
      for (const v of parsedVariants) {
        const variantRes = await apiFetch(`/v1/admin/experiments/${expId}/variants`, {
          method: 'POST',
          body: JSON.stringify(v),
        })
        if (!variantRes.ok) {
          // The experiment row already exists; say so instead of implying
          // nothing was saved, and point at where it can be finished.
          const e = describeApiError(variantRes.error, `Variant "${v.name}" was not saved`)
          toast.error(e.title, `${e.hint} The experiment was saved as a draft: open it from the list to add the missing variant or delete it.`)
          onCreated()
          return
        }
      }
      toast.success('Experiment created')
      onCreated()
    } catch {
      toast.error(
        createdId ? 'The experiment was only partly saved' : 'Could not create the experiment',
        createdId ? 'Open the draft from the list to finish it.' : 'Try again in a moment.',
      )
      if (createdId) onCreated()
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
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-fg-muted">Name</span>}
              <Input value={v.name} onChange={(e) => setVariants((vs) => vs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            </label>
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-fg-muted">Weight (0–1)</span>}
              <Input type="number" step={0.1} min={0} max={1} value={v.traffic_weight}
                onChange={(e) => setVariants((vs) => vs.map((x, j) => j === i ? { ...x, traffic_weight: e.target.value } : x))} />
            </label>
            {i >= 2 && (
              <Btn size="sm" variant="ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>✕</Btn>
            )}
          </div>
        ))}
        <Btn size="sm" variant="ghost" onClick={() => setVariants((vs) => [...vs, { name: `Treatment ${String.fromCharCode(64 + vs.length)}`, description: '', traffic_weight: '0.33' }])}>
          + Add variant
        </Btn>
      </div>

      <div className="flex gap-2">
        <Btn variant="primary" onClick={submit} loading={loading} disabled={!projectId}>Create experiment</Btn>
        {onCancel && <Btn variant="ghost" onClick={onCancel} disabled={loading}>Back to experiments</Btn>}
      </div>
    </Card>
  )
}

function ExperimentDrawer({ experiment, open, onClose, onLaunch, onStop, onRefresh, onUpdated, onDeleted }: {
  experiment: Experiment
  open: boolean
  onClose: () => void
  onLaunch: (id: string) => Promise<Experiment | null>
  onStop: (id: string) => Promise<Experiment | null>
  onRefresh: () => Promise<void>
  onUpdated: (e: Experiment) => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [transition, setTransition] = useState<'launch' | 'stop' | null>(null)
  const [variantDraft, setVariantDraft] = useState({ name: '', weight: '0.5' })
  const [addingVariant, setAddingVariant] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await apiFetch<AnalysisResult>(`/v1/admin/experiments/${experiment.id}/analyze`, { method: 'POST' })
      if (!res.ok) {
        const e = describeApiError(res.error, 'Could not analyze the experiment')
        toast.error(e.title, e.hint)
        return
      }
      setAnalysis(res.data ?? null)
      // Analyze can declare a winner and move bandit weights: show them.
      await onRefresh()
    } finally { setAnalyzing(false) }
  }

  const runTransition = async (kind: 'launch' | 'stop') => {
    setTransition(kind)
    try {
      const updated = kind === 'launch' ? await onLaunch(experiment.id) : await onStop(experiment.id)
      if (updated) onUpdated(updated)
    } finally { setTransition(null) }
  }

  const addVariant = async () => {
    const name = variantDraft.name.trim()
    const weight = parseVariantWeight(variantDraft.weight)
    if (!name || weight == null) {
      toast.error('Check the variant', 'Give it a name and a weight between 0 and 1.')
      return
    }
    setAddingVariant(true)
    const res = await apiFetch(`/v1/admin/experiments/${experiment.id}/variants`, {
      method: 'POST',
      body: JSON.stringify({ name, traffic_weight: weight }),
    })
    setAddingVariant(false)
    if (!res.ok) {
      const e = describeApiError(res.error, 'Could not add the variant')
      toast.error(e.title, e.hint)
      return
    }
    toast.success(`Variant "${name}" added`)
    setVariantDraft({ name: '', weight: '0.5' })
    await onRefresh()
  }

  const deleteDraft = async () => {
    setDeleting(true)
    const res = await apiFetch(`/v1/admin/experiments/${experiment.id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDelete(false)
    if (!res.ok) {
      const e = describeApiError(res.error, 'Could not delete the draft')
      toast.error(e.title, e.hint)
      return
    }
    toast.success('Draft deleted')
    onDeleted()
  }

  const variants = experiment.experiment_variants ?? []
  const missingVariants = Math.max(0, 2 - variants.length)

  return (
    <Drawer open={open} onClose={onClose} title={experiment.name} width="lg">
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap gap-2 items-center">
          {statusBadge(experiment.status)}
          {experiment.bandit_enabled && (
            <Badge className={CHIP_TONE.brandSubtle}>Bandit</Badge>
          )}
          {experiment.winner_variant_id && (
            <Badge className={CHIP_TONE.okSubtle}>Winner found</Badge>
          )}
          <div className="ml-auto flex gap-2">
            {experiment.status === 'draft' && variants.length >= 2 && (
              <Btn size="sm" variant="primary" loading={transition === 'launch'} disabled={transition != null} onClick={() => void runTransition('launch')}>Launch</Btn>
            )}
            {experiment.status === 'running' && (
              <Btn size="sm" variant="ghost" loading={transition === 'stop'} disabled={transition != null} onClick={() => void runTransition('stop')}>Stop</Btn>
            )}
            <Btn size="sm" variant="ghost" onClick={analyze} loading={analyzing}>Analyze</Btn>
            {experiment.status === 'draft' && (
              <Btn size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete draft</Btn>
            )}
          </div>
        </div>

        {experiment.status === 'draft' && (
          <ContainedBlock tone="muted" label="Variants">
            <p className="mb-2 text-xs text-fg-muted">
              {missingVariants > 0
                ? `Add ${missingVariants} more variant${missingVariants === 1 ? '' : 's'} to launch: a test needs a control and at least one treatment.`
                : 'Ready to launch. You can still add more variants first.'}
            </p>
            {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
            <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
              <Input
                label="Name"
                value={variantDraft.name}
                onChange={(e) => setVariantDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={variants.length === 0 ? 'Control' : 'Treatment A'}
              />
              <Input
                label="Weight (0–1)"
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={variantDraft.weight}
                onChange={(e) => setVariantDraft((d) => ({ ...d, weight: e.target.value }))}
              />
              <Btn size="sm" onClick={addVariant} loading={addingVariant}>Add variant</Btn>
            </div>
          </ContainedBlock>
        )}

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
                  <Badge className={CHIP_TONE.okSubtle}>Winner</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        {analysis && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Analysis</p>

            <div className={`rounded-md border px-4 py-3 text-sm ${analysis.srm_ok ? 'border-ok/30 bg-ok/5' : 'border-danger/40 bg-surface-raised'}`}>
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

        {confirmDelete && (
          <ConfirmDialog
            title={`Delete the draft "${experiment.name}"?`}
            body="The draft and its variants are removed. It never ran, so no assignments or results are lost."
            confirmLabel="Delete draft"
            tone="danger"
            loading={deleting}
            onConfirm={deleteDraft}
            onCancel={() => (deleting ? undefined : setConfirmDelete(false))}
          />
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
