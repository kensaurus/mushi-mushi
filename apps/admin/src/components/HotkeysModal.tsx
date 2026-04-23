/**
 * FILE: apps/admin/src/components/HotkeysModal.tsx
 * PURPOSE: App-wide keyboard-shortcut cheatsheet. Opens on `?` from any page,
 *          listing global shortcuts plus the page-scoped ones that live on
 *          Reports and Fixes. Keeps the full shortcut registry in a single
 *          place so discoverability stays honest as new hotkeys are added.
 *
 *          Context-aware rendering:
 *            - The group that matches the current route is promoted to
 *              the top of the list and labelled "On this page" so the
 *              user sees their most-relevant shortcuts first.
 *            - Every group is still rendered — users who hit `?` from a
 *              page mid-task can glance up for global shortcuts without
 *              closing and reopening the cheatsheet somewhere else.
 *
 *          Single source of truth for the shortcut registry so adding a
 *          hotkey means adding one entry here, not hunting for a
 *          forgotten help overlay.
 */

import { useMemo, type ReactNode } from 'react'
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
    id: 'global',
    title: 'Global',
    hint: 'Works from anywhere in the admin.',
    items: [
      { keys: [MOD, 'K'], desc: 'Open command palette', hint: 'Jump to any page or action by name.' },
      { keys: [MOD, 'J'], desc: 'Open Ask Mushi', hint: 'Scoped to the current page — filters + focus are sent with each question. Use /commands or @mentions in the composer.' },
      { keys: ['?'], desc: 'Toggle this cheatsheet' },
      { keys: ['Esc'], desc: 'Close modal, drawer, or clear selection' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports — triage queue',
    hint: 'Keyboard-driven triage so you never need to touch the mouse on the /reports page.',
    routes: ['/reports'],
    items: [
      { keys: ['J'], desc: 'Move cursor to next report' },
      { keys: ['K'], desc: 'Move cursor to previous report' },
      { keys: ['Space'], desc: 'Preview the focused report', hint: 'Opens a side drawer without leaving the list.' },
      { keys: ['Enter'], desc: 'Open focused report (full page)' },
      { keys: ['X'], desc: 'Toggle selection on focused row' },
      { keys: ['A'], desc: 'Select all reports on this page' },
      { keys: ['/'], desc: 'Focus the search box' },
      { keys: ['['], desc: 'Previous page' },
      { keys: [']'], desc: 'Next page' },
    ],
  },
  {
    id: 'fixes',
    title: 'Fixes & Repo',
    hint: 'Shortcuts available on /fixes and /repo detail pages.',
    routes: ['/fixes', '/repo'],
    items: [
      { keys: ['Enter'], desc: 'Open the focused branch or fix card' },
      { keys: ['←', '→'], desc: 'Navigate the fix-branch graph', hint: 'Use Arrow keys inside the git graph to walk nodes.' },
    ],
  },
  {
    id: 'tips',
    title: 'Tips',
    items: [
      { keys: [], desc: 'Most shortcuts pause inside input fields so typing stays unambiguous.' },
      { keys: [], desc: `${MOD}+K and ${MOD}+J are always available — even while you are typing in a search box.` },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function HotkeysModal({ open, onClose }: Props) {
  const location = useLocation()

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

  return (
    <Modal open={open} size="md" title="Keyboard shortcuts" onClose={onClose}>
      <div className="space-y-4 text-xs">
        {orderedGroups.map((group) => {
          const isCurrent = group.id === currentGroupId
          return (
            <Group
              key={group.id}
              title={isCurrent ? `On this page — ${group.title}` : group.title}
              hint={group.hint}
              highlighted={isCurrent}
            >
              <dl
                className={`divide-y divide-edge/40 rounded-sm border bg-surface-raised/40 ${
                  isCurrent ? 'border-brand/40' : 'border-edge/40'
                }`}
              >
                {group.items.map((item, idx) => (
                  <ShortcutRow key={`${group.id}-${idx}`} item={item} />
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
  children,
}: {
  title: string
  hint?: string
  highlighted?: boolean
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
        {hint && <p className="text-2xs text-fg-muted">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function ShortcutRow({ item }: { item: Shortcut }) {
  return (
    <div className="flex items-start justify-between gap-3 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-fg">{item.desc}</div>
        {item.hint && <div className="text-2xs text-fg-muted mt-0.5">{item.hint}</div>}
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
