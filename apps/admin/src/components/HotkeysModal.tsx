/**
 * FILE: apps/admin/src/components/HotkeysModal.tsx
 * PURPOSE: App-wide keyboard-shortcut cheatsheet (? key) with route-aware grouping,
 *          search, and the single registry for all global and page-scoped hotkeys.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Modal } from './Modal'
import { Kbd } from './ui'

interface Shortcut {
  /** One or more keys pressed together or in sequence. Strings get rendered
   *  as individual `<Kbd>` chips so `[' Cmd', 'K']` reads as ⌘ + K. */
  keys: string[]
  /** User-facing description — stays in imperative voice ("Open report")
   *  because it describes what the user *does*, not what the system *did*. */
  desc: string
  /** Optional fine-print extra shown in a muted line under the desc. */
  hint?: string
  /** Optional category — used by the search index to match queries like
   *  "navigation" or "view" so users find shortcuts even when they don't
   *  remember the description. */
  tags?: string[]
}

interface ShortcutGroup {
  id: string
  title: string
  hint?: string
  /** Route prefixes this group applies to. Used to promote the group
   *  to the top when the user is currently on a matching page. */
  routes?: string[]
  items: Shortcut[]
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const GROUPS: ShortcutGroup[] = [
  {
    id: 'find',
    title: 'Find · open',
    hint: 'Reach any page or surface from anywhere — including while typing.',
    items: [
      { keys: [MOD, 'K'], desc: 'Open command palette', hint: 'Jump to any page or action by name. Works inside inputs.', tags: ['navigation', 'palette'] },
      { keys: [MOD, 'J'], desc: 'Open Ask Mushi', hint: 'Scoped to the current page — filters + focus are sent with each question. Use /commands or @mentions in the composer.', tags: ['ai', 'navigation'] },
      { keys: [MOD, 'Shift', 'I'], desc: 'Open the Action Inbox', hint: 'Jumps straight to /inbox from anywhere — works even while typing in a search field.', tags: ['inbox', 'navigation'] },
      { keys: ['?'], desc: 'Toggle this cheatsheet', tags: ['help'] },
    ],
  },
  {
    id: 'view',
    title: 'View · workspace',
    hint: 'Reshape the chrome around the page so you can focus on the task.',
    items: [
      { keys: [MOD, '.'], desc: 'Toggle focus mode', hint: 'Hides the sidebar, top bar chrome, and pipeline pulse. Esc also exits.', tags: ['view', 'focus'] },
      { keys: ['['], desc: 'Toggle sidebar collapse', hint: 'Mirrors Linear: collapses the left sidebar to a 48px icon rail. On /reports the queue claims this key while engaged (j/k/x/Enter or a click inside the table) — pagination wins until you click out.', tags: ['view', 'sidebar'] },
      { keys: ['Esc'], desc: 'Close modal, drawer, or exit focus mode', tags: ['close', 'view'] },
    ],
  },
  {
    id: 'reports',
    title: 'Reports — bug queue',
    hint: 'Keyboard-driven review so you never need to touch the mouse on /reports.',
    routes: ['/reports'],
    items: [
      { keys: ['J'], desc: 'Move cursor to next report', tags: ['reports', 'navigation'] },
      { keys: ['K'], desc: 'Move cursor to previous report', tags: ['reports', 'navigation'] },
      { keys: ['Space'], desc: 'Preview the focused report', hint: 'Opens a side drawer without leaving the list.', tags: ['reports', 'preview'] },
      { keys: ['Enter'], desc: 'Open focused report (full page)', tags: ['reports'] },
      { keys: ['X'], desc: 'Toggle selection on focused row', tags: ['reports', 'selection'] },
      { keys: ['A'], desc: 'Select all reports on this page', tags: ['reports', 'selection'] },
      { keys: ['/'], desc: 'Focus the search box', tags: ['reports', 'search'] },
      { keys: ['['], desc: 'Previous page (within the queue)', hint: 'Same key as sidebar collapse — only paginates after you engage the queue (j/k/x/Enter, or a click inside the table). Click outside the table to release the key back to the sidebar toggle.', tags: ['reports', 'navigation'] },
      { keys: [']'], desc: 'Next page (within the queue)', hint: 'Engagement-gated like [ — see above.', tags: ['reports', 'navigation'] },
    ],
  },
  {
    id: 'fixes',
    title: 'Fixes & Repo',
    hint: 'Shortcuts available on /fixes and /repo detail pages.',
    routes: ['/fixes', '/repo'],
    items: [
      { keys: ['Enter'], desc: 'Open the focused branch or fix card', tags: ['fixes'] },
      { keys: ['←', '→'], desc: 'Navigate the fix-branch graph', hint: 'Use Arrow keys inside the git graph to walk nodes.', tags: ['fixes', 'navigation'] },
    ],
  },
  {
    id: 'tips',
    title: 'Tips · gotchas',
    items: [
      { keys: [], desc: 'Most shortcuts pause inside input fields so typing stays unambiguous.' },
      { keys: [], desc: `${MOD}+K, ${MOD}+J, and ${MOD}+Shift+I are always available — even while you are typing in a search box.` },
      { keys: [], desc: 'The cheatsheet promotes the page-relevant section to the top — pages without dedicated shortcuts just see the global set.' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function HotkeysModal({ open, onClose }: Props) {
  const location = useLocation()
  const [search, setSearch] = useState('')

  /** Find the group that best matches the current route so it can be
   *  promoted to the top. Longest-prefix match wins (so `/reports/:id`
   *  still picks the Reports group even once detail routes pick up
   *  their own entries). */
  const currentGroupId = useMemo(() => {
    const path = location.pathname
    let best: { id: string; len: number } | null = null
    for (const g of GROUPS) {
      if (!g.routes) continue
      for (const prefix of g.routes) {
        if (path === prefix || path.startsWith(`${prefix}/`)) {
          if (!best || prefix.length > best.len) best = { id: g.id, len: prefix.length }
        }
      }
    }
    return best?.id ?? null
  }, [location.pathname])

  const orderedGroups = useMemo(() => {
    if (!currentGroupId) return GROUPS
    const match = GROUPS.find((g) => g.id === currentGroupId)
    if (!match) return GROUPS
    const rest = GROUPS.filter((g) => g.id !== currentGroupId)
    return [match, ...rest]
  }, [currentGroupId])

  // Search filters across description, hint, key names, and tags so the
  // most-common operator queries ("focus", "ai", "next", "Cmd+K") all hit.
  // Empty query = pass-through (no filtering).
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orderedGroups
    return orderedGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          const haystack = [
            item.desc,
            item.hint ?? '',
            ...item.keys,
            ...(item.tags ?? []),
            g.title,
          ]
            .join(' ')
            .toLowerCase()
          return haystack.includes(q)
        }),
      }))
      .filter((g) => g.items.length > 0)
  }, [orderedGroups, search])

  const totalShortcuts = GROUPS.reduce((n, g) => n + g.items.filter((i) => i.keys.length > 0).length, 0)
  const visibleShortcuts = filteredGroups.reduce((n, g) => n + g.items.length, 0)

  return (
    <Modal open={open} size="md" title="Keyboard shortcuts" onClose={onClose}>
      <div className="space-y-3 text-xs">
        {/* Search + summary strip — always at the top of the modal so the
            operator can immediately type-to-filter without scrolling. */}
        <div className="space-y-2">
          <label className="block">
            <span className="sr-only">Search shortcuts</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shortcuts (e.g. inbox, focus, K)…"
              autoFocus
              className="w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand/40"
            />
          </label>
          <div className="flex items-center justify-between text-2xs text-fg-muted">
            <span>
              {search.trim()
                ? `${visibleShortcuts} of ${totalShortcuts} shortcuts`
                : `${totalShortcuts} shortcuts across ${GROUPS.length} categories`}
            </span>
            {currentGroupId && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
                Showing this page first
              </span>
            )}
          </div>
        </div>

        {filteredGroups.length === 0 && (
          <div className="rounded-sm border border-dashed border-edge bg-surface-raised/30 px-3 py-4 text-center">
            <p className="text-xs text-fg-muted">
              Nothing matches <span className="font-mono text-fg-secondary">{search}</span>.
            </p>
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-2 text-2xs text-accent-foreground hover:text-accent motion-safe:transition-colors"
            >
              Clear search
            </button>
          </div>
        )}

        {filteredGroups.map((group) => {
          const isCurrent = group.id === currentGroupId
          const keyedCount = group.items.filter((i) => i.keys.length > 0).length
          return (
            <Group
              key={group.id}
              title={isCurrent ? `On this page — ${group.title}` : group.title}
              hint={group.hint}
              highlighted={isCurrent}
              count={keyedCount}
            >
              <dl
                className={`divide-y divide-edge/40 rounded-sm border bg-surface-raised/40 ${
                  isCurrent ? 'border-brand/40' : 'border-edge/40'
                }`}
              >
                {group.items.map((item, idx) => (
                  <ShortcutRow key={`${group.id}-${idx}`} item={item} highlight={search.trim()} />
                ))}
              </dl>
            </Group>
          )
        })}

        <p className="text-2xs text-fg-muted">
          Missing a shortcut you'd like? Open an issue in <code className="font-mono">mushi-mushi</code> and tell us what
          would save you keystrokes.
        </p>
      </div>
    </Modal>
  )
}

