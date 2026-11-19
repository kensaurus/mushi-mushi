/**
 * ProvidersPage — /providers, "Providers & AI routes" (operator only).
 *
 * The shared AI provider accounts behind every Kensaurus app and the model
 * routes the router tries, from kensaurus-ops on kenji (yen-yen
 * docs/kensaurus-provider-watch.md, "Operator console API"):
 *   - alert cards first: providers down or warn, open critical incidents,
 *     apps that cost more than they sell;
 *   - tabs on `?tab=`: Providers (default) · Spend · Routes · History.
 *
 * Writes: toggles and reorders move at once (useOptimistic inside a
 * transition) and fall back when the server refuses; delete, model switch,
 * add and thresholds wait for the answer. Every write refetches with
 * ?fresh=1 and is audited upstream (History). A change that would leave an
 * app with no enabled default route is disabled before it can 409.
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
import { Btn, EmptyState, Loading } from '../components/ui'
import { IconRefresh } from '../components/icons'
import { ProvidersAlerts } from '../components/providers/ProvidersAlerts'
import { ProvidersTable, providerPendingKey } from '../components/providers/ProvidersTable'
import { ThresholdsDrawer } from '../components/providers/ThresholdsDrawer'
import { SpendPanel } from '../components/providers/SpendPanel'
import { RoutesPanel, featurePendingKey, routePendingKey, type NewRoute } from '../components/providers/RoutesPanel'
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
import type { AiRoute, OpsAction, ProviderAccount } from '../lib/kensaurusOpsTypes'
import {
  PROVIDERS_TABS,
  ageLabel,
  applyOptimistic,
  buildAlerts,
  buildHistory,
  incidentCounts,
  providerState,
  reorderPermutation,
  resolveProvidersTab,
  sortProviders,
  wouldDropLastDefault,
  writeErrorText,
  type FeatureChain,
  type OptimisticPatch,
  type ProvidersTab,
  makeAppNamer,
  makeAppProjectFinder,
} from '../lib/providersView'

export function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const tab = resolveProvidersTab(searchParams.get('tab'))
  const tabHref = useCallback(
    (id: ProvidersTab) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'providers') next.delete('tab')
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
        if (id === 'providers') next.delete('tab')
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

  const onRouteToggle = (r: AiRoute, enabled: boolean) => {
    if (!enabled && snapshot && wouldDropLastDefault(snapshot.routes, r)) return
    const key = { app: r.app, feature: r.feature, priority: r.priority }
    run(routePendingKey(r), { action: enabled ? 'enable_route' : 'disable_route', ...key }, `#${r.priority} ${r.model} ${enabled ? 'on' : 'off'}`, {
      kind: 'route-enabled',
      ...key,
      enabled,
    })
  }

  const onMove = (chain: FeatureChain, index: number, dir: -1 | 1) => {
    const order = reorderPermutation(chain.routes, index, dir)
    if (!order) return
    run(featurePendingKey(chain.app, chain.feature), { action: 'reorder', app: chain.app, feature: chain.feature, order }, 'Order saved', {
      kind: 'reorder',
      app: chain.app,
      feature: chain.feature,
      order,
    })
  }

  const onDelete = (r: AiRoute) => {
    if (r.enabled && snapshot && wouldDropLastDefault(snapshot.routes, r)) return
    run(routePendingKey(r), { action: 'delete_route', app: r.app, feature: r.feature, priority: r.priority }, `#${r.priority} ${r.model} deleted`)
  }

  const onSwitchModel = (r: AiRoute, model: string) =>
    run(
      routePendingKey(r),
      { action: 'upsert_route', app: r.app, feature: r.feature, priority: r.priority, provider: r.provider, model },
      `#${r.priority} now ${model}`,
    )

  const onAdd = (app: string, feature: string, nr: NewRoute) =>
    run(
      featurePendingKey(app, feature),
      { action: 'upsert_route', app, feature, priority: nr.priority, provider: nr.provider, model: nr.model, enabled: true, ...(nr.params ? { params: nr.params } : {}) },
      `#${nr.priority} ${nr.model} added`,
    )

  const providers = useMemo(() => (snapshot ? sortProviders(snapshot.providers) : []), [snapshot])
  const incidents = useMemo(() => (snapshot ? incidentCounts(snapshot) : new Map()), [snapshot])
  const alerts = useMemo(() => (snapshot ? buildAlerts(snapshot, now) : []), [snapshot, now])
  const history = useMemo(() => (snapshot ? buildHistory(snapshot.route_changes, snapshot.provider_changes) : []), [snapshot])
  const troubled = providers.filter((p) => p.enabled && (providerState(p) === 'down' || providerState(p) === 'warn')).length

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
        helpHowToUse="Start with the red cards. Turn a provider off to stop routing to it; reorder or switch a route's model on Routes. Every change is audited on History."
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
          <ProvidersAlerts alerts={alerts} onOpen={openTab} />
          <TabbedSubNav ariaLabel="Providers views" tabs={tabs} />
          {tab === 'providers' && (
            <ProvidersTable providers={providers} incidents={incidents} now={now} pending={pending} onToggle={onProviderToggle} onEditThresholds={setEditing} appName={appName} appProject={appProject} />
          )}
          {tab === 'spend' && <SpendPanel snapshot={snapshot} appName={appName} />}
          {tab === 'routes' && (
            <RoutesPanel
              routes={snapshot.routes}
              meta={meta}
              prices={snapshot.prices}
              pending={pending}
              onToggle={onRouteToggle}
              onMove={onMove}
              onDelete={onDelete}
              onSwitchModel={onSwitchModel}
              onAdd={onAdd}
              appName={appName}
            />
          )}
          {tab === 'history' && <HistoryPanel rows={history} now={now} />}
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
