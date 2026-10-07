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
 */

import type { BrowserContext } from 'playwright'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** `"POST /rest/v1/rpc/*"`, or a bare path glob meaning any method. */
export type AllowRule = string

export interface GuardLog {
  blocked: Array<{ method: string; url: string }>
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/** Pure decision, exported for tests: may this request leave the browser? */
export function isRequestAllowed(method: string, url: string, allow: readonly AllowRule[]): boolean {
  const m = method.toUpperCase()
  if (READ_METHODS.has(m)) return true
  let path: string
  try {
    const u = new URL(url)
    path = u.pathname + u.search
  } catch {
    return false
  }
  return allow.some((rule) => {
    const space = rule.indexOf(' ')
    const ruleMethod = space > 0 ? rule.slice(0, space).toUpperCase() : null
    const ruleGlob = space > 0 ? rule.slice(space + 1).trim() : rule.trim()
    if (ruleMethod && ruleMethod !== m) return false
    return globToRegExp(ruleGlob).test(path)
  })
}

const DESTRUCTIVE_RE =
  /\b(delete|remove|destroy|erase|discard|revoke|disconnect|uninstall|archive|cancel (?:plan|subscription)|pay|purchase|buy|checkout|charge|send|submit|publish|merge|deploy|log ?out|sign ?out|reset)\b/i

/** Pure: should discovery refuse to click an element with this label? */
export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE_RE.test(label)
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

export async function installGuard(context: BrowserContext, allow: readonly AllowRule[]): Promise<GuardLog> {
  const log: GuardLog = { blocked: [] }
  await context.addInitScript({ content: NO_SUBMIT_SCRIPT })
  await context.route('**/*', async (route) => {
    const req = route.request()
    if (isRequestAllowed(req.method(), req.url(), allow)) return route.continue()
    log.blocked.push({ method: req.method(), url: req.url() })
    return route.abort('blockedbyclient')
  })
  return log
}

/** Console text Chromium prints for a request the guard aborted. */
export function isGuardNoise(text: string): boolean {
  return /ERR_BLOCKED_BY_CLIENT/.test(text)
}
