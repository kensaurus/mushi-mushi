/**
 * RealWorld/Conduit dogfood journey.
 *
 * Proves the Mushi capture → ingest → MCP loop against both Conduit
 * frontends and the Express backend:
 *
 *  1. Conduit API contract (Token auth, limit/offset, error shape).
 *  2. @mushi-mushi/node captures the deliberate server error (scrubbed).
 *  3. Widget-driven FULL report from each frontend — asserts the wire
 *     payload's networkLogs (limit/offset, scrubbed values), route timeline
 *     (path router AND hash router), and console capture.
 *  4. Headless capture path (createHeadlessCapture exposed by fixtures).
 *  5. Discovery inventory receives templated hash routes + fragment
 *     query KEYS (never values).
 *  6. MCP dogfood: stdio client drives get_recent_reports →
 *     get_report_detail → get_fix_context → run_nl_query against a real
 *     project when MUSHI_PROJECT_ID + MUSHI_API_KEY are set.
 *
 * Hermetic by default: all SDK traffic lands on tests/ingest-stub.mjs.
 * Gated behind MUSHI_REALWORLD=1 via the root `e2e:realworld` script.
 */

import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUSHI_MCP_ENABLED } from '../playwright.config'

const STUB_BASE = 'http://localhost:4199'
const REACT_BASE = 'http://localhost:4102'
const HASH_BASE = 'http://localhost:4103'
const BACKEND_BASE = 'http://localhost:4101'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

// ─────────────────────────────────────────────────────────────────────────────
// Stub helpers
// ─────────────────────────────────────────────────────────────────────────────

type StubRecord = Record<string, unknown>

async function stubGet(collection: 'reports' | 'spans' | 'discovery'): Promise<StubRecord[]> {
  const res = await fetch(`${STUB_BASE}/__stub/${collection}`)
  return (await res.json()) as StubRecord[]
}

async function stubReset(): Promise<void> {
  await fetch(`${STUB_BASE}/__stub/reset`, { method: 'POST' })
}

async function waitForStub(
  collection: 'reports' | 'spans' | 'discovery',
  predicate: (records: StubRecord[]) => boolean,
  timeoutMs = 15_000,
): Promise<StubRecord[]> {
  const deadline = Date.now() + timeoutMs
  let last: StubRecord[] = []
  while (Date.now() < deadline) {
    last = await stubGet(collection)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `Timed out waiting on stub ${collection}; got ${last.length} records: ${JSON.stringify(last).slice(0, 400)}`,
  )
}

/**
 * Drive the real Mushi widget to file a full report: open trigger → pick Bug
 * category → type description → submit.
 *
 * The widget has a multi-step flow (01/03 category picker → 02/03 form → 03/03
 * confirmation). Playwright CSS locators pierce the widget's open shadow DOM.
 */
