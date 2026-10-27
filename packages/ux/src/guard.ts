// SPDX-License-Identifier: MIT
/**
 * Hard rule of the loop: exploring and screenshotting an app never writes
 * to it. A localhost dev server often talks to a real backend, so one stray
 * "Delete" click or form submit during discovery would mutate real data.
 *
 * - Every request that is not GET / HEAD / OPTIONS is aborted unless it
 *   matches the per-target allowlist (reads some apps make with POST, such as
 *   PostgREST `rpc/` calls or GraphQL queries).
 * - Form submission is cancelled in the page itself.
 * - Discovery never clicks an element whose label reads as destructive.
 * - Service Workers are blocked where the context is created (capture.ts):
 *   requests a worker handles never reach `context.route`.
 *
 * WebSockets are not routed: a Supabase Realtime socket only subscribes, and
 * table writes go through REST, which the route sees.
 *
 * Fresh-eyes runs (ADR 0051) may write, but only on the app's own origins
 * (`writes: 'same-origin'`). In every mode, a request is refused when it would
 * pay, sign in with a third party, or create an account through a public
 * sign-up endpoint: those never reach the network, whatever the allowlist.
 */

import type { BrowserContext } from 'playwright'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** `"POST /rest/v1/rpc/*"`, or a bare path glob meaning any method. */
export type AllowRule = string

/**
 * read-only (the default): every write is aborted unless the allowlist names it.
 * same-origin (fresh-eyes, ADR 0051): writes may also reach `appOrigins`.
 */
export type WriteMode = 'read-only' | 'same-origin'

export interface GuardPolicy {
  writes?: WriteMode
  /** The app's own origins (`https://app.example.com`), with writes: 'same-origin'. */
  appOrigins?: readonly string[]
}

/** Payment pages and APIs: never navigated to, never written to. Scripts (js.stripe.com) still load. */
const PAYMENT_HOST_RE = /(^|\.)(checkout\.stripe\.com|billing\.stripe\.com|buy\.stripe\.com|api\.stripe\.com|paypal\.com|pay\.google\.com|checkout\.paddle\.com|buy\.paddle\.com|lemonsqueezy\.com|checkout\.shopify\.com)$/i

/** Third-party sign-in: a run never signs in with someone's Google, GitHub, Apple or Microsoft account. */
const OAUTH_HOST_RE = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com)$/i
const OAUTH_URL_RE = /^https?:\/\/(?:[^/]+\.)?(?:github\.com\/login|discord\.com\/oauth2|gitlab\.com\/oauth|(?:www\.)?facebook\.com\/(?:[^/]+\/)?dialog\/oauth|x\.com\/i\/oauth2|api\.twitter\.com\/oauth)/i
/** Supabase (or any GoTrue) third-party sign-in start: /auth/v1/authorize?provider=github. */
const PROVIDER_AUTHORIZE_RE = /\/auth\/v1\/authorize\b[^#]*[?&]provider=/i

/** Public account creation, magic links and password recovery: never called, even on the app's own origin. */
const PUBLIC_AUTH_WRITE_RE = /\/auth\/v1\/(?:signup|otp|recover|magiclink|resend)\b/i

/** Captcha providers: seen, never solved (a run stops there). */
const CAPTCHA_URL_RE = /^https?:\/\/(?:[^/]+\.)?(?:hcaptcha\.com|recaptcha\.net|challenges\.cloudflare\.com|google\.com\/recaptcha|arkoselabs\.com|funcaptcha\.com)/i

/** Pure: is this URL a captcha provider's (a script, frame or check)? */
export function isCaptchaUrl(url: string): boolean {
  return CAPTCHA_URL_RE.test(url)
}

/**
 * Pure: why a request is refused in every mode, or null. A navigation or a
 * write to a payment or third-party sign-in host, a third-party sign-in
 * started through the app's own auth, or a public sign-up/OTP/recovery call.
 * Plain script and image loads from those hosts (Stripe.js) are not refused.
 */
export function requestRefusal(method: string, url: string, isNavigation: boolean): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const write = !READ_METHODS.has(method.toUpperCase())
  if ((write || isNavigation) && PAYMENT_HOST_RE.test(u.hostname)) return `payment: ${u.hostname}`
  if ((write || isNavigation) && (OAUTH_HOST_RE.test(u.hostname) || OAUTH_URL_RE.test(url))) return `third-party sign-in: ${u.hostname}`
  if (PROVIDER_AUTHORIZE_RE.test(u.pathname + u.search)) return 'third-party sign-in through the app'
  if (write && PUBLIC_AUTH_WRITE_RE.test(u.pathname)) return `public account endpoint: ${u.pathname}`
  return null
}

