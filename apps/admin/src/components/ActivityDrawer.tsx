/**
 * FILE: apps/admin/src/components/ActivityDrawer.tsx
 * PURPOSE: Live-updating activity drawer (fix_events realtime) with stats,
 *          time buckets, filter pills, search, and unread badge via localStorage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from './ProjectSwitcher'
import { Drawer } from './Drawer'
import { RelativeTime, Badge, EmptyState, Loading, DetailRows, type DetailRowItem, type DetailRowTone } from './ui'
import { debugLog, debugWarn } from '../lib/debug'
import { ActionPill, ActionPillRow, ContainedBlock, InlineProof, SignalChip } from './report-detail/ReportSurface'
import { EmptySectionMessage } from './report-detail/ReportClassification'

type EventKind =
  | 'dispatched'
  | 'branch'
  | 'commit'
  | 'pr_opened'
  | 'ci_resolved'
  | 'completed'
  | 'failed'
  | 'started'
  | 'ci_started'
  | 'pr_state_changed'

interface ActivityEvent {
  at: string
  kind: EventKind
  fix_attempt_id: string
  report_id: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  label: string
  detail?: string | null
  status?: 'ok' | 'fail' | 'pending'
}

const KIND_META: Record<EventKind, { glyph: string; tone: string; caption: string; family: 'fix' | 'pr' | 'ci' | 'lifecycle' }> = {
  dispatched:       { glyph: '→', tone: 'text-info',   caption: 'Dispatched',      family: 'lifecycle' },
  started:          { glyph: '→', tone: 'text-info',   caption: 'Started',         family: 'lifecycle' },
  branch:           { glyph: '⎇', tone: 'text-brand',  caption: 'Branch',          family: 'fix' },
  commit:           { glyph: '◆', tone: 'text-brand',  caption: 'Commit',          family: 'fix' },
  pr_opened:        { glyph: '↗', tone: 'text-brand',  caption: 'PR opened',       family: 'pr' },
  ci_started:       { glyph: '⟳', tone: 'text-warn',   caption: 'CI started',      family: 'ci' },
  ci_resolved:      { glyph: '✓', tone: 'text-ok',     caption: 'CI resolved',     family: 'ci' },
  pr_state_changed: { glyph: '↻', tone: 'text-info',   caption: 'PR state',        family: 'pr' },
  completed:        { glyph: '●', tone: 'text-ok',     caption: 'Completed',       family: 'lifecycle' },
  failed:           { glyph: '✕', tone: 'text-danger', caption: 'Failed',          family: 'lifecycle' },
}

const LAST_SEEN_KEY = 'mushi:activity:last-seen:v1'

function readLastSeen(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY)
    return raw ? Number(raw) || 0 : 0
  } catch {
    // Safari private mode / locked-down storage: treat as "nothing seen yet"
    // so the unread badge stays benign rather than crashing the sidebar.
    return 0
  }
}

function writeLastSeen(ts: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, String(ts))
  } catch {
    // localStorage write can fail in private mode — badge just won't
    // persist across reloads, which is a soft degradation users won't
    // notice in normal flow.
  }
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called whenever unread count changes so the top-bar trigger can
   *  light up its badge. Omit if the parent doesn't need to know. */
  onUnreadChange?: (unread: number) => void
}

type ActivityFilter = 'all' | 'fix' | 'pr' | 'failed'

const FILTERS: { id: ActivityFilter; label: string; hint: string }[] = [
  { id: 'all',    label: 'All',     hint: 'Every event in the feed' },
  { id: 'fix',    label: 'Fixes',   hint: 'Branch + commit lifecycle' },
  { id: 'pr',     label: 'PRs',     hint: 'PR opened / state changed' },
  { id: 'failed', label: 'Failed',  hint: 'Anything that landed in a failed state' },
]

// ─── Time bucketing ───────────────────────────────────────────────────────
//
// Same scheme Inbox + Reports use: anchor on "now" and walk back. The
// boundaries are stamped once per render so a long-open drawer doesn't
// silently re-shuffle events into the wrong bucket as the wall clock
// crosses midnight (we *want* them to re-bucket, but only when the
// realtime reload triggers a render — not mid-scroll).

type Bucket = 'now' | 'today' | 'yesterday' | 'week' | 'earlier'

