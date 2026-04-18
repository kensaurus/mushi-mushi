/**
 * FILE: apps/admin/src/pages/MarketplacePage.tsx
 * PURPOSE: Browse the plugin catalog, install/uninstall webhook plugins, and
 *          inspect every signed dispatch the platform has fired. Includes
 *          search/category/status filters plus per-plugin reliability stats
 *          rolled up from the dispatch log.
 */

import { Fragment, useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Loading,
  ErrorAlert,
  EmptyState,
  Input,
  Section,
  FilterSelect,
  Badge,
} from '../components/ui'

interface MarketplacePlugin {
  slug: string
  name: string
  short_description: string
  long_description: string | null
  publisher: string
  source_url: string | null
  manifest: { subscribes?: string[]; config?: Record<string, string> } | null
  required_scopes: string[]
  install_count: number
  category: string
  is_official: boolean
}

interface InstalledPlugin {
  id?: string
  plugin_name: string
  plugin_slug: string | null
  webhook_url: string | null
  subscribed_events: string[]
  is_active: boolean
  last_delivery_at: string | null
  last_delivery_status: 'ok' | 'error' | 'timeout' | 'skipped' | null
}

interface DispatchEntry {
  id: number
  delivery_id: string
  plugin_slug: string
  event: string
  status: 'pending' | 'ok' | 'error' | 'timeout' | 'skipped'
  http_status: number | null
  duration_ms: number | null
  response_excerpt: string | null
  created_at: string
}

const STATUS_CHIP: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-500',
  error: 'bg-red-500/10 text-red-500',
  timeout: 'bg-amber-500/10 text-amber-500',
  skipped: 'bg-fg-muted/10 text-fg-muted',
  pending: 'bg-blue-500/10 text-blue-500',
}

const CATEGORY_LABEL: Record<string, string> = {
  incident: 'Incident response',
  'project-management': 'Project management',
  integration: 'Integration',
  notification: 'Notifications',
  analytics: 'Analytics',
}

const STATUS_FILTER_OPTIONS = ['', 'ok', 'error', 'timeout', 'skipped', 'pending']

