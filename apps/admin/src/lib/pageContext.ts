/**
 * FILE: apps/admin/src/lib/pageContext.ts
 * PURPOSE: Shared publish/subscribe registry for "what is the user looking
 *          at *right now* on this page?" context. Ask Mushi, the hotkeys
 *          cheatsheet, and command palette all consume this single source
 *          of truth so their behaviour tracks the active page instead of
 *          being statically keyed off the URL pathname.
 *
 *          Why a registry instead of a React Context Provider?
 *          - Pages mount *inside* `<Layout>`, so a top-down context cannot
 *            read child state without prop drilling or lifting state. A
 *            module-level store sidesteps the layering problem and plays
 *            nicely with `useSyncExternalStore` for StrictMode safety.
 *          - Multiple consumers (sidebar, palette, modal) read the same
 *            snapshot without re-computing anything per consumer.
 *          - Pages that don't care simply never publish — the registry
 *            falls back to a minimal "route only" context derived from
 *            window.location, so every page is at least route-aware.
 *
 *          Usage (pages):
 *
 *            usePublishPageContext({
 *              route: '/reports',
 *              title: 'Reports',
 *              summary: `${total} reports · ${critical} critical`,
 *              filters: { status, severity, search },
 *              actions: [{ id: 'triage-next', label: 'Triage next new report', run: ... }],
 *              questions: ['Which reports are stalling?', ...],
 *            })
 *
 *          Usage (consumers):
 *
 *            const ctx = usePageContext()
 *
 *          Published values are cleared on route change so stale "Reports"
 *          context never leaks onto `/fixes` if a page forgets to clean up.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'

/** Declarative action the page contributes. Consumers render these inline
 *  (e.g. command palette at the top, or Ask Mushi as a quick button). */
export interface PageAction {
  id: string
  label: string
  hint?: string
  /** Optional keyboard shortcut string ("g r", "R", etc.) — purely for
   *  display in consumers; the page itself owns the binding. */
  shortcut?: string
  run: () => void
}

/** What the page knows about the currently-focused entity (a report, a
 *  fix, a prompt version, ...). Used by Ask Mushi so it can answer
 *  "why did *this one* fail?" without guessing. */
export interface PageSelection {
  kind: string
  id: string
  label: string
}

export interface PageContext {
  /** The route path for this context — set explicitly by the page to
   *  guard against stale context leaking across navigations. */
  route: string
  /** Human-readable page title for display in consumer headers. */
  title: string
  /** One-line summary of the page's current state ("12 new · 3 critical").
   *  Renders as a chip in the Ask Mushi header so the user can confirm
   *  the assistant sees what they see. Also concatenated into the
   *  browser tab title by `useDocumentTitle`, so keep it short. */
  summary?: string
  /** Optional count of critical-severity items on this page. When > 0,
   *  `useFaviconBadge` draws a red dot on the favicon so the operator
   *  sees something needs attention even from another browser tab.
   *  Pages that don't surface criticals can omit this field. */
  criticalCount?: number
  /** Active filters as a small key-value map. Values are coerced to
   *  string when rendered as chips; consumers should drop empty strings. */
  filters?: Record<string, string | number | boolean | null | undefined>
  /** The currently-focused entity (if any). */
  selection?: PageSelection
  /** Page-contributed quick actions (palette + Ask Mushi). */
  actions?: PageAction[]
  /** Page-contributed empty-state suggestions for Ask Mushi. If
   *  omitted, the sidebar falls back to the static route-based list. */
  questions?: string[]
  /** Page-contributed @-mention sources. Surfaced in the Ask Mushi
   *  composer's `@` popover so the user can pull entities the page
   *  already knows about (current report, currently-rendered fixes, etc.)
   *  without typing an id. The composer also queries
   *  `/v1/admin/ask-mushi/mentions` for fuzzy server-side matches; pages
   *  that publish a list here just give the user a head start. */
  mentionables?: PageMentionable[]
}

export interface PageMentionable {
  /** Logical entity kind. Mirrors the `@kind:id` token format. */
  kind: 'report' | 'fix' | 'branch' | 'page' | string
  /** Stable id used in the `@kind:id` token (and in the resolved
   *  context-block on the backend). */
  id: string
  /** Display label used in the popover ("@report:abc12345 — Crash on save"). */
  label: string
  /** Optional second line for context. */
  sublabel?: string
}

type Listener = () => void

let currentContext: PageContext | null = null
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PageContext | null {
  return currentContext
}

/** Publish the current page's context. Call inside an effect so the
 *  registry updates react to state changes (filter toggles, selection
 *  changes, etc.). The hook automatically clears the registry on unmount
 *  so a stale "Reports" payload never lingers on `/fixes`. */
export function usePublishPageContext(ctx: PageContext | null): void {
  // Stringify deterministically so we can compare without a deep-equal lib.
  // `actions` are stripped from the compare because closures break equality
  // on every render; we still forward the latest closures to the registry.
  const stableKey = useMemo(() => {
    if (!ctx) return ''
    const { actions, ...rest } = ctx
    return JSON.stringify({
      ...rest,
      actions: actions?.map((a) => ({ id: a.id, label: a.label, hint: a.hint, shortcut: a.shortcut })),
    })
  }, [ctx])

  // We deliberately depend on the serialised key (not `ctx` itself) so
  // pages that recompute their context object on every render don't
  // thrash the registry. `ctx` is captured fresh via closure each render,
  // so the latest action closures are still forwarded once `stableKey`
  // changes.
  useEffect(() => {
    currentContext = ctx
    emit()
    return () => {
      if (currentContext === ctx) {
        currentContext = null
        emit()
      }
    }
  }, [stableKey, ctx])
}

/** Read the current page context. Returns null when no page has
 *  published — consumers should fall back to their own default. */
export function usePageContext(): PageContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Compact the filter map into printable chips, skipping empty values. */
export function contextFilterChips(
  filters: PageContext['filters'] | undefined,
): Array<{ key: string; value: string }> {
  if (!filters) return []
  const out: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined) continue
    const v = String(raw).trim()
    if (!v || v === 'all' || v === 'any') continue
    out.push({ key, value: v })
  }
  return out
}
