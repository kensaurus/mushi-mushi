/**
 * FILE: apps/admin/src/lib/useHotkeys.ts
 * PURPOSE: Lightweight keyboard shortcut hook. Registers a single document-
 *          level keydown listener and dispatches by key. Skips when focus is
 *          inside a form control unless the binding opts in via `allowInInputs`.
 *
 *          Used by the Reports triage table for j/k navigation, x toggle,
 *          enter to open, / focus search, and ? for the help overlay.
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
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (FORM_TAGS.has(target.tagName)) return true
  if (target.isContentEditable) return true
  return false
}

export function useHotkeys(bindings: HotkeyBinding[], enabled = true): void {
  const ref = useRef(bindings)
  ref.current = bindings

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
        break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}
