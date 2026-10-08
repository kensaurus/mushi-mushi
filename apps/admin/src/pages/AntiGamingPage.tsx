/**
 * FILE: apps/admin/src/pages/AntiGamingPage.tsx
 * PURPOSE: Surfaces multi-account / velocity / cross-account abuse detection.
 *          Lets admins inspect, search, expand, manually flag, and unflag
 *          devices, plus filter the audit-grade event log.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { refreshNavCounts } from '../lib/useNavCounts'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { useEntitlements } from '../lib/useEntitlements'
import { useToast } from '../lib/toast'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { AntiGamingStatusBanner } from '../components/anti-gaming/AntiGamingStatusBanner'
import {
  EMPTY_ANTI_GAMING_STATS,
  type AntiGamingStats,
  type AntiGamingTabId,
} from '../components/anti-gaming/AntiGamingStatsTypes'
import {
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
import { KpiTile } from '../components/charts'
import { NextStep } from '../components/NextStep'
import { ConfigHelp } from '../components/ConfigHelp'
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog'
import { plainApiError } from '../lib/humanizeApiError'
import { useMergedErrors } from '../lib/useMergedErrors'
import { pluralizeWithCount } from '../lib/format'
import { IconEye, IconChevronUp, IconFlag, IconFlagOff, IconRewards } from '../components/icons'
import {
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { CHIP_TONE } from '../lib/chipTone'
import { shortReporterKey } from '../lib/reporterKey'

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
  multi_account: CHIP_TONE.warnSubtle,
  velocity_anomaly: CHIP_TONE.dangerSubtle,
  manual_flag: CHIP_TONE.dangerSubtle,
  unflag: CHIP_TONE.okSubtle,
}

const EVENT_TYPE_OPTIONS = ['', 'multi_account', 'velocity_anomaly', 'manual_flag', 'unflag']

interface EventGroup {
  /** Tuple key: `${event_type}|${reason ?? ''}|${ip_address ?? ''}|${day}` */
  key: string
  event_type: AntiGamingEvent['event_type']
  reason: string | null
  /** Distinct reporter token hashes behind the group's events. */
  tokens: string[]
  ip_address: string | null
  count: number
  first_at: string
  last_at: string
  /** Underlying event ids, useful for the expanded detail view + audit trail. */
  ids: string[]
}

/**
 * Collapse identical events into one row keyed by the (event_type, reason,
 * ip_address, UTC day) tuple. The detector fires once per threshold breach,
 * and a multi-account burst carries a different token on every event, so a
 * key that included the token left dozens of identical rows. Each group keeps
 * its distinct tokens and every event id for SOC-2 traceability.
 *
 * Events are returned newest-first by their last occurrence so the most
 * active groups bubble to the top.
 */
