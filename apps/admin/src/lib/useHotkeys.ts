/**
 * FILE: apps/admin/src/lib/useHotkeys.ts
 * PURPOSE: Lightweight keyboard shortcut hook. Registers a single document-
 *          level keydown listener and dispatches by key. Skips when focus is
 *          inside a form control unless the binding opts in via `allowInInputs`.
 *
 *          Used by the Reports triage table for j/k navigation, x toggle,
 *          enter to open, / focus search, and ? for the help overlay.
 *
 *          Two listeners on `document` (e.g. global Layout + per-page
 *          ReportsPage) both fire on the same keystroke by default —
 *          `addEventListener` does not dedupe across hook invocations.
 *          When a page-level binding wants to **preempt** the global
 *          binding for a shared key (e.g. `[` paginates on /reports
 *          instead of also collapsing the sidebar), opt into:
 *            • `{ capture: true }` on the per-page hook so its listener
 *              runs in the capture phase, *before* the bubble-phase
 *              global listener registered by the Layout shell.
 *            • `preempt: true` on the binding itself so when its handler
 *              fires it calls `e.stopImmediatePropagation()`, skipping
 *              every later listener (including the global one).
 *          A page that doesn't need preemption ignores both options and
 *          the hook behaves exactly as before.
 */

import { useEffect, useRef } from 'react'

export type HotkeyHandler = (e: KeyboardEvent) => void

export interface HotkeyBinding {
  key: string
  description: string
  handler: HotkeyHandler
  allowInInputs?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  /**
   * When true, calling the handler also calls `e.stopImmediatePropagation()`
   * so any other `useHotkeys()` listeners on `document` (e.g. the Layout
   * shortcut registry) don't also fire for the same keystroke. Pair with
   * `useHotkeys(bindings, { capture: true })` so this listener runs first.
   */
  preempt?: boolean
}

export interface HotkeyOptions {
  enabled?: boolean
  /**
   * Register the listener in the capture phase (`addEventListener(_, _, true)`)
   * so it runs *before* any bubble-phase listeners on `document`. Required
   * when a page-level hook wants to preempt a global hook for a shared key.
   */
  capture?: boolean
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (FORM_TAGS.has(target.tagName)) return true
  if (target.isContentEditable) return true
  return false
}

export function useHotkeys(
  bindings: HotkeyBinding[],
  optionsOrEnabled: HotkeyOptions | boolean = true,
): void {
  const ref = useRef(bindings)
  ref.current = bindings

  // Normalise legacy `(bindings, true)` callers and the new
  // `(bindings, { enabled, capture })` form into a single shape.
  const options: HotkeyOptions =
    typeof optionsOrEnabled === 'boolean' ? { enabled: optionsOrEnabled } : optionsOrEnabled
  const { enabled = true, capture = false } = options

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target)
      for (const b of ref.current) {
        if (b.key.toLowerCase() !== e.key.toLowerCase()) continue
        // Strict match on ctrl/meta/alt — a binding for `a` must NOT fire on
        // Ctrl+A (browser select-all), Cmd+A, or Alt+A. Without this the
        // shortcut runs alongside the browser's native handler and produces
        // confusing double behaviour.
        if (!!b.ctrl !== e.ctrlKey) continue
        if (!!b.meta !== e.metaKey) continue
        if (!!b.alt !== e.altKey) continue
        // Shift is intentionally lenient: many bindings (e.g. `?`, which is
        // Shift+/ on US layouts) include shift implicitly to produce the
        // character. Only enforce that shift is held when the binding asks
        // for it; do not reject when shift happens to be down.
        if (b.shift && !e.shiftKey) continue
        if (typing && !b.allowInInputs) continue
        b.handler(e)
        // Stop other `document` keydown listeners (capture or bubble phase)
        // from also firing for this keystroke. Only the binding that opts
        // in gets this — non-preempting bindings keep the legacy
        // multiple-listeners-may-coexist behaviour, which is what most of
        // the registry relies on.
        if (b.preempt) e.stopImmediatePropagation()
        break
      }
    }
    document.addEventListener('keydown', onKey, capture)
    return () => document.removeEventListener('keydown', onKey, capture)
  }, [enabled, capture])
}
