/**
 * FILE: apps/admin/src/lib/pwaRegister.ts
 * PURPOSE: Register the PWA service worker (src/sw.ts). Kept separate from
 *          `lib/pwa.ts` because this module imports the `virtual:pwa-register`
 *          module that only exists inside a Vite build — importing it from
 *          code that also runs under vitest would break the unit tests.
 *
 * Loaded lazily from main.tsx after `load`. No-op when the browser has no
 * service-worker support or the page is not on a secure origin.
 */

import { registerSW } from 'virtual:pwa-register'
import { debugLog } from './debug'

let registered = false

export function registerServiceWorker(): void {
  if (registered) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return
  registered = true
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl) {
      debugLog('pwa', `service worker registered: ${swUrl}`)
    },
    onRegisterError(error) {
      debugLog('pwa', `service worker registration failed: ${String(error)}`)
    },
  })
}
