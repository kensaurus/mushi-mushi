/**
 * Smoke test for enhanced Explore page.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const PROJECT_ID = '67a6453c-375d-41d7-833a-b33471159442'

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

test.describe('Explore enhanced shell', () => {
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

  test('overview loads banner, KPI strip, and tabs', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/explore?tab=overview`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 3000 }).catch(() => {})
    await expect(page.getByText('EXPLORE SNAPSHOT', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Explore sections')).toBeVisible()
    await expect(page.getByLabel('Explore sections').getByRole('radio', { name: 'Overview' })).toBeChecked()
  })

  test('graph tab loads (default)', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/explore`, { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Explore sections').getByRole('radio', { name: 'Graph' })).toBeChecked()
  })

  test('index tab loads', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/explore?tab=index`, { waitUntil: 'networkidle' })
    await expect(page.getByLabel('Explore sections').getByRole('radio', { name: 'Index' })).toBeChecked()
    await expect(page.getByText('Indexer debug')).toBeVisible()
  })
})
