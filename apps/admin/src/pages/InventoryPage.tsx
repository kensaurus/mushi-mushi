import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useEntitlements } from '../lib/useEntitlements'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { apiFetch } from '../lib/supabase'
import { apiErrorMessage } from '../lib/humanizeApiError'
import { PageLoadError } from '../components/PageLoadError'
import { inventoryFindingsEnabled } from '../lib/inventoryReadout'
import { useRealtimeReload } from '../lib/realtime'
import { useAdminMode } from '../lib/mode'
import {
  SegmentedControl,
  Btn,
  Card,
  ErrorAlert,
  Loading,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageHero } from '../components/PageHero'
import { PageStatus } from '../components/ui/page-status'
import { PageFirstStep } from '../components/ui/page-first-step'
import { PageActionMap } from '../components/inventory/PageActionMap'
import { gateLabel } from '../lib/gateLabels'
import { pluralize } from '../lib/format'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { UserStoryMap } from '../components/inventory/UserStoryMap'
import { InventoryTree, type TreeRow } from '../components/inventory/InventoryTree'
import { GateFindingCard, type GateFinding } from '../components/inventory/GateFindingCard'
import { DismissFindingButton } from '../components/gates/DismissFindingButton'
import { ActionDetailDrawer } from '../components/inventory/ActionDetailDrawer'
import { InventoryYamlDropzone } from '../components/inventory/InventoryYamlDropzone'
import { CrawlerSettingsCard } from '../components/inventory/CrawlerSettingsCard'
import { DiscoveryTab } from '../components/inventory/DiscoveryTab'
import { SyntheticTimeline } from '../components/inventory/SyntheticTimeline'
import { DriftDiffPanel } from '../components/inventory/DriftDiffPanel'
import { InventoryWorkspaceReadout } from '../components/inventory/InventoryWorkspaceReadout'
import { INVENTORY_HELP } from '../components/inventory/inventoryCopy'
import { useNextBestAction } from '../lib/useNextBestAction'

type Tab = 'stories' | 'tree' | 'gates' | 'synthetic' | 'drift' | 'discovery' | 'yaml'

// One tab row: the page is already Advanced-only, so a second
// "Primary / Advanced" toggle above it only hid half the tabs.
// Ids stay as they were: other pages and the docs deep-link `?tab=gates`,
// `?tab=discovery` and so on. Only the words on the tabs changed.
const INVENTORY_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'stories', label: 'User stories' },
  { id: 'tree', label: 'All actions' },
  { id: 'gates', label: 'Code checks' },
  { id: 'synthetic', label: 'Live probes' },
  { id: 'drift', label: 'Out of sync' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'yaml', label: 'Map file' },
]

