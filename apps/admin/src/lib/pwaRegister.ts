/**
 * FILE: apps/admin/src/lib/pwaRegister.ts
 * PURPOSE: Register the PWA service worker (src/sw.ts). Kept separate from
 *          `lib/pwa.ts` because this module imports the `virtual:pwa-register`
 *          module that only exists inside a Vite build — importing it from
 *          code that also runs under vitest would break the unit tests.
 *
 * Loaded lazily from main.tsx after `load`. No-op when the browser has no
 * service-worker support or the page is not on a secure origin.
 *
 * Updates are "prompt" (2026-11-18): a new deploy's worker waits, the page
 * shows "New version — Reload" (components/NewVersionBanner.tsx), and the
 * reload happens only when the user presses it. The logic is lib/swUpdate.ts.
 */

import { registerSW } from 'virtual:pwa-register'
import { debugLog } from './debug'
import { createSwUpdater, pageRunsDeployedBuild, publishSwUpdate } from './swUpdate'

/** Announce a waiting worker only when this page is not already the deployed build. */
function announceIfBehind(apply: () => void): void {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).href
  const running = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? null
  void pageRunsDeployedBuild({
    // The base URL, not index.html: sw.ts serves index.html from its precache
    // (cache first, matched by path), which would return the old shell.
    fetchShell: async () => (await fetch(base, { cache: 'no-store', credentials: 'same-origin' })).text(),
    runningEntry: running ? new URL(running).pathname : null,
    baseUrl: base,
  }).then((current) => {
    if (current) debugLog('pwa', 'new worker waiting; this page already runs the deployed build')
    else publishSwUpdate(apply)
  })
}

let registered = false

export function registerServiceWorker(): void {
  if (registered) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return
  registered = true
  registerSW({
    immediate: true,
    // Never reload on our behalf: lib/swUpdate.ts reloads once, after Reload.
    // mushi-mushi-allowlist: deliberately empty; the default handler would reload mid-form
    onNeedReload: () => undefined,
    onRegisteredSW(swUrl, registration) {
      debugLog('pwa', `service worker registered: ${swUrl}`)
      if (!registration) return
      createSwUpdater(registration, {
        container: navigator.serviceWorker,
        doc: document,
        win: window,
        reload: () => window.location.reload(),
        onReady: announceIfBehind,
      })
    },
    onRegisterError(error) {
      debugLog('pwa', `service worker registration failed: ${String(error)}`)
    },
  })
}
