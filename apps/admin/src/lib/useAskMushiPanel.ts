/**
 * FILE: apps/admin/src/lib/useAskMushiPanel.ts
 * PURPOSE: Global open/seed state for the Ask Mushi sidebar (Cmd/Ctrl+J).
 */

import { useSyncExternalStore } from 'react'
import { markAskMushiIntroSeen } from './askMushiIntro'

type Listener = () => void

interface PanelState {
  open: boolean
  seed: string | null
  /** Palette handoff — hydrate this thread instead of starting fresh. */
  threadId: string | null
}

let state: PanelState = { open: false, seed: null, threadId: null }
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PanelState {
  return state
}

export const askMushiPanel = {
  open(seed?: string) {
    markAskMushiIntroSeen()
    state = { open: true, seed: seed ?? null, threadId: null }
    emit()
  },
  /** Continue Cmd+K assist in the sidebar with the existing server thread. */
  openFromPalette(seed: string, threadId: string) {
    markAskMushiIntroSeen()
    state = { open: true, seed: seed.trim() || null, threadId }
    emit()
  },
  close() {
    state = { open: false, seed: null, threadId: null }
    emit()
  },
  toggle() {
    const opening = !state.open
    if (opening) markAskMushiIntroSeen()
    state = {
      ...state,
      open: opening,
      seed: state.open ? null : state.seed,
      threadId: state.open ? null : state.threadId,
    }
    emit()
  },
  consumeSeed(): string | null {
    const s = state.seed
    if (s) {
      state = { ...state, seed: null }
      emit()
    }
    return s
  },
}

export function useAskMushiPanel() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    isOpen: snap.open,
    seed: snap.seed,
    threadId: snap.threadId,
    open: (seed?: string) => askMushiPanel.open(seed),
    openFromPalette: (seed: string, threadId: string) =>
      askMushiPanel.openFromPalette(seed, threadId),
    close: () => askMushiPanel.close(),
    toggle: () => askMushiPanel.toggle(),
    consumeSeed: () => askMushiPanel.consumeSeed(),
  }
}
