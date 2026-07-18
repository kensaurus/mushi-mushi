/**
 * FILE: apps/admin/src/lib/authBroadcast.ts
 * PURPOSE: Cross-tab auth event fan-out. Signing out in one tab should make
 *          every other console tab leave protected routes before a stale 401,
 *          and switching accounts in one tab should make the others adopt the
 *          new active account rather than keep rendering the old one's data.
 */

type AuthBroadcastEvent = 'SIGNED_OUT' | 'ACCOUNT_SWITCHED'
type AuthHandler = (event: AuthBroadcastEvent) => void

const CHANNEL_NAME = 'mushi:auth'
const STORAGE_KEY = 'mushi:auth:event'

let channel: BroadcastChannel | null = null
const handlers = new Set<AuthHandler>()

function isAuthEvent(value: unknown): value is AuthBroadcastEvent {
  return value === 'SIGNED_OUT' || value === 'ACCOUNT_SWITCHED'
}

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.addEventListener('message', (event: MessageEvent<AuthBroadcastEvent>) => {
    if (isAuthEvent(event.data)) emit(event.data)
  })
  return channel
}

function emit(event: AuthBroadcastEvent): void {
  for (const handler of handlers) handler(event)
}

function broadcast(event: AuthBroadcastEvent): void {
  ensureChannel()?.postMessage(event)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ event, at: Date.now() }))
  }
}

export function notifySignOut(): void {
  broadcast('SIGNED_OUT')
}

export function notifyAccountSwitched(): void {
  broadcast('ACCOUNT_SWITCHED')
}

export function subscribeAuthBroadcast(handler: AuthHandler): () => void {
  handlers.add(handler)
  ensureChannel()

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue) as { event?: AuthBroadcastEvent }
      if (isAuthEvent(parsed.event)) handler(parsed.event)
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