export function MarketplacePage() {
  const toast = useToast()
  const catalogQuery = usePageData<{ plugins: MarketplacePlugin[] }>('/v1/marketplace/plugins')
  const installedQuery = usePageData<{ plugins: InstalledPlugin[] }>('/v1/admin/plugins')
  const dispatchQuery = usePageData<{ entries: DispatchEntry[] }>('/v1/admin/plugins/dispatch-log')

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
  const [expandedDelivery, setExpandedDelivery] = useState<number | null>(null)

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
      if (needle && !p.name.toLowerCase().includes(needle) && !p.short_description.toLowerCase().includes(needle) && !p.publisher.toLowerCase().includes(needle)) return false
      return true
    })
  }, [catalog, search, categoryFilter, showInstalledOnly, installedBySlug])

  const reliabilityBySlug = useMemo(() => {
    const stats = new Map<string, { total: number; ok: number; error: number; avgLatency: number }>()
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

  const beginInstall = (plugin: MarketplacePlugin) => {
    setInstallTarget(plugin)
    setDraftWebhookUrl('')
    setDraftWebhookSecret(generateSecret())
    setDraftEvents((plugin.manifest?.subscribes ?? []).join(', '))
  }

  const cancelInstall = () => {
    setInstallTarget(null)
    setDraftWebhookUrl('')
    setDraftWebhookSecret('')
    setDraftEvents('')
  }

  const submitInstall = async () => {
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
    const events = draftEvents.split(',').map((s) => s.trim()).filter(Boolean)
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
  }

  const uninstall = async (slug: string, name: string) => {
    if (!confirm(`Remove "${name}"? Webhook secret will be wiped from Vault.`)) return
    setInstalling(slug)
    try {
      const res = await apiFetch(`/v1/admin/plugins/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Uninstall failed')
      toast.success(`Removed ${name}`)
      reloadAll()
    } catch (err) {
      toast.error('Uninstall failed', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={`Failed to load marketplace: ${error}`} onRetry={reloadAll} />

  return (
    <div className="space-y-3">
      <PageHeader title="Plugin marketplace">
        <Btn variant="ghost" size="sm" onClick={reloadAll}>Refresh</Btn>
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

      {installTarget ? (
        <Section title={`Install ${installTarget.name}`} className="space-y-3">
          <p className="text-2xs opacity-70">
            Subscribed events:&nbsp;
            <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
              {(installTarget.manifest?.subscribes ?? []).join(', ') || '(none)'}
            </code>
          </p>
          <Input
            label="Webhook URL"
            value={draftWebhookUrl}
            placeholder="https://your-receiver.example.com/mushi/webhook"
            onChange={(e) => setDraftWebhookUrl(e.target.value)}
          />
          <Input
            label="Signing secret (HMAC-SHA256, store this — shown only once)"
            value={draftWebhookSecret}
            onChange={(e) => setDraftWebhookSecret(e.target.value)}
          />
          <Input
            label="Subscribed events (comma-separated, * for all)"
            value={draftEvents}
            onChange={(e) => setDraftEvents(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={cancelInstall}>Cancel</Btn>
            <Btn size="sm" onClick={submitInstall} disabled={installing === installTarget.slug}>
              {installing === installTarget.slug ? 'Installing…' : 'Install'}
            </Btn>
          </div>
        </Section>
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
            description={catalog.length === 0
              ? 'Seed the plugin_registry table with the reference catalog (PagerDuty, Linear, Zapier) or check that is_listed = true.'
              : 'Try clearing search, category, or the installed-only toggle.'}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleCatalog.map((p) => {
              const inst = installedBySlug.get(p.slug)
              const stats = reliabilityBySlug.get(p.slug)
              return (
                <Card key={p.slug} className="p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{p.name}</h3>
                        {p.is_official ? (
                          <span className="inline-flex rounded px-1.5 py-0.5 text-3xs bg-brand/10 text-brand">
                            Official
                          </span>
                        ) : null}
                      </div>
                      <p className="text-2xs text-fg-muted">
                        {p.publisher} · {CATEGORY_LABEL[p.category] ?? p.category}
                        {p.install_count > 0 && ` · ${p.install_count.toLocaleString()} installs`}
                      </p>
                    </div>
                    {inst ? (
                      <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${inst.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-fg-muted/10 text-fg-muted'}`}>
                        {inst.is_active ? 'Installed' : 'Disabled'}
                      </span>
                    ) : null}
                  </div>

                  <p className="text-xs opacity-80">{p.short_description}</p>

                  {p.manifest?.subscribes?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {p.manifest.subscribes.slice(0, 4).map((evt) => (
                        <code key={evt} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
                          {evt}
                        </code>
                      ))}
                      {p.manifest.subscribes.length > 4 && (
                        <span className="text-3xs text-fg-faint">+{p.manifest.subscribes.length - 4} more</span>
                      )}
                    </div>
                  ) : null}

                  {inst && stats && (
                    <div className="flex items-center gap-2 flex-wrap text-3xs text-fg-muted border-t border-edge-subtle pt-2">
                      <span><span className="font-mono text-fg">{stats.total}</span> deliveries</span>
                      <span><span className="font-mono text-ok">{stats.ok}</span> ok</span>
                      {stats.error > 0 && <span><span className="font-mono text-danger">{stats.error}</span> failed</span>}
                      <span>avg <span className="font-mono">{stats.avgLatency}ms</span></span>
                      {inst.webhook_url && (
                        <code className="ml-auto truncate max-w-[12rem] text-fg-faint" title={inst.webhook_url}>
                          {inst.webhook_url.replace(/^https?:\/\//, '')}
                        </code>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between pt-2">
                    {p.source_url ? (
                      <a
                        href={p.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-2xs text-brand hover:underline"
                      >
                        Source ↗
                      </a>
                    ) : <span />}
                    {inst ? (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => uninstall(p.slug, p.name)}
                        disabled={installing === p.slug}
                      >
                        {installing === p.slug ? 'Removing…' : 'Uninstall'}
                      </Btn>
                    ) : (
                      <Btn size="sm" onClick={() => beginInstall(p)} disabled={installing === p.slug}>
                        Install
                      </Btn>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Installed">
        {installed.length === 0 ? (
          <EmptyState title="No plugins installed" description="Install one above to start receiving signed webhooks." />
        ) : (
          <div className="space-y-2">
            {installed.map((p) => (
              <Card key={(p.plugin_slug ?? p.plugin_name)} className="p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold">{p.plugin_name}</p>
                    {!p.is_active && <Badge className="bg-fg-muted/10 text-fg-muted">disabled</Badge>}
                  </div>
                  <p className="text-2xs text-fg-muted font-mono break-all">{p.webhook_url ?? '(built-in)'}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.subscribed_events.length === 0 ? (
                      <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">all events</code>
                    ) : p.subscribed_events.map((e) => (
                      <code key={e} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">{e}</code>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.last_delivery_status ? (
                    <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[p.last_delivery_status]}`}>
                      {p.last_delivery_status.toUpperCase()}
                    </span>
                  ) : null}
                  {p.last_delivery_at ? (
                    <span className="text-2xs text-fg-muted">{new Date(p.last_delivery_at).toLocaleString()}</span>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Recent deliveries (${visibleDispatch.length}/${dispatchLog.length})`}>
        {dispatchLog.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            description="Webhook deliveries will appear here once events fire. Errors include HTTP status and the first 512 chars of the response."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-2">
              <FilterSelect
                label="Plugin"
                value={pluginFilter}
                options={installedPluginOptions}
                onChange={(e) => setPluginFilter(e.currentTarget.value)}
              />
              <FilterSelect
                label="Status"
                value={statusFilter}
                options={STATUS_FILTER_OPTIONS}
                onChange={(e) => setStatusFilter(e.currentTarget.value)}
              />
            </div>
            {visibleDispatch.length === 0 ? (
              <EmptyState title="No deliveries match these filters" description="Try clearing plugin or status filters." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-2xs">
                  <thead className="text-left opacity-60">
                    <tr>
                      <th className="px-2 py-1.5">When</th>
                      <th className="px-2 py-1.5">Plugin</th>
                      <th className="px-2 py-1.5">Event</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">HTTP</th>
                      <th className="px-2 py-1.5">Duration</th>
                      <th className="px-2 py-1.5">Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDispatch.map((d) => {
                      const isExpanded = expandedDelivery === d.id
                      const hasResponse = d.response_excerpt && d.response_excerpt.length > 0
                      return (
                        <Fragment key={d.id}>
                          <tr
                            className="border-t border-border-subtle hover:bg-surface-overlay/30 cursor-pointer"
                            onClick={() => hasResponse && setExpandedDelivery(isExpanded ? null : d.id)}
                          >
                            <td className="px-2 py-1.5">{new Date(d.created_at).toLocaleString()}</td>
                            <td className="px-2 py-1.5">
                              <code className="bg-surface-raised px-1 py-0.5 rounded">{d.plugin_slug}</code>
                            </td>
                            <td className="px-2 py-1.5">
                              <code className="bg-surface-raised px-1 py-0.5 rounded">{d.event}</code>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex rounded px-1.5 py-0.5 ${STATUS_CHIP[d.status]}`}>{d.status}</span>
                            </td>
                            <td className="px-2 py-1.5">{d.http_status ?? '—'}</td>
                            <td className="px-2 py-1.5">{d.duration_ms != null ? `${d.duration_ms}ms` : '—'}</td>
                            <td className="px-2 py-1.5 max-w-[28ch] truncate">
                              {hasResponse ? (isExpanded ? '▾ collapse' : `▸ ${d.response_excerpt?.slice(0, 32)}…`) : '—'}
                            </td>
                          </tr>
                          {isExpanded && hasResponse && (
                            <tr className="bg-surface-overlay/30 border-t border-border-subtle">
                              <td colSpan={7} className="px-3 py-2">
                                <div className="text-3xs text-fg-muted uppercase tracking-wider mb-1">
                                  Full response · delivery {d.delivery_id.slice(0, 8)}…
                                </div>
                                <pre className="text-3xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap break-all bg-surface-raised rounded-sm p-2">
                                  {d.response_excerpt}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  )
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
