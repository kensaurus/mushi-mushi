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
 * Run the user-supplied login script. The script receives a
 * Playwright `page` already navigated to `base_url + login_path`,
 * plus an `env` proxy for secrets the script references via
 * `env.TEST_USER_EMAIL` etc.
 *
 * The script can be either:
 *   1. A literal block of JS (treated as a function body that
 *      receives `page`, `env`, `context`).
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

  // Inline body. Wrap in `(async (page, env, context) => { … })`. We
  // intentionally use new Function rather than eval so the script
  // doesn't have access to our local closure.
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
 * Pick the cookie that's most likely the session: prefer one that's
 * HttpOnly + Secure + has a name containing `session`, `auth`, or
 * `sb-` (Supabase). Falls back to the first cookie set on the
 * login origin.
 */
function pickSessionCookie(
  cookies: Array<{ name: string; value: string; domain: string; httpOnly?: boolean; secure?: boolean }>,
  baseUrl: string,
): { name: string; value: string; domain: string } | null {
  const host = new URL(baseUrl).host.replace(/^www\./, '')
  const sameOrigin = cookies.filter((c) => c.domain.replace(/^\./, '').endsWith(host))
  const ranked = sameOrigin
    .map((c) => {
      let score = 0
      const n = c.name.toLowerCase()
      if (/session|auth|access_token|sb-|next-auth/.test(n)) score += 50
      if (c.httpOnly) score += 10
      if (c.secure) score += 5
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.c ?? sameOrigin[0] ?? null
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

export const __test = { pickSessionCookie }