async function submitWidgetReport(page: Page, description: string): Promise<void> {
  // Step 1: open the widget by clicking the edge-tab trigger
  await page.locator('.mushi-trigger').first().click()

  // Step 2: widget opens to the category picker (01/03).
  // Pick "Bug" — rendered with data-category="bug" (role="radio").
  const bugBtn = page.locator('[data-category="bug"]').first()
  await bugBtn.waitFor({ state: 'visible', timeout: 10_000 })
  await bugBtn.click()

  // Step 3: intent picker (02/03) — pick first available intent.
  // Widget goes: category → intent → details(textarea). For custom categories
  // with no intents the widget jumps directly to details; wait for either.
  const intentOrTextarea = page.locator('[data-intent], .mushi-textarea').first()
  await intentOrTextarea.waitFor({ state: 'visible', timeout: 10_000 })
  const firstLocator = await intentOrTextarea.evaluate((el: Element) =>
    el.hasAttribute('data-intent'),
  )
  if (firstLocator) {
    // Intent step — click the first intent to advance to details
    await page.locator('[data-intent]').first().click()
  }

  // Step 4: textarea is now visible in the details step (03/03)
  const textarea = page.locator('.mushi-textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 10_000 })
  await textarea.fill(description)

  // Step 5: submit
  await page.locator('button[data-action="submit"]').first().click()
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Backend health + Conduit API contract
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('conduit backend contract', () => {
  test('backend fixture is healthy', async ({ request }) => {
    const res = await request.get(`${BACKEND_BASE}/health`)
    expect(res.ok()).toBe(true)
  })

  test('articles list honors limit/offset pagination and tag filter', async ({ request }) => {
    const r1 = await request.get(`${BACKEND_BASE}/api/articles?limit=2&offset=0`)
    const b1 = (await r1.json()) as { articles: unknown[]; articlesCount: number }
    expect(b1.articlesCount).toBeGreaterThanOrEqual(3)
    expect(b1.articles.length).toBe(2)

    const r2 = await request.get(`${BACKEND_BASE}/api/articles?limit=2&offset=2`)
    const b2 = (await r2.json()) as { articles: Array<{ slug: string }> }
    expect(b2.articles.length).toBeGreaterThanOrEqual(1)

    const r3 = await request.get(`${BACKEND_BASE}/api/articles?tag=dragons&limit=10&offset=0`)
    const b3 = (await r3.json()) as { articles: Array<{ tagList: string[] }> }
    expect(b3.articles.length).toBeGreaterThanOrEqual(2)
    expect(b3.articles.every((a) => a.tagList.includes('dragons'))).toBe(true)
  })

  test('login issues a Token-scheme JWT; favorite requires it', async ({ request }) => {
    const bad = await request.post(`${BACKEND_BASE}/api/users/login`, {
      data: { user: { email: 'wrong@x.com', password: 'nope' } },
    })
    expect(bad.status()).toBe(422)
    const badBody = (await bad.json()) as { errors: { body: string[] } }
    expect(Array.isArray(badBody.errors.body)).toBe(true)

    const ok = await request.post(`${BACKEND_BASE}/api/users/login`, {
      data: { user: { email: 'jake@example.com', password: 'password' } },
    })
    expect(ok.ok()).toBe(true)
    const { user } = (await ok.json()) as { user: { token: string } }
    expect(user.token).toMatch(/^eyJ/)

    const unauth = await request.post(
      `${BACKEND_BASE}/api/articles/how-to-train-your-dragon/favorite`,
    )
    expect(unauth.status()).toBe(401)

    const fav = await request.post(
      `${BACKEND_BASE}/api/articles/how-to-train-your-dragon/favorite`,
      { headers: { Authorization: `Token ${user.token}` } },
    )
    expect(fav.ok()).toBe(true)
    const favBody = (await fav.json()) as { article: { favorited: boolean } }
    expect(favBody.article.favorited).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Node SDK server-error capture (+ scrub parity)
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('node SDK capture', () => {
  test('captures the deliberate server error, with query values scrubbed', async ({
    request,
  }) => {
    await stubReset()
    const res = await request.get(
      `${BACKEND_BASE}/api/articles/how-to-train-your-dragon/comments?token=supersecret&tag=dragons`,
    )
    expect(res.status()).toBe(500)

    const reports = await waitForStub('reports', (r) => r.length >= 1)
    const raw = JSON.stringify(reports)
    expect(raw).toContain('comments are not implemented')
    expect(raw).not.toContain('supersecret')
    expect(raw).toContain('token=[Scrubbed]')
    expect(raw).toContain('tag=dragons')

    const rep = reports[0]!
    expect(rep['category']).toBe('bug')
    expect(rep['sdkPackage']).toContain('node')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Path-router frontend — widget-driven full report
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('path-router frontend (react-vite)', () => {
  test('journey: browse → paginate by tag → article error → widget report', async ({ page }) => {
    await stubReset()

    await page.goto(`${REACT_BASE}/`)
    await expect(page.locator('[data-testid="article-list"]')).toBeVisible()

    // Tag filter → fires /api/articles?limit=10&offset=0&tag=… fetches.
    await page.locator('[data-testid="tag-dragons"]').click()
    await expect(page).toHaveURL(/tag=dragons/)
    await expect(page.locator('[data-testid="article-list"] li').first()).toBeVisible()

    // Article navigation via pushState (stays within SPA session — network
    // capture accumulates across all navigations, no full-page reload).
    await page.locator('[data-testid^="article-link-"]').first().click()
    await expect(page).toHaveURL(/\/article\//)
    await expect(page.locator('[data-testid="article-title"]')).toBeVisible()
    await page.locator('[data-testid="back-home"]').click()
    await expect(page.locator('[data-testid="article-list"]')).toBeVisible()

    // Broken article — navigate via pushState so the SDK ring-buffer retains
    // all prior requests captured during this page session.
    await page.evaluate(() => {
      history.pushState({}, '', '/article/nonexistent-slug')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.locator('[data-testid="article-error"]')).toBeVisible()

    // File a report through the real widget.
    await submitWidgetReport(page, 'Conduit journey: article page failed to load')

    const reports = await waitForStub('reports', (r) =>
      r.some((rep) => JSON.stringify(rep).includes('article page failed to load')),
    )
    const rep = reports.find((r) => JSON.stringify(r).includes('article page failed to load'))!

    // Pillar 1: network capture — limit/offset article-list calls present,
    // query keys preserved, no sensitive values.
    const networkLogs = (rep['networkLogs'] ?? []) as Array<{ url: string }>
    expect(networkLogs.length).toBeGreaterThan(0)
    const urls = networkLogs.map((n) => n.url).join(' ')
    expect(urls).toContain('limit=10')
    expect(urls).toContain('offset=0')
    expect(urls).toContain('tag=dragons')

    // Pillar 2: route timeline — pushState navigations recorded.
    const timeline = (rep['timeline'] ?? []) as Array<{
      kind: string
      payload: Record<string, unknown>
    }>
    const routeEntries = timeline.filter((t) => t.kind === 'route')
    expect(routeEntries.length).toBeGreaterThan(0)
    const routes = routeEntries.map((t) => String(t.payload['route'] ?? ''))
    expect(routes.some((r) => r.includes('/article/'))).toBe(true)

    // Pillar 3: console capture — the app's console.error made it in.
    const consoleLogs = (rep['consoleLogs'] ?? []) as Array<{ level: string; message: string }>
    expect(consoleLogs.some((c) => c.level === 'error' && c.message.includes('Failed to load article'))).toBe(true)
  })

  test('headless capture posts a report from app code', async ({ page }) => {
    await stubReset()
    await page.goto(`${REACT_BASE}/`)
    const ok = await page.evaluate(async () => {
      const w = window as Window & {
        __mushiHeadless?: { captureEvent: (e: unknown) => Promise<{ ok: boolean }> }
      }
      if (!w.__mushiHeadless) return null
      return w.__mushiHeadless.captureEvent({
        description: 'headless probe from path-router fixture',
        category: 'bug',
      })
    })
    expect(ok).not.toBeNull()
    const reports = await waitForStub('reports', (r) =>
      r.some((rep) => JSON.stringify(rep).includes('headless probe from path-router')),
    )
    expect(reports.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hash-router frontend — hash timeline + discovery inventory
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('hash-router frontend (vanilla web SDK)', () => {
  test('journey: hash navigation → widget report carries hash route timeline', async ({
    page,
  }) => {
    await stubReset()

    await page.goto(`${HASH_BASE}/#/`)
    await expect(page.locator('[data-testid="article-list"]')).toBeVisible()

    // Hash navigations (the RealWorld routing spec).
    await page.locator('[data-testid^="article-link-"]').first().click()
    await expect(page).toHaveURL(/#\/article\//)
    await expect(page.locator('[data-testid="article-title"]')).toBeVisible()

    await page.locator('[data-testid="back-home"]').click()
    await expect(page).toHaveURL(/#\/$/)

    await page.locator('[data-testid="nav-login"]').click()
    await expect(page).toHaveURL(/#\/login/)
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible()

    // File a report through the real widget; its timeline must contain the
    // hash-route navigations.
    await submitWidgetReport(page, 'Conduit journey: hash-router timeline check')

    const reports = await waitForStub('reports', (r) =>
      r.some((rep) => JSON.stringify(rep).includes('hash-router timeline check')),
    )
    const rep = reports.find((r) => JSON.stringify(r).includes('hash-router timeline check'))!

    const timeline = (rep['timeline'] ?? []) as Array<{
      kind: string
      payload: Record<string, unknown>
    }>
    const routes = timeline
      .filter((t) => t.kind === 'route')
      .map((t) => String(t.payload['route'] ?? ''))
    expect(routes.some((r) => r.includes('#/article/'))).toBe(true)
    expect(routes.some((r) => r.includes('#/login'))).toBe(true)

    // Network capture works identically under the hash router.
    const networkLogs = (rep['networkLogs'] ?? []) as Array<{ url: string }>
    const urls = networkLogs.map((n) => n.url).join(' ')
    expect(urls).toContain('limit=10')
  })

  test('discovery inventory receives templated hash routes and query KEYS only', async ({
    page,
  }) => {
    await stubReset()
    await page.goto(`${HASH_BASE}/#/?tag=dragons&limit=10`)
    await expect(page.locator('[data-testid="article-list"]')).toBeVisible()

    // Wait for the initial discovery event (100ms timer) to fire and reach the
    // stub BEFORE clicking the article. This ensures the event is captured while
    // `location.hash` still contains `?tag=dragons&limit=10` (race prevention).
    await waitForStub('discovery', (d) => d.length >= 1, 10_000)

    // Navigate to an article so a second inventory route emits.
    await page.locator('[data-testid^="article-link-"]').first().click()
    await expect(page).toHaveURL(/#\/article\//)

    const discovery = await waitForStub('discovery', (d) => d.length >= 1)
    const raw = JSON.stringify(discovery)

    // Hash routes present, with the /# prefix the SDK derives.
    expect(raw).toContain('/#/')

    // Query KEYS collected, values never shipped.
    const flat = discovery.flatMap((d) => {
      // events may be batched or single, tolerate both shapes
      const events = (d['events'] as StubRecord[] | undefined) ?? [d]
      return events
    })
    const keys = flat.flatMap((e) => (e['query_param_keys'] as string[] | undefined) ?? [])
    expect(keys).toContain('tag')
    expect(keys).toContain('limit')
    expect(raw).not.toContain('tag=dragons')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. MCP dogfood — stdio client over just-produced real reports
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('MCP dogfood (real project)', () => {
  test.skip(
    !MUSHI_MCP_ENABLED,
    'set MUSHI_PROJECT_ID + MUSHI_API_KEY (+ optional MUSHI_API_ENDPOINT) to enable',
  )

  test('get_recent_reports → get_report_detail → get_fix_context → run_nl_query', async () => {
    test.setTimeout(120_000)
    // Same launch contract as packages/mcp/scripts/smoke-stdio.mjs.
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(REPO_ROOT, 'packages', 'mcp', 'dist', 'index.js')],
      env: {
        ...process.env,
        MUSHI_API_KEY: process.env['MUSHI_API_KEY']!,
        MUSHI_PROJECT_ID: process.env['MUSHI_PROJECT_ID']!,
        ...(process.env['MUSHI_API_ENDPOINT']
          ? { MUSHI_API_ENDPOINT: process.env['MUSHI_API_ENDPOINT'] }
          : {}),
        MUSHI_FEATURES: 'all',
      },
    })
    const client = new Client({ name: 'realworld-dogfood', version: '0.0.1' })
    await client.connect(transport)

    try {
      const asText = (r: unknown): string =>
        JSON.stringify((r as { content?: unknown }).content ?? r)

      const recent = await client.callTool({
        name: 'get_recent_reports',
        arguments: { limit: 5 },
      })
      expect(recent.isError ?? false).toBe(false)
      const recentText = asText(recent)
      expect(recentText.length).toBeGreaterThan(0)

      // Pull a report id out of the recent-reports payload if one exists.
      const idMatch = recentText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
      if (idMatch) {
        const detail = await client.callTool({
          name: 'get_report_detail',
          arguments: { report_id: idMatch[0] },
        })
        expect(detail.isError ?? false).toBe(false)

        const fixCtx = await client.callTool({
          name: 'get_fix_context',
          arguments: { report_id: idMatch[0] },
        })
        // fix context may legitimately error for un-triaged reports — assert
        // it responds with structured content either way.
        expect(asText(fixCtx).length).toBeGreaterThan(0)
      }

      const nl = await client.callTool({
        name: 'run_nl_query',
        arguments: { query: 'What errors happened most recently?' },
      })
      expect(asText(nl).length).toBeGreaterThan(0)
    } finally {
      await client.close()
    }
  })
})
