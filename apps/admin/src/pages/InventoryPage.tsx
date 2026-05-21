import { useCallback, useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useEntitlements } from '../lib/useEntitlements'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useInventoryUx, resolveQuickInventoryTab } from '../lib/inventoryModeUx'
import { inventoryLinks } from '../lib/statCardLinks'
import { usePublishPageContext } from '../lib/pageContext'
import { apiFetch } from '../lib/supabase'
import { useRealtimeReload } from '../lib/realtime'
import {
  PageHeader,
  PageHelp,
  SegmentedControl,
  Btn,
  Card,
  ErrorAlert,
  Loading,
  Section,
  StatCard,
  FreshnessPill,
  Badge,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { PageHero } from '../components/PageHero'
import { PageActionBar } from '../components/PageActionBar'
import { SetupNudge } from '../components/SetupNudge'
import { HeroGraphNodes } from '../components/illustrations/HeroIllustrations'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { UserStoryMap } from '../components/inventory/UserStoryMap'
import { InventoryTree, type TreeRow } from '../components/inventory/InventoryTree'
import { GateFindingCard, type GateFinding } from '../components/inventory/GateFindingCard'
import { ActionDetailDrawer } from '../components/inventory/ActionDetailDrawer'
import { InventoryYamlDropzone } from '../components/inventory/InventoryYamlDropzone'
import { CrawlerSettingsCard } from '../components/inventory/CrawlerSettingsCard'
import { DiscoveryTab } from '../components/inventory/DiscoveryTab'
import { SyntheticTimeline } from '../components/inventory/SyntheticTimeline'
import { DriftDiffPanel } from '../components/inventory/DriftDiffPanel'
import { INVENTORY_HELP } from '../components/inventory/inventoryCopy'
import { InventoryStatusBanner } from '../components/inventory/InventoryStatusBanner'
import {
  EMPTY_INVENTORY_STATS,
  type InventoryStats,
  type InventoryTabId,
} from '../components/inventory/InventoryStatsTypes'
import { useNextBestAction } from '../lib/useNextBestAction'

const INVENTORY_TABS: Array<{ id: InventoryTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, coverage snapshot, and how discovery → ingest → gates fit together.',
  },
  {
    id: 'stories',
    label: 'User stories',
    description: 'Card map of stories and actions — status chips from gates, crawler, and synthetic probes.',
  },
  { id: 'tree', label: 'Tree', description: 'Page × element grid with backend and test wiring.' },
  { id: 'gates', label: 'Gates', description: 'Latest gate runs and open findings — dead handlers, mock leaks, contracts.' },
  { id: 'synthetic', label: 'Synthetic', description: 'Production probes per action — latency and pass/fail history.' },
  { id: 'drift', label: 'Drift', description: 'Crawler diff — missing in inventory vs missing in app vs mismatches.' },
  { id: 'discovery', label: 'Discovery', description: 'SDK observe → Claude propose → accept lifecycle.' },
  { id: 'yaml', label: 'Yaml', description: 'Power-user ingest — paste inventory.yaml or tweak the raw snapshot.' },
]

function resolveInventoryTab(value: string | null): InventoryTabId {
  if (
    value === 'stories' ||
    value === 'tree' ||
    value === 'gates' ||
    value === 'synthetic' ||
    value === 'drift' ||
    value === 'discovery' ||
    value === 'yaml'
  ) {
    return value
  }
  return 'overview'
}

interface Summary {
  total?: number
  verified?: number
  wired?: number
  mocked?: number
  stub?: number
  regressed?: number
  unknown?: number
}

interface InventoryPayload {
  snapshot: {
    id: string
    raw_yaml?: string
    parsed?: Record<string, unknown>
    validation_errors?: unknown[]
    commit_sha?: string | null
  } | null
  summary: Summary | null
}

interface StoryPayload {
  id: string
  label: string
  metadata?: Record<string, unknown> | null
  actions: Array<{
    id: string
    label: string
    status: string
    metadata?: Record<string, unknown> | null
  }>
}

