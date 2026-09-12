/**
 * Pure helpers in lib/pwa.ts — platform detection, push-support reasoning,
 * VAPID key decoding, and the push-service labels. The async subscribe flow
 * touches real browser APIs and is covered by the dogfood suite.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  supabase: {},
}))

import { detectPushSupport, isIos, isStandalone, pushServiceLabel, summarise, urlBase64ToUint8Array } from './pwa'

describe('isIos', () => {
  it('detects iPhone / iPad user agents', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true)
  })
  it('treats a touch-capable "Macintosh" as iPadOS', () => {
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe(false)
  })
  it('is false for Android and desktop', () => {
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128', 5)).toBe(false)
    expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128', 0)).toBe(false)
  })
})

describe('isStandalone', () => {
  const win = (standaloneMedia: boolean, navStandalone?: boolean) => ({
    matchMedia: (q: string) => ({ matches: standaloneMedia && q.includes('standalone') }),
    navigator: { standalone: navStandalone },
  })
  it('honours display-mode: standalone', () => {
    expect(isStandalone(win(true))).toBe(true)
    expect(isStandalone(win(false))).toBe(false)
  })
  it('falls back to navigator.standalone (iOS Safari)', () => {
    expect(isStandalone(win(false, true))).toBe(true)
    expect(isStandalone(win(false, false))).toBe(false)
  })
})

describe('detectPushSupport', () => {
  const base = { isSecureContext: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true, ios: false, standalone: false }
  it('supports a modern secure browser', () => {
    expect(detectPushSupport(base)).toEqual({ supported: true })
  })
  it('explains iOS in Safari (not installed) before the missing PushManager', () => {
    expect(detectPushSupport({ ...base, ios: true, standalone: false, hasPushManager: false })).toEqual({ supported: false, reason: 'ios_not_standalone' })
  })
  it('supports iOS once installed to the Home Screen', () => {
    expect(detectPushSupport({ ...base, ios: true, standalone: true })).toEqual({ supported: true })
  })
  it('reports the first blocking reason in order', () => {
    expect(detectPushSupport({ ...base, isSecureContext: false })).toEqual({ supported: false, reason: 'insecure' })
    expect(detectPushSupport({ ...base, hasServiceWorker: false })).toEqual({ supported: false, reason: 'no_service_worker' })
    expect(detectPushSupport({ ...base, hasPushManager: false })).toEqual({ supported: false, reason: 'no_push' })
    expect(detectPushSupport({ ...base, hasNotification: false })).toEqual({ supported: false, reason: 'no_notification' })
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID public key into 65 raw bytes', () => {
    const raw = new Uint8Array(65)
    raw[0] = 0x04
    for (let i = 1; i < 65; i++) raw[i] = (i * 7) & 0xff
    const b64url = Buffer.from(raw).toString('base64url')
    const out = urlBase64ToUint8Array(b64url)
    expect(out.length).toBe(65)
    expect(Array.from(out)).toEqual(Array.from(raw))
    expect(out.buffer).toBeInstanceOf(ArrayBuffer)
  })
  it('tolerates padding and whitespace', () => {
    expect(Array.from(urlBase64ToUint8Array(' AQID '))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('AQID=='))).toEqual([1, 2, 3])
  })
})

describe('pushServiceLabel / summarise', () => {
  it('names the four push services', () => {
    expect(pushServiceLabel('fcm.googleapis.com')).toMatch(/Google/)
    expect(pushServiceLabel('web.push.apple.com')).toBe('Apple')
    expect(pushServiceLabel('updates.push.services.mozilla.com')).toMatch(/Mozilla/)
    expect(pushServiceLabel('db5p.notify.windows.com')).toMatch(/Microsoft/)
    expect(pushServiceLabel('other.example')).toBe('other.example')
  })
  it('summarises an endpoint down to its host', () => {
    expect(summarise('https://web.push.apple.com/QWERTY')).toEqual({ endpoint: 'https://web.push.apple.com/QWERTY', host: 'web.push.apple.com' })
    expect(summarise('not a url').host).toBe('not a url')
  })
})
