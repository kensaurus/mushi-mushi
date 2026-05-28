/**
 * FILE: apps/admin/src/pages/DriftPage.tsx
 * PURPOSE: Contract drift console — banner + DRIFT SNAPSHOT + tabs:
 *          Overview | Findings | Snapshots | Scanner.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useDriftUx, resolveQuickDriftTab } from '../lib/driftModeUx'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  StatCard,
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
import { DriftStatusBanner } from '../components/drift/DriftStatusBanner'
import {
  EMPTY_DRIFT_STATS,
  type DriftStats,
  type DriftTabId,
} from '../components/drift/DriftStatsTypes'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'
import {
  contractEdgesDetail,
  contractEdgesTooltip,
  criticalOpenDetail,
  criticalOpenTooltip,
  openFindingsDetail,
  openFindingsTooltip,
  snapshotsDetail,
  snapshotsTooltip,
  surfacesWithFindingsDetail,
  surfacesWithFindingsTooltip,
  warnOpenDetail,
  warnOpenTooltip,
} from '../lib/statTooltips/drift'
import { driftLinks } from '../lib/statCardLinks'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DriftFinding {
  id: string
  project_id: string
  snapshot_id: string | null
  finding_type: string
  severity: 'info' | 'warn' | 'critical'
  surface: string
  path: string | null
  message: string
  expected: unknown
  actual: unknown
  status: 'open' | 'dismissed'
  dismissed_at: string | null
  created_at: string
}

interface ContractSnapshot {
  id: string
  project_id: string
  snapshot_at: string
  edge_count: number
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_CLS: Record<DriftFinding['severity'], string> = {
  info: 'bg-info/10 text-info border border-info/20',
  warn: 'bg-warn/10 text-warn border border-warn/20',
  critical: 'bg-danger/10 text-danger border border-danger/20',
}

const SEVERITY_LABEL: Record<DriftFinding['severity'], string> = {
  info: 'Info', warn: 'Warn', critical: 'Critical',
}

function severityBadge(s: DriftFinding['severity']) {
  return <Badge className={SEVERITY_CLS[s]}>{SEVERITY_LABEL[s]}</Badge>
}

function listRows<T>(payload: T[] | { data: T[] } | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

const TABS: Array<{ id: DriftTabId; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Posture banner and how contract drift detection works.' },
  { id: 'findings', label: 'Findings', description: 'Open gaps between OpenAPI spec, inventory nodes, and DB schema.' },
  { id: 'snapshots', label: 'Snapshots', description: 'Contract snapshot history and edge-count trend.' },
  { id: 'scanner', label: 'Scanner', description: 'Trigger a manual drift-walker scan on demand.' },
]

function resolveDriftTab(value: string | null): DriftTabId {
  if (value === 'findings' || value === 'snapshots' || value === 'scanner') return value
  return 'overview'
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function DriftPage() {
  const copy = usePageCopy('/drift')
  const ux = useDriftUx()
  const toast = useToast()
  const projectId = useActiveProjectId()
  const setup = useSetupStatus(projectId)
  const projectName = setup.activeProject?.project_name ?? null
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveDriftTab(tabParam)
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const [selectedFinding, setSelectedFinding] = useState<DriftFinding | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<DriftStats>('/v1/admin/drift/stats')
  const stats = { ...EMPTY_DRIFT_STATS, ...statsData }

  const {
    data: findingsData,
    loading: findingsLoading,
    error: findingsError,
    reload: reloadFindings,
    isValidating: findingsValidating,
  } = usePageData<{ data: DriftFinding[]; total: number }>(
    projectId && activeTab === 'findings' ? `/v1/admin/drift?project_id=${projectId}&limit=100` : null,
    { deps: [projectId, activeTab] },
  )

  const {
    data: snapshotsData,
    loading: snapshotsLoading,
    reload: reloadSnapshots,
    isValidating: snapshotsValidating,
  } = usePageData<{ data: ContractSnapshot[] }>(
    projectId && activeTab === 'snapshots' ? `/v1/admin/drift/snapshots?project_id=${projectId}` : null,
    { deps: [projectId, activeTab] },
  )

  const findings = listRows(findingsData)
  const snapshots = listRows(snapshotsData)

  const setActiveTab = useCallback(
    (tab: DriftTabId) => {
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
    reloadFindings()
    reloadSnapshots()
  }, [reloadStats, reloadFindings, reloadSnapshots])

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickDriftTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'findings' && stats.openFindings > 0
            ? stats.openFindings
            : t.id === 'findings' && stats.criticalOpen > 0
              ? stats.criticalOpen
              : undefined,
      })),
    [copy?.tabLabels, stats.openFindings, stats.criticalOpen],
  )

  usePublishPageContext({
    route: '/drift',
    title: projectName ? `Drift · ${projectName}` : 'Drift',
    summary: statsLoading
      ? 'Loading contract drift…'
      : stats.snapshotCount === 0
        ? 'No contract snapshot yet'
        : `${stats.openFindings} open · ${stats.snapshotCount} snapshots`,
    criticalCount: stats.criticalOpen,
    questions: stats.openFindings > 0
      ? ['Which API routes diverged from the OpenAPI spec?', 'Should I promote this critical finding to a lesson?']
      : ['How do I run the first drift scan?', 'What surfaces does the walker compare?'],
  })

  const dismiss = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/drift/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    reloadAll()
    toast.success('Finding dismissed')
  }, [reloadAll, toast])

  const createLesson = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/drift/${id}/create-lesson`, { method: 'POST' })
    if (res.ok) { toast.success('Candidate lesson created'); reloadAll() }
    else toast.error(res.error?.message ?? 'Failed to create lesson')
  }, [reloadAll, toast])

  const onScanDone = useCallback(() => {
    reloadAll()
    setActiveTab('findings')
  }, [reloadAll, setActiveTab])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading drift">
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
    return <ErrorAlert message={`Failed to load drift stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'critical_findings'
        ? 'danger'
        : stats.topPriority === 'warn_findings' || stats.topPriority === 'stale_scan'
          ? 'warn'
          : stats.topPriority === 'never_scanned'
            ? 'brand'
            : stats.topPriority === 'healthy'
              ? 'ok'
              : 'info'

  return (
    <div className="space-y-4" data-testid="mushi-page-drift">
      <PageHelp
        title={copy?.help?.title ?? 'Contract drift detection'}
        whatIsIt={copy?.help?.whatIsIt ?? 'The drift-walker builds a contract snapshot then walks every route with Thompson-sampled priority — routes with more historical findings are checked first.'}
        useCases={copy?.help?.useCases ?? [
          'Find API endpoints present in inventory but missing in OpenAPI spec',
          'Detect DB columns expected by the FE but removed from the schema',
          'Promote high-severity findings to candidate lessons',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Run a scan from the Scanner tab, then triage findings. Dismiss false positives to train the sampler.'}
      />

      <PageHeader
        title={copy?.title ?? 'Drift'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        contextChip={<PdcaContextHint stage="check" />}
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
            : stats.criticalOpen > 0
              ? `${stats.criticalOpen} CRIT`
              : stats.openFindings > 0
                ? `${stats.openFindings} OPEN`
                : stats.snapshotCount === 0
                  ? 'NO SCAN'
                  : 'IN SYNC'}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || findingsValidating || snapshotsValidating}>
          Refresh
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => setActiveTab('scanner')}>
          Run scan
        </Btn>
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Banner + DRIFT SNAPSHOT — Overview for posture, Findings to triage, Snapshots for history, Scanner to run walker.'}
        </p>
      </ContainedBlock>

      <DriftStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<DriftTabId>
        size="sm"
        ariaLabel="Drift sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideDriftSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'DRIFT SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.openFindings ?? 'Open findings'} value={stats.openFindings} accent={stats.openFindings > 0 ? 'text-warn' : 'text-ok'} tooltip={openFindingsTooltip(stats)} detail={openFindingsDetail(stats)} to={driftLinks.openFindings} />
          <StatCard label={copy?.statLabels?.critical ?? 'Critical'} value={stats.criticalOpen} accent={stats.criticalOpen > 0 ? 'text-danger' : 'text-ok'} tooltip={criticalOpenTooltip(stats)} detail={criticalOpenDetail()} to={driftLinks.critical} />
          <StatCard label={copy?.statLabels?.warnings ?? 'Warnings'} value={stats.warnOpen} accent={stats.warnOpen > 0 ? 'text-warn' : undefined} tooltip={warnOpenTooltip(stats)} detail={warnOpenDetail(stats)} to={driftLinks.warnings} />
          <StatCard label={copy?.statLabels?.snapshots ?? 'Snapshots'} value={stats.snapshotCount} accent={stats.snapshotCount > 0 ? 'text-brand' : undefined} tooltip={snapshotsTooltip(stats)} detail={snapshotsDetail(stats)} to={driftLinks.snapshots} />
          <StatCard label={copy?.statLabels?.contractEdges ?? 'Contract edges'} value={stats.lastSnapshotEdges} accent={stats.lastSnapshotEdges > 0 ? 'text-brand' : undefined} tooltip={contractEdgesTooltip(stats)} detail={contractEdgesDetail(stats)} to={driftLinks.contractEdges} />
          <StatCard label={copy?.statLabels?.surfaces ?? 'Surfaces'} value={stats.surfacesWithFindings} accent={stats.surfacesWithFindings > 0 ? 'text-warn' : undefined} tooltip={surfacesWithFindingsTooltip(stats)} detail={surfacesWithFindingsDetail()} to={driftLinks.surfaces} />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'critical_findings'
              ? 'border-danger/30 bg-danger/5'
              : stats.topPriority === 'never_scanned'
                ? 'border-brand/30 bg-brand/5'
                : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'critical_findings'
                ? 'danger'
                : stats.topPriority === 'never_scanned'
                  ? 'brand'
                  : 'warn'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone={stats.topPriority === 'critical_findings' ? 'warn' : 'info'}>
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
              title="Contracts are in sync"
              description={`${stats.snapshotCount} snapshot${stats.snapshotCount === 1 ? '' : 's'} · ${stats.lastSnapshotEdges} edges tracked · 0 open findings.`}
            />
          )}
          {!ux.hideOverviewChrome && stats.topPriority === 'never_scanned' && (
            <RecommendedAction
              tone="info"
              title="Build your first contract baseline"
              description="The drift-walker compares OpenAPI, inventory nodes, and Postgres schema. Run a scan to capture edges and detect gaps."
              cta={{ label: 'Open Scanner', to: '/drift?tab=scanner' }}
            />
          )}
          {!ux.hideOverviewChrome && (stats.topPriority === 'critical_findings' || stats.topPriority === 'warn_findings') && (
            <RecommendedAction
              tone="info"
              title="Triage open drift findings"
              description={stats.topPriorityLabel ?? 'Review findings and dismiss false positives or promote critical gaps to lessons.'}
              cta={{ label: 'Open Findings', to: '/drift?tab=findings' }}
            />
          )}
        </div>
      )}

      {activeTab === 'findings' && (
        <FindingsTab
          findings={findings}
          loading={findingsLoading}
          error={findingsError}
          onDismiss={dismiss}
          onCreateLesson={createLesson}
          onOpen={(f) => { setSelectedFinding(f); setDrawerOpen(true) }}
          projectId={projectId ?? ''}
          neverScanned={stats.snapshotCount === 0}
          onRunScan={() => setActiveTab('scanner')}
        />
      )}

      {activeTab === 'snapshots' && (
        <SnapshotsTab
          snapshots={snapshots}
          loading={snapshotsLoading}
          projectId={projectId ?? ''}
          onRunScan={() => setActiveTab('scanner')}
        />
      )}

      {activeTab === 'scanner' && (
        <ScannerTab projectId={projectId ?? ''} onDone={onScanDone} />
      )}

      {drawerOpen && selectedFinding && (
        <FindingDetailDrawer
          finding={selectedFinding}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelectedFinding(null) }}
          onDismiss={dismiss}
          onCreateLesson={createLesson}
        />
      )}
    </div>
  )
}

// ─── Findings tab ────────────────────────────────────────────────────────────

function FindingsTab({
  findings, loading, error, onDismiss, onCreateLesson, onOpen, projectId, neverScanned, onRunScan,
}: {
  findings: DriftFinding[]
  loading: boolean
  error: string | null
  onDismiss: (id: string) => void
  onCreateLesson: (id: string) => void
  onOpen: (f: DriftFinding) => void
  projectId: string
  neverScanned: boolean
  onRunScan: () => void
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher to see drift findings." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!findings.length) return (
    <EmptyState
      title={neverScanned ? 'No scan yet' : 'No open findings'}
      description={
        neverScanned
          ? 'Run a drift scan to build the first contract snapshot and detect OpenAPI / inventory / DB gaps.'
          : 'OpenAPI, inventory, and DB schema are in sync — or dismissed findings were cleared.'
      }
      action={neverScanned ? <Btn size="sm" variant="primary" onClick={onRunScan}>Run scan</Btn> : undefined}
    />
  )

  const bySurface = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.surface] = (acc[f.surface] ?? 0) + 1; return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.keys(bySurface).length > 1 && (
        <ContainedBlock tone="muted" label="By surface">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bySurface).map(([s, n]) => (
              <SignalChip key={s} tone="neutral" className="font-mono">
                {s}: {n}
              </SignalChip>
            ))}
          </div>
        </ContainedBlock>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge-subtle bg-surface-overlay text-xs text-fg-muted">
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Surface</th>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-left">Message</th>
              <th className="px-3 py-2 text-left">Found</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-overlay/50 transition-colors">
                <td className="px-3 py-2">{severityBadge(f.severity)}</td>
                <td className="px-3 py-2 text-xs font-mono text-fg-muted">{f.surface}</td>
                <td className="px-3 py-2 max-w-[180px] truncate font-mono text-xs">{f.path ?? '—'}</td>
                <td className="px-3 py-2 max-w-[280px] truncate text-xs">{f.message}</td>
                <td className="px-3 py-2 text-xs text-fg-muted"><RelativeTime value={f.created_at} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => onOpen(f)}>View</Btn>
                    {f.severity === 'critical' && (
                      <Btn size="sm" variant="ghost" onClick={() => onCreateLesson(f.id)}>→ Lesson</Btn>
                    )}
                    <Btn size="sm" variant="cancel" onClick={() => onDismiss(f.id)}>Dismiss</Btn>
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

// ─── Snapshots tab ────────────────────────────────────────────────────────────

function SnapshotsTab({
  snapshots, loading, projectId, onRunScan,
}: {
  snapshots: ContractSnapshot[]
  loading: boolean
  projectId: string
  onRunScan: () => void
}) {
  if (!projectId) return <EmptyState title="Select a project" />
  if (loading) return <TableSkeleton rows={5} />
  if (!snapshots.length) {
    return (
      <EmptyState
        title="No snapshots"
        description="Trigger a scan to build the first contract snapshot."
        action={<Btn size="sm" variant="primary" onClick={onRunScan}>Run scan</Btn>}
      />
    )
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge-subtle bg-surface-overlay text-xs text-fg-muted">
            <th className="px-3 py-2 text-left">Snapshot</th>
            <th className="px-3 py-2 text-right">Edges</th>
            <th className="px-3 py-2 text-left">Taken</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-overlay/50">
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">{s.id.slice(0, 8)}…</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.edge_count}</td>
              <td className="px-3 py-2 text-xs text-fg-muted"><RelativeTime value={s.snapshot_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ─── Scanner tab ─────────────────────────────────────────────────────────────

function ScannerTab({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ findings_inserted: number; findings_found: number; snapshot_id: string } | null>(null)
  const [maxPaths, setMaxPaths] = useState(200)

  const run = async () => {
    if (!projectId) { toast.error('Select a project first'); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await apiFetch<{ findings_inserted: number; findings_found: number; snapshot_id: string }>(
        '/v1/admin/drift/scan',
        { method: 'POST', body: JSON.stringify({ project_id: projectId, max_paths: maxPaths }) },
      )
      if (!res.ok) throw new Error(res.error?.message ?? 'Scan failed')
      setResult(res.data ?? { findings_inserted: 0, findings_found: 0, snapshot_id: '' })
      toast.success(`Scan complete — ${res.data?.findings_inserted ?? 0} new findings`)
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-lg p-6 space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-fg-primary">Manual drift scan</h2>
        <ContainedBlock tone="muted">
          <p className="text-sm leading-relaxed text-fg-muted">
            Builds a fresh contract snapshot then walks routes with Thompson-sampled priority.
            Findings are deduplicated against the last 24 h.
          </p>
        </ContainedBlock>
      </div>
      {!projectId && (
        <ContainedBlock tone="warn">
          <p className="text-xs text-warn">Select a project from the switcher before running a scan.</p>
        </ContainedBlock>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-medium text-fg-primary">Max paths to walk</span>
        <input
          type="number"
          min={10}
          max={1000}
          value={maxPaths}
          onChange={(e) => setMaxPaths(parseInt(e.target.value, 10))}
          className="block w-32 rounded-md border border-edge-subtle bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
        />
      </label>
      <Btn variant="primary" onClick={run} loading={loading} disabled={!projectId} className="w-full sm:w-auto">
        {loading ? 'Scanning…' : 'Run scan'}
      </Btn>
      {result && (
        <ContainedBlock tone="info" label="Scan complete">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <SignalChip tone="ok">{result.findings_found} discovered</SignalChip>
              <SignalChip tone="brand">{result.findings_inserted} new stored</SignalChip>
            </div>
            <InlineProof className="font-mono">
              snapshot: {result.snapshot_id?.slice(0, 8)}…
            </InlineProof>
          </div>
        </ContainedBlock>
      )}
    </Card>
  )
}

// ─── Finding detail drawer ────────────────────────────────────────────────────

function FindingDetailDrawer({
  finding, open, onClose, onDismiss, onCreateLesson,
}: {
  finding: DriftFinding
  open: boolean
  onClose: () => void
  onDismiss: (id: string) => void
  onCreateLesson: (id: string) => void
}) {
  return (
    <Drawer open={open} onClose={onClose} title={`${finding.finding_type} — ${finding.path ?? 'N/A'}`}>
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          {severityBadge(finding.severity)}
          <Badge className="bg-surface-overlay text-fg-muted">{finding.surface}</Badge>
        </div>

        <div className="rounded-md bg-surface-overlay px-4 py-3 text-sm text-fg-primary">{finding.message}</div>

        {finding.expected != null && (
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted uppercase tracking-wide">Expected</p>
            <pre className="overflow-x-auto rounded-md bg-surface-overlay px-3 py-2 text-xs">{JSON.stringify(finding.expected, null, 2)}</pre>
          </div>
        )}

        {finding.actual != null && (
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted uppercase tracking-wide">Actual</p>
            <pre className="overflow-x-auto rounded-md bg-surface-overlay px-3 py-2 text-xs">{JSON.stringify(finding.actual, null, 2)}</pre>
          </div>
        )}

        <div className="rounded-md border border-edge-subtle bg-surface-overlay/50 px-4 py-3 space-y-1 text-xs text-fg-muted">
          <div className="flex gap-2"><span className="w-28">Type</span><span className="font-mono">{finding.finding_type}</span></div>
          <div className="flex gap-2"><span className="w-28">Path</span><span className="font-mono">{finding.path ?? '—'}</span></div>
          <div className="flex gap-2"><span className="w-28">Surface</span><span>{finding.surface}</span></div>
          <div className="flex gap-2"><span className="w-28">Found</span><RelativeTime value={finding.created_at} /></div>
        </div>

        <div className="flex gap-2 pt-2">
          {finding.severity === 'critical' && (
            <Btn variant="primary" size="sm" onClick={() => { onCreateLesson(finding.id); onClose() }}>
              Promote to lesson
            </Btn>
          )}
          <Btn variant="cancel" size="sm" onClick={() => { onDismiss(finding.id); onClose() }}>
            Dismiss
          </Btn>
        </div>
      </div>
    </Drawer>
  )
}
