import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert,
  EmptyState, Input, Section,
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

  const installedBySlug = useMemo(() => {
    const map = new Map<string, InstalledPlugin>()
    for (const p of installed) {
      const key = p.plugin_slug ?? p.plugin_name
      map.set(key, p)
    }
    return map
  }, [installed])

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
    setInstalling(null)
    if (!res.ok) {
      toast.error('Install failed', res.error?.message)
      return
    }
    toast.success(`Installed ${installTarget.name}`)
    cancelInstall()
    reloadAll()
  }

  const uninstall = async (slug: string, name: string) => {
    if (!confirm(`Remove "${name}"? Webhook secret will be wiped from Vault.`)) return
    setInstalling(slug)
    const res = await apiFetch(`/v1/admin/plugins/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setInstalling(null)
    if (!res.ok) {
      toast.error('Uninstall failed', res.error?.message)
      return
    }
    toast.success(`Removed ${name}`)
    reloadAll()
  }

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={`Failed to load marketplace: ${error}`} onRetry={reloadAll} />

  return (
    <div className="space-y-3">
      <PageHeader title="Plugin marketplace" />
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

      <Section title="Available plugins">
        {catalog.length === 0 ? (
          <EmptyState
            title="No plugins listed"
            description="No plugins are listed yet. Seed the plugin_registry table with the reference catalog (PagerDuty, Linear, Zapier) or check that is_listed = true."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {catalog.map((p) => {
              const inst = installedBySlug.get(p.slug)
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
                      </p>
                    </div>
                    {inst ? (
                      <span className="inline-flex rounded px-2 py-0.5 text-3xs bg-emerald-500/10 text-emerald-500">
                        Installed
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
                    </div>
                  ) : null}

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
              <Card key={(p.plugin_slug ?? p.plugin_name)} className="p-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">{p.plugin_name}</p>
                  <p className="text-2xs text-fg-muted font-mono break-all">{p.webhook_url ?? '(built-in)'}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.subscribed_events.length === 0 ? (
                      <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">all events</code>
                    ) : p.subscribed_events.map((e) => (
                      <code key={e} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">{e}</code>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
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

      <Section title="Recent deliveries">
        {dispatchLog.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            description="Webhook deliveries will appear here once events fire. Errors include HTTP status and the first 512 chars of the response."
          />
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
                {dispatchLog.map((d) => (
                  <tr key={d.id} className="border-t border-border-subtle">
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
                    <td className="px-2 py-1.5 max-w-[28ch] truncate" title={d.response_excerpt ?? ''}>
                      {d.response_excerpt ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
