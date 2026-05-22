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
  Section,
  Badge,
  Btn,
  FilterSelect,
  Input,
  ErrorAlert,
  SegmentedControl,
  Tooltip,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { KpiTile, type KpiDelta } from '../components/charts'
import { SetupNudge } from '../components/SetupNudge'
import { ConfigHelp } from '../components/ConfigHelp'
import { PromptDialog } from '../components/ConfirmDialog'
import { useMergedErrors } from '../lib/useMergedErrors'
import { pluralizeWithCount } from '../lib/format'
import { PageActionBar } from '../components/PageActionBar'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'
import { IconEye, IconChevronUp, IconFlag, IconFlagOff } from '../components/icons'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'

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

interface EventGroup {
  /** Tuple key: `${event_type}|${reason ?? ''}|${reporter_token_hash}|${ip_address ?? ''}` */
  key: string
  event_type: AntiGamingEvent['event_type']
  reason: string | null
  reporter_token_hash: string
  ip_address: string | null
  count: number
  first_at: string
  last_at: string
  /** Underlying event ids, useful for the expanded detail view + audit trail. */
  ids: string[]
}

/**
 * Collapse identical events into one row keyed by the (event_type, reason,
 * reporter_token_hash, ip_address) tuple. The detector fires once per
 * threshold breach so a single misbehaving device can spam dozens of
 * identical lines per hour — this aggregation makes the audit feed
 * actually skimmable while preserving every individual event id for
 * SOC-2 traceability.
 *
 * Events are returned newest-first by their last occurrence so the most
 * active groups bubble to the top.
 */
