/**
 * @mushi-mushi/inventory-auth-runner — Mushi v2.1 §5 (whitepaper §6 hybrid mode).
 *
 * What this does
 * ──────────────
 * Reads the project's currently-ingested `inventory.yaml`, finds the
 * `auth.scripted` block, runs the login script via Playwright, then
 * POSTs the captured cookies to `/v1/admin/inventory/:projectId/settings`
 * so the Mushi crawler + synthetic monitor + observed-route diffing
 * can reach auth-gated routes.
 *
 * What it does NOT do
 * ───────────────────
 *   - It does not run user-supplied JS in a privileged context. The
 *     `script` field is executed inside Playwright's page.* API only —
 *     i.e. anything the host app could already do via the browser.
 *   - It does not store credentials on the Mushi server. The runner
 *     reads creds from the local environment (`TEST_USER_EMAIL`,
 *     `TEST_USER_PASSWORD`, or whatever the `script` references) and
 *     only ships the resulting *cookie* to the server.
 *
 * Security model
 * ──────────────
 *   - Cookies are written to `project_settings.crawler_auth_config.value`
 *     via the existing settings PATCH endpoint, which RLS-gates on
 *     project membership.
 *   - The runner refuses to run if `MUSHI_API_KEY` doesn't have the
 *     `mcp:write` scope (server allowlist: `report:write`, `mcp:read`,
 *     `mcp:write`).
 *   - The cookie has a soft TTL via `last_refreshed_at`; the user
 *     should re-run this on a daily cron or after every CI deploy.
 *
 * Typical invocation
 * ──────────────────
 *   $ MUSHI_API_KEY=… MUSHI_PROJECT=… \
 *     TEST_USER_EMAIL=qa@example.com TEST_USER_PASSWORD=… \
 *     npx mushi-mushi-auth refresh
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test'

export interface RunnerOptions {
  apiEndpoint: string
  apiKey: string
  projectId: string
  /** When true, prints the cookie value to stdout. NEVER true in CI. */
  debug?: boolean
}

export interface ScriptedAuthBlock {
  type: 'scripted'
  config: {
    login_path: string
    script: string
  }
}

interface InventorySnapshot {
  parsed: {
    app: { id: string; base_url: string }
    auth?: ScriptedAuthBlock
  }
}

interface SettingsResponse {
  ok: boolean
  data?: { crawler_base_url: string | null }
  error?: { code: string; message: string }
}