function groupEvents(events: AntiGamingEvent[]): EventGroup[] {
  const map = new Map<string, EventGroup>()
  for (const e of events) {
    const key = `${e.event_type}|${e.reason ?? ''}|${e.ip_address ?? ''}|${e.created_at.slice(0, 10)}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      existing.ids.push(e.id)
      if (!existing.tokens.includes(e.reporter_token_hash)) existing.tokens.push(e.reporter_token_hash)
      if (e.created_at < existing.first_at) existing.first_at = e.created_at
      if (e.created_at > existing.last_at) existing.last_at = e.created_at
    } else {
      map.set(key, {
        key,
        event_type: e.event_type,
        reason: e.reason,
        tokens: [e.reporter_token_hash],
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

/** Event rows shown before "Show all". */
const EVENT_PREVIEW_ROWS = 10

export function AntiGamingPage() {
  const toast = useToast()
  const projectId = useActiveProjectId()
  const {
    data: shellStatsData,
    reload: reloadShellStats,
    isValidating: shellValidating,
  } = usePageData<AntiGamingStats>(
    projectId ? `/v1/admin/anti-gaming/stats?project_id=${projectId}` : null,
    { deps: [projectId] },
  )
  const shellStats = shellStatsData ?? EMPTY_ANTI_GAMING_STATS
  // The device filter lives in the URL so the status banner's links
  // (?filter=flagged, ?tab=events) and shared links actually do something.
  const [searchParams, setSearchParams] = useSearchParams()
  const filter: 'flagged' | 'all' = searchParams.get('filter') === 'all' ? 'all' : 'flagged'
  const setFilter = useCallback(
    (next: 'flagged' | 'all') => {
      setSearchParams(
        (prev) => {
          const qs = new URLSearchParams(prev)
          qs.set('filter', next)
          return qs
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setSearchParams],
  )
  const tabParam = searchParams.get('tab')
  const [unflagTarget, setUnflagTarget] = useState<string | null>(null)
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flagTarget, setFlagTarget] = useState<string | null>(null)
  const [aggregateEvents, setAggregateEvents] = useState(true)
  const [expandedEventGroup, setExpandedEventGroup] = useState<string | null>(null)
  const [showAllEvents, setShowAllEvents] = useState(false)
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

  // Scoped to the active project so the list matches the KPI tiles above.
  const deviceParams = new URLSearchParams()
  if (filter === 'flagged') deviceParams.set('flagged', 'true')
  if (projectId) deviceParams.set('project_id', projectId)
  const devicesQs = deviceParams.toString()
  const devicesPath = `/v1/admin/anti-gaming/devices${devicesQs ? `?${devicesQs}` : ''}`
  const devicesQuery = usePageData<{ devices: ReporterDevice[] }>(devicesPath, { deps: [filter, projectId] })
  const eventParams = new URLSearchParams()
  if (eventFilter) eventParams.set('event_type', eventFilter)
  if (projectId) eventParams.set('project_id', projectId)
  const eventsQs = eventParams.toString()
  const eventsQuery = usePageData<{ events: AntiGamingEvent[] }>(
    `/v1/admin/anti-gaming/events${eventsQs ? `?${eventsQs}` : ''}`,
    { deps: [eventFilter, projectId] },
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
    reloadShellStats()
  }, [devicesQuery, eventsQuery, reloadShellStats])

  // Mushi Bounties: fetch withheld tester redemptions for the 3rd KPI tile.
  // The route is platform-wide and super-admin only (404 for everyone else),
  // so project owners skip the call and the tile instead of logging a 404.
  const { isSuperAdmin } = useEntitlements()
  const withheldRedemptionsQuery = usePageData<{ count: number; items: Array<{
    id: string
    tester_id: string
    kind: string
    points_spent: number
    face_value_usd: number | null
    requested_at: string
    mushi_testers?: { public_handle: string | null } | null
  }> }>(isSuperAdmin ? '/v1/admin/tester-redemptions/withheld' : null)
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
  const eventRowCount = aggregateEvents ? eventGroups.length : events.length
  const visibleEventGroups = showAllEvents ? eventGroups : eventGroups.slice(0, EVENT_PREVIEW_ROWS)
  const visibleEvents = showAllEvents ? events : events.slice(0, EVENT_PREVIEW_ROWS)

  // Counts come from the same project-scoped stats as the status banner. The
  // device list spans every owned project and, under the default "flagged"
  // filter, holds only flagged devices, so counting it showed "16 flagged"
  // under a banner saying "4 flagged" and made Tracked equal Flagged. Its
  // per-period deltas came from that population too, so they are gone.
  const stats = {
    total: shellStats.trackedDevices,
    flagged: shellStats.flaggedDevices,
    crossAccount: shellStats.crossAccountDevices,
    totalReports: shellStats.totalReports,
  }

  // Unflag also clears the cross-account flag, so it is confirmed first.
  function unflag(deviceId: string) {
    setUnflagTarget(deviceId)
  }

  async function commitUnflag() {
    const deviceId = unflagTarget
    if (!deviceId) return
    setBusy(deviceId)
    try {
      const res = await apiFetch(`/v1/admin/anti-gaming/devices/${deviceId}/unflag`, { method: 'POST' })
      if (!res.ok) {
        toast.error('Could not unflag device', plainApiError(res.error, 'Try again in a moment.'))
        return
      }
      toast.success('Device unflagged')
      reloadAll()
      refreshNavCounts()
    } catch (err) {
      toast.error('Could not unflag device', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setUnflagTarget(null)
    }
  }

  // Banner buttons act on this page instead of only changing the URL.
  const goToSection = useCallback(
    (tab: AntiGamingTabId) => {
      if (tab === 'events') {
        document.getElementById('anti-gaming-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      const showFlagged = shellStats.topPriority === 'cross_account' || shellStats.topPriority === 'flagged'
      setFilter(showFlagged ? 'flagged' : 'all')
      setSearch('')
      document.getElementById('anti-gaming-devices')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [setFilter, shellStats.topPriority],
  )

  // Deep link: /anti-gaming?tab=events lands on the event log.
  useEffect(() => {
    if (tabParam !== 'events' || loading) return
    document.getElementById('anti-gaming-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [tabParam, loading])

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
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-anti-gaming">
      <PageHeaderBar
        title="Spam & abuse"

        helpTitle="About Spam & abuse"
        helpWhatIsIt="Detects abusive reporters: the same device fingerprint registering many distinct reporter tokens (multi-account), or a single token submitting too many reports in a short window (velocity anomaly). Device fingerprint is derived server-side from IP + User-Agent and supplemented by an SDK-supplied stable hash."
        helpUseCases={[
          'Block reward farming on gamified deployments',
          'Identify scripted submission attempts',
          'Stop a single misconfigured client from polluting the report queue',
        ]}
        helpHowToUse="Where this fits the loop — Plan stage. Junk intake here pollutes every downstream stage (classify, judge, fix). Flagged reports are still ingested but marked. Use Unflag after verifying a false positive (shared NAT, dev test accounts) or Flag manually after confirming abuse. The event log shows every decision for SOC 2 audit. Reporter token + device fingerprint are generated by the SDK — see packages/web/README.md#reporter-token for how to wire that on the client."
      >
        <FilterSelect
          label="Show"
          value={filter}
          options={['flagged', 'all']}
          onChange={(e) => setFilter(e.currentTarget.value as 'flagged' | 'all')}
        />
        <ConfigHelp helpId="anti-gaming.flagged_filter" />
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <AntiGamingStatusBanner
                stats={shellStats}
                onTab={goToSection}
                onRefresh={reloadAll}
                refreshing={loading || shellValidating}
              />
            ),
          },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-dav-anchor="anti-gaming:decide">
        <KpiTile
          label="Tracked devices"
          value={stats.total}
          meaning="Distinct device fingerprints the SDK has seen submitting reports. A growing number means broader reach; a flat one means the SDK isn't installed widely."
        />
        <KpiTile
          label="Flagged"
          value={stats.flagged}
          accent={stats.flagged > 0 ? 'danger' : undefined}
          meaning="Devices our heuristics or you have marked as abusive. Their reports still ingest but won't dispatch fixes automatically."
        />
        <KpiTile
          label="Cross-account"
          value={stats.crossAccount}
          accent={stats.crossAccount > 0 ? 'warn' : undefined}
          meaning="Devices that have submitted reports under more than one reporter token in the same window. A common abuse signal — but also fires for shared NAT."
        />
        <KpiTile
          label="Total reports"
          value={stats.totalReports}
          meaning="Cumulative reports ingested from any tracked device. Compare against the dashboard's 14d intake to see if abuse is inflating volume."
        />
      </div>

      {/* Mushi Bounties (super-admin only): withheld tester redemptions. The
          count lives here rather than as a fifth tile that wrapped alone. */}
      {withheldCount > 0 && (
        <Section title={`Withheld tester redemptions (${withheldCount})`} icon={<IconRewards />}>
          <p className="text-2xs text-fg-muted mb-3">
            Mushi Bounties gift-card redemptions paused by the anti-fraud engine (velocity cap
            exceeded or an anti-fraud flag). Review each one and approve or deny.
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

      <div id="anti-gaming-devices" className="scroll-mt-4">
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
            <NextStep
              variant="inline"
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
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`group-body-${group.key}`}
                      className="w-full flex items-center gap-2 justify-start rounded-sm px-2 py-1.5 text-left bg-surface-raised border-edge-subtle/60 hover:bg-surface-overlay"
                    >
                      <span aria-hidden="true" className="text-fg-faint font-mono text-2xs leading-none w-3 inline-block">
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                      <span className="font-mono text-xs text-fg truncate">{group.label}</span>
                      <Badge className="bg-surface-overlay text-fg-muted text-3xs">{group.count}</Badge>
                      {group.sublabel && (
                        <SignalChip tone="neutral" className="truncate max-w-48">
                          {group.sublabel}
                        </SignalChip>
                      )}
                    </Btn>
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
      </div>

      <div data-dav-anchor="anti-gaming:verify" id="anti-gaming-events" className="scroll-mt-4">
      <Section
        title={
          aggregateEvents && collapsedCount > 0
            ? `Recent events · ${eventGroups.length} groups · ${collapsedCount} duplicates collapsed`
            : 'Recent events'
        }
        action={
          <div className="flex items-center gap-2">
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
            {visibleEventGroups.map((g) => {
              const isOpen = expandedEventGroup === g.key
              const isRecurring = g.count > 1
              const tokTip = `Reporter token hash${g.tokens.length === 1 ? '' : 'es'} ${g.tokens.join(', ')}`
              return (
                <div key={g.key} className="rounded-sm hover:bg-surface-overlay/40">
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => isRecurring && setExpandedEventGroup(isOpen ? null : g.key)}
                    aria-expanded={isOpen}
                    disabled={!isRecurring}
                    className="w-full flex items-center gap-2 justify-start px-2 py-1 text-left border-0 bg-transparent shadow-none hover:bg-transparent disabled:cursor-default"
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
                        {g.tokens.length === 1
                          ? `tok:${shortReporterKey(g.tokens[0])}…`
                          : `${g.tokens.length} tokens`}
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
                  </Btn>
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
            {visibleEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40">
                <SignalChip tone="neutral" className="w-32 truncate font-mono tabular-nums">
                  {new Date(e.created_at).toLocaleString()}
                </SignalChip>
                <Badge className={EVENT_BADGE[e.event_type]}>{e.event_type}</Badge>
                <span className="text-fg-secondary truncate flex-1">{e.reason ?? '—'}</span>
                <SignalChip tone="neutral" className="shrink-0 max-w-32 truncate font-mono">
                  tok:{shortReporterKey(e.reporter_token_hash)}…
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
        {eventRowCount > EVENT_PREVIEW_ROWS ? (
          <div className="mt-2">
            <Btn variant="ghost" size="sm" onClick={() => setShowAllEvents((v) => !v)}>
              {showAllEvents ? `Show first ${EVENT_PREVIEW_ROWS}` : `Show all ${eventRowCount}`}
            </Btn>
          </div>
        ) : null}
      </Section>
      </div>

      {unflagTarget && (
        <ConfirmDialog
          title="Unflag this device?"
          body="Its reports will count normally again and it can earn rewards. This also clears its cross-account flag. Only unflag after checking it was a false alarm (shared office network, a test account)."
          confirmLabel="Unflag device"
          tone="danger"
          loading={busy === unflagTarget}
          onConfirm={commitUnflag}
          onCancel={() => setUnflagTarget(null)}
        />
      )}

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
                <Badge tone="dangerSubtle">cross-account</Badge>
              )}
              {d.flagged_as_suspicious && !d.cross_account_flagged && (
                <Badge tone="dangerSubtle">flagged</Badge>
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
  // Approve releases a real gift card; deny refunds the points. Both are
  // confirmed so a mis-click cannot pay out or reverse a payout.
  const [confirming, setConfirming] = useState<'approve' | 'deny' | null>(null)

  const act = async (action: 'approve' | 'deny') => {
    setActing(action)
    try {
      const res = await apiFetch(`/v1/admin/tester-redemptions/${redemption.id}/${action}`, { method: 'POST' })
      if (!res.ok) {
        toast.error(plainApiError(res.error, action === 'approve' ? 'Could not approve the redemption.' : 'Could not deny the redemption.'))
        return
      }
      toast.success(action === 'approve' ? 'Redemption approved' : 'Redemption denied — points refunded')
      onAction()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(null)
      setConfirming(null)
    }
  }

  const handle = redemption.mushi_testers?.public_handle ?? 'unknown tester'
  const value = redemption.face_value_usd ? `$${redemption.face_value_usd} ` : ''

  return (
    <Card  className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">@{handle}</span>
          <Badge tone="warnSubtle">{redemption.kind.replace(/_/g, ' ')}</Badge>
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
        <Btn size="sm" variant="primary" disabled={!!acting} onClick={() => setConfirming('approve')}>
          {acting === 'approve' ? '…' : 'Approve'}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={!!acting} onClick={() => setConfirming('deny')}>
          {acting === 'deny' ? '…' : 'Deny'}
        </Btn>
      </div>
      {confirming && (
        <ConfirmDialog
          title={confirming === 'approve' ? `Release this ${value}redemption?` : 'Deny this redemption?'}
          body={
            confirming === 'approve'
              ? `@${handle} will receive it. A gift card is ordered for real and cannot be taken back.`
              : `@${handle} gets their ${redemption.points_spent.toLocaleString()} points back and the redemption is cancelled.`
          }
          confirmLabel={confirming === 'approve' ? 'Release redemption' : 'Deny and refund'}
          tone={confirming === 'approve' ? 'default' : 'danger'}
          loading={acting === confirming}
          onConfirm={() => act(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Card>
  )
}
