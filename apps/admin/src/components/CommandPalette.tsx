/**
 * FILE: apps/admin/src/components/CommandPalette.tsx
 * PURPOSE: Global command palette (Cmd/Ctrl+K). Combines three content
 *          tiers so the user's muscle memory pays off no matter what they
 *          type:
 *
 *            1. Static routes (navigation) — always present, scored by
 *               `cmdk` against the route's label + keyword aliases.
 *            2. Quick actions — jump to common filtered views and toggle
 *               admin mode without navigating manually.
 *            3. Live API search — debounced 250ms, hits /v1/admin/reports
 *               and /v1/admin/fixes with `q=<query>` when the query is
 *               long enough to be meaningful (≥ 2 chars).
 *
 *          Recent selections persist in localStorage so the first open
 *          is never empty once the user has used the palette before.
 */

import { Command } from 'cmdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCommandPalette } from '../lib/useCommandPalette'
import { useAdminMode, type AdminMode } from '../lib/mode'
import { apiFetch } from '../lib/supabase'
import { STATIC_ROUTES, type PaletteGroup, type StaticRoute } from '../lib/searchIndex'

interface LiveReport {
  id: string
  description: string
  category: string
  severity: string | null
  status: string
}

interface LiveFix {
  id: string
  report_id: string
  status: string
  summary?: string
  pr_url?: string
  pr_number?: number
}

const RECENTS_KEY = 'mushi:palette:recent:v1'
const MAX_RECENTS = 5
const LIVE_DEBOUNCE_MS = 250
const LIVE_MIN_CHARS = 2
const LIVE_LIMIT = 5

function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecents(ids: string[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)))
  } catch {
    // localStorage may be unavailable; non-fatal.
  }
}

const PALETTE_GROUP_ORDER: PaletteGroup[] = ['Start', 'Plan', 'Do', 'Check', 'Act', 'Workspace']

