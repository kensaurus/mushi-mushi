/**
 * ProvidersPage — /providers, "Providers & AI routes" (operator only).
 *
 * The shared AI provider accounts behind every Kensaurus app and the model
 * routes the router tries, from kensaurus-ops on kenji (yen-yen
 * docs/kensaurus-provider-watch.md, "Operator console API"):
 *   - alert cards first: providers down or warn, open critical incidents,
 *     apps that cost more than they sell;
 *   - tabs on `?tab=`: Routes (default: overview, provider switches, fallback
 *     orders folded into chains) · Providers · Spend · History.
 *
 * Writes: a provider toggle moves at once (useOptimistic inside a transition)
 * and falls back when the server refuses; thresholds wait for the answer. A
 * chain edit (ChainDrawer) re-reads ?fresh=1 and refuses when the chain changed
 * meanwhile. Then, when upstream lists `batch`, it sends ONE call: every feature
 * in one transaction, refused whole (409 stale) if the rows moved since the
 * read, one hub notice. Otherwise (an older upstream, or a batch over its
 * limits) it sends one audited write at a time and stops at the first refusal,
 * saying which features changed. Every write is audited upstream (History).
 *
 * Data: GET /v1/admin/kensaurus/ops[?fresh=1] → OpsReadResponse
 *       POST /v1/admin/kensaurus/ops { action, … } (actor set by the server)
 * Guard: App.tsx wraps it in OperatorRoute; the server checks the operator list.
 */

import { startTransition, useCallback, useMemo, useOptimistic, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { TabbedSubNav } from '../components/TabbedSubNav'
import { PageLoadError } from '../components/PageLoadError'
import { Btn, EmptyState, Loading, PageStatus } from '../components/ui'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { BarCell } from '../components/signal/BarCell'
import { IconRefresh } from '../components/icons'
import { ProvidersAlerts } from '../components/providers/ProvidersAlerts'
import { ProvidersTable, providerPendingKey } from '../components/providers/ProvidersTable'
import { ThresholdsDrawer } from '../components/providers/ThresholdsDrawer'
import { SpendPanel } from '../components/providers/SpendPanel'
import { RoutesPanel } from '../components/providers/RoutesPanel'
import { RoutesOverview, switchPendingKey } from '../components/providers/RoutesOverview'
import { ChainDrawer } from '../components/providers/ChainDrawer'
import { HistoryPanel } from '../components/providers/HistoryPanel'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { usePublishPageContext } from '../lib/pageContext'
import { useToast } from '../lib/toast'
import { useNow } from '../lib/useNow'
import { useKensaurusOps } from '../lib/useKensaurusOps'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useReadTimedOut } from '../lib/ciReadTimeout'
import { CiNotChecked } from '../components/ci/CiNotChecked'
import type { OpsAction, ProviderAccount } from '../lib/kensaurusOpsTypes'
import {
  batchFits,
  buildOverview,
  chainBatch,
  draftChanges,
  driftedFeatures,
  findChain,
  groupChains,
  planChainSave,
  providerHealth,
  providerName,
  routedProviders,
  routesStatusLine,
  runChainSave,
  saveReportText,
  type DraftStep,
  type ProviderHealth,
  type RouteChain,
} from '../lib/routeChains'
import {
  PROVIDERS_TABS,
  ageLabel,
  applyOptimistic,
  buildAlerts,
  buildHistory,
  incidentCounts,
  providerState,
  resolveProvidersTab,
  sortProviders,
  writeErrorText,
  type OptimisticPatch,
  type ProvidersTab,
  makeAppNamer,
  makeAppProjectFinder,
  providersLead,
} from '../lib/providersView'

