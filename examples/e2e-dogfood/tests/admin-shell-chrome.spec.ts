/**
 * Shell chrome alignment — sidebar logo row vs desktop sub-header, token floor
 * on sidebar footer controls, org switcher dropdown stacking.
 *
 * Requires: MUSHI_ADMIN_URL, Supabase auth env (same as admin-chrome-budget.spec.ts).
 */

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464').replace(/\/$/, '')

/** Resolve admin dev URL — Vite may fall back to 6465 when 6464 is taken. */
async function resolveAdminBase(request: import('@playwright/test').APIRequestContext): Promise<string> {
  for (const port of [6464, 6465]) {
    const url = `http://127.0.0.1:${port}`
    try {
      const res = await request.get(`${url}/login`, { timeout: 4000 })
      if (res.ok()) return url
    } catch {
      /* try next port */
    }
  }
  return ADMIN_URL
}
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
const THEME_STORAGE_KEY = 'mushi:theme:v1'

async function seedSession(
  page: Page,
  mode: 'quickstart' | 'beginner' | 'advanced',
  request: import('@playwright/test').APIRequestContext,
) {
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
    ({ key, sessionPayload, projectId, adminMode, themeKey }) => {
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
      window.localStorage.setItem('mushi:mode', adminMode)
      window.localStorage.setItem(themeKey, 'light')
      document.documentElement.setAttribute('data-theme', 'light')
      document.documentElement.style.colorScheme = 'light'
    },
    {
      key: storageKey,
      sessionPayload: session,
      projectId: PROJECT_ID,
      adminMode: mode,
      themeKey: THEME_STORAGE_KEY,
    },
  )
}

async function dismissBetaIfPresent(page: Page) {
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2000 }).catch(() => {})
}

test.describe('Admin shell chrome', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires Supabase + test user env',
  )

  test.use({ viewport: { width: 1280, height: 900 } })

  test('sidebar logo row aligns with desktop sub-header bottom edge', async ({ page, request }) => {
    await seedSession(page, 'advanced', request)
    const base = await resolveAdminBase(request)
    await page.goto(`${base}/dashboard?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
    await dismissBetaIfPresent(page)
    await page.waitForTimeout(400)

    const sidebarRow = page.locator('aside .chrome-top-row').first()
    const headerRow = page.locator('header.chrome-top-row').first()
    await expect(sidebarRow).toBeVisible()
    await expect(headerRow).toBeVisible()

    const sidebarBox = await sidebarRow.boundingBox()
    const headerBox = await headerRow.boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(headerBox).not.toBeNull()

    const sidebarBottom = sidebarBox!.y + sidebarBox!.height
    const headerBottom = headerBox!.y + headerBox!.height
    expect(Math.abs(sidebarBottom - headerBottom)).toBeLessThanOrEqual(1)
  })

  test('sidebar footer controls meet 12px type floor on interactive elements', async ({ page, request }) => {
    await seedSession(page, 'advanced', request)
    const base = await resolveAdminBase(request)
    await page.goto(`${base}/dashboard?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
    await dismissBetaIfPresent(page)

    const minFontPx = await page.evaluate(() => {
      const footer = document.querySelector('aside')?.querySelector('[aria-label="Density, theme, and focus"]')
      if (!footer) return 12
      let min = 99
      footer.querySelectorAll('button, a, [role="radio"], [role="button"]').forEach((el) => {
        const px = parseFloat(getComputedStyle(el).fontSize)
        if (Number.isFinite(px) && px < min) min = px
      })
      return min
    })
    expect(minFontPx).toBeGreaterThanOrEqual(12)
  })

  test('org switcher dropdown stacks above main content on dashboard', async ({ page, request }) => {
    await seedSession(page, 'advanced', request)
    const base = await resolveAdminBase(request)
    await page.goto(`${base}/dashboard?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
    await dismissBetaIfPresent(page)

    const teamButton = page.getByRole('button', { name: /Team/i }).first()
    await teamButton.click()

    const listbox = page.getByRole('listbox').first()
    await expect(listbox).toBeVisible()

    const dropdownAboveMain = await page.evaluate(() => {
      const panel = document.querySelector('[role="listbox"]')?.parentElement
      const main = document.getElementById('main-content')
      if (!panel || !main) return false
      const pz = parseInt(getComputedStyle(panel).zIndex || '0', 10)
      return pz >= 40
    })
    expect(dropdownAboveMain).toBe(true)
  })
})