function groupEvents(events: AntiGamingEvent[]): EventGroup[] {
  const map = new Map<string, EventGroup>()
  for (const e of events) {
    const key = `${e.event_type}|${e.reason ?? ''}|${e.reporter_token_hash}|${e.ip_address ?? ''}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      existing.ids.push(e.id)
      if (e.created_at < existing.first_at) existing.first_at = e.created_at
      if (e.created_at > existing.last_at) existing.last_at = e.created_at
    } else {
      map.set(key, {
        key,
        event_type: e.event_type,
        reason: e.reason,
        reporter_token_hash: e.reporter_token_hash,
        ip_address: e.ip_address,
        count: 1,
        first_at: e.created_at,
        last_at: e.created_at,
        ids: [e.id],
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1))
}

type DeviceGroupBy = 'flat' | 'ip' | 'date' | 'status'

export function AntiGamingPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged')
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flagTarget, setFlagTarget] = useState<string | null>(null)
  const [aggregateEvents, setAggregateEvents] = useState(true)
  const [expandedEventGroup, setExpandedEventGroup] = useState<string | null>(null)
  // 2026-05-07 enhancement — when 50 devices land in the flagged lane the
  // flat list is unscannable; an operator can't tell whether they're staring
  // at one rogue datacenter spamming 30 tokens or a coordinated campaign
  // across 30 IPs. Grouping by IP / date / status surfaces those structures
  // without forcing the operator to do the aggregation by eye. Flat stays
  // the default so first-time visitors see the existing layout.
  const [groupBy, setGroupBy] = useState<DeviceGroupBy>('flat')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Reset collapsed state whenever the grouping axis changes — otherwise a
  // group key collapsed under "by IP" stays collapsed under "by date" even
  // though it represents a different bucket.
  const resetCollapsed = useCallback(() => setCollapsedGroups(new Set()), [])

  const devicesPath = `/v1/admin/anti-gaming/devices${filter === 'flagged' ? '?flagged=true' : ''}`
  const devicesQuery = usePageData<{ devices: ReporterDevice[] }>(devicesPath, { deps: [filter] })
  const eventsQuery = usePageData<{ events: AntiGamingEvent[] }>(
    `/v1/admin/anti-gaming/events${eventFilter ? `?event_type=${eventFilter}` : ''}`,
    { deps: [eventFilter] },
  )

  const allDevices = devicesQuery.data?.devices ?? []
  const events = eventsQuery.data?.events ?? []
  // Merge both queries' loading + error into one decision so we never render
  // half a page when one feed fails
  const merged = useMergedErrors([
    { ...devicesQuery, label: 'devices' },
    { ...eventsQuery, label: 'audit events' },
  ])
  const loading = merged.loading
  const error = merged.error

  const reloadAll = useCallback(() => {
    devicesQuery.reload()
    eventsQuery.reload()
  }, [devicesQuery, eventsQuery])

  // Mushi Bounties: fetch withheld tester redemptions for the 3rd KPI tile.
  const withheldRedemptionsQuery = usePageData<{ count: number; items: Array<{
    id: string
    tester_id: string
    kind: string
    points_spent: number
    face_value_usd: number | null
    requested_at: string
    mushi_testers?: { public_handle: string | null } | null
  }> }>('/v1/admin/tester-redemptions/withheld')
  const withheldRedemptions = withheldRedemptionsQuery.data?.items ?? []
  const withheldCount = withheldRedemptionsQuery.data?.count ?? 0

  useRealtime({ table: 'reporter_devices' }, devicesQuery.reload)
  useRealtime({ table: 'anti_gaming_events' }, eventsQuery.reload)
  useRealtime({ table: 'tester_redemptions' }, withheldRedemptionsQuery.reload)

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

  // Bucketise the (already filtered + searched) device list into named
  // groups. Each grouping axis returns a stable order so the user's eye
  // doesn't have to re-anchor on every render:
  //
  //   flat    → one synthetic group "All devices"
  //   ip      → primary IP (first ip_address); devices with no IP go
  //             under "(no IP)" sorted last
  //   date    → relative day bucket (Today / Yesterday / This week /
  //             Last 30d / Older), oldest bucket last
  //   status  → cross-account → flagged → tracked, severity descending
  //
  // The `count` is shown in the group header so the operator sees the
  // shape of abuse at a glance without expanding anything.
  const deviceGroups = useMemo<Array<{ key: string; label: string; sublabel?: string; count: number; devices: ReporterDevice[] }>>(() => {
    if (groupBy === 'flat') {
      return [{ key: 'all', label: 'All devices', count: devices.length, devices }]
    }
    if (groupBy === 'ip') {
      const buckets = new Map<string, ReporterDevice[]>()
      for (const d of devices) {
        const key = d.ip_addresses[0] ?? '(no IP)'
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key)!.push(d)
      }
      return Array.from(buckets.entries())
        .sort((a, b) => {
          if (a[0] === '(no IP)') return 1
          if (b[0] === '(no IP)') return -1
          if (b[1].length !== a[1].length) return b[1].length - a[1].length
          return a[0].localeCompare(b[0])
        })
        .map(([ip, devs]) => ({
          key: `ip:${ip}`,
          label: ip,
          sublabel: devs.length > 1 ? `${devs.length} devices share this IP` : undefined,
          count: devs.length,
          devices: devs,
        }))
    }
    if (groupBy === 'date') {
      const now = Date.now()
      const ms = (n: number) => n * 24 * 60 * 60 * 1000
      const bucketFor = (created: string): { rank: number; key: string; label: string } => {
        const age = now - new Date(created).getTime()
        if (age < ms(1)) return { rank: 0, key: 'today', label: 'Today' }
        if (age < ms(2)) return { rank: 1, key: 'yesterday', label: 'Yesterday' }
        if (age < ms(7)) return { rank: 2, key: 'this-week', label: 'This week' }
        if (age < ms(30)) return { rank: 3, key: 'last-30d', label: 'Last 30 days' }
        return { rank: 4, key: 'older', label: 'Older' }
      }
      const buckets = new Map<string, { rank: number; label: string; devices: ReporterDevice[] }>()
      for (const d of devices) {
        const b = bucketFor(d.created_at)
        if (!buckets.has(b.key)) buckets.set(b.key, { rank: b.rank, label: b.label, devices: [] })
        buckets.get(b.key)!.devices.push(d)
      }
      return Array.from(buckets.entries())
        .sort((a, b) => a[1].rank - b[1].rank)
        .map(([key, { label, devices: devs }]) => ({
          key: `date:${key}`,
          label,
          count: devs.length,
          devices: devs,
        }))
    }
    // status — severity descending so the most actionable bucket is at top
    const buckets = {
      cross: [] as ReporterDevice[],
      flagged: [] as ReporterDevice[],
      tracked: [] as ReporterDevice[],
    }
    for (const d of devices) {
      if (d.cross_account_flagged) buckets.cross.push(d)
      else if (d.flagged_as_suspicious) buckets.flagged.push(d)
      else buckets.tracked.push(d)
    }
    const out: Array<{ key: string; label: string; sublabel?: string; count: number; devices: ReporterDevice[] }> = []
    if (buckets.cross.length > 0) {
      out.push({ key: 'status:cross', label: 'Cross-account', sublabel: 'Tokens reused across distinct users — strongest abuse signal', count: buckets.cross.length, devices: buckets.cross })
    }
    if (buckets.flagged.length > 0) {
      out.push({ key: 'status:flagged', label: 'Flagged', sublabel: 'Heuristically suspicious — review before clearing', count: buckets.flagged.length, devices: buckets.flagged })
    }
    if (buckets.tracked.length > 0) {
      out.push({ key: 'status:tracked', label: 'Tracked', sublabel: 'No abuse signals — listed for completeness', count: buckets.tracked.length, devices: buckets.tracked })
    }
    return out
  }, [devices, groupBy])

  const eventGroups = useMemo(() => groupEvents(events), [events])
  const collapsedCount = events.length - eventGroups.length

  const stats = useMemo(() => {
    const flagged = allDevices.filter((d) => d.flagged_as_suspicious).length
    const crossAccount = allDevices.filter((d) => d.cross_account_flagged).length
    const totalReports = allDevices.reduce((sum, d) => sum + d.report_count, 0)
    return { total: allDevices.length, flagged, crossAccount, totalReports }
  }, [allDevices])

  const antiGamingAction = useNextBestAction({
    scope: 'anti-gaming',
    flaggedLastHour: stats.flagged,
    blockedIps: stats.crossAccount,
  })

  // Today-vs-7d-avg delta on each KPI: derived from device.created_at (tracked,
  // flagged, cross-account) and device.report_count_today is not stored, so the
  // reports KPI gets a static delta. surface direction of
  // travel without waiting on a server-side rollup.
  const deltas = useMemo(() => buildDeltas(allDevices, events), [allDevices, events])

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

  function flag(deviceId: string) {
    setFlagTarget(deviceId)
  }

  async function commitFlag(reason: string) {
    if (!flagTarget) return
    const deviceId = flagTarget
    setBusy(deviceId)
    setFlagTarget(null)
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
        <ConfigHelp helpId="anti-gaming.flagged_filter" />
        <Btn variant="ghost" size="sm" onClick={reloadAll}>Refresh</Btn>
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          Protect intake quality — throttle bad-faith reporters, quarantine spam, and audit reward eligibility.
        </p>
      </ContainedBlock>

      {(() => {
        // Anti-gaming severity is largely driven by cross-account fingerprints
        // (a flagged account is ambiguous — could be a false positive; a
        // cross-account IP is almost certainly abuse).
        const antiGamingSeverity: 'crit' | 'warn' | 'ok' =
          stats.crossAccount > 0 ? 'crit' : stats.flagged > 0 ? 'warn' : 'ok'
        return (
          <>
            <PageHero
              scope="anti-gaming"
              title="Anti-Gaming"
              kicker="Intake integrity"
              decide={{
                label:
                  stats.crossAccount > 0
                    ? 'Cross-account abuse detected'
                    : stats.flagged > 0
                      ? 'Flagged devices need review'
                      : 'Intake is clean',
                metric: `${stats.flagged} flagged · ${stats.crossAccount} cross-account`,
                summary:
                  antiGamingSeverity === 'crit'
                    ? 'Cross-account fingerprints almost always mean reward farming — quarantine now.'
                    : antiGamingSeverity === 'warn'
                      ? 'Review flagged devices to confirm abuse or unflag false positives.'
                      : `${stats.total} device${stats.total === 1 ? '' : 's'} tracked · ${stats.totalReports} reports.`,
                severity: antiGamingSeverity,
                anchor: 'anti-gaming:decide',
                evidence: {
                  kind: 'metric-breakdown',
                  items: [
                    { label: 'Tracked', value: stats.total, tone: 'neutral' },
                    { label: 'Flagged', value: stats.flagged, tone: stats.flagged > 0 ? 'warn' : 'ok' },
                    { label: 'Cross-account', value: stats.crossAccount, tone: stats.crossAccount > 0 ? 'crit' : 'ok' },
                    { label: 'Reports', value: stats.totalReports, tone: 'neutral' },
                  ],
                },
              }}
              act={antiGamingAction}
              actAnchor="anti-gaming:act"
              actEvidence={antiGamingAction ? { kind: 'rule-trace', why: antiGamingAction.reason ?? antiGamingAction.title, threshold: stats.crossAccount > 0 ? `${stats.crossAccount} cross-account` : stats.flagged > 0 ? `${stats.flagged} flagged` : undefined } : undefined}
              verify={{
                label: 'Latest enforcement activity',
                detail:
                  events.length > 0
                    ? `${events.length} recent event${events.length === 1 ? '' : 's'} · ${collapsedCount} collapsed`
                    : 'No enforcement actions yet',
                to: '/audit?source=anti-gaming',
                anchor: 'anti-gaming:verify',
                evidence: events.length > 0 ? {
                  kind: 'last-event',
                  at: events[0].created_at,
                  by: events[0].event_type,
                  payloadSummary: events[0].reason ?? events[0].reporter_token_hash.slice(0, 12) + '…',
                  status: events[0].event_type === 'unflag' ? 'ok' : 'warn',
                } : undefined,
              }}
            />
            <div data-dav-anchor="anti-gaming:act">
              <PageActionBar scope="anti-gaming" action={antiGamingAction} />
            </div>

            {(stats.crossAccount > 0 || stats.flagged > 0) && (
              <Card
                className={`space-y-3 p-4 ${
                  stats.crossAccount > 0 ? 'border-danger/30 bg-danger/5' : 'border-warn/30 bg-warn/5'
                }`}
              >
                <SignalChip tone={stats.crossAccount > 0 ? 'danger' : 'warn'}>
                  Needs attention
                </SignalChip>
                <ContainedBlock tone="warn">
                  <p className="text-xs font-medium leading-snug text-fg">
                    {stats.crossAccount > 0
                      ? `${stats.crossAccount} cross-account fingerprint${stats.crossAccount === 1 ? '' : 's'} — review and quarantine reward farming.`
                      : `${stats.flagged} flagged device${stats.flagged === 1 ? '' : 's'} need review.`}
                  </p>
                </ContainedBlock>
                <ActionPillRow>
                  <ActionPill
                    onClick={() => {
                      setFilter('flagged')
                      setSearch('')
                    }}
                    tone="brand"
                  >
                    Review flagged →
                  </ActionPill>
                  <ActionPill to="/audit?source=anti-gaming" tone="neutral">
                    Audit log
                  </ActionPill>
                </ActionPillRow>
              </Card>
            )}
          </>
        )
      })()}

      <PageHelp
        title="About Anti-Gaming"
        whatIsIt="Detects abusive reporters: the same device fingerprint registering many distinct reporter tokens (multi-account), or a single token submitting too many reports in a short window (velocity anomaly). Device fingerprint is derived server-side from IP + User-Agent and supplemented by an SDK-supplied stable hash."
        useCases={[
          'Block reward farming on gamified deployments',
          'Identify scripted submission attempts',
          'Stop a single misconfigured client from polluting the report queue',
        ]}
        howToUse="Where this fits the loop — Plan stage. Junk intake here pollutes every downstream stage (classify, judge, fix). Flagged reports are still ingested but marked. Use Unflag after verifying a false positive (shared NAT, dev test accounts) or Flag manually after confirming abuse. The event log shows every decision for SOC 2 audit. Reporter token + device fingerprint are generated by the SDK — see packages/web/README.md#reporter-token for how to wire that on the client."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-dav-anchor="anti-gaming:decide">
        <KpiTile
          label="Tracked devices"
          value={stats.total}
          delta={deltas.tracked}
          meaning="Distinct device fingerprints the SDK has seen submitting reports. A growing number means broader reach; a flat one means the SDK isn't installed widely."
        />
        <KpiTile
          label="Flagged"
          value={stats.flagged}
          accent={stats.flagged > 0 ? 'danger' : undefined}
          delta={deltas.flagged}
          meaning="Devices our heuristics or you have marked as abusive. Their reports still ingest but won't dispatch fixes automatically."
        />
        <KpiTile
          label="Cross-account"
          value={stats.crossAccount}
          accent={stats.crossAccount > 0 ? 'warn' : undefined}
          delta={deltas.crossAccount}
          meaning="Devices that have submitted reports under more than one reporter token in the same window. A common abuse signal — but also fires for shared NAT."
        />
        <KpiTile
          label="Total reports"
          value={stats.totalReports}
          meaning="Cumulative reports ingested from any tracked device. Compare against the dashboard's 14d intake to see if abuse is inflating volume."
        />
        {/* Mushi Bounties: 3rd KPI — tester redemptions awaiting manual review */}
        <KpiTile
          label="Tester redemptions withheld"
          value={withheldCount}
          accent={withheldCount > 0 ? 'warn' : undefined}
          meaning="Mushi Bounties gift-card redemptions paused for manual review (velocity cap exceeded or anti-fraud flag). Approve or deny below."
        />
      </div>

      {/* Mushi Bounties: withheld tester redemptions review section */}
      {withheldCount > 0 && (
        <Section title={`🪲 Withheld tester redemptions (${withheldCount})`} icon={undefined}>
          <p className="text-2xs text-fg-muted mb-3">
            These gift-card redemptions were paused by the anti-fraud engine.
            Review each one and approve or deny.
          </p>
          <div className="space-y-2">
            {withheldRedemptions.map((r) => (
              <WithheldRedemptionRow
                key={r.id}
                redemption={r}
                onAction={withheldRedemptionsQuery.reload}
              />
            ))}
          </div>
        </Section>
      )}

      <Section
        title={
          (filter === 'flagged' ? 'Flagged devices' : 'All tracked devices') +
          (search ? ` · ${devices.length}/${allDevices.length} match "${search}"` : '')
        }
        action={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <SegmentedControl<DeviceGroupBy>
              size="sm"
              ariaLabel="Group devices by"
              label="Group"
              value={groupBy}
              options={DEVICE_GROUP_OPTIONS}
              onChange={(next) => {
                setGroupBy(next)
                resetCollapsed()
              }}
            />
            <Input
              placeholder="Search fingerprint, token, IP, reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
        }
      >
        {loading ? (
          <TableSkeleton rows={6} columns={4} showFilters={false} label="Loading devices" />
        ) : error ? (
          <ErrorAlert
            message={`Failed to load ${merged.failedLabel ?? 'data'}: ${error}`}
            onRetry={merged.retry}
          />
        ) : devices.length === 0 ? (
          search ? (
            <EmptySectionMessage
              text="No devices match this search."
              hint="Try a different fingerprint, token, or IP fragment."
            />
          ) : filter === 'flagged' ? (
            <EmptySectionMessage
              text="No flagged devices."
              hint="Switch to All to inspect every tracked device, or wait for the detector to fire."
            />
          ) : (
            <SetupNudge
              requires={['first_report_received']}
              emptyTitle="No tracked devices yet"
              emptyDescription="Devices appear here once a reporter submits at least one report from them."
            />
          )
        ) : (
          <div className="space-y-2">
            {deviceGroups.map((group) => {
              // In flat mode there's only one synthetic group with the
              // same count as the visible list — drop the header chrome
              // entirely so the layout stays identical to the pre-grouping
              // experience for users who don't change the axis.
              const showHeader = groupBy !== 'flat'
              const isCollapsed = showHeader && collapsedGroups.has(group.key)
              return (
                <div key={group.key} className="space-y-1">
                  {showHeader && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`group-body-${group.key}`}
                      className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left bg-surface-raised/40 border border-edge-subtle/60 hover:bg-surface-raised motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <span aria-hidden="true" className="text-fg-faint font-mono text-2xs leading-none w-3 inline-block">
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                      <span className="font-mono text-xs text-fg truncate">{group.label}</span>
                      <Badge className="bg-surface-overlay text-fg-muted text-3xs">{group.count}</Badge>
                      {group.sublabel && (
                        <SignalChip tone="neutral" className="truncate max-w-[12rem]">
                          {group.sublabel}
                        </SignalChip>
                      )}
                    </button>
                  )}
                  {!isCollapsed && (
                    <div id={`group-body-${group.key}`} className={`space-y-1 ${showHeader ? 'pl-4 border-l border-edge-subtle/60 ml-2' : ''}`}>
                      {group.devices.map((d) => (
                        <DeviceCard
                          key={d.id}
                          device={d}
                          isExpanded={expanded === d.id}
                          isBusy={busy === d.id}
                          onToggleExpand={() => setExpanded(expanded === d.id ? null : d.id)}
                          onFlag={() => flag(d.id)}
                          onUnflag={() => unflag(d.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <div data-dav-anchor="anti-gaming:verify">
      <Section
        title={
          aggregateEvents && collapsedCount > 0
            ? `Recent events · ${eventGroups.length} groups · ${collapsedCount} duplicates collapsed`
            : 'Recent events'
        }
        action={
          <div className="flex items-center gap-2">
            <ContainedBlock tone="muted" className="inline-flex items-center gap-1.5 py-1 px-2">
              <label className="inline-flex items-center gap-1.5 text-2xs text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={aggregateEvents}
                  onChange={(e) => setAggregateEvents(e.target.checked)}
                  className="h-3 w-3 accent-brand"
                />
                Group identical
                <ConfigHelp helpId="anti-gaming.aggregate_identical" />
              </label>
            </ContainedBlock>
            <FilterSelect
              label="Type"
              value={eventFilter}
              options={EVENT_TYPE_OPTIONS}
              onChange={(e) => setEventFilter(e.currentTarget.value)}
            />
          </div>
        }
      >
        {events.length === 0 ? (
          <EmptySectionMessage
            text="No anti-gaming events yet."
            hint={eventFilter ? 'Try a different event type.' : 'Events appear when devices are flagged or unflagged.'}
          />
        ) : aggregateEvents ? (
          <div className="space-y-0.5 font-mono text-2xs">
            {eventGroups.map((g) => {
              const isOpen = expandedEventGroup === g.key
              const isRecurring = g.count > 1
              const tokTip = `Reporter token hash ${g.reporter_token_hash}`
              return (
                <div key={g.key} className="rounded-sm hover:bg-surface-overlay/40">
                  <button
                    type="button"
                    onClick={() => isRecurring && setExpandedEventGroup(isOpen ? null : g.key)}
                    aria-expanded={isOpen}
                    disabled={!isRecurring}
                    className="w-full flex items-center gap-2 px-2 py-1 text-left disabled:cursor-default"
                  >
                    <span title={`First: ${new Date(g.first_at).toLocaleString()}\nLast: ${new Date(g.last_at).toLocaleString()}`}>
                      <SignalChip tone="neutral" className="w-32 truncate font-mono tabular-nums">
                        {new Date(g.last_at).toLocaleString()}
                      </SignalChip>
                    </span>
                    <Badge className={EVENT_BADGE[g.event_type]}>{g.event_type}</Badge>
                    {isRecurring && (
                      <Badge className="bg-surface-raised text-fg-muted border border-edge-subtle">
                        ×{g.count}
                      </Badge>
                    )}
                    <span className="text-fg-secondary truncate flex-1">{g.reason ?? '—'}</span>
                    <span title={tokTip}>
                      <SignalChip tone="neutral" className="shrink-0 max-w-32 truncate font-mono">
                        tok:{g.reporter_token_hash.slice(0, 8)}…
                      </SignalChip>
                    </span>
                    {g.ip_address && (
                      <SignalChip tone="neutral" className="shrink-0 font-mono">
                        {g.ip_address}
                      </SignalChip>
                    )}
                    {isRecurring && (
                      <span className="text-fg-faint shrink-0 text-3xs">{isOpen ? '▾' : '▸'}</span>
                    )}
                  </button>
                  {isOpen && isRecurring && (
                    <ContainedBlock tone="muted" className="mx-2 mb-2 ml-32 space-y-1">
                      {events
                        .filter((e) => g.ids.includes(e.id))
                        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                        .map((e) => (
                          <InlineProof key={e.id} className="font-mono text-3xs border-0 bg-transparent px-0 py-0">
                            {new Date(e.created_at).toLocaleString()} · evt:{e.id.slice(0, 8)}
                          </InlineProof>
                        ))}
                    </ContainedBlock>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-0.5 font-mono text-2xs">
            {events.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40">
                <SignalChip tone="neutral" className="w-32 truncate font-mono tabular-nums">
                  {new Date(e.created_at).toLocaleString()}
                </SignalChip>
                <Badge className={EVENT_BADGE[e.event_type]}>{e.event_type}</Badge>
                <span className="text-fg-secondary truncate flex-1">{e.reason ?? '—'}</span>
                <SignalChip tone="neutral" className="shrink-0 max-w-32 truncate font-mono">
                  tok:{e.reporter_token_hash.slice(0, 8)}…
                </SignalChip>
                {e.ip_address && (
                  <SignalChip tone="neutral" className="shrink-0 font-mono">
                    {e.ip_address}
                  </SignalChip>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      </div>

      {flagTarget && (
        <PromptDialog
          title="Flag this device?"
          body="Captured in the audit trail for compliance + future reviewers. Flagged devices stop earning rewards immediately."
          label="Reason"
          defaultValue="Suspicious activity confirmed"
          confirmLabel="Flag device"
          loading={busy === flagTarget}
          validate={(v) => (v.length >= 4 ? null : 'Give a short reason (≥4 chars).')}
          onConfirm={commitFlag}
          onCancel={() => setFlagTarget(null)}
        />
      )}
    </div>
  )
}

/* ── Device-list helpers ──────────────────────────────────────────────── */

const DEVICE_GROUP_OPTIONS = [
  { id: 'flat' as const, label: 'Flat' },
  { id: 'ip' as const, label: 'IP' },
  { id: 'date' as const, label: 'Date' },
  { id: 'status' as const, label: 'Status' },
] as const

interface DeviceCardProps {
  device: ReporterDevice
  isExpanded: boolean
  isBusy: boolean
  onToggleExpand: () => void
  onFlag: () => void
  onUnflag: () => void
}

/**
 * Single device row, extracted into a stable component so the parent's
 * grouping logic doesn't have to re-create the same JSX inside every
 * group section. The visual contract is unchanged from the pre-grouping
 * version — the only addition is that it now lives inside an indented
 * group track when grouping is active (the rule is rendered by the
 * parent so this component stays grouping-agnostic).
 */
function DeviceCard({ device: d, isExpanded, isBusy, onToggleExpand, onFlag, onUnflag }: DeviceCardProps) {
  return (
    <Card className="overflow-hidden">
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
              <div className="flex flex-wrap items-center gap-1.5">
                <SignalChip tone="neutral">{pluralizeWithCount(d.reporter_tokens.length, 'token')}</SignalChip>
                <SignalChip tone="info">{pluralizeWithCount(d.ip_addresses.length, 'IP')}</SignalChip>
                <SignalChip tone="brand">{pluralizeWithCount(d.report_count, 'report')}</SignalChip>
                {d.distinct_user_count > 0 ? (
                  <SignalChip tone="warn">{pluralizeWithCount(d.distinct_user_count, 'distinct user')}</SignalChip>
                ) : null}
              </div>
            </div>
            {d.flag_reason && (
              <ContainedBlock tone="warn" className="mt-2">
                <p className="text-xs text-danger leading-relaxed max-w-prose wrap-break-word text-pretty">{d.flag_reason}</p>
              </ContainedBlock>
            )}
            <InlineProof className="mt-2">
              First seen {new Date(d.created_at).toLocaleString()} · last activity {new Date(d.updated_at).toLocaleString()}
            </InlineProof>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip content={isExpanded ? 'Collapse' : 'Details'}>
              <Btn
                variant="ghost"
                size="sm"
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse device details' : 'Show device details'}
                className="px-2"
              >
                {isExpanded ? <IconChevronUp size={14} /> : <IconEye size={14} />}
              </Btn>
            </Tooltip>
            {d.flagged_as_suspicious ? (
              <Tooltip content="Unflag device">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={onUnflag}
                  disabled={isBusy}
                  loading={isBusy}
                  aria-label="Unflag device"
                  className="px-2 text-fg-muted hover:text-ok"
                >
                  <IconFlagOff size={14} />
                </Btn>
              </Tooltip>
            ) : (
              <Tooltip content="Flag as suspicious">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={onFlag}
                  disabled={isBusy}
                  loading={isBusy}
                  aria-label="Flag as suspicious"
                  className="px-2 text-fg-muted hover:text-danger"
                >
                  <IconFlag size={14} />
                </Btn>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-edge-subtle bg-surface-overlay/30 px-3 py-2 space-y-2">
          <ContainedBlock tone="muted" label={`Reporter tokens (${d.reporter_tokens.length})`}>
            <div className="flex flex-wrap gap-1">
              {d.reporter_tokens.map((t) => (
                <SignalChip key={t} tone="neutral" className="font-mono">
                  {t.slice(0, 16)}…
                </SignalChip>
              ))}
            </div>
          </ContainedBlock>
          <ContainedBlock tone="muted" label={`IP addresses (${d.ip_addresses.length})`}>
            <div className="flex flex-wrap gap-1">
              {d.ip_addresses.map((ip) => (
                <SignalChip key={ip} tone="info" className="font-mono">
                  {ip}
                </SignalChip>
              ))}
            </div>
          </ContainedBlock>
          <InlineProof className="font-mono">
            Full fingerprint: {d.device_fingerprint}
          </InlineProof>
        </div>
      )}
    </Card>
  )
}

interface AntiGamingDeltas {
  tracked: KpiDelta | null
  flagged: KpiDelta | null
  crossAccount: KpiDelta | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function buildDeltas(devices: ReporterDevice[], events: AntiGamingEvent[]): AntiGamingDeltas {
  return {
    tracked: deltaFromTimestamps(devices.map((d) => d.created_at)),
    flagged: deltaFromTimestamps(
      events
        .filter((e) => e.event_type === 'multi_account' || e.event_type === 'manual_flag')
        .map((e) => e.created_at),
      { invertTone: true },
    ),
    crossAccount: deltaFromTimestamps(
      events.filter((e) => e.event_type === 'multi_account').map((e) => e.created_at),
      { invertTone: true },
    ),
  }
}

function deltaFromTimestamps(
  timestamps: string[],
  opts: { invertTone?: boolean } = {},
): KpiDelta | null {
  if (timestamps.length === 0) return null
  const now = Date.now()
  const todayCutoff = now - DAY_MS
  const sevenDayCutoff = now - 7 * DAY_MS
  let today = 0
  let priorWindow = 0
  for (const ts of timestamps) {
    const t = new Date(ts).getTime()
    if (Number.isNaN(t)) continue
    if (t >= todayCutoff) today += 1
    else if (t >= sevenDayCutoff) priorWindow += 1
  }
  if (today === 0 && priorWindow === 0) return null
  const sevenDayAvg = priorWindow / 6
  const diff = today - sevenDayAvg
  const direction: KpiDelta['direction'] = diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : 'flat'
  // For abuse counters, "up" is bad, "down" is good. Plain counters keep the
  // natural read.
  const tone: KpiDelta['tone'] = opts.invertTone
    ? direction === 'up' ? 'danger' : direction === 'down' ? 'ok' : 'muted'
    : direction === 'up' ? 'ok' : direction === 'down' ? 'warn' : 'muted'
  const formattedDiff = Math.abs(diff) >= 1 ? Math.round(Math.abs(diff)).toString() : Math.abs(diff).toFixed(1)
  return {
    value: direction === 'flat' ? 'flat vs 7d avg' : `${formattedDiff} vs 7d avg`,
    direction,
    tone,
  }
}

// ─── Withheld tester redemption row ──────────────────────────────────────────
// Displayed in AntiGamingPage when a Mushi Bounties gift-card redemption was
// held for manual review. Reviewer can approve (→ pending, picked up by cron)
// or deny (→ failed, points refunded to tester).

function WithheldRedemptionRow({
  redemption,
  onAction,
}: {
  redemption: {
    id: string
    tester_id: string
    kind: string
    points_spent: number
    face_value_usd: number | null
    requested_at: string
    mushi_testers?: { public_handle: string | null } | null
  }
  onAction: () => void
}) {
  const toast = useToast()
  const [acting, setActing] = useState<'approve' | 'deny' | null>(null)

  const act = async (action: 'approve' | 'deny') => {
    setActing(action)
    try {
      await apiFetch(`/v1/admin/tester-redemptions/${redemption.id}/${action}`, { method: 'POST' })
      toast.success(action === 'approve' ? 'Redemption approved' : 'Redemption denied — points refunded')
      onAction()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(null)
    }
  }

  const handle = redemption.mushi_testers?.public_handle ?? redemption.tester_id.slice(0, 8)

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">@{handle}</span>
          <Badge tone="warn" size="xs">{redemption.kind.replace(/_/g, ' ')}</Badge>
          {redemption.face_value_usd && (
            <span className="text-xs text-fg-secondary">${redemption.face_value_usd} gift card</span>
          )}
          <span className="text-2xs text-fg-faint">{redemption.points_spent.toLocaleString()} pts</span>
        </div>
        <p className="text-2xs text-fg-faint">
          Requested {new Date(redemption.requested_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        <Btn size="sm" variant="primary" disabled={!!acting} onClick={() => act('approve')}>
          {acting === 'approve' ? '…' : 'Approve'}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={!!acting} onClick={() => act('deny')}>
          {acting === 'deny' ? '…' : 'Deny'}
        </Btn>
      </div>
    </div>
  )
}
