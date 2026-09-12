/**
 * FILE: apps/admin/src/lib/pwa.ts
 * PURPOSE: PWA runtime helpers for the Voice page and Settings — platform
 *          detection (iOS / standalone), Web Push subscribe / unsubscribe /
 *          test against `/v1/push/*`, and the Cache-API hand-off used by the
 *          Web Share Target flow in src/sw.ts.
 *
 * Pure helpers (`urlBase64ToUint8Array`, `detectPushSupport`, `isIos`,
 * `isStandalone`) take their inputs as parameters so they are unit-testable
 * without a browser; the async functions talk to the real `navigator` APIs.
 *
 * No `virtual:pwa-register` import here — see lib/pwaRegister.ts.
 */

import { apiFetch, apiFetchMutate } from './supabase'
import { getActiveProjectIdSnapshot } from './activeProject'

/** Must match SHARE_CACHE_NAME / SHARE_CACHE_KEY in src/sw.ts. */
export const SHARE_CACHE_NAME = 'mushi-share'
export const SHARE_CACHE_KEY = '/__mushi_shared_audio'

// ── platform ────────────────────────────────────────────────────────────────

export function isIos(ua: string = navigator.userAgent, maxTouchPoints: number = navigator.maxTouchPoints ?? 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /Macintosh/i.test(ua) && maxTouchPoints > 1
}

/** The slice of `window` that standalone detection needs — injectable for tests. */
export interface StandaloneEnv {
  matchMedia: (query: string) => { matches: boolean }
  navigator?: { standalone?: boolean }
}

export function isStandalone(win: StandaloneEnv = window as unknown as StandaloneEnv): boolean {
  try {
    if (win.matchMedia('(display-mode: standalone)').matches) return true
    if (win.matchMedia('(display-mode: fullscreen)').matches) return true
  } catch {
    // matchMedia can throw in odd embedders
  }
  return win.navigator?.standalone === true
}

export type PushSupport =
  | { supported: true }
  | {
      supported: false
      reason: 'insecure' | 'no_service_worker' | 'no_push' | 'no_notification' | 'ios_not_standalone'
    }

/** Why push cannot work on this device, or `{ supported: true }`. */
export function detectPushSupport(env: {
  isSecureContext: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  ios: boolean
  standalone: boolean
}): PushSupport {
  if (!env.isSecureContext) return { supported: false, reason: 'insecure' }
  if (!env.hasServiceWorker) return { supported: false, reason: 'no_service_worker' }
  // iOS 16.4+ only exposes push to Home Screen web apps; in Safari itself
  // PushManager is missing, so the standalone check must come first.
  if (env.ios && !env.standalone) return { supported: false, reason: 'ios_not_standalone' }
  if (!env.hasPushManager) return { supported: false, reason: 'no_push' }
  if (!env.hasNotification) return { supported: false, reason: 'no_notification' }
  return { supported: true }
}

export function detectPushSupportInBrowser(): PushSupport {
  return detectPushSupport({
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
    ios: typeof navigator !== 'undefined' && isIos(),
    standalone: typeof window !== 'undefined' && isStandalone(),
  })
}

export const PUSH_UNSUPPORTED_COPY: Record<Exclude<PushSupport, { supported: true }>['reason'], string> = {
  insecure: 'Push needs an https origin.',
  no_service_worker: 'This browser has no service-worker support, so it cannot receive push.',
  no_push: 'This browser does not support Web Push.',
  no_notification: 'This browser does not support notifications.',
  ios_not_standalone:
    'On iPhone and iPad, push only works from the Home Screen app: tap Share, then "Add to Home Screen", open Mushi from there, and tap this button again.',
}

// ── keys ────────────────────────────────────────────────────────────────────

/** VAPID public key (base64url) → the BufferSource `pushManager.subscribe` expects. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const normalised = base64Url.trim().replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// ── service worker ──────────────────────────────────────────────────────────

const SW_READY_TIMEOUT_MS = 8_000

/** Resolves the active registration, or null when the SW never activates. */
export async function serviceWorkerReady(timeoutMs = SW_READY_TIMEOUT_MS): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

// ── push subscribe / unsubscribe / test ─────────────────────────────────────

