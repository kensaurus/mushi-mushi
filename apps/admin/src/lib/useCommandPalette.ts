/**
 * FILE: apps/admin/src/lib/useCommandPalette.ts
 * PURPOSE: Tiny zustand-free singleton store for the command palette's
 *          open state. A module-level subscription set + `useSyncExternalStore`
 *          means `CommandPalette`, the header trigger, and any stray
 *          `useHotkeys` binding all read from the same source of truth
 *          without a Provider wrapping the whole app.
 */

import { useSyncExternalStore } from 'react'

type Listener = () => void

let open = false
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return open
}

/**
 * Imperative setters live on the module so event handlers outside React
 * (keyboard listener, etc.) can toggle the palette without going through
 * a hook. Components read via {@link useCommandPalette}.
 */
export const commandPalette = {
  open() {
    if (open) return
    open = true
    emit()
  },
  close() {
    if (!open) return
    open = false
    emit()
  },
  toggle() {
    open = !open
    emit()
  },
  get isOpen() {
    return open
  },
}

export function useCommandPalette() {
  const isOpen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    isOpen,
    open: commandPalette.open,
    close: commandPalette.close,
    toggle: commandPalette.toggle,
  }
}