interface FindingsPayload {
  runs: Array<{
    id: string
    gate: string
    status: string
    findings_count?: number
    commit_sha?: string | null
    started_at?: string
  }>
  findings: Array<GateFinding & { gate_run_id?: string }>
}

/**
 * Flattens the ingested `inventory.yaml` (stored as JSONB on
 * `inventories.parsed`) into one row per (page × element). We keep the
 * pretty-printed `backend` / `verifiedBy` strings for accessibility / hover
 * titles AND the structured arrays so the table can render proper chips.
 */
function buildTreeRows(parsed: Record<string, unknown> | undefined): TreeRow[] {
  if (!parsed) return []
  const pages = parsed.pages as
    | Array<{
        id: string
        path: string
        elements?: Array<{
          id: string
          action?: string
          status?: string
          backend?: unknown
          verified_by?: unknown
          db_writes?: unknown
          db_reads?: unknown
        }>
      }>
    | undefined
  if (!Array.isArray(pages)) return []
  const rows: TreeRow[] = []
  for (const p of pages) {
    for (const el of p.elements ?? []) {
      const backendList = Array.isArray(el.backend)
        ? (el.backend as Array<{ method?: string; path?: string }>)
            .filter((b) => typeof b.method === 'string' && typeof b.path === 'string')
            .map((b) => ({ method: b.method as string, path: b.path as string }))
        : []
      const testList = Array.isArray(el.verified_by)
        ? (el.verified_by as Array<{ file?: string; name?: string; framework?: string }>)
            .filter((t) => typeof t.file === 'string' && typeof t.name === 'string')
            .map((t) => ({ file: t.file as string, name: t.name as string, framework: t.framework }))
        : []
      const backendStr = backendList.map((b) => `${b.method} ${b.path}`).join(', ')
      const verifiedStr = testList.length
        ? `${testList[0]!.file} :: ${testList[0]!.name}`
        : ''
      rows.push({
        id: `${p.id}-${el.id}`,
        pageId: p.id,
        pagePath: p.path,
        elementId: el.id,
        actionLabel: el.action ?? el.id,
        status: el.status ?? 'unknown',
        backend: backendStr,
        verifiedBy: verifiedStr,
        backendList,
        testList,
      })
    }
  }
  return rows
}