export interface PushSubscriptionSummary {
  endpoint: string
  host: string
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await serviceWorkerReady(2_000)
  if (!reg || !('pushManager' in reg)) return null
  try {
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export type SubscribeResult =
  | { ok: true; subscription: PushSubscriptionSummary }
  | { ok: false; code: 'unsupported' | 'permission_denied' | 'server_not_configured' | 'no_service_worker' | 'subscribe_failed' | 'save_failed'; message: string }

/**
 * Full subscribe flow. MUST be called from a click handler: the permission
 * prompt is requested synchronously before the first `await` so the user
 * gesture is still attached (iOS drops it otherwise).
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  const support = detectPushSupportInBrowser()
  if (!support.supported) return { ok: false, code: 'unsupported', message: PUSH_UNSUPPORTED_COPY[support.reason] }

  // Ask first, synchronously — keeps the gesture.
  const permissionPromise: Promise<NotificationPermission> =
    Notification.permission === 'granted' ? Promise.resolve('granted') : Promise.resolve(Notification.requestPermission())

  const keyRes = await apiFetch<{ publicKey: string }>('/v1/push/vapid-public-key', { scope: 'none', cache: 'no-store' })
  if (!keyRes.ok || !keyRes.data?.publicKey) {
    return {
      ok: false,
      code: 'server_not_configured',
      message:
        keyRes.error?.code === 'SERVER_MISCONFIGURED'
          ? 'Push is not configured on the server yet (VAPID keys missing).'
          : (keyRes.error?.message ?? 'Could not fetch the push key.'),
    }
  }

  const permission = await permissionPromise
  if (permission !== 'granted') {
    return { ok: false, code: 'permission_denied', message: 'Notifications are blocked for this site. Allow them in the browser settings and try again.' }
  }

  const reg = await serviceWorkerReady()
  if (!reg) return { ok: false, code: 'no_service_worker', message: 'The service worker did not activate. Reload the page and try again.' }

  let subscription: PushSubscription
  try {
    subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey),
      }))
  } catch (err) {
    return { ok: false, code: 'subscribe_failed', message: err instanceof Error ? err.message : String(err) }
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, code: 'subscribe_failed', message: 'The browser returned an incomplete subscription.' }
  }
  const save = await apiFetchMutate('/v1/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      expirationTime: json.expirationTime ?? null,
      user_agent: navigator.userAgent.slice(0, 512),
      project_id: getActiveProjectIdSnapshot(),
    }),
  })
  if (!save.ok) return { ok: false, code: 'save_failed', message: save.error?.message ?? 'Could not save the subscription.' }

  return { ok: true, subscription: summarise(json.endpoint) }
}

export async function unsubscribeFromPush(): Promise<{ ok: boolean; message?: string }> {
  const current = await getCurrentPushSubscription()
  if (!current) return { ok: true }
  const endpoint = current.endpoint
  try {
    await current.unsubscribe()
  } catch {
    // The server-side row is what matters for delivery; keep going.
  }
  const res = await apiFetchMutate('/v1/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) })
  return res.ok ? { ok: true } : { ok: false, message: res.error?.message ?? 'Could not remove the subscription.' }
}

export async function sendTestPush(): Promise<{ ok: boolean; sent?: number; failed?: number; message?: string }> {
  const res = await apiFetchMutate<{ sent: number; failed: number }>('/v1/push/test')
  if (!res.ok) return { ok: false, message: res.error?.message ?? 'Test notification failed.' }
  return { ok: true, sent: res.data?.sent, failed: res.data?.failed }
}

export function summarise(endpoint: string): PushSubscriptionSummary {
  let host = endpoint
  try {
    host = new URL(endpoint).hostname
  } catch {
    // keep raw
  }
  return { endpoint, host }
}

/** Human label for the push service behind an endpoint host. */
export function pushServiceLabel(host: string): string {
  if (host.endsWith('push.apple.com')) return 'Apple'
  if (host === 'fcm.googleapis.com') return 'Google (Chrome / Android)'
  if (host.endsWith('push.services.mozilla.com')) return 'Mozilla (Firefox)'
  if (host.endsWith('notify.windows.com')) return 'Microsoft (Edge)'
  return host
}

// ── share target hand-off ───────────────────────────────────────────────────

/**
 * Takes (and clears) the audio file the service worker stashed after a Web
 * Share Target POST. Returns null when nothing was shared.
 */
export async function takeSharedAudio(): Promise<File | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(SHARE_CACHE_NAME)
    const res = await cache.match(SHARE_CACHE_KEY)
    if (!res) return null
    const blob = await res.blob()
    const name = decodeURIComponent(res.headers.get('X-Mushi-Filename') ?? 'shared-audio')
    const type = res.headers.get('Content-Type') ?? blob.type ?? 'application/octet-stream'
    await cache.delete(SHARE_CACHE_KEY)
    if (blob.size === 0) return null
    return new File([blob], name, { type })
  } catch {
    return null
  }
}
