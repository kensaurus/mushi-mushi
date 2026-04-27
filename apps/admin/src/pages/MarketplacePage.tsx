/**
 * FILE: apps/admin/src/pages/MarketplacePage.tsx
 * PURPOSE: Browse the plugin catalog, install/uninstall webhook plugins, and
 *          inspect every signed dispatch the platform has fired. Includes
 *          search/category/status filters plus per-plugin reliability stats
 *          rolled up from the dispatch log.
 */

import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Btn,
  ErrorAlert,
  EmptyState,
  Input,
  Section,
  FilterSelect,
} from '../components/ui'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { DispatchTable } from '../components/marketplace/DispatchTable'
import { InstallForm } from '../components/marketplace/InstallForm'
import { InstalledList } from '../components/marketplace/InstalledList'
import { PluginCard } from '../components/marketplace/PluginCard'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import {
  type DispatchEntry,
  type InstalledPlugin,
  type MarketplacePlugin,
  type ReliabilityStats,
} from '../components/marketplace/types'

export function MarketplacePage() {
  const toast = useToast()
  const entitlements = useEntitlements()
  const pluginsUnlocked = entitlements.has('plugins')
  const catalogQuery = usePageData<{ plugins: MarketplacePlugin[] }>('/v1/marketplace/plugins')
  const installedQuery = usePageData<{ plugins: InstalledPlugin[] }>('/v1/admin/plugins')
  const dispatchQuery = usePageData<{ entries: DispatchEntry[] }>(
    '/v1/admin/plugins/dispatch-log',
  )

  const catalog = catalogQuery.data?.plugins ?? []
  const installed = installedQuery.data?.plugins ?? []
  const dispatchLog = dispatchQuery.data?.entries ?? []
  const loading = catalogQuery.loading || installedQuery.loading || dispatchQuery.loading
  const error = catalogQuery.error

  const reloadAll = useCallback(() => {
    catalogQuery.reload()
    installedQuery.reload()
    dispatchQuery.reload()
  }, [catalogQuery, installedQuery, dispatchQuery])

  const [installing, setInstalling] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<MarketplacePlugin | null>(null)
  const [draftWebhookUrl, setDraftWebhookUrl] = useState('')
  const [draftWebhookSecret, setDraftWebhookSecret] = useState('')
  const [draftEvents, setDraftEvents] = useState<string>('')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
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

  const reliabilityBySlug = useMemo(() => {
    const stats = new Map<string, ReliabilityStats>()
    const latencies: Record<string, number[]> = {}
    for (const e of dispatchLog) {
      const cur = stats.get(e.plugin_slug) ?? { total: 0, ok: 0, error: 0, avgLatency: 0 }
      cur.total += 1
      if (e.status === 'ok') cur.ok += 1
      if (e.status === 'error' || e.status === 'timeout') cur.error += 1
      stats.set(e.plugin_slug, cur)
      latencies[e.plugin_slug] ??= []
      if (typeof e.duration_ms === 'number') latencies[e.plugin_slug].push(e.duration_ms)
    }
    for (const [slug, s] of stats) {
      const arr = latencies[slug] ?? []
      s.avgLatency = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
    }
    return stats
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
    } catch (err) {
      toast.error('Install failed', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [installTarget, draftWebhookUrl, draftWebhookSecret, draftEvents, toast, cancelInstall, reloadAll])

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

  if (loading) return <TableSkeleton rows={6} columns={4} showFilters label="Loading marketplace" />
  if (error)
    return <ErrorAlert message={`Failed to load marketplace: ${error}`} onRetry={reloadAll} />

  return (
    <div className="space-y-3">
      <PageHeader
        title="Plugin marketplace"
        description="Toggle plugins to extend the loop — extra evaluators, custom dispatchers, or downstream notifiers."
      >
        <Btn variant="ghost" size="sm" onClick={reloadAll}>
          Refresh
        </Btn>
      </PageHeader>
      <PageHelp
        title="About the marketplace"
        whatIsIt="Mushi plugins are HTTPS webhook receivers that subscribe to lifecycle events (report.created, report.classified, fix.applied, sla.breached, etc.). Mushi signs every payload with HMAC-SHA256 so plugins can verify the request came from your project."
        useCases={[
          'Page on-call via PagerDuty when a critical bug is reported',
          'Mirror reports to Linear and keep the issue status in sync',
          'Fan out any event to a Zapier/Make catch-hook for no-code workflows',
        ]}
        howToUse="Pick a plugin, deploy its webhook receiver (or use one of the reference plugins under packages/plugin-*), then click Install and paste the receiver URL. Mushi generates a signing secret and stores it in Supabase Vault — the raw value is shown only once."
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

      <Section title={`Available plugins (${visibleCatalog.length}/${catalog.length})`}>
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
                ? 'Seed the plugin_registry table with the reference catalog (PagerDuty, Linear, Zapier) or check that is_listed = true.'
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
      </Section>

      <Section title="Installed">
        <InstalledList installed={installed} />
      </Section>

      <Section title={`Recent deliveries (${visibleDispatch.length}/${dispatchLog.length})`}>
        {dispatchLog.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            description="Webhook deliveries will appear here once events fire. Errors include HTTP status and the first 512 chars of the response."
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