export function InventoryPage() {
  const toast = useToast()
  const projectId = useActiveProjectId()
  const { has, loading: entLoading, planName } = useEntitlements()
  const copy = usePageCopy('/inventory')
  const ux = useInventoryUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveInventoryTab(tabParam)
  const activeTabMeta = INVENTORY_TABS.find((t) => t.id === activeTab) ?? INVENTORY_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<InventoryStats>('/v1/admin/inventory/stats')
  const stats = statsData ?? EMPTY_INVENTORY_STATS

  const setActiveTab = useCallback(
    (id: InventoryTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !projectId || statsLoading) return
    const quickTab = resolveQuickInventoryTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, projectId, statsLoading, stats, activeTab, setActiveTab])

  const [yamlDraft, setYamlDraft] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{
    id: string
    title: string
    status: string
    meta: Record<string, unknown> | null
  } | null>(null)
  const [history, setHistory] = useState<
    Array<{ id: string; from_status: string | null; to_status: string; trigger: string; changed_at: string }>
  >([])

  const isUuid = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  const basePath = projectId ? `/v1/admin/inventory/${projectId}` : null
  const mainQuery = usePageData<InventoryPayload>(basePath, {
    deps: [projectId ?? ''],
  })
  const storiesQuery = usePageData<{ tree: StoryPayload[] }>(
    basePath ? `${basePath}/user-stories` : null,
    { deps: [projectId ?? '', activeTab] },
  )
  const findingsQuery = usePageData<FindingsPayload>(
    basePath && (activeTab === 'gates' || activeTab === 'stories' || activeTab === 'overview')
      ? `${basePath}/findings`
      : null,
    { deps: [projectId ?? '', activeTab] },
  )

  const payload = mainQuery.data
  const summary = payload?.summary ?? {}
  const snapshot = payload?.snapshot ?? null
  const treeRows = useMemo(() => buildTreeRows(snapshot?.parsed as Record<string, unknown>), [snapshot])

  const reloadAll = useCallback(() => {
    reloadStats()
    mainQuery.reload()
    storiesQuery.reload()
    findingsQuery.reload()
  }, [reloadStats, mainQuery, storiesQuery, findingsQuery])

  useRealtimeReload(['inventories', 'gate_runs', 'gate_findings', 'status_history', 'synthetic_runs'], reloadAll, {
    debounceMs: 1200,
    enabled: Boolean(projectId) && has('inventory_v2'),
  })

  const nba = useNextBestAction({
    scope: 'inventory',
    fragileComponents: Number(summary.regressed ?? 0),
    untestedComponents: Number(summary.unknown ?? 0),
  })

  // Gate-run and reconcile both operate at the WHOLE-PROJECT level today.
  // The downstream inventory-gates / inventory-crawler edge functions don't
  // accept a story filter yet — adding one is a feature, not an audit fix.
  // The per-story buttons in UserStoryMap are kept as a contextual shortcut
  // ("I'm reading this story, run gates from right here") but the toast
  // copy is honest about the actual scope so users aren't misled.
  const runGates = async () => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/gates/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (res.ok) {
      toast.success('Gates triggered', 'Watch the Gates tab for results.')
      findingsQuery.reload()
    } else {
      toast.push({
        tone: 'error',
        message: 'Gates run failed',
        description: res.error?.message ?? '',
      })
    }
  }

  const reconcile = async () => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (res.ok) toast.success('Crawler started', 'Drift tab updates when the crawl finishes.')
    else
      toast.push({ tone: 'error', message: 'Reconcile failed', description: res.error?.message ?? '' })
  }

  const ingestYaml = async (yaml: string) => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ yaml, source: 'cli' }),
    })
    if (res.ok) {
      toast.success('Inventory ingested')
      reloadAll()
    } else {
      toast.push({
        tone: 'error',
        message: 'Ingest failed',
        description: res.error?.message ?? JSON.stringify(res.error),
      })
    }
  }

  const openDrawerForRow = useCallback((row: TreeRow) => {
    setHistory([])
    setDrawer({
      id: row.id,
      title: row.actionLabel,
      status: row.status,
      meta: {
        intent: row.actionLabel,
        // The drawer renders structured chips for these — the previous
        // string-flat versions stay around for hover-title / a11y but
        // the array-of-objects form is what gives us proper rendering.
        backend: row.backendList ?? [],
        verified_by: row.testList ?? [],
      },
    })
  }, [])

  const openActionDrawer = useCallback(
    async (a: StoryPayload['actions'][0]) => {
      setDrawer({
        id: a.id,
        title: a.label,
        status: a.status,
        meta: (a.metadata as Record<string, unknown>) ?? { intent: a.label },
      })
      if (!projectId || !isUuid(a.id)) {
        setHistory([])
        return
      }
      const h = await apiFetch<{ transitions: typeof history }>(
        `/v1/admin/inventory/${projectId}/status-history?node_id=${encodeURIComponent(a.id)}`,
      )
      if (h.ok && h.data?.transitions) setHistory(h.data.transitions)
      else setHistory([])
    },
    [projectId],
  )

  const stories = storiesQuery.data?.tree ?? []

  // Bucket gate_findings by their `node_id` so the User-Story Map can
  // render "X open findings" against each story. The reconciler/gates
  // pin findings to whichever graph_node they affect (action, element,
  // page) so this same map serves the per-action chip on each card.
  const findingsByNode = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of findingsQuery.data?.findings ?? []) {
      const nid = (f as { node_id?: string | null }).node_id
      if (!nid) continue
      m.set(nid, (m.get(nid) ?? 0) + 1)
    }
    return m
  }, [findingsQuery.data?.findings])

  const synthActions = useMemo(
    () =>
      stories.flatMap((s) =>
        s.actions.map((a) => ({
          id: a.id,
          label: a.label,
          storyLabel: s.label,
        })),
      ),
    [stories],
  )

  const gateCards = ['dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim'] as const
  const runs = findingsQuery.data?.runs ?? []
  const findings = findingsQuery.data?.findings ?? []

  const driftFromFindings = useMemo(() => {
    const crawl = findings.filter(
      (f) =>
        f.message &&
        runs.find((r) => r.id === f.gate_run_id)?.gate === 'crawl',
    )
    const missingInv: { label: string; detail?: string }[] = []
    const missingApp: { label: string; detail?: string }[] = []
    const mismatch: { label: string; detail?: string }[] = []
    for (const f of crawl) {
      const msg = f.message.toLowerCase()
      if (msg.includes('inventory') || msg.includes('missing yaml')) missingInv.push({ label: f.message })
      else if (msg.includes('dom') || msg.includes('testid')) missingApp.push({ label: f.message })
      else mismatch.push({ label: f.message })
    }
    return { missingInv, missingApp, mismatch }
  }, [findings, runs])

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : !stats.hasInventory
        ? 'brand'
        : stats.topPriority === 'regressed'
          ? 'danger'
          : stats.topPriority === 'open_findings'
            ? 'warn'
            : stats.topPriority === 'stub_heavy' || stats.topPriority === 'discovery_ready'
              ? 'info'
              : stats.topPriority === 'clear'
                ? 'ok'
                : 'brand'

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'stories' as const,
        label: copy?.tabLabels?.stories ?? 'User stories',
        count: stats.userStories > 0 ? stats.userStories : undefined,
      },
      {
        id: 'tree' as const,
        label: copy?.tabLabels?.tree ?? 'Tree',
        count: stats.total > 0 ? stats.total : undefined,
      },
      {
        id: 'gates' as const,
        label: copy?.tabLabels?.gates ?? 'Gates',
        count: stats.openFindings > 0 ? stats.openFindings : undefined,
      },
      { id: 'synthetic' as const, label: copy?.tabLabels?.synthetic ?? 'Synthetic' },
      { id: 'drift' as const, label: copy?.tabLabels?.drift ?? 'Drift' },
      {
        id: 'discovery' as const,
        label: copy?.tabLabels?.discovery ?? 'Discovery',
        count: stats.draftProposals > 0 ? stats.draftProposals : undefined,
      },
      { id: 'yaml' as const, label: copy?.tabLabels?.yaml ?? 'Yaml' },
    ],
    [copy?.tabLabels, stats],
  )

  usePublishPageContext({
    route: '/inventory',
    title: 'User stories',
    summary: `${activeTabMeta.label} · ${stats.hasInventory ? `${stats.verified}/${stats.total} verified` : 'No inventory yet'}`,
    filters: { tab: activeTab, project_id: projectId ?? undefined },
    criticalCount: stats.regressed,
    actions: [
      { id: 'inventory-refresh', label: 'Refresh', hint: 'Re-fetch stats + snapshot', run: reloadAll },
      { id: 'inventory-gates', label: 'Run gates', hint: 'Trigger gate suite on project', run: () => void runGates() },
    ],
  })

  if (!projectId) {
    return <Loading text="Select a project…" />
  }

  if (!entLoading && !has('inventory_v2')) {
    return (
      <div className="space-y-4">
        <PageHeader title="User stories & inventory" projectScope={null} />
        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-xs leading-relaxed text-fg-muted">Maps specs to verified actions.</p>
        </ContainedBlock>
        <UpgradePrompt flag="inventory_v2" currentPlan={planName} />
      </div>
    )
  }

  if ((statsLoading && !statsData) || (mainQuery.loading && !mainQuery.data)) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading inventory">
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
    return <ErrorAlert message={`Failed to load inventory stats: ${statsError}`} onRetry={reloadAll} />
  }
  if (mainQuery.error) {
    return <ErrorAlert message={mainQuery.error} onRetry={reloadAll} />
  }

  const total = Number(summary.total ?? stats.total)
  const verified = Number(summary.verified ?? stats.verified)

  return (
    <div className="space-y-4" data-testid="mushi-page-inventory">
      <PageHelp {...INVENTORY_HELP} />

      <PageHeader
        title={copy?.title ?? 'User stories · Inventory'}
        projectScope={stats.projectName ?? undefined}
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
                    : bannerSeverity === 'info'
                      ? 'bg-info/10 text-info'
                      : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasInventory
            ? stats.draftProposals > 0
              ? `${stats.draftProposals} DRAFT`
              : 'EMPTY'
            : stats.regressed > 0
              ? `${stats.regressed} REGRESSED`
              : stats.openFindings > 0
                ? `${stats.openFindings} FINDINGS`
                : 'CURRENT'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? mainQuery.lastFetchedAt}
          isValidating={statsValidating || mainQuery.isValidating}
        />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || mainQuery.isValidating}>
          Refresh
        </Btn>
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            (stats.hasInventory
              ? `${verified}/${total} verified — ${activeTabMeta.label} tab`
              : 'Banner + INVENTORY SNAPSHOT — start on Overview, then Discovery or Yaml to ingest.')}
        </p>
      </ContainedBlock>

      <InventoryStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating || mainQuery.isValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<InventoryTabId>
        size="sm"
        ariaLabel="Inventory sections"
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
      />
      )}

      {!ux.hideInventorySnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'INVENTORY SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.verified ?? 'Verified'}
            value={stats.hasInventory ? `${stats.verified}/${stats.total}` : '—'}
            accent={stats.regressed > 0 ? 'text-warn' : stats.verified > 0 ? 'text-ok' : undefined}
            hint={stats.hasInventory ? `${stats.userStories} stories` : 'Not ingested'}
            to={inventoryLinks.verified}
          />
          <StatCard
            label={copy?.statLabels?.regressed ?? 'Regressed'}
            value={stats.regressed}
            accent={stats.regressed > 0 ? 'text-danger' : 'text-ok'}
            hint={stats.regressed > 0 ? 'Fix before release' : 'None flagged'}
            to={inventoryLinks.regressed}
          />
          <StatCard
            label={copy?.statLabels?.findings ?? 'Findings'}
            value={stats.openFindings}
            accent={stats.openFindings > 0 ? 'text-warn' : undefined}
            hint={stats.lastGateRunAt ? 'From latest gate runs' : 'No runs yet'}
            to={inventoryLinks.findings}
          />
          <StatCard
            label={copy?.statLabels?.discovery ?? 'Discovery'}
            value={stats.discoveryEvents}
            accent={stats.draftProposals > 0 ? 'text-brand' : undefined}
            hint={
              stats.draftProposals > 0
                ? `${stats.draftProposals} draft proposal${stats.draftProposals === 1 ? '' : 's'}`
                : 'SDK events observed'
            }
            to={inventoryLinks.discovery}
          />
        </div>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          <PageHero
            scope="inventory"
            title="User stories"
            kicker="Plan"
            decide={{
              label: stats.topPriorityLabel ?? 'Truth layer',
              metric: stats.hasInventory ? `${stats.verified}/${stats.total} verified` : undefined,
              summary:
                stats.topPriority === 'no_inventory'
                  ? 'Brand banner — no inventory yet. Discovery tab runs observe → propose → accept; Yaml tab is the manual path.'
                  : stats.topPriority === 'regressed'
                    ? 'Red banner — regressed actions broke since last verify. Stories tab shows which cards regressed.'
                    : stats.topPriority === 'open_findings'
                      ? 'Amber banner — gate findings need review on the Gates tab.'
                      : 'Green banner — coverage current. Tree tab shows page × element wiring.',
              severity:
                stats.topPriority === 'regressed'
                  ? 'crit'
                  : stats.topPriority === 'open_findings'
                    ? 'warn'
                    : stats.topPriority === 'clear'
                      ? 'ok'
                      : 'info',
            }}
            verify={{
              label: 'Latest ingest',
              detail: stats.commitSha ? `commit ${stats.commitSha.slice(0, 7)}` : stats.hasInventory ? 'Ingested' : '—',
            }}
          />

          {stats.topPriorityTo && stats.topPriority !== 'clear' ? (
            <Card
              className={`space-y-3 p-4 ${
                stats.topPriority === 'regressed'
                  ? 'border-danger/30 bg-danger/5'
                  : stats.topPriority === 'open_findings'
                    ? 'border-warn/30 bg-warn/5'
                    : 'border-brand/30 bg-brand/5'
              }`}
            >
              <SignalChip
                tone={
                  stats.topPriority === 'regressed'
                    ? 'danger'
                    : stats.topPriority === 'open_findings'
                      ? 'warn'
                      : 'brand'
                }
              >
                Top priority
              </SignalChip>
              <ContainedBlock
                tone={
                  stats.topPriority === 'regressed'
                    ? 'warn'
                    : stats.topPriority === 'open_findings'
                      ? 'info'
                      : 'info'
                }
              >
                <p className="text-sm font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
              </ContainedBlock>
              <ActionPillRow>
                <ActionPill to={stats.topPriorityTo} tone="brand">
                  Take action →
                </ActionPill>
                <ActionPill onClick={() => setActiveTab('stories')} tone="neutral">
                  User stories
                </ActionPill>
              </ActionPillRow>
            </Card>
          ) : null}

          <PageActionBar
            scope="inventory"
            action={nba}
            trailing={
              <div className="flex flex-wrap gap-2" data-dav-anchor="inventory:act">
                <Btn type="button" size="sm" variant="ghost" onClick={() => void runGates()}>
                  Run gates
                </Btn>
                <Btn type="button" size="sm" variant="ghost" onClick={() => void reconcile()}>
                  Run crawler
                </Btn>
              </div>
            }
          />

          {!snapshot && (
            <SetupNudge
              requires={['github_connected']}
              emptyTitle="No inventory yet"
              emptyDescription="Either install @mushi-mushi/web with discoverInventory: true and let the SDK observe your app — Claude will draft an inventory.yaml — or hand-author one and paste it from the Yaml tab."
              emptyIcon={<HeroGraphNodes />}
              blockedIcon={<HeroGraphNodes accent="text-fg-faint" />}
              emptyAction={
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" onClick={() => setActiveTab('discovery')}>
                    Open Discovery →
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setActiveTab('yaml')}>
                    Paste YAML
                  </Btn>
                </div>
              }
              emptyHints={[
                'Discovery (recommended): SDK observes → Claude proposes → you accept.',
                'Manual: author inventory.yaml directly and paste from the Yaml tab.',
                'Either path supports auth-gated apps via crawler settings or auth.scripted blocks.',
              ]}
            />
          )}

          <ActionPillRow>
            <ActionPill
              onClick={() => setActiveTab(stats.hasInventory ? 'stories' : 'discovery')}
              tone="brand"
            >
              {stats.hasInventory ? 'Open user stories →' : 'Start Discovery →'}
            </ActionPill>
            {stats.hasInventory ? (
              <ActionPill onClick={() => setActiveTab('gates')} tone="neutral">
                View gates
              </ActionPill>
            ) : null}
          </ActionPillRow>
          </>
          )}
        </>
      )}

      {activeTab === 'stories' && (
        <div data-dav-anchor="inventory:decide">
          <UserStoryMap
            stories={stories}
            findingsByNode={findingsByNode}
            onSelectAction={(a) => void openActionDrawer(a)}
            onRunGatesForStory={() => void runGates()}
            onRunCrawlerForStory={() => void reconcile()}
          />
        </div>
      )}

      {activeTab === 'tree' && <InventoryTree rows={treeRows} onRowClick={openDrawerForRow} />}

      {activeTab === 'gates' && (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5" data-dav-anchor="inventory:verify">
            {gateCards.map((g) => {
              const latest = runs.find((r) => r.gate === g)
              const statusTone =
                latest?.status === 'pass'
                  ? 'ok'
                  : latest?.status === 'fail'
                    ? 'danger'
                    : 'neutral'
              return (
                <Card key={g} className="space-y-2 p-3">
                  <SignalChip tone="neutral" className="uppercase">
                    {g.replace(/_/g, ' ')}
                  </SignalChip>
                  <ContainedBlock tone={statusTone === 'danger' ? 'warn' : 'muted'}>
                    <p className="text-sm font-semibold text-fg">{latest?.status ?? '—'}</p>
                    <InlineProof className="mt-1.5">
                      {latest?.findings_count ?? 0} findings
                    </InlineProof>
                  </ContainedBlock>
                </Card>
              )
            })}
          </div>
          <div className="space-y-2 max-h-[28rem] overflow-auto">
            {findings.slice(0, 80).map((f) => (
              <GateFindingCard
                key={f.id}
                f={{ ...f, gate: runs.find((r) => r.id === f.gate_run_id)?.gate }}
                onOpenFile={(path, line) => {
                  // GitHub's code search expects /search?q=... (the bare /?q= URL renders the homepage).
                  // `noopener,noreferrer` so a malicious finding can't reach back into window.opener.
                  const q = encodeURIComponent(`${path}${line ? ` line ${line}` : ''}`)
                  window.open(`https://github.com/search?q=${q}&type=code`, '_blank', 'noopener,noreferrer')
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'synthetic' && (
        <div className="grid gap-3 md:grid-cols-2">
          {synthActions.length === 0 ? (
            <EmptySectionMessage
              text="No Action nodes for synthetic probes yet."
              hint="Ingest inventory with user stories — each Action node becomes a probe target on this tab."
            />
          ) : (
            synthActions.slice(0, 16).map((a) => (
              <SyntheticPreview key={a.id} projectId={projectId} actionId={a.id} label={`${a.storyLabel} · ${a.label}`} />
            ))
          )}
        </div>
      )}

      {activeTab === 'drift' && (
        <DriftDiffPanel
          missingInInventory={driftFromFindings.missingInv}
          missingInApp={driftFromFindings.missingApp}
          mismatches={driftFromFindings.mismatch}
          onReconcile={reconcile}
        />
      )}

      {activeTab === 'discovery' && (
        <DiscoveryTab projectId={projectId} onAccepted={reloadAll} />
      )}

      {activeTab === 'yaml' && (
        <div className="space-y-4">
          <CrawlerSettingsCard projectId={projectId} />
          <div className="space-y-3">
            <InventoryYamlDropzone onParsed={(y) => setYamlDraft(y)} />
            <div className="flex gap-2">
              <Btn type="button" size="sm" onClick={() => yamlDraft && ingestYaml(yamlDraft)} disabled={!yamlDraft}>
                Ingest selected file
              </Btn>
            </div>
            <pre className="text-2xs bg-surface-overlay/50 p-3 rounded-md overflow-auto max-h-[32rem] font-mono">
              {yamlDraft ?? snapshot?.raw_yaml ?? '—'}
            </pre>
            {snapshot?.validation_errors && Array.isArray(snapshot.validation_errors) && snapshot.validation_errors.length > 0 && (
              <ErrorAlert message={JSON.stringify(snapshot.validation_errors)} />
            )}
          </div>
        </div>
      )}

      <ActionDetailDrawer
        open={drawer != null}
        onClose={() => {
          setDrawer(null)
          setHistory([])
        }}
        title={drawer?.title ?? ''}
        status={drawer?.status}
        meta={drawer?.meta ?? null}
        nodeId={drawer?.id}
        transitions={history}
      />
    </div>
  )
}

function SyntheticPreview({
  projectId,
  actionId,
  label,
}: {
  projectId: string
  actionId: string
  label: string
}) {
  const path = `/v1/admin/inventory/${projectId}/synthetic/${encodeURIComponent(actionId)}/history`
  const q = usePageData<{ runs: Array<{ ran_at: string; latency_ms?: number | null; status: string }> }>(path, {
    deps: [projectId, actionId],
  })
  return <SyntheticTimeline runs={q.data?.runs ?? []} actionLabel={label} />
}