export interface GuardLog {
  blocked: Array<{ method: string; url: string }>
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/** Pure decision, exported for tests: may this request leave the browser? */
export function isRequestAllowed(method: string, url: string, allow: readonly AllowRule[], policy: GuardPolicy = {}, isNavigation = false): boolean {
  const m = method.toUpperCase()
  if (requestRefusal(m, url, isNavigation)) return false
  if (READ_METHODS.has(m)) return true
  let path: string
  let origin: string
  try {
    const u = new URL(url)
    path = u.pathname + u.search
    origin = u.origin
  } catch {
    return false
  }
  if (policy.writes === 'same-origin' && (policy.appOrigins ?? []).some((o) => sameOrigin(o, origin))) return true
  return allow.some((rule) => {
    const space = rule.indexOf(' ')
    const ruleMethod = space > 0 ? rule.slice(0, space).toUpperCase() : null
    const ruleGlob = space > 0 ? rule.slice(space + 1).trim() : rule.trim()
    if (ruleMethod && ruleMethod !== m) return false
    return globToRegExp(ruleGlob).test(path)
  })
}

function sameOrigin(a: string, origin: string): boolean {
  try {
    return new URL(a).origin === origin
  } catch {
    return false
  }
}

const DESTRUCTIVE_RE =
  /\b(delete|remove|destroy|erase|discard|revoke|disconnect|uninstall|archive|cancel (?:plan|subscription)|pay|purchase|buy|checkout|charge|send|submit|publish|merge|deploy|log ?out|sign ?out|reset)\b/i

/** Pure: should discovery refuse to click an element with this label? */
export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE_RE.test(label)
}

/**
 * What a fresh-eyes visitor never clicks (ADR 0051). Unlike discovery it may
 * submit, send and sign up on the app itself; it never deletes, revokes, pays,
 * subscribes, signs out or signs in with a third-party account.
 */
const FRESH_EYES_REFUSED_RE =
  /\b(delete|remove|destroy|erase|revoke|disconnect|uninstall|pay|purchase|buy|checkout|subscribe|upgrade|charge|log ?out|sign ?out|cancel (?:plan|subscription))\b|\b(?:continue|sign ?(?:in|up)|log ?in|connect) (?:with|using|via) (?:google|github|apple|microsoft|facebook|gitlab|twitter|x|discord)\b/i

/** Pure: should a fresh-eyes run refuse to click an element with this label? */
export function isFreshEyesRefusedLabel(label: string): boolean {
  return FRESH_EYES_REFUSED_RE.test(label)
}

/**
 * Cancels form submission inside every page of the context, before any app
 * script runs. Covers submit events, `form.submit()` and `requestSubmit()`.
 */
const NO_SUBMIT_SCRIPT = `(() => {
  addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation() }, true)
  HTMLFormElement.prototype.submit = function () {}
  HTMLFormElement.prototype.requestSubmit = function () {}
})()`

export async function installGuard(context: BrowserContext, allow: readonly AllowRule[], log: GuardLog = { blocked: [] }, policy: GuardPolicy = {}): Promise<GuardLog> {
  // A run that may write lets the app's own forms submit; the request route still decides where they go.
  if (policy.writes !== 'same-origin') await context.addInitScript({ content: NO_SUBMIT_SCRIPT })
  await context.route('**/*', async (route) => {
    const req = route.request()
    if (isRequestAllowed(req.method(), req.url(), allow, policy, req.isNavigationRequest())) return route.continue()
    log.blocked.push({ method: req.method(), url: req.url() })
    return route.abort('blockedbyclient')
  })
  return log
}

/** Console text Chromium prints for a request the guard aborted. */
export function isGuardNoise(text: string): boolean {
  return /ERR_BLOCKED_BY_CLIENT/.test(text)
}
