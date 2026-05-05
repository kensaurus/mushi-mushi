import { useCallback, useMemo, useState } from 'react'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useEntitlements } from '../lib/useEntitlements'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
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
} from '../components/ui'
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
import { useNextBestAction } from '../lib/useNextBestAction'

type Tab = 'stories' | 'tree' | 'gates' | 'synthetic' | 'drift' | 'discovery' | 'yaml'

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
  const [tab, setTab] = useState<Tab>('stories')
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
    basePath && (tab === 'gates' || tab === 'stories') ? `${basePath}/findings` : null,
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
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/reconcile`, { method: 'POST', body: '{}' })
    if (res.ok) toast.success('Crawler started', 'Drift tab updates when the crawl finishes.')
    else toast.push({ tone: 'error', message: 'Reconcile failed', description: res.error?.message ?? '' })
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

  if (!projectId) {
    return <Loading text="Select a project…" />
  }

  if (!entLoading && !has('inventory_v2')) {
    return (
      <div className="space-y-4">
        <PageHeader title="User stories & inventory" projectScope={null} description="Maps specs to verified actions." />
        <UpgradePrompt flag="inventory_v2" currentPlan={planName} />
      </div>
    )
  }

  if (mainQuery.loading && !mainQuery.data) {
    return <Loading text="Loading inventory…" />
  }
  if (mainQuery.error) {
    return <ErrorAlert message={mainQuery.error} onRetry={mainQuery.reload} />
  }

  const total = Number(summary.total ?? 0)
  const verified = Number(summary.verified ?? 0)
  const regressed = Number(summary.regressed ?? 0)
  const stub = Number(summary.stub ?? 0)

  return (
    <div className="space-y-3" data-testid="mushi-page-inventory">
      <PageHeader
        title={copy?.title ?? 'User stories · Inventory'}
        projectScope={null}
        description={
          copy?.description ??
          'Positive graph: stories, pages, elements, actions — status derived from gates, crawler, and reconciler.'
        }
      >
        <SegmentedControl<Tab>
          size="sm"
          ariaLabel="Inventory section"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'stories', label: 'User stories' },
            { id: 'tree', label: 'Tree' },
            { id: 'gates', label: 'Gates' },
            { id: 'synthetic', label: 'Synthetic' },
            { id: 'drift', label: 'Drift' },
            { id: 'discovery', label: 'Discovery' },
            { id: 'yaml', label: 'Yaml' },
          ]}
        />
      </PageHeader>

      <PageHero
        scope="inventory"
        title="Truth layer snapshot"
        kicker="Plan → Act → Verify"
        decide={{
          label: total ? `${verified} / ${total} actions verified` : 'No actions ingested',
          metric: `${stub} stub · ${regressed} regressed`,
          summary: regressed > 0 ? 'Regressed actions need a fix or rollback before the next release.' : 'Surface looks healthy — keep gates green in CI.',
          severity: regressed > 0 ? 'crit' : total === 0 ? 'neutral' : 'ok',
        }}
        act={nba}
        verify={{
          label: 'Latest ingest',
          detail: snapshot?.commit_sha ? `commit ${snapshot.commit_sha.slice(0, 7)}` : '—',
          to: '/repo',
          secondaryTo: '/graph',
          secondaryLabel: 'Open graph',
        }}
      />
      <PageActionBar
        scope="inventory"
        action={nba}
        trailing={
          <div className="flex flex-wrap gap-2">
            <Btn type="button" size="sm" variant="ghost" onClick={runGates}>
              Run gates
            </Btn>
            <Btn type="button" size="sm" variant="ghost" onClick={reconcile}>
              Run crawler
            </Btn>
          </div>
        }
      />

      <PageHelp {...INVENTORY_HELP} />

      {!snapshot && (
        <SetupNudge
          requires={['github_connected']}
          emptyTitle="No inventory yet"
          emptyDescription="Either install @mushi-mushi/web with discoverInventory: true and let the SDK observe your app — Claude will draft an inventory.yaml — or hand-author one and paste it from the Yaml tab."
          emptyIcon={<HeroGraphNodes />}
          blockedIcon={<HeroGraphNodes accent="text-fg-faint" />}
          emptyAction={
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" onClick={() => setTab('discovery')}>
                Open Discovery →
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setTab('yaml')}>
                Paste YAML
              </Btn>
            </div>
          }
          emptyHints={[
            'Discovery (recommended): SDK observes → Claude proposes → you accept. Open the Discovery tab to see the four-step lifecycle.',
            'Manual: author inventory.yaml directly and paste from the Yaml tab.',
            'Either path supports auth-gated apps: cookie-paste from the Yaml tab\'s crawler settings card, or an inventory.yaml auth.scripted block.',
          ]}
        />
      )}

      {tab === 'stories' && (
        <UserStoryMap
          stories={stories}
          findingsByNode={findingsByNode}
          onSelectAction={(a) => void openActionDrawer(a)}
        />
      )}

      {tab === 'tree' && <InventoryTree rows={treeRows} onRowClick={openDrawerForRow} />}

      {tab === 'gates' && (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            {gateCards.map((g) => {
              const latest = runs.find((r) => r.gate === g)
              return (
                <Card key={g} className="p-3">
                  <p className="text-2xs uppercase text-fg-faint">{g.replace(/_/g, ' ')}</p>
                  <p className="text-sm font-semibold">{latest?.status ?? '—'}</p>
                  <p className="text-2xs text-fg-muted">{latest?.findings_count ?? 0} findings</p>
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

      {tab === 'synthetic' && (
        <div className="grid gap-3 md:grid-cols-2">
          {synthActions.length === 0 ? (
            <p className="text-xs text-fg-muted">Ingest inventory with user stories to list Action nodes for probes.</p>
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
          onReconcile={reconcile}
        />
      )}

      {tab === 'discovery' && (
        <DiscoveryTab projectId={projectId} onAccepted={reloadAll} />
      )}

      {tab === 'yaml' && (
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