async function api<T>(opts: {
  endpoint: string
  apiKey: string
  projectId: string
  path: string
  init?: RequestInit
}): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  const res = await fetch(`${opts.endpoint}${opts.path}`, {
    ...opts.init,
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': opts.apiKey,
      'X-Mushi-Project': opts.projectId,
      ...(opts.init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: { ok: boolean; data?: T; error?: { code: string; message: string } }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    body = { ok: false, error: { code: `HTTP_${res.status}`, message: text.slice(0, 500) } }
  }
  return body
}

async function loadInventory(opts: RunnerOptions): Promise<InventorySnapshot> {
  const r = await api<InventorySnapshot>({
    endpoint: opts.apiEndpoint,
    apiKey: opts.apiKey,
    projectId: opts.projectId,
    path: `/v1/admin/inventory/${opts.projectId}`,
  })
  if (!r.ok || !r.data) {
    throw new Error(`Could not load inventory: ${r.error?.message ?? 'unknown'}`)
  }
  return r.data
}

/**
 * Patterns rejected from inline `auth.scripted` bodies. Inline scripts
 * are meant to drive Playwright's `page.*` / `context.*` API only —
 * anything they could otherwise reach (Node `require`, `process.env`
 * direct read, dynamic `import`, child process spawn) belongs in a
 * checked-in `js:./scripts/login.js` file the team can review.
 *
 * The runner deliberately blocks these tokens in inline scripts so
 * a malicious or accidentally-broken inventory.yaml can't escalate
 * out of the Playwright sandbox into the runner's host environment.
 *
 * Block list rationale (each entry has caused a real-world escalation
 * in some sandboxed-eval environment):
 *   - `require`            — Node CommonJS escape into fs/child_process.
 *   - `import(`            — dynamic ESM import; bypass.
 *   - `process.`           — env exfiltration, exit, kill.
 *   - `globalThis.`        — generic escape.
 *   - `Function(`          — second-order eval inside the eval.
 *   - `eval(`              — same.
 *   - `child_process`      — dangerous module name even if quoted.
 *   - `Deno.`              — Deno-specific escape if the runner
 *                            ever ships in a hybrid environment.
 *   - `Worker(`            — out-of-process escape via Web Workers.
 */
const INLINE_SCRIPT_DENY = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\s*\./,
  /\bglobalThis\s*\./,
  /\bFunction\s*\(/,
  /\beval\s*\(/,
  /\bchild_process\b/,
  /\bDeno\s*\./,
  /\bWorker\s*\(/,
] as const

const MAX_INLINE_SCRIPT_LEN = 8 * 1024

/**
 * Validate an inline `auth.scripted` body before handing it to
 * `new Function`. Throws with a precise reason so the inventory
 * editor knows what to remove or move into a `js:` file.
 *
 * Exported for tests; not part of the package's public API.
 */
export function validateInlineAuthScript(script: string): void {
  if (typeof script !== 'string') {
    throw new Error('auth.scripted body must be a string')
  }
  if (script.length > MAX_INLINE_SCRIPT_LEN) {
    throw new Error(
      `auth.scripted body is ${script.length} chars; limit is ${MAX_INLINE_SCRIPT_LEN}. ` +
        'Move the script to a js:./scripts/login.js file instead.',
    )
  }
  for (const re of INLINE_SCRIPT_DENY) {
    const hit = re.exec(script)
    if (hit) {
      throw new Error(
        `auth.scripted inline body contains a forbidden token: \`${hit[0]}\`. ` +
          'Inline scripts may only call Playwright methods on the supplied `page` / `context` ' +
          'arguments. For anything else, move the script to a js:./scripts/login.js file.',
      )
    }
  }
}

/**
 * Run the user-supplied login script. The script receives a
 * Playwright `page` already navigated to `base_url + login_path`,
 * plus an `env` proxy for secrets the script references via
 * `env.TEST_USER_EMAIL` etc.
 *
 * The script can be either:
 *   1. A literal block of JS (treated as a function body that
 *      receives `page`, `env`, `context`). Validated against
 *      `INLINE_SCRIPT_DENY` before execution.
 *   2. A reference like `js:./scripts/login.js` (loaded from disk
 *      relative to CWD — handy for committing the script to your
 *      repo without inline-escaping JS into YAML).
 */
async function runLoginScript(
  page: Page,
  context: BrowserContext,
  script: string,
): Promise<void> {
  const env = new Proxy(
    {},
    {
      get(_t, key: string) {
        return process.env[key]
      },
    },
  )

  if (script.startsWith('js:')) {
    const path = script.slice(3).trim()
    const mod = (await import(path)) as { default?: (page: Page, env: unknown, ctx: BrowserContext) => Promise<void> }
    if (typeof mod.default !== 'function') {
      throw new Error(`auth.scripted file ${path} must default-export a function`)
    }
    await mod.default(page, env, context)
    return
  }

  // Inline body. Validate first — block obvious sandbox-escape
  // primitives before they reach `new Function`. We still use
  // `new Function` rather than `eval` so the script doesn't see our
  // local closure, but that alone is not enough security if a script
  // can call `require('child_process')`.
  validateInlineAuthScript(script)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'page',
    'env',
    'context',
    `return (async () => { ${script} })()`,
  ) as (p: Page, e: unknown, c: BrowserContext) => Promise<void>
  await fn(page, env, context)
}

/**
 * Known analytics / advertising / fingerprinting cookies. We refuse to
 * EVER pick one of these as the session cookie even if it's the only
 * cookie set, because submitting `_ga` to project_settings would tell
 * the crawler to send a useless cookie on every request and silently
 * fail every auth-gated route until someone manually wipes the
 * setting.
 *
 * Match is case-insensitive and uses startsWith so vendor-versioned
 * variants (`_ga_ABCDEF`, `_gid_v2`) all match. Add new entries here
 * if the runner picks a tracking cookie in production.
 */
const ANALYTICS_COOKIE_PREFIXES = [
  '_ga',           // Google Analytics
  '_gid',          // Google Analytics
  '_gat',          // Google Analytics throttling
  '_gcl_',         // Google Ads
  '_fbp',          // Facebook Pixel
  '__utm',         // Urchin / GA legacy
  'ajs_',          // Segment
  '_hp2_',         // Heap
  '_hjid',         // Hotjar
  '_hjSession',    // Hotjar
  '_mkto_trk',     // Marketo
  '__hstc',        // HubSpot
  'hubspotutk',    // HubSpot
  'mp_',           // Mixpanel
  'amplitude_',    // Amplitude
  '_pk_',          // Piwik
  'di2',           // Lucky Orange
  'optimizelyEndUserId',
] as const

/**
 * Score-based session cookie picker.
 *
 * Returns the highest-scoring cookie when a single cookie clearly looks
 * like a session (httpOnly + secure + a session-y name), otherwise
 * returns null and lets the caller surface a clear error message
 * instead of writing analytics garbage into project_settings.
 *
 * Exported for tests; not part of the package's public API.
 */
export function pickSessionCookie(
  cookies: Array<{ name: string; value: string; domain: string; httpOnly?: boolean; secure?: boolean }>,
  baseUrl: string,
): { name: string; value: string; domain: string } | null {
  const host = new URL(baseUrl).host.replace(/^www\./, '')
  const sameOrigin = cookies.filter((c) => c.domain.replace(/^\./, '').endsWith(host))
  const eligible = sameOrigin.filter((c) => !isAnalyticsCookie(c.name))

  const ranked = eligible
    .map((c) => {
      let score = 0
      const n = c.name.toLowerCase()
      if (/session|auth|access_token|sb-|next-auth|connect\.sid|jwt|token/.test(n)) score += 50
      if (c.httpOnly) score += 10
      if (c.secure) score += 5
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)

  // Require either an explicit session-class name match (score ≥ 50) or
  // an httpOnly+secure cookie (score ≥ 15). Anything below that is too
  // ambiguous to write back to project_settings without confirmation.
  const top = ranked[0]
  if (!top) return null
  if (top.score >= 15) return top.c
  return null
}

function isAnalyticsCookie(name: string): boolean {
  const lower = name.toLowerCase()
  return ANALYTICS_COOKIE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))
}

export async function refresh(opts: RunnerOptions): Promise<{ cookieName: string; domain: string }> {
  const inv = await loadInventory(opts)
  if (!inv.parsed?.auth || inv.parsed.auth.type !== 'scripted') {
    throw new Error("Project's current inventory.yaml has no `auth.scripted` block; nothing to refresh.")
  }
  const baseUrl = inv.parsed.app.base_url
  const loginUrl = new URL(inv.parsed.auth.config.login_path, baseUrl).toString()

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(loginUrl, { waitUntil: 'networkidle' })
    await runLoginScript(page, context, inv.parsed.auth.config.script)

    // Settle for one networkidle; many login flows redirect after submit.
    await page.waitForLoadState('networkidle').catch(() => undefined)

    const cookies = await context.cookies()
    const session = pickSessionCookie(cookies, baseUrl)
    if (!session) {
      throw new Error('No cookies were set on the login domain after the script ran.')
    }
    const r = await api<SettingsResponse>({
      endpoint: opts.apiEndpoint,
      apiKey: opts.apiKey,
      projectId: opts.projectId,
      path: `/v1/admin/inventory/${opts.projectId}/settings`,
      init: {
        method: 'PATCH',
        body: JSON.stringify({
          crawler_auth_config: {
            type: 'cookie',
            config: {
              name: session.name,
              value: session.value,
              domain: session.domain,
            },
          },
        }),
      },
    })
    if (!r.ok) {
      throw new Error(`Failed to write cookie back to project_settings: ${r.error?.message ?? 'unknown'}`)
    }
    if (opts.debug) {
      console.log(`[mushi-mushi-auth] cookie ${session.name} captured (${session.value.slice(0, 6)}…)`)
    }
    return { cookieName: session.name, domain: session.domain }
  } finally {
    await browser.close()
  }
}

/**
 * Internal helpers exposed for unit tests. Not part of the public API —
 * any consumer importing these is on their own across versions.
 */
export const __test = {
  pickSessionCookie,
  validateInlineAuthScript,
  isAnalyticsCookie,
  INLINE_SCRIPT_DENY,
  ANALYTICS_COOKIE_PREFIXES,
  MAX_INLINE_SCRIPT_LEN,
}