export function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const tab = resolveProvidersTab(searchParams.get('tab'))
  const tabHref = useCallback(
    (id: ProvidersTab) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'routes') next.delete('tab')
      else next.set('tab', id)
      const q = next.toString()
      return q ? `${location.pathname}?${q}` : location.pathname
    },
    [searchParams, location.pathname],
  )
  const openTab = useCallback(
    (id: ProvidersTab) =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (id === 'routes') next.delete('tab')
        else next.set('tab', id)
        return next
      }),
    [setSearchParams],
  )

  const ops = useKensaurusOps()
  // Never an endless "Loading providers…": 10 s, then "not checked" with Retry.
  const firstRead = useReadTimedOut(ops.loading && !ops.data && !ops.error)
  // The ops registry names apps by repo slug; the console names them as every other page does.
  const setup = useSetupStatus(useActiveProjectId())
  const appName = useMemo(() => makeAppNamer(setup.data?.projects ?? []), [setup.data?.projects])
  const appProject = useMemo(() => makeAppProjectFinder(setup.data?.projects ?? []), [setup.data?.projects])
  const toast = useToast()
  const now = useNow(30_000)
  const [snapshot, addPatch] = useOptimistic(ops.data?.snapshot ?? null, applyOptimistic)
  const meta = ops.data?.meta ?? null
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState<ProviderAccount | null>(null)

  const setBusy = (key: string, on: boolean) =>
    setPending((s) => {
      const next = new Set(s)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  /** One write: optimistic when `patch` is given, then the fresh snapshot, then a toast. */
  const run = (key: string, action: OpsAction, done: string, patch?: OptimisticPatch) => {
    setBusy(key, true)
    startTransition(async () => {
      if (patch) addPatch(patch)
      const res = await ops.write(action)
      if (res.ok) {
        await ops.load(true)
        toast.success(done, undefined, { label: 'History', onClick: () => openTab('history') })
      } else {
        toast.error(writeErrorText(res.error))
        // The page was out of date: show what is there now.
        if (res.error?.code === 'last_default_route' || res.error?.code === 'not_found') await ops.load(true)
      }
      setBusy(key, false)
    })
  }

  const onProviderToggle = (p: ProviderAccount, enabled: boolean) =>
    run(providerPendingKey(p.id), { action: 'set_provider_enabled', account_id: p.id, enabled }, `${p.label} ${enabled ? 'on' : 'off'}`, {
      kind: 'provider-enabled',
      id: p.id,
      enabled,
    })

  const onThresholds = (p: ProviderAccount, thresholds: Record<string, unknown>) => {
    setEditing(null)
    run(providerPendingKey(p.id), { action: 'set_provider_thresholds', account_id: p.id, thresholds }, `${p.label} thresholds saved`)
  }

  /** A provider switched off (or on) for every app: each of its accounts, one write at a time. */
  const onProviderSwitch = (h: ProviderHealth, enabled: boolean) => {
    const accounts = h.accounts.filter((a) => a.enabled !== enabled)
    if (accounts.length === 0) return
    const key = switchPendingKey(h.provider)
    setBusy(key, true)
    startTransition(async () => {
      for (const a of accounts) addPatch({ kind: 'provider-enabled', id: a.id, enabled })
      for (const a of accounts) {
        const res = await ops.write({ action: 'set_provider_enabled', account_id: a.id, enabled })
        if (!res.ok) {
          toast.error(writeErrorText(res.error))
          await ops.load(true)
          setBusy(key, false)
          return
        }
      }
      await ops.load(true)
      toast.success(`${providerName(h.provider)} ${enabled ? 'on' : 'off'} for every app`, undefined, { label: 'History', onClick: () => openTab('history') })
      setBusy(key, false)
    })
  }

  // ── chains ──
  const [openChainId, setOpenChainId] = useState<string | null>(null)
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<{ app: string; text: string } | null>(null)
  const chainApps = useMemo(() => (snapshot ? groupChains(snapshot.routes) : []), [snapshot])
  const openChain = openChainId ? findChain(chainApps, openChainId) : null

  /**
   * Save one chain edit to every feature in it. Re-reads first and refuses when any feature's
   * order changed meanwhile; then one write at a time, stopping at the first refusal.
   */
  const onSaveChain = async (chain: RouteChain, draft: DraftStep[]) => {
    setSaving({ done: 0, total: chain.members.length })
    setReport(null)
    const fresh = await ops.load(true)
    if (!fresh) {
      toast.error("Couldn't read the latest routes, so nothing was saved. Try again.")
      setSaving(null)
      return
    }
    const drifted = driftedFeatures(chain, fresh.snapshot.routes)
    if (drifted.length > 0) {
      toast.error(`This order changed since you opened it (${drifted.slice(0, 3).map((f) => (f === '*' ? 'default' : f)).join(', ')}). Nothing was saved; open it again to see the latest.`)
      setSaving(null)
      setOpenChainId(null)
      return
    }
    // Plan from the fresh rows: twins keep their own priorities, which the signature does not cover.
    const latest = findChain(groupChains(fresh.snapshot.routes), chain.id)!
    const target = { ...latest, members: latest.members.filter((m) => chain.members.some((o) => o.feature === m.feature)) }
    const plans = planChainSave(target, draft, fresh.meta)
    // One call when upstream takes a batch: one transaction, one hub notice (2026-11-21).
    const batch = chainBatch(target, plans, draftChanges(chain, draft).join('; '))
    if (batchFits(fresh.meta, batch)) {
      const res = await ops.write(batch)
      // An older proxy that does not know `batch` yet refuses it before upstream; fall through.
      const unknown = !res.ok && res.error?.code === 'validation_failed' && /unknown action/i.test(res.error.message ?? '')
      if (!unknown) {
        await ops.load(true)
        setSaving(null)
        setOpenChainId(null)
        if (res.ok) {
          toast.success(saveReportText(appName(chain.app), { saved: plans.map((x) => x.feature), failed: null, untouched: [], writes: batch.ops.length }, plans.length, writeErrorText), undefined, {
            label: 'History',
            onClick: () => openTab('history'),
          })
        } else if (res.error?.code === 'stale') {
          toast.error('This order changed since you opened it. Nothing was saved; open it again to see the latest.')
        } else {
          toast.error(`Nothing was saved: ${writeErrorText(res.error)}`)
        }
        return
      }
    }
    const result = await runChainSave(plans, ops.write, (done, total) => setSaving({ done, total }))
    await ops.load(true)
    const text = saveReportText(appName(chain.app), result, plans.length, (e) => writeErrorText(e))
    setSaving(null)
    setOpenChainId(null)
    if (result.failed) {
      setReport({ app: chain.app, text })
      toast.error(`Save stopped at ${result.failed.feature === '*' ? 'default' : result.failed.feature}: ${result.saved.length} of ${plans.length} features changed.`)
    } else {
      toast.success(text, undefined, { label: 'History', onClick: () => openTab('history') })
    }
  }

  const providers = useMemo(() => (snapshot ? sortProviders(snapshot.providers) : []), [snapshot])
  const routeProviders = useMemo(() => (snapshot ? routedProviders(snapshot.routes, meta) : []), [snapshot, meta])
  const health = useMemo(() => new Map(routeProviders.map((p) => [p, providerHealth(p, snapshot?.providers ?? [])])), [routeProviders, snapshot])
  const overviewRows = useMemo(() => (snapshot ? buildOverview(snapshot, routeProviders, health) : []), [snapshot, routeProviders, health])
  const statusLine = useMemo(() => routesStatusLine([...health.values()], snapshot?.incidents.length ?? 0), [health, snapshot])
  const incidents = useMemo(() => (snapshot ? incidentCounts(snapshot) : new Map()), [snapshot])
  const alerts = useMemo(() => (snapshot ? buildAlerts(snapshot, now) : []), [snapshot, now])
  const history = useMemo(() => (snapshot ? buildHistory(snapshot.route_changes, snapshot.provider_changes) : []), [snapshot])
  const troubled = providers.filter((p) => p.enabled && (providerState(p) === 'down' || providerState(p) === 'warn')).length
  const lead = useMemo(() => providersLead(providers), [providers])
  const openIncidents = snapshot?.incidents.length ?? 0

  usePublishPageContext({
    route: '/providers',
    title: 'Providers & AI routes',
    summary: snapshot ? `${providers.length} accounts · ${troubled} need a look · ${snapshot.routes.length} routes` : ops.error ? "Providers couldn't load" : 'Loading providers',
    questions: ['Which AI provider is down?', 'Which app loses money on AI?', 'Which model does each app try first?'],
  })

  const tabs = PROVIDERS_TABS.map((t) => ({
    to: tabHref(t.id),
    label: t.label,
    badge: t.id === 'providers' && troubled > 0 ? troubled : undefined,
    badgeLabel: t.id === 'providers' ? `${troubled} providers down or warning` : undefined,
    match: () => tab === t.id,
  }))

  const notConfigured = !snapshot && ops.error?.code === 'NOT_FOUND'
  const updated = ageLabel(ops.data?.fetched_at, now)

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-providers">
      <PageHeaderBar
        title="Providers & AI routes"
        description="Every app's AI provider accounts, what they cost, and which model each app tries first."
        helpTitle="About Providers & AI routes"
        helpWhatIsIt="The provider accounts every Kensaurus app calls through, their balance and health, what each app spends against what it sells, and the ordered model routes the router tries. Read from the provider watch on kenji."
        helpHowToUse="Start on Routes: the status line and the table show which provider each app tries first. Switch a provider off for every app from its card; open a fallback order to change it for every feature that shares it. Every change is audited on History."
      >
        {updated && (
          <span className="text-2xs text-fg-muted tabular-nums" data-testid="providers-updated">
            Updated {updated} ago
          </span>
        )}
        <Btn
          size="sm"
          variant="ghost"
          aria-label="Refresh"
          title="Read the latest from kenji now"
          aria-busy={ops.refreshing || undefined}
          onClick={() => void ops.load(true)}
        >
          <IconRefresh size={14} className={ops.refreshing ? 'motion-safe:animate-spin' : ''} />
        </Btn>
      </PageHeaderBar>

      {ops.loading && !snapshot && !firstRead.timedOut && <Loading text="Loading providers…" />}
      {ops.loading && !snapshot && firstRead.timedOut && (
        <CiNotChecked
          what="Providers"
          testId="providers-not-checked"
          onRetry={() => {
            firstRead.restart()
            void ops.load(true)
          }}
        />
      )}
      {notConfigured && (
        <EmptyState
          title="Not connected"
          description="The server route is not deployed here yet, or its KENSAURUS_OPS_URL / KENSAURUS_OPS_CONSOLE_TOKEN secrets are unset."
        />
      )}
      {ops.error && !snapshot && !notConfigured && (
        <PageLoadError error={ops.error.message} code={ops.error.code} resource="providers" endpoint="/v1/admin/kensaurus/ops" onRetry={() => void ops.load(true)} />
      )}

      {snapshot && (
        <>
          {/* What needs a look, and the one fix the console has for it (2026-11-19). */}
          <PagePosture
            slots={[
              {
                priority: POSTURE_PRIORITY.status,
                children: (
                  <PageStatus
                    ariaLabel="Providers status"
                    tone={lead.tone}
                    sentence={lead.sentence}
                    action={
                      lead.turnOn ? (
                        <Btn
                          size="sm"
                          variant="primary"
                          disabled={pending.has(providerPendingKey(lead.turnOn.id))}
                          onClick={() => onProviderToggle(lead.turnOn!, true)}
                          data-testid="providers-lead-action"
                        >
                          Turn on {lead.turnOn.label}
                        </Btn>
                      ) : undefined
                    }
                    metrics={[
                      {
                        label: 'Working',
                        value: `${lead.working}/${providers.length}`,
                        tone: lead.working === providers.length ? 'ok' : 'warn',
                        hint: 'Accounts that are on and passed their last health check.',
                        to: tabHref('providers'),
                        visual: providers.length > 0 ? <BarCell value={lead.working} max={providers.length} tone="ok" label={`${lead.working} of ${providers.length} working`} /> : undefined,
                      },
                      {
                        label: 'Need a look',
                        value: lead.needLook.length,
                        tone: lead.needLook.length > 0 ? 'warn' : 'neutral',
                        hint: 'Accounts that are off, down, warning or not checked.',
                        to: tabHref('providers'),
                      },
                      {
                        label: 'Open incidents',
                        value: openIncidents,
                        tone: openIncidents > 0 ? 'danger' : 'neutral',
                        hint: 'Problems the provider watch raised and has not closed.',
                        to: tabHref('providers'),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          <ProvidersAlerts alerts={alerts} onOpen={openTab} />
          <TabbedSubNav ariaLabel="Providers views" tabs={tabs} />
          {tab === 'routes' && (
            <RoutesPanel
              apps={chainApps}
              health={health}
              appName={appName}
              report={report}
              onDismissReport={() => setReport(null)}
              onOpen={setOpenChainId}
              overview={
                <RoutesOverview
                  routes={snapshot.routes}
                  providers={routeProviders}
                  health={health}
                  rows={overviewRows}
                  status={statusLine}
                  busy={pending}
                  appName={appName}
                  onSwitch={onProviderSwitch}
                />
              }
            />
          )}
          {tab === 'providers' && (
            <ProvidersTable
              providers={providers}
              routes={snapshot.routes}
              incidents={incidents}
              now={now}
              pending={pending}
              onToggle={onProviderToggle}
              onEditThresholds={setEditing}
              appName={appName}
              appProject={appProject}
            />
          )}
          {tab === 'spend' && <SpendPanel snapshot={snapshot} appName={appName} />}
          {tab === 'history' && <HistoryPanel rows={history} now={now} />}
          <ChainDrawer
            chain={tab === 'routes' ? openChain : null}
            appName={appName}
            meta={meta}
            prices={snapshot.prices}
            health={health}
            now={now}
            saving={saving}
            onClose={() => setOpenChainId(null)}
            onSave={(c, d) => void onSaveChain(c, d)}
          />
          <ThresholdsDrawer
            account={editing}
            keys={meta?.threshold_keys ?? []}
            busy={!!editing && pending.has(providerPendingKey(editing.id))}
            onClose={() => setEditing(null)}
            onSave={onThresholds}
          />
        </>
      )}
    </div>
  )
}
