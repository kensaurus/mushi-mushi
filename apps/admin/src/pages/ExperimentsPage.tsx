/**
 * FILE: apps/admin/src/pages/ExperimentsPage.tsx
 * PURPOSE: A/B experiment console — create, launch, analyze, and ship winners.
 *   Phase 5 of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Experiments  — list with status, variants, live stats
 *     New          — create + add variants
 *     [Drawer]     — analysis results: CUPED, mSPRT, SRM, bandit config
 */

import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectSignal } from '../lib/activeProject'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
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
} from '../components/ui'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<Experiment['status'], string> = {
  draft:     'bg-muted text-muted-foreground',
  running:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  stopped:   'bg-muted text-muted-foreground',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
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

// ─── Main page ───────────────────────────────────────────────────────────────

export function ExperimentsPage() {
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const [tab, setTab] = useState<'experiments' | 'new'>('experiments')
  const [selected, setSelected] = useState<Experiment | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/experiments',
    title: 'Experiments',
    summary: 'A/B and multi-arm RCT experiments — run controlled tests against real users with statistical significance tracking.',
    filters: { tab, project_id: projectId ?? undefined },
  })

  const {
    data: expData,
    loading,
    error,
    reload,
  } = usePageData<{ data: Experiment[]; total: number }>(
    projectId ? `/v1/admin/experiments?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  const experiments = listRows(expData)
  const running = experiments.filter(e => e.status === 'running').length

  const launch = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/experiments/${id}/launch`, { method: 'POST' })
    if (!res.ok) { toast.error(res.error?.message ?? 'Launch failed'); return }
    toast.success('Experiment launched')
    reload()
  }, [reload, toast])

  const stop = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/experiments/${id}/stop`, { method: 'POST' })
    if (!res.ok) { toast.error(res.error?.message ?? 'Stop failed'); return }
    toast.success('Experiment stopped')
    reload()
  }, [reload, toast])

  const openDetail = useCallback(async (exp: Experiment) => {
    const res = await apiFetch<{ data: Experiment }>(`/v1/admin/experiments/${exp.id}`)
    setSelected(res.data?.data ?? exp)
    setDrawerOpen(true)
  }, [])

  const tabs = [
    { id: 'experiments', label: `Experiments (${experiments.length})` },
    { id: 'new',         label: 'New' },
  ] as const

  return (
    <div className="space-y-4">
      <PageHeader
        title="Experiments"
        description="A/B test UI variants, messaging, and feature flags with CUPED variance reduction, mSPRT always-valid p-values, and SRM checks."
      >
        <Btn variant="primary" size="sm" onClick={() => setTab('new')}>+ New</Btn>
      </PageHeader>

      <PageHelp
        title="A/B experiments"
        whatIsIt="Each experiment auto-assigns reporters to variants via deterministic hash or Thompson sampling (bandit mode). Run Analyze at any time for an always-valid p-value — no peeking penalty."
        useCases={[
          'Test button copy, colour, or layout variants',
          'Measure impact of a new feature on report rate',
          'Use bandit mode for fast exploration with small samples',
        ]}
        howToUse="Create an experiment, add variants, launch it. The SDK assigns users via mushi.experiment(). Analyze at any time — mSPRT prevents false positives."
      />

      <Section title="Experiment overview">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard label="Total" value={experiments.length} />
          <StatCard label="Running" value={running} />
          <StatCard label="Winners found" value={experiments.filter(e => e.winner_variant_id).length} />
        </div>

        <SegmentedControl value={tab} onChange={v => setTab(v as typeof tab)} options={tabs} className="mb-6" />

        {tab === 'experiments' && (
          <ExperimentsTab
            experiments={experiments}
            loading={loading}
            error={error}
            onOpen={openDetail}
            onLaunch={launch}
            onStop={stop}
            projectId={projectId}
          />
        )}
        {tab === 'new' && (
          <NewExperimentForm projectId={projectId} onCreated={() => { setTab('experiments'); reload() }} />
        )}
      </Section>

      {drawerOpen && selected && (
        <ExperimentDrawer
          experiment={selected}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelected(null) }}
          onLaunch={launch}
          onStop={stop}
          onRefresh={async () => {
            const res = await apiFetch<{ data: Experiment }>(`/v1/admin/experiments/${selected.id}`)
            if (res.ok && res.data) setSelected(res.data as Experiment)
          }}
        />
      )}
    </div>
  )
}

// ─── Experiments tab ──────────────────────────────────────────────────────────

function ExperimentsTab({ experiments, loading, error, onOpen, onLaunch, onStop, projectId }: {
  experiments: Experiment[]
  loading: boolean
  error: string | null
  onOpen: (e: Experiment) => void
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  projectId: string
}) {
  if (!projectId) return <EmptyState title="Select a project" />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!experiments.length) return <EmptyState title="No experiments" description="Create your first A/B experiment to start testing variants." />

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Variants</th>
            <th className="px-3 py-2 text-left">Bandit</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {experiments.map(e => (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-3 py-2">
                <div className="font-medium">{e.name}</div>
                {e.hypothesis && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{e.hypothesis}</div>}
              </td>
              <td className="px-3 py-2">{statusBadge(e.status)}</td>
              <td className="px-3 py-2 tabular-nums text-xs">{e.experiment_variants?.length ?? '—'}</td>
              <td className="px-3 py-2">
                {e.bandit_enabled
                  ? <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Bandit</Badge>
                  : <span className="text-xs text-muted-foreground">Static</span>}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground"><RelativeTime value={e.created_at} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-1 justify-end">
                  {e.status === 'draft' && <Btn size="sm" variant="primary" onClick={() => onLaunch(e.id)}>Launch</Btn>}
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

// ─── New experiment form ──────────────────────────────────────────────────────

function NewExperimentForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', hypothesis: '', bandit_enabled: false })
  const [variants, setVariants] = useState([
    { name: 'Control', description: '', traffic_weight: 0.5 },
    { name: 'Treatment A', description: '', traffic_weight: 0.5 },
  ])

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

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
      <h2 className="text-base font-semibold">New experiment</h2>
      <div className="grid gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Name *</span>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Button colour CTA test" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Hypothesis</span>
          <Input value={form.hypothesis} onChange={e => set('hypothesis', e.target.value)} placeholder="Changing CTA to orange will increase clicks by 5%" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.bandit_enabled} onChange={e => set('bandit_enabled', e.target.checked)} className="h-4 w-4" />
          Enable Thompson Sampling bandit (auto-shifts traffic to winning variant)
        </label>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Variants</h3>
        {variants.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-muted-foreground">Name</span>}
              <Input value={v.name} onChange={e => setVariants(vs => vs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            </label>
            <label className="block space-y-1">
              {i === 0 && <span className="text-xs text-muted-foreground">Weight (0–1)</span>}
              <Input type="number" step={0.1} min={0} max={1} value={v.traffic_weight}
                onChange={e => setVariants(vs => vs.map((x, j) => j === i ? { ...x, traffic_weight: parseFloat(e.target.value) } : x))} />
            </label>
            {i >= 2 && (
              <Btn size="sm" variant="ghost" onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))}>✕</Btn>
            )}
          </div>
        ))}
        <Btn size="sm" variant="ghost" onClick={() => setVariants(vs => [...vs, { name: `Treatment ${String.fromCharCode(64 + vs.length)}`, description: '', traffic_weight: 0.33 }])}>
          + Add variant
        </Btn>
      </div>

      <Btn variant="primary" onClick={submit} loading={loading}>Create experiment</Btn>
    </Card>
  )
}

// ─── Experiment drawer ────────────────────────────────────────────────────────

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
            <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Bandit</Badge>
          )}
          {experiment.winner_variant_id && (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Winner found</Badge>
          )}
          <div className="ml-auto flex gap-2">
            {experiment.status === 'draft' && (
              <Btn size="sm" variant="primary" onClick={() => { onLaunch(experiment.id); onRefresh() }}>Launch</Btn>
            )}
            {experiment.status === 'running' && (
              <Btn size="sm" variant="ghost" onClick={() => { onStop(experiment.id); onRefresh() }}>Stop</Btn>
            )}
            <Btn size="sm" variant="ghost" onClick={analyze} loading={analyzing}>Analyze</Btn>
          </div>
        </div>

        {experiment.hypothesis && (
          <div className="rounded-md bg-muted/40 px-4 py-3 text-sm italic">{experiment.hypothesis}</div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants</p>
          <div className="space-y-2">
            {variants.map(v => (
              <div key={v.id} className={`flex items-center gap-3 rounded-md border p-3 ${experiment.winner_variant_id === v.id ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>
                <div className="flex-1">
                  <div className="font-medium text-sm">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Weight: {(v.traffic_weight * 100).toFixed(0)}%
                    {experiment.bandit_enabled && ` · α=${v.bandit_alpha.toFixed(1)} β=${v.bandit_beta.toFixed(1)}`}
                  </div>
                </div>
                {experiment.winner_variant_id === v.id && (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Winner</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        {analysis && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analysis</p>

            <div className={`rounded-md border px-4 py-3 text-sm ${analysis.srm_ok ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' : 'border-rose-300 bg-rose-50 dark:bg-rose-950/30'}`}>
              <div className="font-medium">{analysis.srm_ok ? '✅ SRM check passed' : '⚠️ SRM detected'}</div>
              <div className="text-xs mt-0.5 text-muted-foreground">chi-square p = {analysis.srm_p.toFixed(4)}</div>
            </div>

            <Card className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">p-value</span><div className="font-mono font-medium">{analysis.p_value.toFixed(4)}</div></div>
                <div><span className="text-muted-foreground text-xs">mSPRT log-LR</span><div className="font-mono font-medium">{analysis.log_lr.toFixed(3)}</div></div>
                <div><span className="text-muted-foreground text-xs">Relative lift</span><div className="font-mono font-medium">{(analysis.relative_lift * 100).toFixed(1)}%</div></div>
              </div>
              <p className="text-sm mt-2 border-t pt-2">{analysis.recommendation}</p>
            </Card>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 text-left">Variant</th>
                  <th className="py-1 text-right">N</th>
                  <th className="py-1 text-right">Converted</th>
                  <th className="py-1 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {analysis.variant_stats.map(v => (
                  <tr key={v.id} className="border-b last:border-0">
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

        <div className="rounded-md border bg-muted/20 px-4 py-3 space-y-1 text-xs text-muted-foreground">
          {experiment.start_at && <div className="flex gap-2"><span className="w-20">Started</span><RelativeTime value={experiment.start_at} /></div>}
          {experiment.end_at && <div className="flex gap-2"><span className="w-20">Stopped</span><RelativeTime value={experiment.end_at} /></div>}
        </div>
      </div>
    </Drawer>
  )
}
