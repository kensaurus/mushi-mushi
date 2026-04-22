/**
 * FILE: apps/admin/src/components/HotkeysModal.tsx
 * PURPOSE: App-wide keyboard-shortcut cheatsheet. Opens on `?` from any page,
 *          listing global shortcuts plus the page-scoped ones that live on
 *          Reports and Fixes. Keeps the full shortcut registry in a single
 *          place so discoverability stays honest as new hotkeys are added.
 *
 *          Intentional design choices:
 *            - Single source of truth for the shortcut registry, colocated
 *              with the modal — adding a hotkey means adding one entry here,
 *              not hunting for a forgotten help overlay.
 *            - Shortcuts grouped by scope (Global / Navigate / Reports /
 *              Fixes) with a thin divider rule so the user finds what they
 *              need without reading the whole list.
 *            - Uses the shared Modal primitive so viewport sizing, focus
 *              trap, backdrop-click, and Esc-close behave identically to
 *              every other dialog in the admin.
 */

import type { ReactNode } from 'react'
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
  title: string
  hint?: string
  items: Shortcut[]
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    hint: 'Works from anywhere in the admin.',
    items: [
      { keys: [MOD, 'K'], desc: 'Open command palette', hint: 'Jump to any page or action by name.' },
      { keys: ['?'], desc: 'Toggle this cheatsheet' },
      { keys: ['Esc'], desc: 'Close modal or clear selection' },
    ],
  },
  {
    title: 'Reports — triage queue',
    hint: 'Keyboard-driven triage so you never need to touch the mouse on the /reports page.',
    items: [
      { keys: ['J'], desc: 'Move cursor to next report' },
      { keys: ['K'], desc: 'Move cursor to previous report' },
      { keys: ['Enter'], desc: 'Open focused report' },
      { keys: ['X'], desc: 'Toggle selection on focused row' },
      { keys: ['A'], desc: 'Select all reports on this page' },
      { keys: ['/'], desc: 'Focus the search box' },
      { keys: ['['], desc: 'Previous page' },
      { keys: [']'], desc: 'Next page' },
    ],
  },
  {
    title: 'Fixes & Repo',
    hint: 'Shortcuts available on /fixes and /repo detail pages.',
    items: [
      { keys: ['Enter'], desc: 'Open the focused branch or fix card' },
      { keys: ['←', '→'], desc: 'Navigate the fix-branch graph', hint: 'Use Arrow keys inside the git graph to walk nodes.' },
    ],
  },
  {
    title: 'Tips',
    items: [
      { keys: [], desc: 'Most shortcuts pause inside input fields so typing stays unambiguous.' },
      { keys: [], desc: 'Cmd/Ctrl-K is always available — even while you are typing in a search box.' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function HotkeysModal({ open, onClose }: Props) {
  return (
    <Modal open={open} size="md" title="Keyboard shortcuts" onClose={onClose}>
      <div className="space-y-4 text-xs">
        {GROUPS.map((group) => (
          <Group key={group.title} title={group.title} hint={group.hint}>
            <dl className="divide-y divide-edge/40 rounded-sm border border-edge/40 bg-surface-raised/40">
              {group.items.map((item, idx) => (
                <ShortcutRow key={`${group.title}-${idx}`} item={item} />
              ))}
            </dl>
          </Group>
        ))}
        <p className="text-2xs text-fg-muted">
          Missing a shortcut you'd like? Open an issue in <code className="font-mono">mushi-mushi</code> and tell us what
          would save you keystrokes.
        </p>
      </div>
    </Modal>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <header className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-secondary">{title}</h3>
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