const BUCKET_LABEL: Record<Bucket, string> = {
  now:       'Right now',
  today:     'Today',
  yesterday: 'Yesterday',
  week:      'Earlier this week',
  earlier:   'Earlier',
}

function bucketFor(at: string, now: Date): Bucket {
  const ts = new Date(at).getTime()
  const diffMs = now.getTime() - ts
  if (diffMs < 5 * 60_000) return 'now' // within last 5 minutes
  const evDate = new Date(ts)
  const isSameDay =
    evDate.getFullYear() === now.getFullYear() &&
    evDate.getMonth() === now.getMonth() &&
    evDate.getDate() === now.getDate()
  if (isSameDay) return 'today'
  // Yesterday: anywhere within the previous local day window.
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    evDate.getFullYear() === yesterday.getFullYear() &&
    evDate.getMonth() === yesterday.getMonth() &&
    evDate.getDate() === yesterday.getDate()
  if (isYesterday) return 'yesterday'
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return 'week'
  return 'earlier'
}

export function ActivityDrawer({ open, onClose, onUnreadChange }: Props) {
  const activeProjectId = useActiveProjectId()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Heartbeat: timestamp of the last successful sync (initial fetch OR
  // realtime-triggered reload). Used so an empty feed visibly says
  // "● Connected · synced 4s ago" instead of just "Quiet on the
  // pipeline" — operators were reading the empty state as "broken".
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [search, setSearch] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const lastSeenRef = useRef<number>(readLastSeen())
  // Latest-wins guard for in-flight activity fetches. If the user switches
  // projects (or realtime fires a reload) while a previous response is still
  // resolving, we drop the stale result rather than flashing the wrong feed.
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setEvents([])
      setLoading(false)
      return
    }
    setError(null)
    // Snapshot the project id at request-start; a slower response for a
    // previously active project must not overwrite state after the user
    // (or realtime reload) has switched projects.
    const requestedProjectId = activeProjectId
    debugLog('activity', 'Fetching live activity feed', {
      endpoint: `/v1/admin/repo/activity`,
      projectId: activeProjectId,
    })
    const res = await apiFetch<{ events: ActivityEvent[] }>(
      `/v1/admin/repo/activity?project_id=${encodeURIComponent(activeProjectId)}&limit=50`,
    )
    if (requestedProjectId !== activeProjectIdRef.current) return
    if (res.ok && res.data) {
      debugLog('activity', `Feed loaded — ${res.data.events.length} events`, {
        projectId: activeProjectId,
        eventCount: res.data.events.length,
      })
      setEvents(res.data.events)
      // Stamp heartbeat on every successful response (including empty
      // feeds) so the connection indicator stays trustworthy whether or
      // not anything new actually streamed in.
      setLastSyncAt(new Date().toISOString())
    } else {
      debugWarn('activity', 'Feed fetch failed', { error: res.error?.message })
      setError(res.error?.message ?? 'Failed to load activity')
    }
    setLoading(false)
  }, [activeProjectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Realtime: fix_events is the canonical stream; fix_attempts covers
  // legacy fixes that pre-date the events table. Either change triggers
  // a full reload rather than diff-merging — the response is small
  // (≤50 rows) and the API server-side-derives events for legacy rows.
  useRealtimeReload(['fix_events', 'fix_attempts'], load, { debounceMs: 400 })

  // Notify the trigger + mark everything seen when the drawer opens.
  //
  // Unread is computed inline (not via useMemo) because it depends on both
  // `events` AND `lastSeenRef.current`. A memo keyed on `events` alone would
  // hold the pre-open count after the drawer opens (which bumps the ref) and
  // then closes without new events — the badge would flash back to the old
  // value even though the user just saw everything.
  useEffect(() => {
    if (open) {
      onUnreadChange?.(0)
      if (events[0]) {
        const newest = new Date(events[0].at).getTime()
        if (newest > lastSeenRef.current) {
          lastSeenRef.current = newest
          writeLastSeen(newest)
        }
      }
      return
    }
    const unread = events.reduce(
      (count, e) => (new Date(e.at).getTime() > lastSeenRef.current ? count + 1 : count),
      0,
    )
    onUnreadChange?.(unread)
  }, [open, events, onUnreadChange])

  // ─── Derived view state ────────────────────────────────────────────────
  // Three KPIs operators ask for first when the drawer opens: total events,
  // failures (anything in `failed` kind or `fail` status), and PRs opened
  // today. Computed in one pass over the server-capped 50-row feed.
  //
  // **No time-window cutoff.** A previous version of this reducer broke
  // out of the loop once `ts < now - 7 days` to bound the scan, but the
  // input is already capped at 50 by the server-side `.limit(limit)` in
  // `query-fixes-repo.ts`, so the optimisation isn't worth the cost: it
  // (a) made the `Failed` filter chip's count diverge from the actual
  // filtered row count whenever the 50-event feed spanned more than a
  // week (low-volume projects), and (b) silently under-counted
  // `activeFixes` for any fix whose most recent event landed >7 days ago.
  // The KPI tile's hint reads "Last 50 events", which is now what we
  // actually compute.
  //
  // `activeFixes` is "fix_attempt_ids whose most-recent event is non-terminal".
  // The server returns events newest-first
  // (`packages/server/supabase/functions/api/routes/query-fixes-repo.ts`,
  // `events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())`),
  // so we walk the array in array order and treat the FIRST event we
  // encounter for a given fix_attempt_id as authoritative — every later
  // event for the same fix is by definition older. A naive add/delete
  // scan in this order would over-count: the terminal `completed`/`failed`
  // event arrives first, finds an empty set so `delete` is a no-op, then
  // older lifecycle events (`branch`, `commit`, `pr_opened`) `add` the
  // fix back as "active" even though it's actually finished.
  const kpis = useMemo(() => {
    const dayStart = (() => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    })()
    let failed = 0
    let prsToday = 0
    const seenLatest = new Set<string>()
    const fixesActive = new Set<string>()
    for (const e of events) {
      const ts = new Date(e.at).getTime()
      if (e.kind === 'failed' || e.status === 'fail') failed++
      if (e.kind === 'pr_opened' && ts >= dayStart) prsToday++
      if (!seenLatest.has(e.fix_attempt_id)) {
        seenLatest.add(e.fix_attempt_id)
        if (e.kind !== 'completed' && e.kind !== 'failed') {
          fixesActive.add(e.fix_attempt_id)
        }
      }
    }
    return {
      total: events.length,
      failed,
      prsToday,
      activeFixes: fixesActive.size,
    }
  }, [events])

  // Filter + search. Search is case-insensitive across label, branch,
  // PR number, and detail so the most common "find this PR" lookup hits
  // even when the operator types "/fix-12" or "PR 4321".
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      const meta = KIND_META[e.kind]
      if (filter === 'fix' && meta?.family !== 'fix' && meta?.family !== 'lifecycle') return false
      if (filter === 'pr' && meta?.family !== 'pr') return false
      if (filter === 'failed' && e.kind !== 'failed' && e.status !== 'fail') return false
      if (q) {
        const haystack = [
          e.label,
          e.detail ?? '',
          e.branch ?? '',
          e.pr_number ? `#${e.pr_number}` : '',
          meta?.caption ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [events, filter, search])

  // Time-bucket the filtered list so the timeline renders with sticky
  // bucket headers ("Today", "Yesterday"). `now` snapshot once per
  // render — see bucketing comment above.
  const buckets = useMemo(() => {
    const now = new Date()
    const map = new Map<Bucket, ActivityEvent[]>()
    for (const e of filtered) {
      const b = bucketFor(e.at, now)
      const list = map.get(b)
      if (list) list.push(e)
      else map.set(b, [e])
    }
    // Keep a stable order (now → today → yesterday → week → earlier).
    const order: Bucket[] = ['now', 'today', 'yesterday', 'week', 'earlier']
    return order.flatMap((b) => {
      const list = map.get(b)
      return list && list.length > 0 ? [{ bucket: b, events: list }] : []
    })
  }, [filtered])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      ariaLabel="Live activity"
      title={
        <div className="flex items-center gap-2">
          <span>Live activity</span>
          <Badge className="bg-surface-raised text-fg-secondary border border-edge">
            {events.length}
          </Badge>
        </div>
      }
      headerAction={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:underline"
          title="Reload activity feed"
        >
          Reload
        </button>
      }
    >
      <div className="px-4 py-3 space-y-3">
        {/* Connection heartbeat — visible in both empty and populated
            states so operators always know the stream is alive. */}
        {!loading && !error && (
          <InlineProof className="flex items-center gap-1.5">
            <SignalChip tone="ok" className="font-normal normal-case tracking-normal">
              Live
            </SignalChip>
            {lastSyncAt && (
              <>
                <span className="text-fg-faint/60">·</span>
                <span>
                  Synced <RelativeTime value={lastSyncAt} />
                </span>
              </>
            )}
          </InlineProof>
        )}

        {/* KPI strip — same layout as Inbox so the muscle-memory carries.
            Numbers come from a single pass over `events` (see `kpis`). */}
        {!loading && !error && events.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            <ActivityKpi label="Active" value={kpis.activeFixes} tone="info" hint="Fix attempts open" />
            <ActivityKpi label="Failed" value={kpis.failed} tone={kpis.failed > 0 ? 'danger' : 'ok'} hint="Last 50 events" />
            <ActivityKpi label="PRs today" value={kpis.prsToday} tone={kpis.prsToday > 0 ? 'brand' : 'idle'} hint="Opened since 00:00" />
          </div>
        )}

        {/* Filter pills + search. Filters are mutually exclusive (the
            common task is "show me one thing"); search is additive on top
            of the active filter. */}
        {!loading && !error && events.length > 0 && (
          <div className="space-y-2">
            <div role="toolbar" aria-label="Filter activity" className="flex flex-wrap gap-1">
              {FILTERS.map((f) => {
                const active = filter === f.id
                const count =
                  f.id === 'all'
                    ? events.length
                    : f.id === 'failed'
                      ? kpis.failed
                      : events.filter((e) => {
                          const fam = KIND_META[e.kind]?.family
                          return f.id === 'fix' ? (fam === 'fix' || fam === 'lifecycle') : fam === 'pr'
                        }).length
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={active}
                    title={f.hint}
                    className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-2xs font-medium motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                      active
                        ? 'bg-brand/12 text-brand border border-brand/28'
                        : 'border-edge-subtle bg-surface-raised/40 text-fg-muted hover:text-fg hover:bg-surface-overlay'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className="tabular-nums text-fg-muted">{count}</span>
                  </button>
                )
              })}
            </div>
            <label className="block">
              <span className="sr-only">Search activity</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by branch, PR #, or label…"
                className="w-full bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-2xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand/40"
              />
            </label>
          </div>
        )}

        {loading && <Loading text="Loading activity…" />}
        {!loading && error && (
          <ContainedBlock tone="warn">
            <p className="text-xs text-danger">{error}</p>
          </ContainedBlock>
        )}
        {!loading && !error && events.length === 0 && (
          <EmptyState
            title="No recent activity"
            description="Connected and listening. The feed lights up the moment Mushi dispatches a fix, opens a PR, or resolves CI."
          />
        )}

        {!loading && !error && events.length > 0 && filtered.length === 0 && (
          <div className="space-y-2">
            <EmptySectionMessage text="No events match this filter." />
            <ActionPillRow>
              <ActionPill
                onClick={() => {
                  setFilter('all')
                  setSearch('')
                }}
                tone="brand"
              >
                Reset filters
              </ActionPill>
            </ActionPillRow>
          </div>
        )}

        {!loading && !error && buckets.length > 0 && (
          <div className="space-y-3">
            {buckets.map((b) => (
              <section key={b.bucket} aria-labelledby={`activity-bucket-${b.bucket}`}>
                <header className="flex items-center gap-1.5 mb-1 sticky top-0 bg-surface-root/95 backdrop-blur-sm py-0.5 z-1">
                  <h3
                    id={`activity-bucket-${b.bucket}`}
                    className="text-2xs uppercase tracking-wider text-fg-faint font-semibold"
                  >
                    {BUCKET_LABEL[b.bucket]}
                  </h3>
                  <span aria-hidden className="text-fg-faint/60">·</span>
                  <SignalChip tone="neutral" className="font-mono">
                    {b.events.length}
                  </SignalChip>
                </header>
                <ol className="relative space-y-2 pl-4 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-edge/60">
                  {b.events.map((e, idx) => {
                    const key = `${e.fix_attempt_id}-${e.at}-${e.kind}-${idx}`
                    return (
                      <EventRow
                        key={key}
                        event={e}
                        isNew={new Date(e.at).getTime() > lastSeenRef.current}
                        expanded={expandedKey === key}
                        onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
                      />
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function ActivityKpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number
  tone: 'info' | 'brand' | 'ok' | 'danger' | 'idle'
  hint: string
}) {
  const RING = {
    info:   'border-info/30 bg-info-muted/10',
    brand:  'border-brand/30 bg-brand/10',
    ok:     'border-ok/30 bg-ok-muted/10',
    danger: 'border-danger/40 bg-danger/10',
    idle:   'border-edge bg-surface-raised/40',
  } as const
  return (
    <div
      className={`rounded-sm border ${RING[tone]} px-2 py-1.5`}
      title={hint}
    >
      <p className="text-2xs uppercase tracking-wider text-fg-faint font-semibold leading-none">{label}</p>
      <p className="mt-1 text-base font-semibold text-fg tabular-nums leading-none">{value}</p>
    </div>
  )
}

function EventRow({
  event,
  isNew,
  expanded,
  onToggle,
}: {
  event: ActivityEvent
  isNew: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const meta = KIND_META[event.kind] ?? { glyph: '·', tone: 'text-fg-muted', caption: event.kind, family: 'lifecycle' as const }
  const isFailed = event.kind === 'failed' || event.status === 'fail'
  return (
    <li
      className={`relative text-xs ${isFailed ? 'pl-1 -ml-1 border-l-2 border-danger/60 rounded-sm bg-danger/5' : ''}`}
    >
      <span
        className={`absolute -left-3 top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-surface-root ${meta.tone}`}
        aria-hidden
      >
        <span className="text-2xs leading-none">{meta.glyph}</span>
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xs font-medium ${meta.tone}`}>{meta.caption}</span>
        {isNew && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse"
            aria-label="New event"
          />
        )}
        {event.branch && (
          <span title={`Branch ${event.branch}`}>
            <SignalChip tone="neutral" className="font-mono truncate max-w-[10rem]">
              {event.branch}
            </SignalChip>
          </span>
        )}
        <RelativeTime value={event.at} className="ml-auto text-2xs text-fg-muted shrink-0" />
      </div>
      <div className="mt-0.5 text-fg leading-snug">{event.label}</div>
      {event.detail && event.detail !== event.label && (
        <InlineProof className={`mt-0.5 ${expanded ? '' : 'truncate'}`}>
          {event.detail}
        </InlineProof>
      )}
      <ActionPillRow className="mt-1">
        <ActionPill to={`/fixes?expand=${event.fix_attempt_id}`} tone="brand">
          View fix
        </ActionPill>
        {event.pr_url && (
          <ActionPill href={event.pr_url} tone="neutral">
            PR #{event.pr_number ?? ''} ↗
          </ActionPill>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="ml-auto text-2xs text-fg-faint hover:text-fg-muted motion-safe:transition-opacity focus-visible:outline-none focus-visible:underline"
        >
          {expanded ? 'Less ▴' : 'More ▾'}
        </button>
      </ActionPillRow>
      {expanded && <DetailRows dense className="mt-1.5" items={buildEventDetailRows(event)} />}
    </li>
  )
}

/**
 * Build the expanded "attempt / report / kind / status / at" rows for an
 * activity event. Pulled out of the JSX so the conditional `status` row
 * and tone-mapping logic don't tangle with the markup.
 */
function buildEventDetailRows(event: ActivityEvent): DetailRowItem[] {
  const statusTone: DetailRowTone | undefined = event.status === 'fail'
    ? 'danger'
    : event.status === 'pending'
      ? 'warn'
      : event.status
        ? 'ok'
        : undefined
  const rows: DetailRowItem[] = [
    { label: 'attempt', value: event.fix_attempt_id, mono: true, tone: 'muted', hint: 'Fix attempt UUID owning this event.' },
    {
      label: 'report',
      value: (
        <Link to={`/reports/${event.report_id}`} className="hover:text-fg hover:underline font-mono">
          {event.report_id}
        </Link>
      ),
      hint: 'Report UUID — click to open the report detail page.',
    },
    { label: 'kind', value: event.kind, mono: true, tone: 'muted' },
  ]
  if (event.status) {
    rows.push({ label: 'status', value: event.status, mono: true, tone: statusTone })
  }
  rows.push({
    label: 'at',
    value: new Date(event.at).toLocaleString(),
    mono: true,
    tone: 'muted',
  })
  return rows
}
