/**
 * FILE: apps/admin/src/pages/AnomaliesPage.tsx
 * PURPOSE: Anomaly detection console — view detected metric regressions,
 *   confirm/dismiss, trigger detection runs, and ingest metric data.
 *   Phase 6 of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Anomalies   — list of detected anomalies with method, score, status
 *     Metrics     — timeseries chart + ingest
 *     Detect      — manual trigger panel
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
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AnomalyDetection {
  id: string
  project_id: string
  metric_name: string
  detected_at: string
  method: string
  score: number
  threshold: number
  value: number
  baseline_mean: number | null
  baseline_std: number | null
  status: 'open' | 'confirmed' | 'dismissed'
  confirmed: boolean
  release_id: string | null
  auto_report_id: string | null
  created_at: string
}

interface MetricPoint {
  ts: string
  value: number
  metric_name: string
  dimension: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const METHOD_CLS: Record<string, string> = {
  'page-hinkley': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  'z-score': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  'release-regression': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function methodBadge(m: string) {
  return <Badge className={METHOD_CLS[m] ?? 'bg-muted text-muted-foreground'}>{m}</Badge>
}

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AnomaliesPage() {
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const [tab, setTab] = useState<'anomalies' | 'metrics' | 'detect'>('anomalies')
  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/anomalies',
    title: 'Anomalies',
    summary: 'Statistical anomaly detection on any metric series you feed in.',
    filters: { tab, project_id: projectId ?? undefined },
  })

  const {
    data: anomalyData,
    loading: anomalyLoading,
    error: anomalyError,
    reload: reloadAnomalies,
  } = usePageData<{ data: AnomalyDetection[]; total: number }>(
    projectId ? `/v1/admin/anomalies?project_id=${projectId}&limit=100` : null,
    { deps: [projectId] },
  )

  const {
    data: metricsData,
    loading: metricsLoading,
    reload: reloadMetrics,
  } = usePageData<{ data: MetricPoint[] }>(
    projectId ? `/v1/admin/metric-series?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  const anomalies = listRows(anomalyData)
  const metrics = listRows(metricsData)

  const confirm = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/anomalies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed', confirmed: true }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    toast.success('Anomaly confirmed')
    reloadAnomalies()
  }, [reloadAnomalies, toast])

  const dismiss = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/anomalies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    toast.success('Anomaly dismissed')
    reloadAnomalies()
  }, [reloadAnomalies, toast])

  const tabs = [
    { id: 'anomalies', label: `Anomalies (${anomalies.length})` },
    { id: 'metrics',   label: 'Metrics' },
    { id: 'detect',    label: 'Detect' },
  ] as const

  return (
    <div className="space-y-4">
      <PageHeader
        title="Anomalies"
        description="Statistical anomaly detection (Page-Hinkley, Z-score, release regression) on any metric series you feed in."
        contextChip={<PdcaContextHint stage="check" />}
      >
        <Btn variant="ghost" size="sm" onClick={() => setTab('detect')}>Run detection</Btn>
      </PageHeader>

      <PageHelp
        title="Anomaly detection"
        whatIsIt="Ingest any numeric metric (error rate, latency, conversion rate) via the Metrics tab or SDK. The detector runs hourly and auto-creates bug reports for release regressions."
        useCases={[
          'Detect crash-rate spikes after a release',
          'Flag latency regressions against rolling baseline',
          'Auto-open a bug report when a regression is confirmed',
        ]}
        howToUse="Select a project, ingest metric data points in the Metrics tab, then run detection or wait for the hourly cron."
      />

      <Section title="Anomaly summary">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard label="Open" value={anomalies.filter(a => a.status === 'open').length} />
          <StatCard label="Confirmed" value={anomalies.filter(a => a.confirmed).length} />
          <StatCard label="Auto-reported" value={anomalies.filter(a => a.auto_report_id).length} />
        </div>

        <SegmentedControl value={tab} onChange={v => setTab(v as typeof tab)} options={tabs} className="mb-6" />

        {tab === 'anomalies' && (
          <AnomaliesTab
            anomalies={anomalies}
            loading={anomalyLoading}
            error={anomalyError}
            onConfirm={confirm}
            onDismiss={dismiss}
            projectId={projectId}
          />
        )}

        {tab === 'metrics' && (
          <MetricsTab metrics={metrics} loading={metricsLoading} projectId={projectId} onIngest={reloadMetrics} />
        )}

        {tab === 'detect' && (
          <DetectTab projectId={projectId} onDone={() => { reloadAnomalies(); setTab('anomalies') }} />
        )}
      </Section>
    </div>
  )
}

// ─── Anomalies tab ────────────────────────────────────────────────────────────

function AnomaliesTab({ anomalies, loading, error, onConfirm, onDismiss, projectId }: {
  anomalies: AnomalyDetection[]
  loading: boolean
  error: string | null
  onConfirm: (id: string) => void
  onDismiss: (id: string) => void
  projectId: string
}) {
  if (!projectId) return <EmptyState title="Select a project" />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!anomalies.length) return (
    <EmptyState title="No open anomalies" description="Run the detector or wait for the hourly cron. No news is good news." />
  )

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">Metric</th>
            <th className="px-3 py-2 text-left">Method</th>
            <th className="px-3 py-2 text-right">Score</th>
            <th className="px-3 py-2 text-right">Value</th>
            <th className="px-3 py-2 text-right">Baseline</th>
            <th className="px-3 py-2 text-left">Detected</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {anomalies.map(a => (
            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-3 py-2 font-mono text-xs">{a.metric_name}</td>
              <td className="px-3 py-2">{methodBadge(a.method)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">{a.score.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">{a.value.toFixed(3)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                {a.baseline_mean != null ? `μ=${a.baseline_mean.toFixed(3)}` : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground"><RelativeTime value={a.detected_at} /></td>
              <td className="px-3 py-2">
                <div className="flex gap-1 justify-end">
                  {a.status === 'open' && (
                    <>
                      <Btn size="sm" variant="primary" onClick={() => onConfirm(a.id)}>Confirm</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => onDismiss(a.id)}>Dismiss</Btn>
                    </>
                  )}
                  {a.auto_report_id && (
                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs">
                      Auto-reported
                    </Badge>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ─── Metrics tab ─────────────────────────────────────────────────────────────

function MetricsTab({ metrics, loading, projectId, onIngest }: {
  metrics: MetricPoint[]
  loading: boolean
  projectId: string
  onIngest: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState({ metric_name: '', value: '', ts: new Date().toISOString().slice(0, 16) })
  const [saving, setSaving] = useState(false)

  const ingest = async () => {
    if (!form.metric_name || !form.value) { toast.error('Name + value required'); return }
    if (!projectId) { toast.error('Select a project'); return }
    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/metric-series', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          metric_name: form.metric_name,
          value: parseFloat(form.value),
          ts: new Date(form.ts).toISOString(),
        }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed')
      toast.success('Point ingested')
      onIngest()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  const uniqueMetrics = [...new Set(metrics.map(m => m.metric_name))]

  return (
    <div className="space-y-6">
      {!projectId && <EmptyState title="Select a project" />}
      {projectId && (
        <>
          <Card className="p-5 space-y-4 max-w-lg">
            <h3 className="text-sm font-semibold">Ingest a data point</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Metric name</span>
                <Input value={form.metric_name} onChange={e => setForm(f => ({ ...f, metric_name: e.target.value }))} placeholder="error_rate" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Value</span>
                <Input type="number" step="any" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0.042" />
              </label>
              <label className="block space-y-1 col-span-2">
                <span className="text-xs font-medium">Timestamp (UTC)</span>
                <Input type="datetime-local" value={form.ts} onChange={e => setForm(f => ({ ...f, ts: e.target.value }))} />
              </label>
            </div>
            <Btn variant="primary" size="sm" onClick={ingest} loading={saving}>Ingest</Btn>
          </Card>

          {loading ? <TableSkeleton rows={5} /> : metrics.length === 0 ? (
            <EmptyState title="No metric data" description="Ingest data points above or send via SDK." />
          ) : (
            <div className="space-y-4">
              {uniqueMetrics.map(name => {
                const pts = metrics.filter(m => m.metric_name === name).slice(0, 50)
                const vals = pts.map(p => p.value)
                const max = Math.max(...vals)
                const min = Math.min(...vals)
                return (
                  <Card key={name} className="p-4">
                    <h4 className="text-sm font-medium font-mono mb-2">{name}</h4>
                    <div className="flex items-end gap-[2px] h-14">
                      {pts.map((p, i) => {
                        const h = max === min ? 50 : Math.round(((p.value - min) / (max - min)) * 100)
                        return (
                          <div key={i} title={`${new Date(p.ts).toLocaleString()}: ${p.value}`}
                            className="flex-1 min-w-[3px] rounded-t-sm bg-primary opacity-70 hover:opacity-100 transition-opacity"
                            style={{ height: `${Math.max(h, 4)}%` }} />
                        )
                      })}
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                      <span>{pts.length} pts</span>
                      <span>min {min.toFixed(3)} · max {max.toFixed(3)}</span>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Detect tab ───────────────────────────────────────────────────────────────

function DetectTab({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ anomalies: number; ids: string[] } | null>(null)
  const [form, setForm] = useState({ metric_name: '', lookback_hours: 48 })

  const run = async () => {
    if (!projectId) { toast.error('Select a project'); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await apiFetch<{ anomalies: number; ids: string[] }>('/v1/admin/anomalies/detect', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...form }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Detection failed')
      setResult(res.data ?? { anomalies: 0, ids: [] })
      toast.success(`${res.data?.anomalies ?? 0} anomalies detected`)
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Detection failed')
    } finally { setLoading(false) }
  }

  return (
    <Card className="max-w-lg p-6 space-y-4">
      <h2 className="text-base font-semibold">Manual detection run</h2>
      <p className="text-sm text-muted-foreground">
        Analyzes metric_series data using Page-Hinkley, Z-score, and release-boundary regression.
        Leaves all findings in the Anomalies tab.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Metric name (optional)</span>
          <Input value={form.metric_name} onChange={e => setForm(f => ({ ...f, metric_name: e.target.value }))} placeholder="all metrics" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Lookback (hours)</span>
          <Input type="number" min={1} max={720} value={form.lookback_hours} onChange={e => setForm(f => ({ ...f, lookback_hours: parseInt(e.target.value, 10) }))} />
        </label>
      </div>
      <Btn variant="primary" onClick={run} loading={loading}>Run detection</Btn>
      {result && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-700 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">{result.anomalies} anomalies detected</p>
        </div>
      )}
    </Card>
  )
}