function parseTab(raw: string | null): Tab {
  return INVENTORY_TABS.some((t) => t.id === raw) ? (raw as Tab) : 'stories'
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
  /** Dismissed (allowlisted) findings come back too; the page filters them out. */
  findings: Array<GateFinding & { gate_run_id?: string; allowlisted?: boolean | null }>
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
  const { isAdvanced } = useAdminMode()
  const projectId = useActiveProjectId()
  const { has, loading: entLoading, planName } = useEntitlements()
  const copy = usePageCopy('/inventory')
  // The tab lives in `?tab=` so links (Settings → Spend-down, Home's site
  // map, this page's own first step) open it, also while already here.
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'))
  const setTab = useCallback(
    (next: Tab) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next === 'stories') out.delete('tab')
          else out.set('tab', next)
          return out
        },
        { replace: true },
      ),
    [setParams],
  )
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
    { deps: [projectId ?? '', tab] },
  )
  // Findings drive the per-story open-finding badge AND the Gates tab's
  // detail list. Loading them on `stories` lets the Stories cards advertise
  // "X open findings" without an extra round-trip when the user clicks over.
  const findingsQuery = usePageData<FindingsPayload>(
    basePath && inventoryFindingsEnabled(tab) ? `${basePath}/findings` : null,
    { deps: [projectId ?? '', tab] },
  )

  const payload = mainQuery.data
  const summary = payload?.summary ?? {}
  const snapshot = payload?.snapshot ?? null
  const treeRows = useMemo(() => buildTreeRows(snapshot?.parsed as Record<string, unknown>), [snapshot])

  const reloadAll = useCallback(() => {
    mainQuery.reload()
    storiesQuery.reload()
    findingsQuery.reload()
  }, [mainQuery, storiesQuery, findingsQuery])

  useRealtimeReload(['inventories', 'gate_runs', 'gate_findings', 'status_history', 'synthetic_runs'], reloadAll, {
    debounceMs: 1200,
    enabled: Boolean(projectId) && has('inventory_v2'),
  })

  const nba = useNextBestAction({
    scope: 'inventory',
    fragileComponents: Number(summary.regressed ?? 0),
    untestedComponents: Number(summary.unknown ?? 0),
  })

  const runGates = async (storyNodeId?: string) => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/gates/run`, {
      method: 'POST',
      body: JSON.stringify(storyNodeId ? { story_node_id: storyNodeId } : {}),
    })
    if (res.ok) {
      toast.success(
        storyNodeId ? 'Checking this story' : 'Checking every action',
        'Results show on the Code checks tab.',
      )
      findingsQuery.reload()
    } else {
      toast.push({
        tone: 'error',
        message: 'Could not start the checks',
        description: res.error?.message ?? '',
      })
    }
  }

  const reconcile = async (storyNodeId?: string) => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify(storyNodeId ? { story_node_id: storyNodeId } : {}),
    })
    if (res.ok) {
      toast.success(
        storyNodeId ? 'Crawler started for this story' : 'Crawler started',
        'The Out of sync tab updates when the crawl finishes.',
      )
    } else {
      toast.push({ tone: 'error', message: 'Could not start the crawler', description: res.error?.message ?? '' })
    }
  }

  const ingestYaml = async (yaml: string) => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/inventory/${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ yaml, source: 'cli' }),
    })
    if (res.ok) {
      toast.success('Map file saved')
      reloadAll()
    } else {
      const issues = (res.error?.issues ?? []) as Array<{ path?: string; message?: string }>
      const detail = issues.length
        ? issues.slice(0, 3).map((i) => `${i.path ?? '$'}: ${i.message ?? 'invalid'}`).join(' · ') +
          (issues.length > 3 ? ` · and ${issues.length - 3} more` : '')
        : apiErrorMessage(res.error, 'The file could not be ingested. Check that it is a valid inventory.yaml.')
      toast.push({ tone: 'error', message: 'Could not read the map file', description: detail })
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
  // Dismissed (allowlisted) findings are not open: never listed or counted.
  const allFindings = findingsQuery.data?.findings
  const findings = useMemo(() => (allFindings ?? []).filter((f) => !f.allowlisted), [allFindings])
  const dismissedPerRun = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of allFindings ?? []) {
      if (f.allowlisted && f.gate_run_id) m.set(f.gate_run_id, (m.get(f.gate_run_id) ?? 0) + 1)
    }
    return m
  }, [allFindings])
  const findingsByNode = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of findings) {
      const nid = (f as { node_id?: string | null }).node_id
      if (!nid) continue
      m.set(nid, (m.get(nid) ?? 0) + 1)
    }
    return m
  }, [findings])
  // Findings with no node can't show on a story card, yet the sidebar badge
  // counts them, so the Stories tab says where they are.
  const unattachedFindings = useMemo(
    () => findings.filter((f) => !(f as { node_id?: string | null }).node_id).length,
    [findings],
  )

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

  if (!projectId) {
    return <Loading text="Select a project…" />
  }

  if (!entLoading && !has('inventory_v2')) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-inventory">
        <PageHeaderBar title="User stories" projectScope={null} />
        <UpgradePrompt flag="inventory_v2" currentPlan={planName} />
      </div>
    )
  }

  if (mainQuery.loading && !mainQuery.data) {
    return <Loading text="Loading inventory…" />
  }
  if (mainQuery.error) {
    return (
      <PageLoadError
        error={mainQuery.error}
        onRetry={mainQuery.reload}
        resource="the inventory"
        endpoint={basePath}
      />
    )
  }

  const total = Number(summary.total ?? 0)
  const verified = Number(summary.verified ?? 0)
  const regressed = Number(summary.regressed ?? 0)
  const stub = Number(summary.stub ?? 0)
  const broken = regressed + stub
  const hasInventory = snapshot != null

  return (
    <div className="space-y-3" data-testid="mushi-page-inventory">
      <PageHeaderBar
        title={copy?.title ?? 'User stories'}
        projectScope={null}
        withPageHero={isAdvanced}

        helpTitle={INVENTORY_HELP.title}
        helpWhatIsIt={INVENTORY_HELP.whatIsIt}
        helpUseCases={INVENTORY_HELP.useCases}
        helpHowToUse={INVENTORY_HELP.howToUse}
      />

      {isAdvanced ? (
      <PageHero
        scope="inventory"
        title="Truth layer snapshot"
        kicker="User story truth layer"
        decide={{
          label: total ? `${verified} / ${total} actions verified` : 'No actions ingested',
          metric: `${stub} stub · ${regressed} regressed`,
          summary: regressed > 0 ? 'Regressed actions need a fix or rollback before the next release.' : 'Surface looks healthy — keep gates green in CI.',
          severity: regressed > 0 ? 'crit' : total === 0 ? 'neutral' : 'ok',
          anchor: 'inventory:decide',
          evidence: {
            kind: 'metric-breakdown',
            whyNow: regressed > 0
              ? `${regressed} regressed action${regressed === 1 ? '' : 's'} need a fix or rollback before the next release.`
              : total === 0
                ? 'No actions ingested yet — connect a repo to populate the inventory.'
                : `${verified}/${total} actions verified · ${stub} stub · ${regressed} regressed.`,
            items: [
              { label: 'Total', value: total, tone: 'neutral' },
              { label: 'Verified', value: verified, tone: verified > 0 ? 'ok' : 'neutral' },
              { label: 'Stub', value: stub, tone: stub > 0 ? 'info' : 'neutral' },
              { label: 'Regressed', value: regressed, tone: regressed > 0 ? 'crit' : 'ok' },
            ],
          },
        }}
        act={nba}
        actAnchor="inventory:act"
        actEvidence={nba ? { kind: 'rule-trace', why: nba.reason ?? nba.title, threshold: regressed > 0 ? `${regressed} regressed` : undefined } : undefined}
        verify={{
          label: 'Latest ingest',
          detail: snapshot?.commit_sha ? `commit ${snapshot.commit_sha.slice(0, 7)}` : '—',
          to: '/repo',
          secondaryTo: '/graph',
          secondaryLabel: 'Open graph',
          anchor: 'inventory:verify',
          evidence: snapshot?.commit_sha ? {
            kind: 'last-event',
            at: mainQuery.lastFetchedAt ?? new Date().toISOString(),
            by: 'crawler / reconciler',
            payloadSummary: `commit ${snapshot.commit_sha.slice(0, 7)}`,
            status: regressed > 0 ? 'warn' : 'ok',
          } : undefined,
        }}
      />
      ) : null}

      {hasInventory ? (
        <PageStatus
          tone={broken > 0 ? 'danger' : total > 0 && verified === total ? 'ok' : 'warn'}
          sentence={inventorySentence({ total, verified, regressed, stub })}
          metrics={[
            { label: 'Broken actions', value: broken, tone: broken > 0 ? 'danger' : 'neutral', hint: 'Actions that stopped working (regressed) or have no code behind them yet (stub).' },
            { label: 'Verified', value: `${verified} of ${total}`, tone: verified > 0 ? 'ok' : 'neutral', hint: 'Actions a test proves still work.' },
            { label: 'Open code findings', value: findings.length, to: '/inventory?tab=gates', tone: findings.length > 0 ? 'warn' : 'neutral' },
          ]}
          action={
            <span className="flex flex-wrap items-center gap-2" data-dav-anchor="inventory:act">
              <Btn size="sm" variant="primary" onClick={() => void runGates()}>
                Check every action
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => void reconcile()}>
                Crawl the app
              </Btn>
            </span>
          }
          data-testid="inventory-status"
        />
      ) : tab === 'stories' ? (
        <PageFirstStep
          title="No user stories yet"
          sentence="Turn on discovery and Mushi watches which pages people open and what they click, then drafts your user stories for you to accept. Nothing to write by hand."
          action={{ label: 'Turn on discovery', to: '/inventory?tab=discovery' }}
          learnMore={{ label: 'Or write the map file yourself', to: '/inventory?tab=yaml' }}
          data-testid="inventory-first-step"
        />
      ) : null}

      <SegmentedControl<Tab>
        size="sm"
        scrollable
        ariaLabel="Inventory sections"
        value={tab}
        onChange={setTab}
        options={INVENTORY_TABS}
        className="w-full sm:w-auto"
      />

      {tab === 'stories' && (
        hasInventory ? (
        <div data-dav-anchor="inventory:decide" className="space-y-4">
          <PageActionMap rows={treeRows} onSelect={openDrawerForRow} onShowAll={() => setTab('tree')} />
          {unattachedFindings > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              {unattachedFindings} open code finding{unattachedFindings === 1 ? ' is' : 's are'} not tied to an action on this map.
              <Btn size="sm" variant="ghost" onClick={() => setTab('gates')}>
                Show code checks
              </Btn>
            </p>
          )}
          <UserStoryMap
            stories={stories}
            findingsByNode={findingsByNode}
            onSelectAction={(a) => void openActionDrawer(a)}
            onRunGatesForStory={(storyId) => void runGates(storyId)}
            onRunCrawlerForStory={(storyId) => void reconcile(storyId)}
          />
        </div>
        ) : null
      )}

      {tab === 'tree' && <InventoryTree rows={treeRows} onRowClick={openDrawerForRow} />}

      {tab === 'gates' && (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5" data-dav-anchor="inventory:verify">
            {gateCards.map((g) => {
              const latest = runs.find((r) => r.gate === g)
              // findings_count is stored when the run ends; a dismissal never lowers it.
              const open = latest ? Math.max(0, (latest.findings_count ?? 0) - (dismissedPerRun.get(latest.id) ?? 0)) : 0
              return (
                <Card key={g} className="p-3">
                  <p className="text-2xs text-fg-faint">{gateLabel(g)}</p>
                  <p className="text-sm font-semibold">{latest ? gateRunWord(latest.status) : 'Not run yet'}</p>
                  <p className="text-2xs text-fg-muted">{open} open {pluralize(open, 'finding')}</p>
                </Card>
              )
            })}
          </div>
          {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
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
                action={
                  projectId ? (
                    <DismissFindingButton projectId={projectId} findingId={f.id} onDismissed={findingsQuery.reload} />
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'synthetic' && (
        <div className="grid gap-3 md:grid-cols-2">
          {synthActions.length === 0 ? (
            <p className="text-xs text-fg-muted">Live probes start once your app has user stories. Turn on discovery to draft them.</p>
          ) : (
            synthActions.slice(0, 16).map((a) => (
              <SyntheticPreview key={a.id} projectId={projectId} actionId={a.id} label={`${a.storyLabel} · ${a.label}`} />
            ))
          )}
        </div>
      )}

      {tab === 'drift' && (
        <DriftDiffPanel
          missingInInventory={driftFromFindings.missingInv}
          missingInApp={driftFromFindings.missingApp}
          mismatches={driftFromFindings.mismatch}
        />
      )}

      {tab === 'discovery' && (
        <DiscoveryTab projectId={projectId} onAccepted={reloadAll} />
      )}

      {tab === 'yaml' && (
        <div className="space-y-4">
          <CrawlerSettingsCard projectId={projectId} />
          <div className="space-y-3">
            <InventoryYamlDropzone onParsed={(y) => setYamlDraft(y)} onCleared={() => setYamlDraft(null)} />
            <div className="flex gap-2">
              <Btn type="button" size="sm" onClick={() => yamlDraft && ingestYaml(yamlDraft)} disabled={!yamlDraft}>
                Save this map file
              </Btn>
            </div>
            {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
            <pre className="mushi-code-block mushi-code-body text-2xs p-3 rounded-md overflow-auto max-h-[32rem] font-mono">
              {yamlDraft ?? snapshot?.raw_yaml ?? '—'}
            </pre>
            {snapshot?.validation_errors && Array.isArray(snapshot.validation_errors) && snapshot.validation_errors.length > 0 && (
              <ErrorAlert message={JSON.stringify(snapshot.validation_errors)} />
            )}
          </div>
        </div>
      )}

      {/* Endpoints and raw signals: developer detail, at the foot of the page. */}
      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.guide,
            show: Boolean(projectId),
            children: (
              <InventoryWorkspaceReadout
                projectId={projectId!}
                storyCount={storiesQuery.data ? storiesQuery.data.tree.length : null}
                nodeCount={total}
              />
            ),
          },
        ]}
      />

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

/** Exported for tests; page modules are knip entries, so it carries no tag. The status line: what is broken first, then how much is proven. */
export function inventorySentence({
  total,
  verified,
  regressed,
  stub,
}: {
  total: number
  verified: number
  regressed: number
  stub: number
}): string {
  if (total === 0) return 'The map file has no actions yet. Accept a discovery draft to fill it.'
  const broken = regressed + stub
  if (broken > 0) {
    const parts = [
      regressed > 0 ? `${regressed} stopped working` : null,
      stub > 0 ? `${stub} ${stub === 1 ? 'has' : 'have'} no code behind ${stub === 1 ? 'it' : 'them'} yet` : null,
    ].filter(Boolean)
    return `${broken} of ${total} ${pluralize(total, 'action')} ${broken === 1 ? 'is' : 'are'} broken: ${parts.join(', ')}.`
  }
  if (verified === total) return `All ${total} ${pluralize(total, 'action')} work and a test proves each one.`
  return `Nothing is broken. ${verified} of ${total} ${pluralize(total, 'action')} ${verified === 1 ? 'has' : 'have'} a test that proves ${verified === 1 ? 'it works' : 'they work'}.`
}

function gateRunWord(status: string): string {
  switch (status) {
    case 'pass':
      return 'Passed'
    case 'fail':
      return 'Found problems'
    case 'running':
    case 'queued':
      return 'Running'
    case 'warn':
      return 'Passed with warnings'
    case 'skipped':
      return 'Skipped'
    case 'error':
      return 'Could not run'
    default:
      return status
  }
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
