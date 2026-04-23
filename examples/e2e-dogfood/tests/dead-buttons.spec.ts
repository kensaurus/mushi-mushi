/**
 * FILE: examples/e2e-dogfood/tests/dead-buttons.spec.ts
 * PURPOSE: Wave T (2026-04-23) — sweep every Advanced admin page for dead
 *          buttons. A "dead button" is any interactive control whose
 *          `href` 404s (`<Link>` to an unknown route), whose
 *          `onClick` handler throws, or which is rendered with
 *          `disabled` while the corresponding data says the action
 *          IS available (false-negative UI). The sweep is anchored
 *          on the `data-*-primary` test hooks added in Wave T's
 *          `PageHero` / `InboxPage` primitives — if a page has a
 *          primary CTA, we assert it navigates somewhere real.
 *
 *          How it runs:
 *            - Logs in via the REST auth path (same seam as
 *              user-story-triage.spec.ts)
 *            - Visits each admin route under test
 *            - For every element matching `[data-hero-primary]`,
 *              `[data-inbox-primary]`, or `[data-tabbed-sub-nav-tab]`,
 *              collects the `href` and asserts the landing page is
 *              NOT the 404 fallback (matching the "Page not found"
 *              copy in `App.tsx`).
 *
 *          Intentionally permissive: pages that legitimately have
 *          nothing actionable render no `data-*-primary`, which is a
 *          pass (the sweep counts assertions, not buttons).
 */

import { test, expect, type Page } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

const PAGES_UNDER_TEST = [
  '/',
  '/inbox',
  '/reports',
  '/fixes',
  '/judge',
  '/health',
  '/graph',
  '/intelligence',
  '/prompt-lab',
  '/integrations',
  '/mcp',
  '/billing',
  '/compliance',
  '/audit',
  '/dlq',
  '/queue',
]

test.describe('Wave T dead-button sweep', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD',
  )

  test.beforeEach(async ({ page, request }) => {
    // Grab a real access token once per test so we don't rely on the
    // login page shape — the Playwright helpers in user-story-triage
    // already prove that flow works; here we just need a valid session.
    const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
    })
    expect(res.ok()).toBeTruthy()
    const { access_token, refresh_token } = (await res.json()) as {
      access_token: string
      refresh_token: string
    }
    await page.addInitScript((tokens) => {
      // The admin auth lib reads supabase-js's default storage key.
      window.localStorage.setItem(
        'sb-mushi-auth-token',
        JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
      )
    }, { access_token, refresh_token })
  })

  for (const path of PAGES_UNDER_TEST) {
    test(`no dead primary CTA on ${path}`, async ({ page }) => {
      await page.goto(`${ADMIN_URL}${path}`, { waitUntil: 'networkidle' })
      // Allow React.lazy chunks + data fetches to settle. 3 s is an empirical
      // ceiling for the dashboard aggregate; beyond this the page is
      // either broken or loading unnecessary data.
      await page.waitForTimeout(3000)

      const targets = await page.$$(
        '[data-hero-primary], [data-inbox-primary], [data-tabbed-sub-nav-tab]',
      )
      if (targets.length === 0) {
        // Some admin pages render no primary CTA if there's nothing to do
        // — that's a pass, but we still want to prove we're on the right
        // route (Layout + page shell have mounted).
        const heading = await page.textContent('h1, [role="banner"] h1, [role="banner"] h2')
        expect(heading ?? '').toBeTruthy()
        return
      }

      for (const target of targets) {
        const href = (await target.getAttribute('href')) ?? ''
        const role = (await target.getAttribute('role')) ?? ''
        const tagName = await target.evaluate((el) => el.tagName.toLowerCase())
        // Button CTAs (no `href`) are exercised by stage-specific specs;
        // the dead-button sweep focuses on the navigation path.
        if (!href || tagName === 'button') continue
        // Skip fragment-only links — they're always valid on the same page.
        if (href.startsWith('#')) continue
        await assertReachable(page, href, role)
      }
    })
  }
})

async function assertReachable(page: Page, href: string, role: string): Promise<void> {
  const url = new URL(href, ADMIN_URL).toString()
  const before = page.url()
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(500)

  // The admin's 404 fallback renders the literal string "Page not found".
  // A dead link lands there; any other page is fine.
  const bodyText = (await page.textContent('body')) ?? ''
  expect.soft(bodyText, `Link to ${url} (role=${role}) should NOT land on 404`).not.toMatch(
    /Page not found/i,
  )

  // Return to the sweep's anchor page so later links still have context.
  await page.goto(before, { waitUntil: 'networkidle' }).catch(() => {})
}
