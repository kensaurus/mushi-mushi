/**
 * Smoke test for enhanced Inbox page.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const PROJECT_ID = '67a6453c-375d-41d7-833a-b33471159442'
/** glot.it — reproduces the blank Overview regression when stats/cards desync. */
const GLOT_PROJECT_ID =
  process.env.MUSHI_INBOX_TEST_PROJECT_ID ?? '542b34e0-019e-41fe-b900-7b637717bb86'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 700 },
  { name: 'narrow', width: 800, height: 700 },
] as const

function loadEnvFile(relPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(resolve(__dirname, '../../../', relPath), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.replace(/\r$/, '').trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
    }
  } catch {
    /* optional */
  }
  return out
}

const rootEnv = loadEnvFile('.env.local')
const adminEnv = loadEnvFile('apps/admin/.env')
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? adminEnv.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? adminEnv.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? rootEnv.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? rootEnv.TEST_USER_PASSWORD ?? ''

const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? 'dxptnwrhwsqckaftyymj'
const storageKey = `sb-${ref}-auth-token`

test.describe('Inbox enhanced shell', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires Supabase + test user env',
  )

  test.beforeEach(async ({ page, request }) => {
    const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
    })
    expect(res.ok()).toBeTruthy()
    const session = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      expires_at?: number
      token_type: string
      user: Record<string, unknown>
    }
    await page.addInitScript(
      ({ key, sessionPayload, projectId }) => {
        const expiresAt =
          sessionPayload.expires_at ??
          Math.floor(Date.now() / 1000) + (sessionPayload.expires_in ?? 3600)
        window.localStorage.setItem(
          key,
          JSON.stringify({
            ...sessionPayload,
            expires_at: expiresAt,
          }),
        )
        window.localStorage.setItem('mushi:active_project_id', projectId)
      },
      {
        key: storageKey,
        sessionPayload: session,
        projectId: PROJECT_ID,
      },
    )
  })

  async function seedProject(page: import('@playwright/test').Page, projectId: string) {
    await page.addInitScript((pid) => {
      window.localStorage.setItem('mushi:active_project_id', pid)
    }, projectId)
  }

  async function dismissBetaBanner(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 3000 }).catch(() => {})
  }

  test('overview tab body is never blank (default project)', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/inbox`, { waitUntil: 'networkidle' })
    await dismissBetaBanner(page)
    const overview = page.locator('[data-inbox-overview-state]')
    await expect(overview).toBeVisible()
    await expect(overview).toHaveAttribute('data-inbox-overview-state', /^(clear|handoff|preview|setup)$/)
    await expect(overview).not.toBeEmpty()
    await expect(overview.getByText(/Inbox zero|open action|Setup incomplete|Top priority|Summarized above/i)).toBeVisible()
  })

  test('overview tab body is never blank (glot.it project)', async ({ page }) => {
    await seedProject(page, GLOT_PROJECT_ID)
    await page.goto(
      `${ADMIN_URL}/inbox?project=${encodeURIComponent(GLOT_PROJECT_ID)}`,
      { waitUntil: 'networkidle' },
    )
    await dismissBetaBanner(page)
    const overview = page.locator('[data-inbox-overview-state]')
    await expect(overview).toBeVisible()
    await expect(overview).not.toBeEmpty()
  })

  for (const viewport of VIEWPORTS) {
    test(`overview renders at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`${ADMIN_URL}/inbox`, { waitUntil: 'networkidle' })
      await dismissBetaBanner(page)
      const overview = page.locator('[data-inbox-overview-state]')
      await expect(overview).toBeVisible()
      await page.screenshot({
        path: `apps/admin/.playwright-mcp/inbox-overview-${viewport.name}.png`,
        fullPage: false,
      })
    })
  }

  test('overview loads banner, KPI strip, and tabs', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/inbox`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 3000 }).catch(() => {})
    await expect(page.getByRole('heading', { name: /to-do list|Inbox|Action inbox/i }).first()).toBeVisible()
    await expect(page.getByText('INBOX SNAPSHOT', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Inbox sections')).toBeVisible()
    await expect(page.getByLabel('Inbox sections').getByRole('radio', { name: 'Overview' })).toBeVisible()
  })

  test('actions tab loads', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/inbox?tab=actions`, { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Inbox sections').getByRole('radio', { name: 'Actions' })).toBeChecked()
  })

  test('stages tab loads', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/inbox?tab=stages`, { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Inbox sections').getByRole('radio', { name: 'Stages' })).toBeChecked()
  })

  test('activity tab loads', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/inbox?tab=activity`, { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Inbox sections').getByRole('radio', { name: 'Activity' })).toBeChecked()
  })
})
