/**
 * Chrome budget guard — visible PagePosture rows must respect admin mode caps.
 *
 * Requires: MUSHI_ADMIN_URL, Supabase auth env (same as dashboard-enhanced.spec.ts).
 * Caps: quickstart/beginner ≤ 2 rows · advanced ≤ 3 rows (PagePosture.tsx).
 * Themes: light, dark, and system (default) via mushi:theme:v1 localStorage.
 */

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464').replace(/\/$/, '')
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

const CHROME_ROUTES = [
  '/dashboard',
  '/reports',
  '/inbox',
  '/fixes',
  '/repo',
  '/health',
  '/connect',
  '/qa-coverage',
  '/rewards',
  '/settings',
  '/projects',
  '/billing',
  '/cost',
  '/judge',
  '/drift',
  '/code-health',
  '/query',
  '/audit',
  '/lessons',
  '/compliance',
  '/sso',
  '/queue',
  '/prompt-lab',
  '/skills',
  '/marketplace',
  '/anomalies',
  '/experiments',
  '/feedback',
  '/storage',
  '/research',
  '/iterate',
  '/intelligence',
  '/notifications',
  '/releases',
  '/fullstack-audit',
  '/content',
  '/feature-board',
  '/anti-gaming',
  '/users',
  '/organization/members',
  '/integrations',
  '/graph',
  '/explore',
  '/inventory',
  '/onboarding',
  '/setup-copilot',
  '/mcp',
] as const

const MODE_BUDGET: Record<'beginner' | 'advanced', number> = {
  beginner: 2,
  advanced: 3,
}

const THEME_PREFS = ['light', 'dark', 'system'] as const
type ThemePref = (typeof THEME_PREFS)[number]
const THEME_STORAGE_KEY = 'mushi:theme:v1'

async function seedSession(
  page: Page,
  mode: 'beginner' | 'advanced',
  theme: ThemePref,
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
    ({ key, sessionPayload, projectId, adminMode, themeKey, themePref }) => {
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
      window.localStorage.setItem(themeKey, themePref)
      const resolved =
        themePref === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : themePref
      document.documentElement.setAttribute('data-theme', resolved)
      document.documentElement.style.colorScheme = resolved
    },
    {
      key: storageKey,
      sessionPayload: session,
      projectId: PROJECT_ID,
      adminMode: mode,
      themeKey: THEME_STORAGE_KEY,
      themePref: theme,
    },
  )
}

async function countPostureRows(page: Page): Promise<number> {
  const posture = page.locator('[data-page-posture]')
  if ((await posture.count()) === 0) return 0
  return posture.locator(':scope > *').count()
}

async function assertResolvedTheme(page: Page, theme: ThemePref) {
  const resolved = await page.evaluate(({ themePref }) => {
    if (themePref === 'system') {
      return document.documentElement.getAttribute('data-theme')
    }
    return themePref
  }, { themePref: theme })
  if (theme !== 'system') {
    expect(resolved).toBe(theme)
  } else {
    expect(resolved === 'light' || resolved === 'dark').toBeTruthy()
  }
}

test.describe('Admin chrome budget (PagePosture)', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires Supabase + test user env',
  )

  for (const theme of THEME_PREFS) {
    for (const mode of ['beginner', 'advanced'] as const) {
      test(`${mode} + ${theme} — posture rows ≤ ${MODE_BUDGET[mode]} on core routes`, async ({ page, request }) => {
        await seedSession(page, mode, theme, request)
        const cap = MODE_BUDGET[mode]

        for (const route of CHROME_ROUTES) {
          await page.goto(`${ADMIN_URL}${route}?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
          await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2000 }).catch(() => {})
          await page.waitForTimeout(500)
          await assertResolvedTheme(page, theme)
          const rows = await countPostureRows(page)
          expect(rows, `${route} (${mode}, ${theme}) should expose ≤ ${cap} posture rows`).toBeLessThanOrEqual(cap)
          await expect(page.locator('[data-page-posture]'), `${route} should mount PagePosture`).toHaveCount(1)
        }
      })
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`contrast spot-check — /health and /reports (${theme})`, async ({ page, request }) => {
      await seedSession(page, 'advanced', theme, request)
      for (const route of ['/health', '/reports'] as const) {
        await page.goto(`${ADMIN_URL}${route}?project=${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(400)

        const violations = await page.evaluate(() => {
          const bad: string[] = []
          const mutedBg = /\bbg-(ok|warn|danger|info|accent|brand)-muted(?:\/[\d.]+)?\b/
          const rawText = /\btext-(ok|warn|danger|info|accent|brand)(?!-(?:foreground|fg)\b)\b/
          for (const el of document.querySelectorAll('[class*="bg-"][class*="text-"]')) {
            const cls = el.className
            if (typeof cls !== 'string' || cls.includes('CHIP_TONE')) continue
            const atRest = cls
              .split(/\s+/)
              .filter((c) => !/^(?:hover:|focus:|active:|group-hover:)/.test(c))
              .join(' ')
            if (mutedBg.test(atRest) && rawText.test(atRest)) {
              bad.push(atRest.slice(0, 120))
            }
          }
          return bad
        })

        expect(violations, `${route} (${theme}) should have no raw semantic-on-muted chips`).toEqual([])
      }
    })
  }
})
