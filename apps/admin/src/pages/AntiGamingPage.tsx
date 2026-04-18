/**
 * FILE: apps/admin/src/pages/AntiGamingPage.tsx
 * PURPOSE: Surfaces multi-account / velocity / cross-account abuse detection.
 *          Lets admins inspect, search, expand, manually flag, and unflag
 *          devices, plus filter the audit-grade event log.
 */

import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  FilterSelect,
  Input,
  EmptyState,
  Loading,
  ErrorAlert,
} from '../components/ui'
import { KpiTile } from '../components/charts'
import { SetupNudge } from '../components/SetupNudge'

interface ReporterDevice {
  id: string
  project_id: string
  device_fingerprint: string
  fingerprint_hash: string | null
  reporter_tokens: string[]
  ip_addresses: string[]
  report_count: number
  distinct_user_count: number
  flagged_as_suspicious: boolean
  cross_account_flagged: boolean
  flag_reason: string | null
  updated_at: string
  created_at: string
}

interface AntiGamingEvent {
  id: string
  project_id: string
  reporter_token_hash: string
  device_fingerprint: string | null
  ip_address: string | null
  event_type: 'multi_account' | 'velocity_anomaly' | 'manual_flag' | 'unflag'
  reason: string | null
  created_at: string
}

const EVENT_BADGE: Record<AntiGamingEvent['event_type'], string> = {
  multi_account: 'bg-warn-muted text-warn',
  velocity_anomaly: 'bg-danger-muted text-danger',
  manual_flag: 'bg-danger-muted text-danger',
  unflag: 'bg-ok-muted text-ok',
}

const EVENT_TYPE_OPTIONS = ['', 'multi_account', 'velocity_anomaly', 'manual_flag', 'unflag']