function Group({
  title,
  hint,
  highlighted,
  count,
  children,
}: {
  title: string
  hint?: string
  highlighted?: boolean
  count?: number
  children: ReactNode
}) {
  return (
    <section>
      <header className="mb-1.5 flex items-baseline gap-2">
        <h3
          className={`text-2xs font-semibold uppercase tracking-wider ${
            highlighted ? 'text-brand' : 'text-fg-secondary'
          }`}
        >
          {title}
        </h3>
        {typeof count === 'number' && count > 0 && (
          <span className="text-3xs text-fg-faint tabular-nums" aria-label={`${count} shortcut${count === 1 ? '' : 's'}`}>
            {count}
          </span>
        )}
        {hint && <p className="text-2xs text-fg-muted">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function ShortcutRow({ item, highlight }: { item: Shortcut; highlight?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-2.5 py-1.5 motion-safe:transition-colors hover:bg-surface-overlay/40 rounded-sm">
      <div className="min-w-0 flex-1">
        <div className="text-fg">
          <HighlightedText text={item.desc} match={highlight} />
        </div>
        {item.hint && (
          <div className="text-2xs text-fg-muted mt-0.5">
            <HighlightedText text={item.hint} match={highlight} />
          </div>
        )}
      </div>
      {item.keys.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {item.keys.map((k, i) => (
            <span key={`${k}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span className="text-2xs text-fg-muted" aria-hidden>+</span>}
              <Kbd>{k}</Kbd>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Lightweight in-place highlighter — wraps the matched substring in a
// faint brand background so search hits are visible without re-running
// the Modal's render tree through a heavy markdown library.
function HighlightedText({ text, match }: { text: string; match?: string }) {
  if (!match || !match.trim()) return <>{text}</>
  const q = match.trim()
  const lower = text.toLowerCase()
  const idx = lower.indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-brand/20 text-fg rounded-sm px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}
