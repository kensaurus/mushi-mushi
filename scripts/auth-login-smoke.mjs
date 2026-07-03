#!/usr/bin/env node
/**
 * FILE: scripts/auth-login-smoke.mjs
 * PURPOSE: Playwright smoke for admin auth surfaces on localhost (or any base).
 *
 * Checks:
 * - /login renders OAuth buttons after GoTrue /settings resolves
 * - OAuth buttons redirect to the correct provider (does not complete sign-in)
 * - /signup loads without console errors
 * - Unauthenticated /login hides BetaBanner feedback actions
 *
 * Usage:
 *   node scripts/auth-login-smoke.mjs [--base http://127.0.0.1:6464]
 */

import { chromium } from 'playwright'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : process.env.ADMIN_URL ?? 'http://127.0.0.1:6464'

function urlMentionsLocalRedirect(url) {
  let cur = url
  for (let i = 0; i < 3; i++) {
    if (cur.includes('127.0.0.1:6464') || cur.includes('localhost:6464')) return true
    try {
      cur = decodeURIComponent(cur)
    } catch {
      break
    }
  }
  return false
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors = []

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // Expected during negative auth probes (invalid password, OTP policy, etc.)
    if (/Failed to load resource.*\b(400|401|422)\b/.test(text)) return
    consoleErrors.push(text)
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })

  await page.getByRole('button', { name: /continue with google/i }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: /continue with github/i }).waitFor({ timeout: 5000 })

  const feedbackBug = page.getByRole('button', { name: /^report a bug$/i })
  if (await feedbackBug.count()) {
    throw new Error('BetaBanner "Report a bug" visible on logged-out /login')
  }

  const googleBtn = page.getByRole('button', { name: /continue with google/i })
  await Promise.all([
    page.waitForURL(/accounts\.google\.com/, { timeout: 15000 }),
    googleBtn.click(),
  ])
  const googleUrl = page.url()
  if (
    !urlMentionsLocalRedirect(googleUrl) &&
    !googleUrl.includes('redirect_uri=https%3A%2F%2Fdxptnwrhwsqckaftyymj.supabase.co')
  ) {
    throw new Error(`Google OAuth missing localhost redirect in URL: ${googleUrl}`)
  }

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.getByRole('button', { name: /continue with github/i }).waitFor({ timeout: 15000 })

  const githubBtn = page.getByRole('button', { name: /continue with github/i })
  await Promise.all([
    page.waitForURL(/github\.com\/login/, { timeout: 15000 }),
    githubBtn.click(),
  ])
  const githubUrl = page.url()
  if (!urlMentionsLocalRedirect(githubUrl)) {
    throw new Error(`GitHub OAuth missing redirect in URL: ${githubUrl}`)
  }

  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(500)

  const overlay = await page.locator('vite-error-overlay, [class*="vite-error"]').count()
  if (overlay > 0) {
    throw new Error('Vite error overlay on /signup')
  }

  // Magic link tab → success state (does not require real email delivery)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.getByRole('button', { name: /^email link$/i }).click()
  await page.locator('#email').fill(`pdca-smoke-${Date.now()}@example.com`)
  await page.getByRole('button', { name: /send sign-in link/i }).click()
  const magicOk = await Promise.race([
    page.getByText(/check your inbox/i).waitFor({ timeout: 20000 }).then(() => true),
    page.locator('.text-danger').waitFor({ timeout: 20000 }).then(() => false),
  ])
  if (!magicOk) {
    const body = await page.locator('body').innerText()
    if (/\{"code":/.test(body)) {
      throw new Error('Magic link surfaced raw JSON error')
    }
  }

  // Forgot password → reset-sent state
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.getByRole('button', { name: /forgot your password/i }).click()
  await page.locator('#email').fill('pdca-smoke@example.com')
  await page.getByRole('button', { name: /send reset link/i }).click()
  await page.getByText(/reset link sent/i).waitFor({ timeout: 20000 })

  // Invalid password → inline error (not raw JSON)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.locator('#email').fill('pdca-smoke@example.com')
  await page.locator('#password').fill('not-a-real-password-123')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.getByText(/invalid email or password/i).waitFor({ timeout: 15000 })

  await browser.close()

  if (consoleErrors.length) {
    console.error('Console errors:')
    for (const err of consoleErrors.slice(0, 10)) console.error(`  - ${err}`)
    process.exit(1)
  }

  console.log(`OK auth-login-smoke @ ${BASE}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