export function AntiGamingPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged')
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const devicesPath = `/v1/admin/anti-gaming/devices${filter === 'flagged' ? '?flagged=true' : ''}`
  const devicesQuery = usePageData<{ devices: ReporterDevice[] }>(devicesPath, { deps: [filter] })
  const eventsQuery = usePageData<{ events: AntiGamingEvent[] }>(
    `/v1/admin/anti-gaming/events${eventFilter ? `?event_type=${eventFilter}` : ''}`,
    { deps: [eventFilter] },
  )

  const allDevices = devicesQuery.data?.devices ?? []
  const events = eventsQuery.data?.events ?? []
  const loading = devicesQuery.loading || eventsQuery.loading
  const error = devicesQuery.error

  const reloadAll = useCallback(() => {
    devicesQuery.reload()
    eventsQuery.reload()
  }, [devicesQuery, eventsQuery])

  useRealtime({ table: 'reporter_devices' }, devicesQuery.reload)
  useRealtime({ table: 'anti_gaming_events' }, eventsQuery.reload)

  const devices = useMemo(() => {
    if (!search.trim()) return allDevices
    const needle = search.trim().toLowerCase()
    return allDevices.filter((d) =>
      d.device_fingerprint.toLowerCase().includes(needle)
      || d.fingerprint_hash?.toLowerCase().includes(needle)
      || d.flag_reason?.toLowerCase().includes(needle)
      || d.reporter_tokens.some((t) => t.toLowerCase().includes(needle))
      || d.ip_addresses.some((ip) => ip.toLowerCase().includes(needle)),
    )
  }, [allDevices, search])

  const stats = useMemo(() => {
    const flagged = allDevices.filter((d) => d.flagged_as_suspicious).length
    const crossAccount = allDevices.filter((d) => d.cross_account_flagged).length
    const totalReports = allDevices.reduce((sum, d) => sum + d.report_count, 0)
    return { total: allDevices.length, flagged, crossAccount, totalReports }
  }, [allDevices])

  async function unflag(deviceId: string) {
    setBusy(deviceId)
    try {
      const res = await apiFetch(`/v1/admin/anti-gaming/devices/${deviceId}/unflag`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Unflag failed')
      toast.success('Device unflagged')
      reloadAll()
    } catch (err) {
      toast.error('Could not unflag device', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function flag(deviceId: string) {
    const reason = window.prompt('Why are you flagging this device?', 'Suspicious activity confirmed')?.trim()
    if (!reason) return
    setBusy(deviceId)
    try {
      const res = await apiFetch(`/v1/admin/anti-gaming/devices/${deviceId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Flag failed')
      toast.success('Device flagged')
      reloadAll()
    } catch (err) {
      toast.error('Could not flag device', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Anti-Gaming">
        <FilterSelect
          label="Show"
          value={filter}
          options={['flagged', 'all']}
          onChange={(e) => setFilter(e.currentTarget.value as 'flagged' | 'all')}
        />
        <Btn variant="ghost" size="sm" onClick={reloadAll}>Refresh</Btn>
      </PageHeader>

      <PageHelp
        title="About Anti-Gaming"
        whatIsIt="Detects abusive reporters: the same device fingerprint registering many distinct reporter tokens (multi-account), or a single token submitting too many reports in a short window (velocity anomaly). Device fingerprint is derived server-side from IP + User-Agent and supplemented by an SDK-supplied stable hash."
        useCases={[
          'Block reward farming on gamified deployments',
          'Identify scripted submission attempts',
          'Stop a single misconfigured client from polluting the report queue',
        ]}
        howToUse="Flagged reports are still ingested but marked. Use Unflag after verifying a false positive (shared NAT, dev test accounts) or Flag manually after confirming abuse. The event log shows every decision for SOC 2 audit."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Tracked devices" value={stats.total} />
        <KpiTile label="Flagged" value={stats.flagged} accent={stats.flagged > 0 ? 'danger' : undefined} />
        <KpiTile label="Cross-account" value={stats.crossAccount} accent={stats.crossAccount > 0 ? 'warn' : undefined} />
        <KpiTile label="Total reports" value={stats.totalReports} />
      </div>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            {filter === 'flagged' ? 'Flagged devices' : 'All tracked devices'}
            {search && ` · ${devices.length}/${allDevices.length} match "${search}"`}
          </h2>
          <Input
            placeholder="Search fingerprint, token, IP, reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {loading ? (
          <Loading text="Loading devices..." />
        ) : error ? (
          <ErrorAlert message={`Failed to load devices: ${error}`} onRetry={devicesQuery.reload} />
        ) : devices.length === 0 ? (
          search ? (
            <EmptyState title="No devices match this search" description="Try a different fingerprint, token, or IP fragment." />
          ) : filter === 'flagged' ? (
            <EmptyState
              title="No flagged devices"
              description="Switch to All to inspect every tracked device, or wait for the detector to fire."
            />
          ) : (
            <SetupNudge
              requires={['first_report_received']}
              emptyTitle="No tracked devices yet"
              emptyDescription="Devices appear here once a reporter submits at least one report from them."
            />
          )
        ) : (
          <div className="space-y-1">
            {devices.map(d => {
              const isExpanded = expanded === d.id
              const isBusy = busy === d.id
              return (
                <Card key={d.id} className="overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {d.cross_account_flagged && (
                            <Badge className="bg-danger-muted text-danger">cross-account</Badge>
                          )}
                          {d.flagged_as_suspicious && !d.cross_account_flagged && (
                            <Badge className="bg-danger-muted text-danger">flagged</Badge>
                          )}
                          <code className="text-2xs font-mono text-fg-secondary truncate">
                            fp:{d.device_fingerprint.slice(0, 16)}…
                          </code>
                          {d.fingerprint_hash && (
                            <code className="text-2xs font-mono text-fg-faint truncate" title="SDK-supplied stable fingerprint hash">
                              sdk:{d.fingerprint_hash.slice(0, 12)}…
                            </code>
                          )}
                          <span className="text-2xs text-fg-faint">
                            {d.reporter_tokens.length} token{d.reporter_tokens.length !== 1 ? 's' : ''} · {d.ip_addresses.length} IP{d.ip_addresses.length !== 1 ? 's' : ''} · {d.report_count} reports
                            {d.distinct_user_count > 0 ? ` · ${d.distinct_user_count} distinct users` : ''}
                          </span>
                        </div>
                        {d.flag_reason && (
                          <p className="mt-1 text-xs text-danger">{d.flag_reason}</p>
                        )}
                        <p className="mt-1 text-2xs text-fg-faint">
                          First seen {new Date(d.created_at).toLocaleString()} · last activity {new Date(d.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(isExpanded ? null : d.id)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </Btn>
                        {d.flagged_as_suspicious ? (
                          <Btn variant="ghost" size="sm" onClick={() => unflag(d.id)} disabled={isBusy}>
                            {isBusy ? 'Working…' : 'Unflag'}
                          </Btn>
                        ) : (
                          <Btn variant="ghost" size="sm" onClick={() => flag(d.id)} disabled={isBusy}>
                            {isBusy ? 'Working…' : 'Flag'}
                          </Btn>
                        )}
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-edge-subtle bg-surface-overlay/30 px-3 py-2 space-y-2">
                      <div>
                        <div className="text-2xs text-fg-muted uppercase tracking-wider mb-1">Reporter tokens ({d.reporter_tokens.length})</div>
                        <div className="flex flex-wrap gap-1 font-mono text-2xs">
                          {d.reporter_tokens.map((t) => (
                            <span key={t} className="px-1.5 py-0.5 bg-surface-raised rounded-sm text-fg-secondary">
                              {t.slice(0, 16)}…
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xs text-fg-muted uppercase tracking-wider mb-1">IP addresses ({d.ip_addresses.length})</div>
                        <div className="flex flex-wrap gap-1 font-mono text-2xs">
                          {d.ip_addresses.map((ip) => (
                            <span key={ip} className="px-1.5 py-0.5 bg-surface-raised rounded-sm text-fg-secondary">
                              {ip}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-2xs text-fg-faint font-mono">
                        Full fingerprint: {d.device_fingerprint}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Recent events</h2>
          <FilterSelect
            label="Type"
            value={eventFilter}
            options={EVENT_TYPE_OPTIONS}
            onChange={(e) => setEventFilter(e.currentTarget.value)}
          />
        </div>
        {events.length === 0 ? (
          <EmptyState title="No anti-gaming events yet" description={eventFilter ? 'Try a different event type.' : undefined} />
        ) : (
          <div className="space-y-0.5 font-mono text-2xs">
            {events.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40">
                <span className="text-fg-faint w-32 truncate">{new Date(e.created_at).toLocaleString()}</span>
                <Badge className={EVENT_BADGE[e.event_type]}>{e.event_type}</Badge>
                <span className="text-fg-secondary truncate flex-1">{e.reason ?? '—'}</span>
                <span className="text-fg-faint shrink-0 max-w-32 truncate">tok:{e.reporter_token_hash.slice(0, 8)}…</span>
                {e.ip_address && <span className="text-fg-faint shrink-0">{e.ip_address}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
