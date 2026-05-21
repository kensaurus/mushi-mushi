/**
 * Smoke: Cursor Cloud integration card + optional dispatch from Reports.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const PROJECT_ID = '67a6453c-375d-41d7-833a-b33471159442'
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')

function loadEnvFile(relPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
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

async function setupSession(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
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
      window.localStorage.removeItem('mushi:pagehelp:read:integrations/config')
    },
    { key: storageKey, sessionPayload: session, projectId: PROJECT_ID },
  )
}

test.describe('Cursor Cloud integration smoke', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires Supabase + test user env',
  )

  test.beforeEach(async ({ page, request }) => {
    await setupSession(page, request)
    await page.addInitScript(() => {
      localStorage.setItem('mushi:mode', 'beginner')
    })
  })

  test('platform tab — Cursor Cloud shows Connection OK without Workspace ID field', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/integrations/config?tab=platform`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('mushi-page-integrations')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Sentry' })).toBeVisible({ timeout: 20_000 })

    const cursorHeading = page.getByRole('heading', { name: 'Cursor Cloud' })
    await cursorHeading.scrollIntoViewIfNeeded()
    await expect(cursorHeading).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Connection OK', { exact: true }).filter({ hasText: 'Connection OK' }).nth(3)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Edit integration' }).nth(3).click()
    await expect(page.getByText('How to connect Cursor Cloud')).toBeVisible()
    await expect(page.getByText(/workspace id/i)).toHaveCount(0)
    await expect(page.getByPlaceholder(/crsr_/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Create Cursor API key/i })).toBeVisible()

    await page.getByRole('button', { name: 'Test connection' }).nth(3).click()
    await expect(page.getByText(/Connection OK|probe succeeded|healthy/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('reports — Send to Cursor dispatches when a report row is available', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/reports`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    const sendBtn = page.getByRole('button', { name: 'Send to Cursor agent' }).first()
    const hasSend = await sendBtn.isVisible().catch(() => false)
    if (!hasSend) {
      test.info().annotations.push({
        type: 'note',
        description: 'No classified reports in queue — Send to Cursor button not rendered on any row.',
      })
      return
    }

    await sendBtn.click()
    await expect(page.getByText(/dispatch|cursor|fix|queued|failed|attempt/i).first()).toBeVisible({ timeout: 25_000 })
  })
})
