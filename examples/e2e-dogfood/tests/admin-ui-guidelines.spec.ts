/**
 * Web Interface Guidelines smoke — high-traffic admin routes in light + dark.
 * Checks skip link, accessible names, Connect section nav, and no straight-dot ellipsis.
 */

import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const specDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(specDir, '../../../')

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464').replace(/\/$/, '')
const PROJECT_ID = '67a6453c-375d-41d7-833a-b33471159442'

function loadEnvFile(relPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(resolve(repoRoot, relPath), 'utf8')
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

const ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/reports', name: 'Reports' },
  { path: '/connect', name: 'Connect' },
  { path: '/qa-coverage', name: 'QA Coverage' },
] as const

async function seedSession(page: Page, theme: 'light' | 'dark', request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const session = await res.json()
  await page.addInitScript(
    ({ key, sessionPayload, projectId, themeKey, themePref }) => {
      window.localStorage.setItem(key, JSON.stringify(sessionPayload))
      window.localStorage.setItem('mushi:active_project_id', projectId)
      window.localStorage.setItem(themeKey, themePref)
      document.documentElement.setAttribute('data-theme', themePref)
      document.documentElement.style.colorScheme = themePref
    },
    { key: storageKey, sessionPayload: session, projectId: PROJECT_ID, themeKey: THEME_STORAGE_KEY, themePref: theme },
  )
}

async function assertNoStraightDotEllipsis(page: Page) {
  const bad = page.getByText(/Loading\.\.\.|Saving\.\.\.|Creating\.\.\./)
  await expect(bad).toHaveCount(0)
}

async function assertNoCriticalA11yViolations(page: Page, rootSelector = '#main-content') {
  const results = await new AxeBuilder({ page })
    .include(rootSelector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical, formatAxeViolations(critical)).toEqual([])
}

function formatAxeViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.description}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n')
}

test.describe('Admin UI guidelines (authenticated)', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires Supabase auth env vars',
  )

  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${theme} theme`, () => {
      test.beforeEach(async ({ page, request }) => {
        await seedSession(page, theme, request)
      })

      for (const route of ROUTES) {
        test(`${route.name} (${route.path}) passes guideline smoke`, async ({ page }) => {
          await page.goto(`${ADMIN_URL}${route.path}`, { waitUntil: 'domcontentloaded' })
          await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)

          await assertNoStraightDotEllipsis(page)

          const resolved = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
          expect(resolved).toBe(theme)

          if (route.path === '/dashboard') {
            const skip = page.getByRole('link', { name: 'Skip to main content' })
            await expect(skip).toBeAttached()
          }

          if (route.path === '/reports') {
            await expect(page.getByRole('searchbox', { name: 'Search reports' })).toBeVisible({ timeout: 15_000 })
            await expect(page.locator('#filter-status')).toBeAttached()
          }

          if (route.path === '/connect') {
            const nav = page.getByRole('navigation', { name: 'Connect page sections' })
            await expect(nav).toBeVisible({ timeout: 15_000 })
            await expect(nav.getByRole('link', { name: 'Studio' })).toBeVisible()
            await expect(nav.getByRole('link', { name: 'Update' })).toBeVisible()
          }

          const main = page.locator('#main-content')
          await expect(main).toBeVisible({ timeout: 15_000 })

          await assertNoCriticalA11yViolations(page)
        })
      }
    })
  }
})

test.describe('Login page (public)', () => {
  test('login form controls are labeled', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await assertNoStraightDotEllipsis(page)
    await assertNoCriticalA11yViolations(page, 'form')
  })
})
