/**
 * FILE: apps/admin/src/pages/MarketplacePage.tsx
 * PURPOSE: Plugin marketplace — browse catalog, install webhook plugins, inspect
 *          signed deliveries for the active project.
 */

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { PageHero } from '../components/PageHero'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import {
  PageHeader,
  PageHelp,
  Btn,
  ErrorAlert,
  EmptyState,
  Input,
  Section,
  FilterSelect,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { DispatchTable } from '../components/marketplace/DispatchTable'
import { InstallForm } from '../components/marketplace/InstallForm'
import { InstalledList } from '../components/marketplace/InstalledList'
import { PluginCard } from '../components/marketplace/PluginCard'
import { MarketplaceStatusBanner } from '../components/marketplace/MarketplaceStatusBanner'
import {
  type DispatchEntry,
  type InstalledPlugin,
  type MarketplacePlugin,
  type MarketplaceStats,
  type MarketplaceTabId,
  type ReliabilityStats,
} from '../components/marketplace/types'

const TABS: Array<{ id: MarketplaceTabId; label: string; description: string }> = [
  {
    id: 'browse',
    label: 'Browse',
    description: 'Official and community webhook plugins — filter by category or installed state.',
  },
  {
    id: 'installed',
    label: 'Installed',
    description: 'Test, pause, edit URL, rotate secret, or uninstall plugins on this project.',
  },
  {
    id: 'deliveries',
    label: 'Deliveries',
    description: 'Every signed webhook POST — status, latency, and the first 512 chars of the response.',
  },
]

function isTabId(v: string | null): v is MarketplaceTabId {
  return TABS.some((t) => t.id === v)
}

export function MarketplacePage() {
  const toast = useToast()
  const entitlements = useEntitlements()
  const pluginsUnlocked = entitlements.has('plugins')
  const copy = usePageCopy('/marketplace')

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const urlFilter = searchParams.get('filter')
  const activeTab: MarketplaceTabId =
    urlFilter === 'disabled' ? 'installed' : isTabId(param) ? param : 'browse'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const catalogQuery = usePageData<{ plugins: MarketplacePlugin[] }>('/v1/marketplace/plugins')
  const installedPath = activeProjectId ? '/v1/admin/plugins' : null
  const statsPath = activeProjectId ? '/v1/admin/marketplace/stats' : null
  const dispatchPath = activeProjectId ? '/v1/admin/plugins/dispatch-log' : null

  const installedQuery = usePageData<{ plugins: InstalledPlugin[] }>(installedPath, {
    deps: [activeProjectId],
  })
  const statsQuery = usePageData<MarketplaceStats>(statsPath, { deps: [activeProjectId] })
  const dispatchQuery = usePageData<{ entries: DispatchEntry[] }>(dispatchPath, {
    deps: [activeProjectId],
  })

  const catalog = catalogQuery.data?.plugins ?? []
  const installed = installedQuery.data?.plugins ?? []
  const dispatchLog = dispatchQuery.data?.entries ?? []
  const stats = statsQuery.data ?? {
    catalogTotal: catalog.length,
    installedTotal: 0,
    installedActive: 0,
    installedPaused: 0,
    deliveries7d: 0,
    deliveriesOk: 0,
    deliveriesFailed: 0,
    lastDeliveryAt: null,
    failingPlugins: 0,
  }

  const loading = Boolean(
    catalogQuery.loading ||
      (activeProjectId &&
        (installedQuery.loading || statsQuery.loading || dispatchQuery.loading)),
  )
  const error = catalogQuery.error ?? installedQuery.error ?? statsQuery.error ?? dispatchQuery.error
  const lastFetchedAt = statsQuery.lastFetchedAt ?? installedQuery.lastFetchedAt
  const isValidating =
    catalogQuery.isValidating || installedQuery.isValidating || dispatchQuery.isValidating

  const reloadAll = useCallback(() => {
    catalogQuery.reload()
    installedQuery.reload()
    statsQuery.reload()
    dispatchQuery.reload()
  }, [catalogQuery, installedQuery, statsQuery, dispatchQuery])

  useRealtimeReload(['project_plugins', 'plugin_dispatch_log'], reloadAll)

  const setTab = useCallback(
    (tab: MarketplaceTabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'browse') next.delete('tab')
      else next.set('tab', tab)
      next.delete('filter')
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const [installing, setInstalling] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<MarketplacePlugin | null>(null)
  const [draftWebhookUrl, setDraftWebhookUrl] = useState('')
  const [draftWebhookSecret, setDraftWebhookSecret] = useState('')
  const [draftEvents, setDraftEvents] = useState<string>('')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
  const [showPausedOnly, setShowPausedOnly] = useState(urlFilter === 'disabled')
  const [pluginFilter, setPluginFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const installedBySlug = useMemo(() => {
    const map = new Map<string, InstalledPlugin>()
    for (const p of installed) {
      const key = p.plugin_slug ?? p.plugin_name
      map.set(key, p)
    }
    return map
  }, [installed])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of catalog) set.add(p.category)
    return ['', ...Array.from(set).sort()]
  }, [catalog])

  const visibleCatalog = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return catalog.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false
      if (showInstalledOnly && !installedBySlug.has(p.slug)) return false
      if (
        needle &&
        !p.name.toLowerCase().includes(needle) &&
        !p.short_description.toLowerCase().includes(needle) &&
        !p.publisher.toLowerCase().includes(needle)
      )
        return false
      return true
    })
  }, [catalog, search, categoryFilter, showInstalledOnly, installedBySlug])

  const visibleInstalled = useMemo(() => {
    if (!showPausedOnly) return installed
    return installed.filter((p) => !p.is_active)
  }, [installed, showPausedOnly])

  const reliabilityBySlug = useMemo(() => {
    const mapStats = new Map<string, ReliabilityStats>()
    const latencies: Record<string, number[]> = {}
    for (const e of dispatchLog) {
      const cur = mapStats.get(e.plugin_slug) ?? { total: 0, ok: 0, error: 0, avgLatency: 0 }
      cur.total += 1
      if (e.status === 'ok') cur.ok += 1
      if (e.status === 'error' || e.status === 'timeout') cur.error += 1
      mapStats.set(e.plugin_slug, cur)
      latencies[e.plugin_slug] ??= []
      if (typeof e.duration_ms === 'number') latencies[e.plugin_slug].push(e.duration_ms)
    }
    for (const [slug, s] of mapStats) {
      const arr = latencies[slug] ?? []
      s.avgLatency = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
    }
    return mapStats
  }, [dispatchLog])

  const visibleDispatch = useMemo(() => {
    return dispatchLog.filter((d) => {
      if (pluginFilter && d.plugin_slug !== pluginFilter) return false
      if (statusFilter && d.status !== statusFilter) return false
      return true
    })
  }, [dispatchLog, pluginFilter, statusFilter])

  const installedPluginOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of dispatchLog) set.add(e.plugin_slug)
    return ['', ...Array.from(set).sort()]
  }, [dispatchLog])

  const marketplaceSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    stats.deliveriesFailed > 0 || stats.failingPlugins > 0
      ? 'crit'
      : stats.installedPaused > 0
        ? 'warn'
        : stats.installedTotal > 0
          ? 'ok'
          : 'neutral'

  usePublishPageContext({
    route: '/marketplace',
    title: `${activeMeta.label} · Marketplace`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.deliveriesFailed + stats.failingPlugins,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'browse' as const, label: 'Browse', count: stats.catalogTotal },
      { id: 'installed' as const, label: 'Installed', count: stats.installedTotal },
      { id: 'deliveries' as const, label: 'Deliveries', count: stats.deliveries7d },
    ],
    [stats.catalogTotal, stats.installedTotal, stats.deliveries7d],
  )

  const beginInstall = useCallback((plugin: MarketplacePlugin) => {
    setInstallTarget(plugin)
    setDraftWebhookUrl('')
    setDraftWebhookSecret(generateSecret())
    setDraftEvents((plugin.manifest?.subscribes ?? []).join(', '))
  }, [])

  const cancelInstall = useCallback(() => {
    setInstallTarget(null)
    setDraftWebhookUrl('')
    setDraftWebhookSecret('')
    setDraftEvents('')
  }, [])

  const submitInstall = useCallback(async () => {
    if (!installTarget) return
    if (!draftWebhookUrl.startsWith('https://')) {
      toast.error('Invalid webhook URL', 'Webhook URL must start with https://')
      return
    }
    if (draftWebhookSecret.length < 16) {
      toast.error('Signing secret too short', 'The signing secret must be at least 16 characters.')
      return
    }
    setInstalling(installTarget.slug)
    const events = draftEvents
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const res = await apiFetch('/v1/admin/plugins', {
        method: 'POST',
        body: JSON.stringify({
          pluginName: installTarget.name,
          pluginSlug: installTarget.slug,
          pluginVersion: '1.0.0',
          webhookUrl: draftWebhookUrl,
          webhookSecret: draftWebhookSecret,
          subscribedEvents: events,
          isActive: true,
        }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Install failed')
      toast.success(`Installed ${installTarget.name}`)
      cancelInstall()
      reloadAll()
      setTab('installed')
    } catch (err) {
      toast.error('Install failed', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [installTarget, draftWebhookUrl, draftWebhookSecret, draftEvents, toast, cancelInstall, reloadAll, setTab])

  const [uninstallTarget, setUninstallTarget] = useState<{ slug: string; name: string } | null>(null)

  const confirmUninstall = useCallback(async () => {
    if (!uninstallTarget) return
    const { slug, name } = uninstallTarget
    setInstalling(slug)
    try {
      const res = await apiFetch(`/v1/admin/plugins/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Uninstall failed')
      toast.success(`Removed ${name}`)
      reloadAll()
      setUninstallTarget(null)
    } catch (err) {
      toast.error('Uninstall failed', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [uninstallTarget, toast, reloadAll])

  const uninstall = useCallback(
    (slug: string, name: string) => setUninstallTarget({ slug, name }),
    [],
  )

  const testPlugin = useCallback(
    async (slug: string) => {
      setInstalling(slug)
      try {
        const res = await apiFetch<{
          delivered: boolean
          httpStatus: number | null
          durationMs: number
          excerpt: string | null
        }>(`/v1/admin/plugins/${encodeURIComponent(slug)}/test-event`, { method: 'POST' })
        if (!res.ok) throw new Error(res.error?.message ?? 'Test failed')
        if (res.data?.delivered) {
          toast.success(`Test delivered (${res.data.httpStatus ?? '—'})`, `${res.data.durationMs}ms`)
        } else {
          toast.error(
            `Test failed (HTTP ${res.data?.httpStatus ?? '—'})`,
            res.data?.excerpt ?? 'No response body',
          )
        }
        reloadAll()
      } catch (err) {
        toast.error('Test failed', err instanceof Error ? err.message : String(err))
      } finally {
        setInstalling(null)
      }
    },
    [toast, reloadAll],
  )

  const togglePausePlugin = useCallback(
    async (slug: string, currentlyActive: boolean) => {
      setInstalling(slug)
      try {
        const res = await apiFetch(`/v1/admin/plugins/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !currentlyActive }),
        })
        if (!res.ok) throw new Error(res.error?.message ?? 'Update failed')
        toast.success(currentlyActive ? 'Plugin paused' : 'Plugin resumed')
        reloadAll()
      } catch (err) {
        toast.error('Update failed', err instanceof Error ? err.message : String(err))
      } finally {
        setInstalling(null)
      }
    },
    [toast, reloadAll],
  )

  const editPluginUrl = useCallback(
    async (slug: string, newUrl: string) => {
      setInstalling(slug)
      try {
        const res = await apiFetch(`/v1/admin/plugins/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          body: JSON.stringify({ webhookUrl: newUrl }),
        })
        if (!res.ok) throw new Error(res.error?.message ?? 'Update failed')
        toast.success('Webhook URL updated')
        reloadAll()
      } catch (err) {
        toast.error('Update failed', err instanceof Error ? err.message : String(err))
        throw err
      } finally {
        setInstalling(null)
      }
    },
    [toast, reloadAll],
  )

  const rotatePluginSecret = useCallback(
    async (slug: string): Promise<string> => {
      setInstalling(slug)
      try {
        const res = await apiFetch<{ secret: string }>(
          `/v1/admin/plugins/${encodeURIComponent(slug)}/rotate-secret`,
          { method: 'POST' },
        )
        if (!res.ok || !res.data?.secret) {
          throw new Error(res.error?.message ?? 'Rotation failed')
        }
        toast.success('Secret rotated', 'Copy it now — it will not be shown again.')
        return res.data.secret
      } catch (err) {
        toast.error('Rotation failed', err instanceof Error ? err.message : String(err))
        throw err
      } finally {
        setInstalling(null)
      }
    },
    [toast],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Marketplace'}
          description={
            copy?.description ??
            'Install signed webhook plugins that react when reports classify or fixes land.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Plugin installs and delivery logs are scoped to the active project in the header."
        />
      </div>
    )
  }

  if (loading) return <TableSkeleton rows={6} columns={4} showFilters label="Loading marketplace" />
  if (error) {
    return <ErrorAlert message={`Failed to load marketplace: ${error}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Marketplace'}
        description={
          copy?.description ??
          'Install HMAC-signed webhook plugins — PagerDuty, Linear, Zapier, and custom receivers.'
        }
        projectScope={projectName}
      >
        <Btn variant="ghost" size="sm" onClick={reloadAll}>
          Refresh
        </Btn>
      </PageHeader>

      <MarketplaceStatusBanner
        stats={stats}
        projectName={projectName}
        pluginsUnlocked={pluginsUnlocked}
      />

      <PageHero
        scope="marketplace"
        title={copy?.title ?? 'Marketplace'}
        kicker="Event routing"
        decide={{
          label:
            stats.installedTotal > 0
              ? `${stats.installedActive} plugin${stats.installedActive === 1 ? '' : 's'} active`
              : 'No plugins installed',
          metric: `${stats.catalogTotal} in catalog`,
          summary:
            stats.installedTotal > 0
              ? `${stats.deliveriesOk} successful deliveries in the last 7 days — each payload is HMAC-SHA256 signed.`
              : 'Pick a plugin from the catalog, paste your HTTPS webhook URL, and Mushi stores the signing secret in Vault.',
          severity: marketplaceSeverity,
          anchor: 'marketplace:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: [
              {
                label: 'Installed',
                value: String(stats.installedTotal),
                tone: stats.installedTotal > 0 ? 'ok' : 'neutral',
              },
              {
                label: 'Paused',
                value: String(stats.installedPaused),
                tone: stats.installedPaused > 0 ? 'warn' : 'neutral',
              },
              {
                label: 'Failed (7d)',
                value: String(stats.deliveriesFailed),
                tone: stats.deliveriesFailed > 0 ? 'crit' : 'ok',
              },
            ],
          },
        }}
        verify={{
          label: stats.lastDeliveryAt ? 'Last delivery' : 'Delivery log empty',
          detail: stats.lastDeliveryAt
            ? new Date(stats.lastDeliveryAt).toLocaleString()
            : 'Install a plugin and send a test event — deliveries appear on the Deliveries tab.',
          to: '/marketplace?tab=deliveries',
          secondaryTo: '/audit?source=marketplace',
          secondaryLabel: 'Audit log',
          anchor: 'marketplace:verify',
          evidence: stats.lastDeliveryAt
            ? {
                kind: 'last-event',
                at: stats.lastDeliveryAt,
                by: 'webhook',
                payloadSummary: `${stats.deliveriesOk} ok · ${stats.deliveriesFailed} failed (7d)`,
                status: stats.deliveriesFailed > 0 ? 'warn' : 'ok',
              }
            : undefined,
        }}
      />

      <PageHelp
        title={copy?.help?.title ?? 'About the marketplace'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Mushi plugins are HTTPS webhook receivers that subscribe to lifecycle events (report.created, report.classified, fix.applied, sla.breached, etc.). Every payload is signed with HMAC-SHA256 so your receiver can verify it came from your project.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Page on-call via PagerDuty when a critical bug is reported',
            'Mirror reports to Linear and keep issue status in sync',
            'Fan out any event to a Zapier catch-hook for no-code workflows',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Pick a plugin, deploy its webhook receiver, click Install, and paste the HTTPS URL. Mushi generates a signing secret (shown once) and stores it in Supabase Vault.'
        }
      />

      {!pluginsUnlocked && !entitlements.loading && (
        <UpgradePrompt flag="plugins" currentPlan={entitlements.planName} />
      )}

      {installTarget ? (
        <InstallForm
          target={installTarget}
          webhookUrl={draftWebhookUrl}
          webhookSecret={draftWebhookSecret}
          events={draftEvents}
          installing={installing === installTarget.slug}
          onWebhookUrlChange={setDraftWebhookUrl}
          onWebhookSecretChange={setDraftWebhookSecret}
          onEventsChange={setDraftEvents}
          onCancel={cancelInstall}
          onSubmit={submitInstall}
        />
      ) : null}

      <Section title="Plugin workspace" freshness={{ at: lastFetchedAt, isValidating }}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Catalog" value={stats.catalogTotal} hint="Listed plugins" />
          <StatCard
            label="Installed"
            value={stats.installedTotal}
            hint={
              stats.installedPaused > 0
                ? `${stats.installedPaused} paused`
                : `${stats.installedActive} active`
            }
          />
          <StatCard
            label="Deliveries (7d)"
            value={stats.deliveries7d}
            hint={`${stats.deliveriesOk} ok · ${stats.deliveriesFailed} failed`}
          />
          <StatCard
            label="Failing"
            value={stats.failingPlugins}
            hint={stats.failingPlugins > 0 ? 'Last delivery error/timeout' : 'All plugins healthy'}
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={setTab}
          options={tabOptions}
          ariaLabel="Marketplace sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {activeTab === 'browse' && (
          <div data-dav-anchor="marketplace:decide">
            <div className="flex flex-wrap gap-2 mb-3">
              <Input
                placeholder="Search by name, publisher, description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <FilterSelect
                label="Category"
                value={categoryFilter}
                options={categories}
                onChange={(e) => setCategoryFilter(e.currentTarget.value)}
              />
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => setShowInstalledOnly((v) => !v)}
                className={showInstalledOnly ? 'border-brand text-brand' : ''}
              >
                {showInstalledOnly ? '✓ Installed only' : 'Installed only'}
              </Btn>
            </div>

            {visibleCatalog.length === 0 ? (
              <EmptyState
                title={catalog.length === 0 ? 'No plugins listed' : 'No plugins match these filters'}
                description={
                  catalog.length === 0
                    ? 'Seed plugin_registry with the reference catalog or set is_listed = true.'
                    : 'Try clearing search, category, or the installed-only toggle.'
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {visibleCatalog.map((p) => (
                  <PluginCard
                    key={p.slug}
                    plugin={p}
                    installed={installedBySlug.get(p.slug)}
                    stats={reliabilityBySlug.get(p.slug)}
                    busy={installing === p.slug}
                    onInstall={() => beginInstall(p)}
                    onUninstall={() => uninstall(p.slug, p.name)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'installed' && (
          <div data-dav-anchor="marketplace:act">
            {stats.installedPaused > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPausedOnly((v) => !v)}
                  className={showPausedOnly ? 'border-warn text-warn' : ''}
                >
                  {showPausedOnly ? '✓ Paused only' : 'Show paused only'}
                </Btn>
              </div>
            )}
            <InstalledList
              installed={visibleInstalled}
              projectName={projectName}
              busySlug={installing}
              onTest={testPlugin}
              onTogglePause={togglePausePlugin}
              onEditUrl={editPluginUrl}
              onRotateSecret={rotatePluginSecret}
              onUninstall={uninstall}
            />
          </div>
        )}

        {activeTab === 'deliveries' && (
          <div data-dav-anchor="marketplace:verify">
            {dispatchLog.length === 0 ? (
              <EmptyState
                title={
                  projectName
                    ? `No deliveries for ${projectName} yet`
                    : 'No deliveries yet'
                }
                description="Webhook deliveries appear here once events fire or you send a test from the Installed tab."
              />
            ) : (
              <DispatchTable
                entries={visibleDispatch}
                installedPluginOptions={installedPluginOptions}
                pluginFilter={pluginFilter}
                statusFilter={statusFilter}
                onPluginFilter={setPluginFilter}
                onStatusFilter={setStatusFilter}
              />
            )}
          </div>
        )}
      </Section>

      {uninstallTarget && (
        <ConfirmDialog
          title={`Remove ${uninstallTarget.name}?`}
          body="The webhook secret will be wiped from Vault. This action cannot be undone."
          confirmLabel="Remove"
          tone="danger"
          loading={installing === uninstallTarget.slug}
          onConfirm={confirmUninstall}
          onCancel={() => setUninstallTarget(null)}
        />
      )}
    </div>
  )
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
