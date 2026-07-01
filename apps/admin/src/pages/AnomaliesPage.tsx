/**
 * FILE: apps/admin/src/pages/AnomaliesPage.tsx
 * PURPOSE: Anomaly detection console — banner + ANOMALIES SNAPSHOT + tabs:
 *          Overview | Anomalies | Metrics | Detect.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useAnomaliesUx, resolveQuickAnomaliesTab } from '../lib/anomaliesModeUx'
import { useToast } from '../lib/toast'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import {
  Card,
  Badge,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { AnomaliesStatusBanner, isAnomaliesStatusBannerCritical } from '../components/anomalies/AnomaliesStatusBanner'
import { AnomaliesDetectionGuide } from '../components/anomalies/AnomaliesDetectionGuide'
import { AnomaliesSnapshotStrip } from '../components/anomalies/AnomaliesSnapshotStrip'
import { AnomaliesReadout } from '../components/anomalies/AnomaliesReadout'
import {
  EMPTY_ANOMALIES_STATS,
  type AnomaliesStats,
  type AnomaliesTabId,
} from '../components/anomalies/AnomaliesStatsTypes'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'
import { BarSparkline } from '../components/charts'

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

const METHOD_CLS: Record<string, string> = {
  'page-hinkley': 'bg-warn-muted/50 text-warning-foreground border border-warn/20',
  'z-score': 'bg-danger-muted/50 text-danger-foreground border border-danger/20',
  'release-regression': 'bg-danger-muted/50 text-danger-foreground border border-danger/20',
}

function methodBadge(m: string) {
  return <Badge className={METHOD_CLS[m] ?? 'bg-surface-overlay text-fg-muted border border-edge-subtle'}>{m}</Badge>
}

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

const TABS: Array<{ id: AnomaliesTabId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Posture banner and how metric ingestion feeds detection.' },
  { id: 'anomalies', label: 'Anomalies', description: 'Open statistical findings — confirm, dismiss, or follow auto-reports.' },
  { id: 'metrics', label: 'Metrics', description: 'Ingest data points and preview timeseries sparklines.' },
  { id: 'detect', label: 'Detect', description: 'Trigger Page-Hinkley, Z-score, and release-regression analysis.' },
]

function resolveAnomaliesTab(value: string | null): AnomaliesTabId {
  if (value === 'anomalies' || value === 'metrics' || value === 'detect') return value
  return 'overview'
}

export function AnomaliesPage() {
  const copy = usePageCopy('/anomalies')
  const ux = useAnomaliesUx()
  const toast = useToast()
  const projectId = useActiveProjectId()
  const setup = useSetupStatus(projectId)
  const projectName = setup.activeProject?.project_name ?? null
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveAnomaliesTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<AnomaliesStats>('/v1/admin/anomalies/stats')
  usePublishPageHeroStats('/anomalies', statsData)
  const stats = { ...EMPTY_ANOMALIES_STATS, ...statsData }

  const {
    data: anomalyData,
    loading: anomalyLoading,
    error: anomalyError,
    reload: reloadAnomalies,
    isValidating: anomaliesValidating,
  } = usePageData<{ data: AnomalyDetection[]; total: number }>(
    projectId && activeTab === 'anomalies' ? `/v1/admin/anomalies?project_id=${projectId}&limit=100` : null,
    { deps: [projectId, activeTab] },
  )

  const {
    data: metricsData,
    loading: metricsLoading,
    reload: reloadMetrics,
    isValidating: metricsValidating,
  } = usePageData<{ data: MetricPoint[] }>(
    projectId && activeTab === 'metrics' ? `/v1/admin/metric-series?project_id=${projectId}` : null,
    { deps: [projectId, activeTab] },
  )

  const anomalies = listRows(anomalyData)
  const metrics = listRows(metricsData)

  const setActiveTab = useCallback(
    (tab: AnomaliesTabId) => {
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
    reloadAnomalies()
    reloadMetrics()
  }, [reloadStats, reloadAnomalies, reloadMetrics])

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickAnomaliesTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count: t.id === 'anomalies' && stats.openAnomalies > 0 ? stats.openAnomalies : undefined,
      })),
    [copy?.tabLabels, stats.openAnomalies],
  )

  usePublishPageContext({
    route: '/anomalies',
    title: projectName ? `Anomalies · ${projectName}` : 'Anomalies',
    summary: statsLoading
      ? 'Loading anomaly posture…'
      : stats.metricPointCount === 0
        ? 'No metric data yet'
        : `${stats.openAnomalies} open · ${stats.distinctMetrics} metrics`,
    criticalCount: stats.releaseRegressionOpen + stats.highScoreOpen,
  })

  const confirm = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/anomalies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed', confirmed: true }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    toast.success('Anomaly confirmed')
    reloadAll()
  }, [reloadAll, toast])

  const dismiss = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/anomalies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    toast.success('Anomaly dismissed')
    reloadAll()
  }, [reloadAll, toast])

  const onDetectDone = useCallback(() => {
    reloadAll()
    setActiveTab('anomalies')
  }, [reloadAll, setActiveTab])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading anomalies">
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
    return <ErrorAlert message={`Failed to load anomaly stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'open_critical'
        ? 'danger'
        : stats.topPriority === 'open_anomalies'
          ? 'warn'
          : stats.topPriority === 'no_metrics'
            ? 'brand'
            : stats.topPriority === 'healthy'
              ? 'ok'
              : 'info'

  return (
    <div className="space-y-4" data-testid="mushi-page-anomalies">
      <PageHeaderBar
        title={copy?.title ?? 'Anomalies'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={copy?.description ?? 'Banner + ANOMALIES SNAPSHOT — Overview for posture, Anomalies to triage, Metrics to ingest, Detect to run analysis.'}
        contextChip={<PdcaContextHint stage="check" />}
        helpTitle={copy?.help?.title ?? 'Anomaly detection'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Ingest any numeric metric (error rate, latency, conversion rate) via the Metrics tab or SDK. The detector runs hourly and auto-creates bug reports for release regressions.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Detect crash-rate spikes after a release',
          'Flag latency regressions against rolling baseline',
          'Auto-open a bug report when a regression is confirmed',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Ingest metric data in the Metrics tab, then run detection or wait for the hourly cron.'}
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger-muted/50 text-danger-foreground'
                : bannerSeverity === 'warn'
                  ? 'bg-warn-muted/50 text-warning-foreground'
                  : bannerSeverity === 'brand'
                    ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.openAnomalies > 0
              ? `${stats.openAnomalies} OPEN`
              : stats.metricPointCount === 0
                ? 'NO DATA'
                : 'NORMAL'}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || anomaliesValidating || metricsValidating}>
          Refresh
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => setActiveTab('detect')}>
          Run detection
        </Btn>
          </>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: isAnomaliesStatusBannerCritical(stats),
            children: (
              <AnomaliesStatusBanner
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
            show: !ux.hideAnomaliesSnapshot,
            children: (
              <AnomaliesSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'ANOMALIES SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show:
              activeTab === 'overview' &&
              !shouldHideGuideWhenBannerActive(
                isAnomaliesStatusBannerCritical(stats),
                COMMON_HEALTHY_PRIORITIES,
                stats.topPriority,
              ),
            children: <AnomaliesDetectionGuide topPriority={stats.topPriority} stats={stats} />,
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<AnomaliesTabId>
        size="sm"
        scrollable
        ariaLabel="Anomalies sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <AnomaliesReadout
            stats={stats}
            fetchedAt={statsFetchedAt}
            isValidating={statsValidating}
          />
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="No open anomalies"
              description={`${stats.distinctMetrics} metric series · ${stats.metricPointCount} data points · detection can run on demand.`}
            />
          )}
          {stats.topPriority === 'no_metrics' && (
            <RecommendedAction
              tone="info"
              title="Seed metric data first"
              description="Page-Hinkley and Z-score detectors need a timeseries baseline — ingest points before running detection."
              cta={{ label: 'Open Metrics', to: '/anomalies?tab=metrics' }}
            />
          )}
          {(stats.topPriority === 'open_anomalies' || stats.topPriority === 'open_critical') && (
            <RecommendedAction
              tone="info"
              title="Triage open anomalies"
              description={stats.topPriorityLabel ?? 'Confirm real regressions or dismiss false positives.'}
              cta={{ label: 'Open Anomalies', to: '/anomalies?tab=anomalies' }}
            />
          )}
        </div>
      )}

      {activeTab === 'anomalies' && (
        <AnomaliesTab
          anomalies={anomalies}
          loading={anomalyLoading}
          error={anomalyError}
          onConfirm={confirm}
          onDismiss={dismiss}
          projectId={projectId ?? ''}
          noMetrics={stats.metricPointCount === 0}
          onIngestMetrics={() => setActiveTab('metrics')}
          onRunDetect={() => setActiveTab('detect')}
        />
      )}

      {activeTab === 'metrics' && (
        <MetricsTab metrics={metrics} loading={metricsLoading} projectId={projectId ?? ''} onIngest={reloadAll} />
      )}

      {activeTab === 'detect' && (
        <DetectTab projectId={projectId ?? ''} onDone={onDetectDone} hasMetrics={stats.metricPointCount > 0} />
      )}
    </div>
  )
}

function AnomaliesTab({
  anomalies, loading, error, onConfirm, onDismiss, projectId, noMetrics, onIngestMetrics, onRunDetect,
}: {
  anomalies: AnomalyDetection[]
  loading: boolean
  error: string | null
  onConfirm: (id: string) => void
  onDismiss: (id: string) => void
  projectId: string
  noMetrics: boolean
  onIngestMetrics: () => void
  onRunDetect: () => void
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher to view anomalies." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!anomalies.length) {
    return (
      <div className="space-y-3">
        <EmptySectionMessage
          text={noMetrics ? 'No metric data yet' : 'No open anomalies'}
          hint={
            noMetrics
              ? 'Ingest metric data points before running Page-Hinkley or Z-score detection.'
              : 'Run the detector or wait for the hourly cron — no open findings is good news.'
          }
        />
        <ActionPillRow>
          {noMetrics ? (
            <ActionPill tone="brand" onClick={onIngestMetrics}>
              Ingest metrics
            </ActionPill>
          ) : (
            <ActionPill tone="brand" onClick={onRunDetect}>
              Run detection
            </ActionPill>
          )}
        </ActionPillRow>
      </div>
    )
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge-subtle bg-surface-overlay text-xs text-fg-muted">
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
          {anomalies.map((a) => (
            <tr key={a.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-overlay/50 transition-colors">
              <td className="px-3 py-2 font-mono text-xs">{a.metric_name}</td>
              <td className="px-3 py-2">{methodBadge(a.method)}</td>
              <td className="px-3 py-2 text-right">
                <SignalChip tone={a.score >= 3 ? 'danger' : a.score >= 2 ? 'warn' : 'info'}>
                  {a.score.toFixed(2)}
                </SignalChip>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">{a.value.toFixed(3)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">
                {a.baseline_mean != null ? (
                  <SignalChip tone="neutral" className="font-mono">
                    μ={a.baseline_mean.toFixed(3)}
                  </SignalChip>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                <SignalChip tone="neutral">
                  <RelativeTime value={a.detected_at} />
                </SignalChip>
              </td>
              <td className="px-3 py-2">
                <div className="flex gap-1 justify-end flex-wrap">
                  {a.status === 'open' && (
                    <>
                      <Btn size="sm" variant="primary" onClick={() => onConfirm(a.id)}>Confirm</Btn>
                      <Btn size="sm" variant="cancel" onClick={() => onDismiss(a.id)}>Dismiss</Btn>
                    </>
                  )}
                  {a.auto_report_id && (
                    <Badge className="bg-brand/10 text-brand border border-brand/20 text-xs">
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

  const uniqueMetrics = [...new Set(metrics.map((m) => m.metric_name))]

  return (
    <div className="space-y-6">
      {!projectId && <EmptyState title="Select a project" />}
      {projectId && (
        <>
          <Card className="p-5 space-y-4 max-w-lg">
            <SignalChip tone="neutral" className="uppercase tracking-wider font-medium">
              Ingest a data point
            </SignalChip>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <SignalChip tone="neutral" className="text-xs">Metric name</SignalChip>
                <Input value={form.metric_name} onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))} placeholder="error_rate" />
              </label>
              <label className="block space-y-1">
                <SignalChip tone="neutral" className="text-xs">Value</SignalChip>
                <Input type="number" step="any" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder="0.042" />
              </label>
              <label className="block space-y-1 col-span-2">
                <SignalChip tone="neutral" className="text-xs">Timestamp (UTC)</SignalChip>
                <Input type="datetime-local" value={form.ts} onChange={(e) => setForm((f) => ({ ...f, ts: e.target.value }))} />
              </label>
            </div>
            <Btn variant="primary" size="sm" onClick={ingest} loading={saving}>Ingest</Btn>
          </Card>

          {loading ? <TableSkeleton rows={5} /> : metrics.length === 0 ? (
            <EmptyState title="No metric data" description="Ingest data points above or send via SDK." />
          ) : (
            <div className="space-y-4">
              {uniqueMetrics.map((name) => {
                const pts = metrics.filter((m) => m.metric_name === name).slice(0, 50)
                const vals = pts.map((p) => p.value)
                const max = Math.max(...vals)
                const min = Math.min(...vals)
                return (
                  <Card key={name} className="p-4">
                    <SignalChip tone="brand" className="font-mono mb-2">
                      {name}
                    </SignalChip>
                    <BarSparkline
                      values={vals}
                      xLabels={pts.map((p) =>
                        new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                      )}
                      barTitles={pts.map((p) => `${new Date(p.ts).toLocaleString()}: ${p.value}`)}
                      accent="bg-brand"
                      height={80}
                      showAxes
                      scaleToData
                      valueFormat="raw"
                      yAxisCaption={name}
                      xAxisCaption="Sample time"
                      showPeakLabel
                      ariaLabel={`${name} metric samples`}
                    />
                    <div className="flex justify-between gap-2">
                      <InlineProof className="flex-1">{pts.length} samples</InlineProof>
                      <InlineProof className="flex-1 text-right">
                        min {min.toFixed(3)} · max {max.toFixed(3)}
                      </InlineProof>
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

function DetectTab({ projectId, onDone, hasMetrics }: { projectId: string; onDone: () => void; hasMetrics: boolean }) {
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
    <Card className="max-w-lg space-y-4 p-6">
      <SignalChip tone="neutral" className="uppercase tracking-wider font-semibold">
        Manual detection run
      </SignalChip>
      <ContainedBlock tone="muted">
        <InlineProof className="border-0 bg-transparent px-0 py-0 text-sm leading-relaxed">
          Analyzes metric_series data using Page-Hinkley, Z-score, and release-boundary regression.
          Leaves all findings in the Anomalies tab.
        </InlineProof>
      </ContainedBlock>
      {!projectId && (
        <ContainedBlock tone="warn">
          <p className="text-xs text-warn">Select a project from the switcher before running detection.</p>
        </ContainedBlock>
      )}
      {!hasMetrics && projectId && (
        <ContainedBlock tone="warn">
          <p className="text-xs text-warn">No metric data yet — ingest points on the Metrics tab first.</p>
        </ContainedBlock>
      )}
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <SignalChip tone="neutral">Metric name (optional)</SignalChip>
          <Input value={form.metric_name} onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))} placeholder="all metrics" />
        </label>
        <label className="block space-y-1">
          <SignalChip tone="neutral">Lookback (hours)</SignalChip>
          <Input type="number" min={1} max={720} value={form.lookback_hours} onChange={(e) => setForm((f) => ({ ...f, lookback_hours: parseInt(e.target.value, 10) }))} />
        </label>
      </div>
      <Btn variant="primary" onClick={run} loading={loading} disabled={!projectId}>Run detection</Btn>
      {result && (
        <ContainedBlock tone="info">
          <SignalChip tone="ok" className="font-medium">
            {result.anomalies} anomalies detected
          </SignalChip>
        </ContainedBlock>
      )}
    </Card>
  )
}
