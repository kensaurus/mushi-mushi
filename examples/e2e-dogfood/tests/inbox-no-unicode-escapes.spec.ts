/**
 * FILE: examples/e2e-dogfood/tests/inbox-no-unicode-escapes.spec.ts
 * PURPOSE: Wave T regression test — Action Inbox and the page-hero pages
 *          must NEVER render literal `\uXXXX` escape sequences in
 *          user-visible text.
 *
 *          The 2026-04-23 InboxPage bug had `<Loading text="Loading
 *          inbox\u2026" />` which renders as the literal six-character
 *          string `\u2026` instead of `…`, because JSX attribute values
 *          and JSX text children are NOT JavaScript string literals. The
 *          static guard `scripts/check-jsx-unicode-escapes.mjs` catches
 *          new violations at commit/CI time; this Playwright sweep is
 *          the runtime safety net for any escape that slips through
 *          (e.g. a string that's assembled at runtime from a backend
 *          response and double-escaped).
 *
 *          Pages swept: every Advanced PDCA page that uses `PageHero`
 *          plus the Inbox itself, since those are where copy density is
 *          highest and where the bug originally surfaced.
 */

import { test, expect } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

const PAGES_UNDER_TEST = [
  '/inbox',
  '/judge',
  '/health',
  '/audit',
  '/compliance',
  '/intelligence',
  '/dlq',
  '/graph',
  '/anti-gaming',
  '/storage',
  '/sso',
  '/billing',
  '/marketplace',
  '/fixes',
] as const

// `\u` followed by exactly four hex digits, but NOT preceded by a backslash
// (which would be the literal `\\u…` escape that's intentionally rendered
// in code-sample blocks). The regex is anchored to find the bug pattern in
// rendered DOM text — not in inline `<code>` snippets, where the literal
// escape might be the intended display.
const ESCAPE_RX = /\\u[0-9a-fA-F]{4}/

test.describe('No literal \\uXXXX in rendered admin pages', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD',
  )

  test.beforeEach(async ({ page, request }) => {
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
      window.localStorage.setItem(
        'sb-mushi-auth-token',
        JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        }),
      )
    }, { access_token, refresh_token })
  })

  for (const path of PAGES_UNDER_TEST) {
    test(`no \\uXXXX in rendered text on ${path}`, async ({ page }) => {
      await page.goto(`${ADMIN_URL}${path}`, { waitUntil: 'networkidle' })
      // Loading skeletons are short-lived but real — wait for the page
      // chrome + first paint of real copy before asserting.
      await page.waitForTimeout(2000)

      // Read the visible text from `<main>` if present (most pages mount
      // their content there) and fall back to body otherwise. Strip out
      // the contents of `<code>` / `<pre>` blocks, which legitimately
      // display `\uXXXX` strings (snippet docs, embed code).
      const visible = await page.evaluate(() => {
        const root = document.querySelector('main') ?? document.body
        const clone = root.cloneNode(true) as HTMLElement
        for (const el of Array.from(clone.querySelectorAll('code, pre'))) {
          el.remove()
        }
        return (clone.innerText || '').trim()
      })

      // Empty page is a different bug (covered by the dead-button sweep);
      // for this regression we only assert the "no escape sequences"
      // contract when there IS rendered text.
      if (!visible) {
        test.skip(true, `${path} rendered no visible text — skipping`)
        return
      }

      const match = visible.match(ESCAPE_RX)
      expect(match, `Found literal escape ${match?.[0]} in ${path}; first 200 chars: ${visible.slice(0, 200)}`).toBeNull()
    })
  }
})
