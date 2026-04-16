import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { PageHeader, PageHelp, Card, Badge, Btn, FilterSelect, EmptyState, Loading, ErrorAlert } from '../components/ui'

interface ReporterDevice {
  id: string
  project_id: string
  device_fingerprint: string
  reporter_tokens: string[]
  ip_addresses: string[]
  report_count: number
  flagged_as_suspicious: boolean
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

export function AntiGamingPage() {
  const [devices, setDevices] = useState<ReporterDevice[]>([])
  const [events, setEvents] = useState<AntiGamingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged')

  const load = useCallback(async () => {
    setError(false)
    const [devRes, evRes] = await Promise.all([
      apiFetch<{ devices: ReporterDevice[] }>(`/v1/admin/anti-gaming/devices${filter === 'flagged' ? '?flagged=true' : ''}`),
      apiFetch<{ events: AntiGamingEvent[] }>('/v1/admin/anti-gaming/events'),
    ])
    if (devRes.ok && devRes.data) setDevices(devRes.data.devices)
    else setError(true)
    if (evRes.ok && evRes.data) setEvents(evRes.data.events)
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])
  useRealtime({ table: 'reporter_devices' }, load)
  useRealtime({ table: 'anti_gaming_events' }, load)

  async function unflag(deviceId: string) {
    await apiFetch(`/v1/admin/anti-gaming/devices/${deviceId}/unflag`, { method: 'POST' })
    await load()
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
      </PageHeader>

      <PageHelp
        title="About Anti-Gaming"
        whatIsIt="Detects abusive reporters: the same device fingerprint registering many distinct reporter tokens (multi-account), or a single token submitting too many reports in a short window (velocity anomaly). Device fingerprint is derived server-side from IP + User-Agent."
        useCases={[
          'Block reward farming on gamified deployments',
          'Identify scripted submission attempts',
          'Stop a single misconfigured client from polluting the report queue',
        ]}
        howToUse="Flagged reports are still ingested but marked. Use Unflag after verifying a false positive (e.g. shared NAT, dev test accounts). The event log shows every flag/unflag decision for audit."
      />

      <section>
        <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">
          {filter === 'flagged' ? 'Flagged devices' : 'All tracked devices'}
        </h2>
        {loading ? (
          <Loading text="Loading devices..." />
        ) : error ? (
          <ErrorAlert message="Failed to load devices." onRetry={load} />
        ) : devices.length === 0 ? (
          <EmptyState
            title={filter === 'flagged' ? 'No flagged devices' : 'No tracked devices yet'}
            description="Devices appear here once a reporter submits at least one report from them."
          />
        ) : (
          <div className="space-y-1.5">
            {devices.map(d => (
              <Card key={d.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {d.flagged_as_suspicious && (
                        <Badge className="bg-danger-muted text-danger">flagged</Badge>
                      )}
                      <code className="text-2xs font-mono text-fg-secondary truncate">
                        fp:{d.device_fingerprint.slice(0, 16)}…
                      </code>
                      <span className="text-2xs text-fg-faint">
                        {d.reporter_tokens.length} token{d.reporter_tokens.length !== 1 ? 's' : ''} · {d.ip_addresses.length} IP{d.ip_addresses.length !== 1 ? 's' : ''} · {d.report_count} reports
                      </span>
                    </div>
                    {d.flag_reason && (
                      <p className="mt-1 text-xs text-danger">{d.flag_reason}</p>
                    )}
                    <p className="mt-1 text-2xs text-fg-faint">
                      First seen {new Date(d.created_at).toLocaleString()} · last activity {new Date(d.updated_at).toLocaleString()}
                    </p>
                  </div>
                  {d.flagged_as_suspicious && (
                    <Btn variant="ghost" size="sm" onClick={() => unflag(d.id)}>
                      Unflag
                    </Btn>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Recent events</h2>
        {events.length === 0 ? (
          <EmptyState title="No anti-gaming events yet" />
        ) : (
          <div className="space-y-0.5 font-mono text-2xs">
            {events.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40">
                <span className="text-fg-faint w-32 truncate">{new Date(e.created_at).toLocaleString()}</span>
                <Badge className={EVENT_BADGE[e.event_type]}>{e.event_type}</Badge>
                <span className="text-fg-secondary truncate">{e.reason ?? '—'}</span>
                <span className="text-fg-faint ml-auto truncate max-w-32">tok:{e.reporter_token_hash.slice(0, 8)}…</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