function groupRoutes(routes: StaticRoute[]): Record<PaletteGroup, StaticRoute[]> {
  const out = PALETTE_GROUP_ORDER.reduce(
    (acc, g) => {
      acc[g] = []
      return acc
    },
    {} as Record<PaletteGroup, StaticRoute[]>,
  )
  for (const r of routes) out[r.group].push(r)
  return out
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const navigate = useNavigate()
  const { mode, setMode } = useAdminMode()

  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => readRecents())

  const [liveReports, setLiveReports] = useState<LiveReport[]>([])
  const [liveFixes, setLiveFixes] = useState<LiveFix[]>([])
  const [liveLoading, setLiveLoading] = useState(false)

  // Reset the query on close so the next open starts fresh — otherwise the
  // list reopens filtered to whatever the user typed before they Esc'd.
  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  // Debounced live search. Aborts on query change so a slow request never
  // clobbers the results for a newer query.
  useEffect(() => {
    if (!isOpen) return
    const trimmed = query.trim()
    if (trimmed.length < LIVE_MIN_CHARS) {
      setLiveReports([])
      setLiveFixes([])
      setLiveLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLiveLoading(true)
      const q = encodeURIComponent(trimmed)
      const [reportsRes, fixesRes] = await Promise.all([
        apiFetch<{ reports: LiveReport[]; total: number }>(
          `/v1/admin/reports?q=${q}&limit=${LIVE_LIMIT}&sort=created_at&dir=desc`,
          { signal: controller.signal },
        ),
        apiFetch<{ fixes: LiveFix[] }>(`/v1/admin/fixes?q=${q}&limit=${LIVE_LIMIT}`, {
          signal: controller.signal,
        }),
      ])
      if (controller.signal.aborted) return
      setLiveReports(reportsRes.ok && reportsRes.data?.reports ? reportsRes.data.reports : [])
      setLiveFixes(fixesRes.ok && fixesRes.data?.fixes ? fixesRes.data.fixes : [])
      setLiveLoading(false)
    }, LIVE_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
      setLiveLoading(false)
    }
  }, [query, isOpen])

  const routesByGroup = useMemo(() => groupRoutes(STATIC_ROUTES), [])

  const recentRoutes = useMemo(() => {
    if (query.trim()) return []
    const byId = new Map(STATIC_ROUTES.map((r) => [r.id, r]))
    return recents.map((id) => byId.get(id)).filter((r): r is StaticRoute => Boolean(r))
  }, [recents, query])

  function handleSelect(id: string, action: () => void) {
    const next = [id, ...recents.filter((x) => x !== id)].slice(0, MAX_RECENTS)
    setRecents(next)
    writeRecents(next)
    close()
    // Defer navigation to the next tick so the dialog can unmount first —
    // otherwise the focus-restoration fights with React Router's own
    // scroll-restore hook and we get a visible scroll flash.
    setTimeout(action, 0)
  }

  const listRef = useRef<HTMLDivElement | null>(null)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-overlay backdrop-blur-sm motion-safe:animate-mushi-fade-in px-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-xl rounded-md border border-edge bg-surface-raised shadow-raised flex flex-col max-h-[70dvh] motion-safe:animate-mushi-modal-in"
        loop
        shouldFilter
      >
        <div className="flex items-center gap-2 border-b border-edge/60 px-3 py-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4 text-fg-muted shrink-0"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" strokeLinecap="round" />
          </svg>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages, reports, fixes, actions…"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
            autoFocus
          />
          <kbd className="text-3xs text-fg-faint border border-edge-subtle px-1 py-0.5 rounded-sm">Esc</kbd>
        </div>

        <Command.List
          ref={listRef}
          className="overflow-y-auto flex-1 min-h-0 py-1 cmdk-list"
        >
          <Command.Empty className="px-4 py-6 text-center text-xs text-fg-muted">
            No matches. Try "reports", "prompt", or a bug description.
          </Command.Empty>

          {recentRoutes.length > 0 && (
            <Command.Group heading="Recent" className="cmdk-group">
              {recentRoutes.map((r) => (
                <PaletteRouteItem
                  key={`recent-${r.id}`}
                  route={r}
                  onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                />
              ))}
            </Command.Group>
          )}

          {PALETTE_GROUP_ORDER.map((group) => {
            const items = routesByGroup[group]
            if (!items.length) return null
            return (
              <Command.Group key={group} heading={group} className="cmdk-group">
                {items.map((r) => (
                  <PaletteRouteItem
                    key={r.id}
                    route={r}
                    onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                  />
                ))}
              </Command.Group>
            )
          })}

          <Command.Group heading="Actions" className="cmdk-group">
            <PaletteActionItem
              id="action:filter:new-reports"
              label="Open new bug reports"
              hint="Reports filtered to status=new"
              keywords={['inbox', 'new', 'triage']}
              onSelect={() => handleSelect('action:filter:new-reports', () => navigate('/reports?status=new'))}
            />
            <PaletteActionItem
              id="action:filter:urgent-reports"
              label="Open critical bugs"
              hint="Reports filtered to severity=critical"
              keywords={['urgent', 'sev1', 'critical', 'escalation']}
              onSelect={() =>
                handleSelect('action:filter:urgent-reports', () =>
                  navigate('/reports?status=new&severity=critical'),
                )
              }
            />
            <PaletteActionItem
              id="action:fixes:open"
              label="Review drafted fixes"
              hint="Pull requests waiting for a human review"
              keywords={['pr', 'merge', 'review', 'drafts']}
              onSelect={() => handleSelect('action:fixes:open', () => navigate('/fixes'))}
            />
            <PaletteActionItem
              id="action:health:open"
              label="Check system health"
              hint="Uptime, queue depth, error rate"
              keywords={['status', 'monitoring', 'sentry', 'health']}
              onSelect={() => handleSelect('action:health:open', () => navigate('/health'))}
            />
            {(['quickstart', 'beginner', 'advanced'] as AdminMode[])
              .filter((m) => m !== mode)
              .map((m) => (
                <PaletteActionItem
                  key={`mode:${m}`}
                  id={`action:mode:${m}`}
                  label={`Switch to ${m[0].toUpperCase()}${m.slice(1)} mode`}
                  hint={
                    m === 'quickstart'
                      ? '3 pages, verb-led copy'
                      : m === 'beginner'
                      ? '9 essential pages, guided'
                      : 'Full 23-page console'
                  }
                  keywords={['mode', 'toggle', m]}
                  onSelect={() =>
                    handleSelect(`action:mode:${m}`, () => {
                      setMode(m)
                    })
                  }
                />
              ))}
          </Command.Group>

          {query.trim().length >= LIVE_MIN_CHARS && (
            <>
              <Command.Group heading={liveLoading ? 'Reports — searching…' : 'Reports'} className="cmdk-group">
                {liveReports.length === 0 && !liveLoading && (
                  <div className="px-3 py-2 text-2xs text-fg-faint">No matching reports.</div>
                )}
                {liveReports.map((r) => (
                  <Command.Item
                    key={`report:${r.id}`}
                    value={`report:${r.id} ${r.description} ${r.category}`}
                    onSelect={() =>
                      handleSelect(`report:${r.id}`, () => navigate(`/reports/${r.id}`))
                    }
                    className="cmdk-item"
                  >
                    <span className="truncate flex-1">{r.description}</span>
                    <span className="ml-2 text-3xs text-fg-faint shrink-0">
                      {r.severity ?? '—'} · {r.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={liveLoading ? 'Fixes — searching…' : 'Fixes'} className="cmdk-group">
                {liveFixes.length === 0 && !liveLoading && (
                  <div className="px-3 py-2 text-2xs text-fg-faint">No matching fixes.</div>
                )}
                {liveFixes.map((f) => (
                  <Command.Item
                    key={`fix:${f.id}`}
                    value={`fix:${f.id} ${f.summary ?? ''} ${f.status}`}
                    onSelect={() =>
                      handleSelect(`fix:${f.id}`, () => navigate(`/fixes#${f.id}`))
                    }
                    className="cmdk-item"
                  >
                    <span className="truncate flex-1">
                      {f.summary ?? `Fix ${f.id.slice(0, 8)}`}
                    </span>
                    <span className="ml-2 text-3xs text-fg-faint shrink-0">
                      {f.pr_number ? `PR #${f.pr_number}` : f.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}
        </Command.List>

        <footer className="flex items-center justify-between border-t border-edge/60 px-3 py-1.5 text-3xs text-fg-faint">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>to navigate</span>
            <Kbd>↵</Kbd>
            <span>to select</span>
          </span>
          <span>Press <Kbd>?</Kbd> anywhere for shortcuts</span>
        </footer>
      </Command>
    </div>
  )
}

interface PaletteRouteItemProps {
  route: StaticRoute
  onSelect: () => void
}

function PaletteRouteItem({ route, onSelect }: PaletteRouteItemProps) {
  return (
    <Command.Item
      value={`${route.path} ${route.label} ${route.keywords.join(' ')} ${route.description}`}
      onSelect={onSelect}
      className="cmdk-item"
    >
      <span className="flex-1 truncate">
        <span className="text-fg">{route.label}</span>
        <span className="ml-2 text-3xs text-fg-faint">{route.description}</span>
      </span>
      <span className="ml-2 text-3xs text-fg-faint shrink-0">{route.path}</span>
    </Command.Item>
  )
}

interface PaletteActionItemProps {
  id: string
  label: string
  hint: string
  keywords: string[]
  onSelect: () => void
}

function PaletteActionItem({ id, label, hint, keywords, onSelect }: PaletteActionItemProps) {
  return (
    <Command.Item
      value={`${id} ${label} ${hint} ${keywords.join(' ')}`}
      onSelect={onSelect}
      className="cmdk-item"
    >
      <span className="flex-1 truncate">
        <span className="text-fg">{label}</span>
        <span className="ml-2 text-3xs text-fg-faint">{hint}</span>
      </span>
    </Command.Item>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-edge-subtle px-1 py-0.5 rounded-sm font-sans">{children}</kbd>
  )
}
