/**
 * FILE: apps/admin/src/pages/IteratePage.tsx
 * PURPOSE: PDCA iteration console — queue runs, watch live progress,
 *   inspect the critique panel, and exit with a draft PR.
 *   Phase 3c of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Runs        — list of all PDCA runs for the project
 *     New Run     — queue a new run
 *     [Run Detail] — opens as a drawer with iteration timeline + critique
 */

import { useState, useCallback, useEffect, useRef } from 'react'
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
import { PdcaContextHint } from '../components/PdcaContextHint'
import { IconChevronRight } from '../components/icons'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PdcaRun {
  id: string
  project_id: string
  target_url: string
  goal: string
  iterations_target: number
  current_iteration: number
  status: 'queued' | 'running' | 'succeeded' | 'aborted' | 'failed'
  primary_model: string
  judge_model: string
  persona: string
  target_score: number
  started_at: string | null
  finished_at: string | null
  final_score: number | null
  created_at: string
  iterations?: PdcaIteration[]
}

interface PdcaIteration {
  id: string
  run_id: string
  iteration_n: number
  draft_html_url: string | null
  screenshot_after_url: string | null
  critique_text: string | null
  score: number | null
  score_breakdown: Record<string, number>
  model_cost_usd: number
  ms_elapsed: number
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<PdcaRun['status'], string> = {
  queued:    'bg-muted text-muted-foreground',
  running:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  succeeded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  aborted:   'bg-muted text-muted-foreground',
  failed:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const STATUS_LABEL: Record<PdcaRun['status'], string> = {
  queued: 'Queued', running: 'Running…', succeeded: 'Succeeded', aborted: 'Aborted', failed: 'Failed',
}

function statusBadge(status: PdcaRun['status']) {
  return <Badge className={STATUS_CLS[status]}>{STATUS_LABEL[status]}</Badge>
}

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

function scoreBar(score: number | null) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(score * 100)
  const colour = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${colour} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums">{pct}%</span>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function IteratePage() {
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const [tab, setTab] = useState<'runs' | 'new'>('runs')
  const [selectedRun, setSelectedRun] = useState<PdcaRun | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/iterate',
    title: 'Iterate',
    summary: 'PDCA-cycle runs — Plan, Do, Check, Act iteration loops powered by LLM agents.',
    filters: { tab, project_id: projectId ?? undefined },
  })

  const {
    data: runsData,
    loading: runsLoading,
    error: runsError,
    reload: reloadRuns,
  } = usePageData<{ data: PdcaRun[]; total: number }>(
    projectId ? `/v1/admin/pdca?project_id=${projectId}&limit=50` : null,
    { deps: [projectId] },
  )

  const runs = listRows(runsData)
  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'queued')

  // Auto-refresh while there are active runs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (activeRuns.length > 0 && !pollRef.current) {
      pollRef.current = setInterval(reloadRuns, 4000)
    } else if (activeRuns.length === 0 && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [activeRuns.length, reloadRuns])

  const openDetail = useCallback(async (run: PdcaRun) => {
    const res = await apiFetch<{ data: PdcaRun }>(`/v1/admin/pdca/${run.id}`)
    setSelectedRun(res.data?.data ?? run)
    setDrawerOpen(true)
  }, [])

  const abortRun = useCallback(async (runId: string) => {
    const res = await apiFetch(`/v1/admin/pdca/${runId}`, { method: 'DELETE' })
    if (!res.ok) { toast.error(res.error?.message ?? 'Abort failed'); return }
    reloadRuns()
    toast.success('Run aborted')
  }, [reloadRuns, toast])

  const triggerRun = useCallback(async (runId: string) => {
    const res = await apiFetch(`/v1/admin/pdca/${runId}/trigger`, { method: 'POST' })
    if (res.ok) { toast.success('Runner triggered'); reloadRuns() }
    else toast.error(res.error?.message ?? 'Trigger failed')
  }, [reloadRuns, toast])

  const tabs = [
    { id: 'runs', label: 'Runs' },
    { id: 'new',  label: 'New Run' },
  ] as const

  return (
    <div className="space-y-4">
      <PageHeader
        title="Iterate"
        description="Autonomous PDCA loops — queue a run, watch the producer/critic cycle, exit with a draft improvement plan."
        contextChip={<PdcaContextHint stage="act" />}
      >
        <Btn variant="primary" size="sm" onClick={() => setTab('new')}>+ New Run</Btn>
      </PageHeader>

      <PageHelp
        title="PDCA autonomous iteration"
        whatIsIt="Each run fetches the target URL, generates improved markup (producer), then critiques it (critic) using a configurable LLM persona. The loop continues until the target score is reached or the monotonicity guard kicks in."
        useCases={[
          "Improve a dashboard page's visual hierarchy automatically",
          'Run a WCAG accessibility critique cycle',
          'Use a conversion-rate-optimizer persona to suggest CTA copy changes',
        ]}
        howToUse="Queue a run with a target URL, goal, and persona. Trigger it manually or wait for the cron. Inspect the critique panel and copy to a PR when done."
      />

      <Section title="PDCA runs">
        {activeRuns.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <span className="animate-pulse">⏳</span>
            {activeRuns.length} run{activeRuns.length > 1 ? 's' : ''} in progress — auto-refreshing every 4s
          </div>
        )}

        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={tabs}
          className="mb-6"
        />

        {tab === 'runs' && (
          <RunsTab
            runs={runs}
            loading={runsLoading}
            error={runsError}
            onOpen={openDetail}
            onAbort={abortRun}
            onTrigger={triggerRun}
            projectId={projectId}
          />
        )}

        {tab === 'new' && (
          <NewRunTab
            projectId={projectId}
            onCreated={() => { setTab('runs'); reloadRuns() }}
          />
        )}
      </Section>

      {drawerOpen && selectedRun && (
        <RunDetailDrawer
          run={selectedRun}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelectedRun(null) }}
          onAbort={abortRun}
          onTrigger={triggerRun}
          onRefresh={async () => {
            const res = await apiFetch<{ data: PdcaRun }>(`/v1/admin/pdca/${selectedRun.id}`)
            if (res.ok && res.data) setSelectedRun(res.data as PdcaRun)
          }}
        />
      )}
    </div>
  )
}

