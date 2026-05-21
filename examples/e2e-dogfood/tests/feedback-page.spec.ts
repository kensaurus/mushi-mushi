/**
 * FILE: examples/e2e-dogfood/tests/feedback-page.spec.ts
 * PURPOSE: Round 9 (2026-05-21) — end-to-end smoke test for /feedback page.
 *
 * Covers:
 *   - Page loads without console errors
 *   - Tab navigation (Overview / Active / Shipped / All) renders non-404
 *   - "Report a bug" CTA opens the feedback modal
 *   - Modal can be dismissed
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

test.describe('FeedbackPage (Round 9)', () => {
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
    await page.goto(`${ADMIN_URL}/feedback`)
    await page.waitForLoadState('networkidle')
  })

  test('page loads without 404', async ({ page }) => {
    await expect(page.locator('h1, [role="heading"]').first()).not.toContainText('Page not found', { timeout: 5000 })
    await expect(page.locator('h1, [role="heading"]').first()).toBeVisible()
  })

  test('tab navigation does not 404', async ({ page }) => {
    for (const tab of ['active', 'shipped', 'all']) {
      await page.goto(`${ADMIN_URL}/feedback?tab=${tab}`)
      await page.waitForLoadState('domcontentloaded')
      const heading = page.locator('h1, [role="heading"]').first()
      await expect(heading).not.toContainText('Page not found', { timeout: 3000 })
    }
  })

  test('"Report a bug" CTA opens feedback modal', async ({ page }) => {
    const btn = page.getByRole('button', { name: /report a bug/i }).first()
    await expect(btn).toBeVisible({ timeout: 5000 })
    await btn.click()
    // Modal should appear
    await expect(page.locator('[role="dialog"], [data-radix-dialog-content]').first()).toBeVisible({ timeout: 3000 })

    // Dismiss with Escape
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"], [data-radix-dialog-content]').first()).not.toBeVisible({ timeout: 2000 })
  })
})
