/**
 * FILE: apps/docs/lib/docs-nav-session-probe.ts
 * PURPOSE: Pre-paint session probe for the docs navbar, emitted once from
 *          the root layout `<head>`.
 *
 * The docs site is a static export. Signed-out links stay in that HTML so a
 * first visit can reach sign-up before JavaScript runs. When this tab already
 * has a usable access token, the probe hides those links (`visibility`, so
 * their box stays) before the navbar is parsed. It does not copy the token
 * into the page.
 *
 * The script has to be a plain inline script in the root layout head. A
 * client component's `<script>` is not run on later renders, and React warns
 * when a render emits one. `next/script` `beforeInteractive` also waits for
 * the Next.js bootstrap, which is after the navbar HTML can paint.
 *
 * If a session is stored but the docs bundle never hydrates, nothing replaces
 * the hidden links and the bar has no way into the console. The probe removes
 * the hide after a few seconds unless the navbar has marked the document
 * hydrated.
 *
 * CSP: the script is inline, and a stored session makes it insert a `<style>`
 * element. Both depend on the docs Content-Security-Policy keeping
 * `'unsafe-inline'` — `script-src` for this probe, `style-src` for the hide
 * rule. That policy is `buildSecurityHeaders()` in
 * `scripts/cloudfront-mushi-docs-response.js`. Removing `'unsafe-inline'`
 * without a hash or nonce for this script and the inserted style makes the
 * probe a no-op: the signed-out links stay visible, including for a returning
 * visitor, until the navbar hydrates.
 */

import { DOCS_AUTH_SESSION_KEY } from './migrationProgress'

export const DOCS_NAV_AUTH_SHELL_STYLE_ID = 'mushi-docs-auth-shell'

/** Set on `<html>` once `NavbarAuthChrome` has hydrated. */
export const DOCS_NAV_HYDRATED_ATTR = 'data-docs-nav-hydrated'

/**
 * Long enough for a slow docs bundle to hydrate, short enough that a failed
 * load gives the signed-out links back.
 */
export const DOCS_NAV_HYDRATION_FALLBACK_MS = 4000

const HIDE_RULE = '[data-docs-nav="signed-out"]{visibility:hidden}'

export const DOCS_NAV_SESSION_PROBE = `(function () {
  try {
    var raw = sessionStorage.getItem('${DOCS_AUTH_SESSION_KEY}')
    if (!raw) return
    var session = JSON.parse(raw)
    if (!session || typeof session.accessToken !== 'string' || session.accessToken.length === 0) return
    if (typeof session.expiresAt !== 'number') return
    if (!(session.expiresAt * 1000 > Date.now() + 5000)) return
    var id = '${DOCS_NAV_AUTH_SHELL_STYLE_ID}'
    if (document.getElementById(id)) return
    var style = document.createElement('style')
    style.id = id
    style.textContent = '${HIDE_RULE}'
    document.head.appendChild(style)
    setTimeout(function () {
      if (document.documentElement.getAttribute('${DOCS_NAV_HYDRATED_ATTR}') === '1') return
      if (style.parentNode) style.remove()
    }, ${DOCS_NAV_HYDRATION_FALLBACK_MS})
  } catch {
    /* sessionStorage unavailable — keep the signed-out links */
  }
})()`

/** Called from the navbar after it hydrates, so the fallback keeps the hide. */
export function markDocsNavHydrated(): void {
  document.documentElement.setAttribute(DOCS_NAV_HYDRATED_ATTR, '1')
}
