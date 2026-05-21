/**
 * FILE: examples/e2e-dogfood/tests/dark-mode-toggle.spec.ts
 * PURPOSE: Round 9 (2026-05-21) — verify the dark mode toggle in the sidebar
 *          footer flips the `dark` class on the document root without a full
 *          page reload. ThemeSidebarToggle.tsx was confirmed ALREADY SHIPPED.
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'

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
  } catch { /* optional */ }
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

test.describe('Dark mode toggle (Round 9)', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires auth env vars',
  )

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
    })
    const token = await res.json()
    await page.goto(ADMIN_URL)
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, token])
    await page.goto(ADMIN_URL)
    await page.waitForLoadState('networkidle')
  })

  test('clicking the dark/light toggle flips the html dark class', async ({ page }) => {
    // Find the theme toggle button (aria-label contains "dark" or "light" or "theme")
    const toggle = page.locator('button[aria-label*="theme"], button[aria-label*="dark"], button[aria-label*="light"]').first()
    await expect(toggle).toBeVisible({ timeout: 5000 })

    // Record initial state
    const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))

    await toggle.click()
    await page.waitForTimeout(300)

    const afterDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(afterDark).toBe(!initialDark)

    // Toggle back
    await toggle.click()
    await page.waitForTimeout(300)
    const finalDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(finalDark).toBe(initialDark)
  })
})
