/**
 * FILE: apps/admin/src/components/ActivityDrawer.tsx
 * PURPOSE: Live-updating, right-anchored panel that streams repo-wide
 *          Mushi activity (fix dispatched → branch pushed → PR opened →
 *          CI resolved → completed). Subscribes to postgres_changes on
 *          `fix_events` so each new webhook animates in without a reload.
 *
 *          Feature intent:
 *            - Gives operators a "is Mushi working?" heartbeat that's
 *              reachable from every page via the bell in the top bar.
 *            - An unread-badge (tracked in localStorage) lights up when
 *              events arrive while the drawer is closed, so async
 *              operators don't miss a merge-ready PR.
 *            - Events link out to the fix detail page and the underlying
 *              PR so the drawer is both a notification surface and a
 *              navigation shortcut.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from './ProjectSwitcher'
import { Drawer } from './Drawer'
import { RelativeTime, Badge, EmptyState, Loading } from './ui'

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

const KIND_META: Record<EventKind, { glyph: string; tone: string; caption: string }> = {
  dispatched:       { glyph: '→', tone: 'text-info',   caption: 'Dispatched' },
  started:          { glyph: '→', tone: 'text-info',   caption: 'Started' },
  branch:           { glyph: '⎇', tone: 'text-brand',  caption: 'Branch' },
  commit:           { glyph: '◆', tone: 'text-brand',  caption: 'Commit' },
  pr_opened:        { glyph: '↗', tone: 'text-brand',  caption: 'PR opened' },
  ci_started:       { glyph: '⟳', tone: 'text-warn',   caption: 'CI started' },
  ci_resolved:      { glyph: '✓', tone: 'text-ok',     caption: 'CI resolved' },
  pr_state_changed: { glyph: '↻', tone: 'text-info',   caption: 'PR state' },
  completed:        { glyph: '●', tone: 'text-ok',     caption: 'Completed' },
  failed:           { glyph: '✕', tone: 'text-danger', caption: 'Failed' },
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

export function ActivityDrawer({ open, onClose, onUnreadChange }: Props) {
  const activeProjectId = useActiveProjectId()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
    const res = await apiFetch<{ events: ActivityEvent[] }>(
      `/v1/admin/repo/activity?project_id=${encodeURIComponent(activeProjectId)}&limit=50`,
    )
    if (requestedProjectId !== activeProjectIdRef.current) return
    if (res.ok && res.data) setEvents(res.data.events)
    else setError(res.error?.message ?? 'Failed to load activity')
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

  const unread = useMemo(() => {
    if (!events.length) return 0
    return events.filter((e) => new Date(e.at).getTime() > lastSeenRef.current).length
  }, [events])

  // Notify the trigger + mark everything seen when the drawer opens.
  useEffect(() => {
    onUnreadChange?.(open ? 0 : unread)
    if (open && events[0]) {
      const newest = new Date(events[0].at).getTime()
      if (newest > lastSeenRef.current) {
        lastSeenRef.current = newest
        writeLastSeen(newest)
      }
    }
  }, [open, unread, events, onUnreadChange])

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
    >
      <div className="px-4 py-3">
        {loading && <Loading text="Loading activity…" />}
        {!loading && error && (
          <p className="text-xs text-danger">{error}</p>
        )}
        {!loading && !error && events.length === 0 && (
          <EmptyState
            title="Quiet on the pipeline"
            description="Nothing has happened lately. When Mushi dispatches, pushes, or merges a fix it will stream in here in real time."
          />
        )}
        {!loading && !error && events.length > 0 && (
          <ol className="relative space-y-2 pl-4 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-edge/60">
            {events.map((e, idx) => (
              <EventRow
                key={`${e.fix_attempt_id}-${e.at}-${e.kind}-${idx}`}
                event={e}
                isNew={new Date(e.at).getTime() > lastSeenRef.current}
              />
            ))}
          </ol>
        )}
      </div>
    </Drawer>
  )
}

function EventRow({ event, isNew }: { event: ActivityEvent; isNew: boolean }) {
  const meta = KIND_META[event.kind] ?? { glyph: '·', tone: 'text-fg-muted', caption: event.kind }
  return (
    <li className="relative text-xs">
      <span
        className={`absolute -left-3 top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-surface-root ${meta.tone}`}
        aria-hidden
      >
        <span className="text-[0.6rem] leading-none">{meta.glyph}</span>
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xs font-medium ${meta.tone}`}>{meta.caption}</span>
        {isNew && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse" aria-label="New event" />
        )}
        <RelativeTime value={event.at} className="ml-auto text-2xs text-fg-muted" />
      </div>
      <div className="mt-0.5 text-fg">{event.label}</div>
      {event.detail && event.detail !== event.label && (
        <div className="text-2xs text-fg-muted truncate">{event.detail}</div>
      )}
      <div className="mt-1 flex items-center gap-2 text-2xs">
        <Link
          to={`/fixes?expand=${event.fix_attempt_id}`}
          className="text-brand hover:underline"
        >
          View fix
        </Link>
        {event.pr_url && (
          <a
            href={event.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted hover:text-fg hover:underline"
          >
            PR #{event.pr_number ?? ''} ↗
          </a>
        )}
      </div>
    </li>
  )
}
