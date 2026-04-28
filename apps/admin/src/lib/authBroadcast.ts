/**
 * FILE: apps/admin/src/lib/authBroadcast.ts
 * PURPOSE: Cross-tab auth event fan-out. Signing out in one tab should make
 *          every other console tab leave protected routes before a stale 401.
 */

type AuthBroadcastEvent = 'SIGNED_OUT'
type AuthHandler = (event: AuthBroadcastEvent) => void

const CHANNEL_NAME = 'mushi:auth'
const STORAGE_KEY = 'mushi:auth:event'

let channel: BroadcastChannel | null = null
const handlers = new Set<AuthHandler>()

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.addEventListener('message', (event: MessageEvent<AuthBroadcastEvent>) => {
    if (event.data === 'SIGNED_OUT') emit(event.data)
  })
  return channel
}

function emit(event: AuthBroadcastEvent): void {
  for (const handler of handlers) handler(event)
}

export function notifySignOut(): void {
  ensureChannel()?.postMessage('SIGNED_OUT')
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ event: 'SIGNED_OUT', at: Date.now() }))
  }
}

export function subscribeAuthBroadcast(handler: AuthHandler): () => void {
  handlers.add(handler)
  ensureChannel()

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue) as { event?: AuthBroadcastEvent }
      if (parsed.event === 'SIGNED_OUT') handler('SIGNED_OUT')
    } catch {
      // Ignore malformed storage payloads. The auth state listener still wins.
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }

  return () => {
    handlers.delete(handler)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}