// ─── Runs tab ────────────────────────────────────────────────────────────────

function RunsTab({
  runs, loading, error, onOpen, onAbort, onTrigger, projectId,
}: {
  runs: PdcaRun[]
  loading: boolean
  error: string | null
  onOpen: (r: PdcaRun) => void
  onAbort: (id: string) => void
  onTrigger: (id: string) => void
  projectId: string
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher above to see its PDCA runs." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!runs.length) return (
    <EmptyState
      title="No runs yet"
      description="Queue your first PDCA run to start the autonomous improvement cycle."
    />
  )

  const succeeded = runs.filter(r => r.status === 'succeeded').length
  const avgScore = runs
    .filter(r => r.final_score != null)
    .reduce((a, r, _, arr) => a + (r.final_score! / arr.length), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total runs" value={runs.length} />
        <StatCard label="Succeeded" value={succeeded} />
        <StatCard label="Avg final score" value={avgScore ? `${Math.round(avgScore * 100)}%` : '—'} />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left">Target URL</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Progress</th>
              <th className="px-3 py-2 text-left">Final Score</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 max-w-[220px] truncate font-mono text-xs">
                  {run.target_url}
                </td>
                <td className="px-3 py-2">{statusBadge(run.status)}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                  {run.current_iteration}/{run.iterations_target}
                </td>
                <td className="px-3 py-2">{scoreBar(run.final_score)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <RelativeTime value={run.created_at} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    {run.status === 'queued' && (
                      <Btn size="sm" variant="ghost" onClick={() => onTrigger(run.id)}>Trigger</Btn>
                    )}
                    {(run.status === 'queued' || run.status === 'running') && (
                      <Btn size="sm" variant="danger" onClick={() => onAbort(run.id)}>Abort</Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => onOpen(run)}>
                      <IconChevronRight className="h-3 w-3" />
                    </Btn>
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

// ─── New Run tab ─────────────────────────────────────────────────────────────

function NewRunTab({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    target_url: '',
    goal: 'Improve UX: fix visual hierarchy, reduce cognitive load, improve scannability.',
    iterations_target: 5,
    primary_model: 'claude-sonnet-4-6',
    judge_model: 'claude-sonnet-4-6',
    persona: 'nng-heuristic',
    target_score: 0.75,
  })

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.target_url.trim()) { toast.error('Target URL is required'); return }
    if (!projectId) { toast.error('Select a project first'); return }
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/pdca', {
        method: 'POST',
        body: JSON.stringify({ ...form, project_id: projectId }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed')
      toast.success('Run queued — switch to Runs tab to trigger it.')
      onCreated()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const personas = [
    { value: 'nng-heuristic', label: 'Nielsen Norman (UX heuristics)' },
    { value: 'accessibility', label: 'Accessibility reviewer' },
    { value: 'conversion', label: 'Conversion rate optimizer' },
    { value: 'senior-dev',  label: 'Senior developer (clean code)' },
  ]

  const models = [
    { value: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-7',     label: 'Claude Opus 4.7' },
    { value: 'gpt-5.4',             label: 'GPT-5.4' },
  ]

  return (
    <Card className="max-w-2xl p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Queue a new PDCA run</h2>
        <p className="text-sm text-muted-foreground">
          The runner fetches the target URL, iterates producer → critic until the target score is
          met or the monotonicity guard fires.
        </p>
      </div>

      <div className="grid gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Target URL *</span>
          <Input
            value={form.target_url}
            onChange={e => set('target_url', e.target.value)}
            placeholder="https://yourapp.com/dashboard"
            className="font-mono text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Goal / instructions</span>
          <textarea
            value={form.goal}
            onChange={e => set('goal', e.target.value)}
            rows={3}
            className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Max iterations</span>
            <Input
              type="number"
              min={1} max={20}
              value={form.iterations_target}
              onChange={e => set('iterations_target', parseInt(e.target.value, 10))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Target score (0–1)</span>
            <Input
              type="number"
              step={0.05} min={0} max={1}
              value={form.target_score}
              onChange={e => set('target_score', parseFloat(e.target.value))}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Producer model</span>
            <select
              value={form.primary_model}
              onChange={e => set('primary_model', e.target.value)}
              className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
            >
              {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Judge model</span>
            <select
              value={form.judge_model}
              onChange={e => set('judge_model', e.target.value)}
              className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
            >
              {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Critic persona</span>
          <select
            value={form.persona}
            onChange={e => set('persona', e.target.value)}
            className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
          >
            {personas.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <Btn variant="primary" onClick={submit} loading={loading} className="w-full sm:w-auto">
        Queue run
      </Btn>
    </Card>
  )
}

// ─── Run detail drawer ────────────────────────────────────────────────────────

function RunDetailDrawer({
  run, open, onClose, onAbort, onTrigger, onRefresh,
}: {
  run: PdcaRun
  open: boolean
  onClose: () => void
  onAbort: (id: string) => void
  onTrigger: (id: string) => void
  onRefresh: () => void
}) {
  const iterations = run.iterations ?? []
  const [activeIter, setActiveIter] = useState<PdcaIteration | null>(iterations.at(-1) ?? null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (run.status === 'running' || run.status === 'queued') {
      pollRef.current = setInterval(onRefresh, 3000)
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [run.status, onRefresh])

  useEffect(() => {
    if (iterations.length > 0) setActiveIter(iterations.at(-1)!)
  }, [iterations.length])

  const scores = iterations.map(i => i.score ?? 0)

  return (
    <Drawer open={open} onClose={onClose} title={`Run: ${run.target_url}`} width="lg">
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          {statusBadge(run.status)}
          <span className="text-sm text-muted-foreground">
            {run.current_iteration}/{run.iterations_target} iterations
          </span>
          {run.final_score != null && (
            <span className="text-sm font-medium">Final: {Math.round(run.final_score * 100)}%</span>
          )}
          {run.status === 'queued' && (
            <Btn size="sm" variant="ghost" onClick={() => onTrigger(run.id)}>Trigger now</Btn>
          )}
          {(run.status === 'queued' || run.status === 'running') && (
            <Btn size="sm" variant="danger" onClick={() => onAbort(run.id)}>Abort</Btn>
          )}
          {run.status === 'running' && (
            <Btn size="sm" variant="ghost" onClick={onRefresh}>↻ Refresh</Btn>
          )}
        </div>

        {scores.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Score timeline</p>
            <div className="flex items-end gap-1 h-16">
              {scores.map((s, i) => {
                const h = Math.round(s * 100)
                const colour = h >= 70 ? 'bg-emerald-500' : h >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                return (
                  <button
                    key={i}
                    onClick={() => setActiveIter(iterations[i])}
                    className={`flex-1 min-w-[6px] rounded-t-sm transition-opacity ${colour} ${activeIter?.iteration_n === i + 1 ? 'opacity-100 ring-2 ring-ring' : 'opacity-60 hover:opacity-100'}`}
                    style={{ height: `${Math.max(h, 4)}%` }}
                    title={`Iteration ${i + 1}: ${h}%`}
                  />
                )
              })}
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>Iter 1</span>
              <span>Iter {scores.length}</span>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Iterations</p>
          {iterations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {run.status === 'queued' ? 'Waiting to start…' : 'No iterations recorded yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {iterations.map((iter) => (
                <button
                  key={iter.id}
                  onClick={() => setActiveIter(iter)}
                  className={`w-full flex items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/30 ${activeIter?.id === iter.id ? 'border-ring bg-muted/20' : ''}`}
                >
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {iter.iteration_n}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {scoreBar(iter.score)}
                      <span className="text-xs text-muted-foreground">
                        {(iter.ms_elapsed / 1000).toFixed(1)}s · ${iter.model_cost_usd.toFixed(4)}
                      </span>
                    </div>
                    {iter.critique_text && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{iter.critique_text}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {activeIter && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Critique — Iteration {activeIter.iteration_n}
            </p>
            <Card className="p-4 space-y-3">
              {activeIter.score != null && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Overall</span>
                  {scoreBar(activeIter.score)}
                </div>
              )}

              {Object.keys(activeIter.score_breakdown).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(activeIter.score_breakdown).map(([dim, val]) => (
                    <div key={dim} className="flex items-center gap-2 text-xs">
                      <span className="w-32 capitalize text-muted-foreground truncate">{dim.replace(/_/g, ' ')}</span>
                      {scoreBar(val)}
                    </div>
                  ))}
                </div>
              )}

              {activeIter.critique_text && (
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-sm leading-relaxed">{activeIter.critique_text}</p>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="rounded-md border bg-muted/20 px-4 py-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex gap-2"><span className="w-28">Goal</span><span className="text-foreground">{run.goal}</span></div>
          <div className="flex gap-2"><span className="w-28">Producer</span><span className="font-mono">{run.primary_model}</span></div>
          <div className="flex gap-2"><span className="w-28">Judge</span><span className="font-mono">{run.judge_model}</span></div>
          <div className="flex gap-2"><span className="w-28">Persona</span><span className="font-mono">{run.persona}</span></div>
          <div className="flex gap-2"><span className="w-28">Target score</span><span>{Math.round(run.target_score * 100)}%</span></div>
          {run.started_at && <div className="flex gap-2"><span className="w-28">Started</span><RelativeTime value={run.started_at} /></div>}
          {run.finished_at && <div className="flex gap-2"><span className="w-28">Finished</span><RelativeTime value={run.finished_at} /></div>}
        </div>

        {run.status === 'succeeded' && iterations.length > 0 && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-700 dark:bg-emerald-950/30">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
              Run succeeded — export critique as a draft PR comment
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              Copy the critique below and paste into a GitHub PR description or a linear issue.
            </p>
            <Btn
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => {
                const text = iterations.map(i =>
                  `**Iteration ${i.iteration_n}** (score ${i.score?.toFixed(2) ?? '?'})\n${i.critique_text ?? ''}`
                ).join('\n\n---\n\n')
                void navigator.clipboard.writeText(text)
              }}
            >
              Copy critique to clipboard
            </Btn>
          </div>
        )}
      </div>
    </Drawer>
  )
}
