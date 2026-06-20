#!/usr/bin/env node
/**
 * FILE: scripts/cli-setup-smoke.mjs
 * PURPOSE: Playwright smoke for CLI ↔ console setup path.
 *
 * Verifies (when authenticated):
 * - `/onboarding?tab=steps&setup=cli` → CLI banner + create form
 * - `/connect` → page loads; CLI section or setup guide when SDK offline
 *
 * Usage:
 *   ADMIN_URL=http://localhost:6464 node scripts/cli-setup-smoke.mjs
 *
 * Auth: launches a *persistent* Chromium profile (default
 * `.playwright-mcp/cli-setup-profile`, override with CLI_SETUP_SMOKE_PROFILE) so
 * you can sign in once in a headed run and every later headless run reuses that
 * session. Without a signed-in session, checks exit 0 with SKIP (set
 * CLI_SETUP_SMOKE_STRICT=1 to fail).
 *
 * Playwright is an optional dev dependency — it's imported dynamically so this
 * script SKIPs cleanly (exit 0) on machines where it isn't installed instead of
 * crashing at module load.
 */

import { join } from 'node:path'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : process.env.ADMIN_URL ?? 'http://localhost:6464'

const STRICT = process.env.CLI_SETUP_SMOKE_STRICT === '1'
const PROFILE_DIR =
  process.env.CLI_SETUP_SMOKE_PROFILE ?? join('.playwright-mcp', 'cli-setup-profile')
const HEADED = process.argv.includes('--headed') || process.env.CLI_SETUP_SMOKE_HEADED === '1'

async function isSignedIn(page) {
  const url = page.url()
  if (/\/(login|auth)(\/|$|\?)/i.test(url)) return false
  const body = await page.locator('body').innerText()
  if (/something went wrong|vite-error-overlay/i.test(body)) {
    throw new Error('error surface visible')
  }
  if (/sign out/i.test(body)) return true
  if (/sign in|log in|magic link/i.test(body) && !/sign out/i.test(body)) return false
  // Heuristic: authenticated shell shows project switcher label
  return /project/i.test(body) && !/welcome back/i.test(body)
}

const CHECKS = [
  {
    name: 'cli setup onboarding',
    path: '/onboarding?tab=steps&setup=cli',
    async assert(page) {
      await page.getByTestId('onboarding-cli-setup-banner').waitFor({ timeout: 15_000 })
      await page.locator('#onboarding-create-form').waitFor({ timeout: 15_000 })
    },
  },
  {
    name: 'connect hub',
    path: '/connect',
    async assert(page) {
      await page.getByRole('heading', { name: /connect & update/i }).waitFor({ timeout: 15_000 })
      const guide = page.getByTestId('cli-setup-guide')
      const cliSection = page.getByRole('heading', { name: /^CLI$/i })
      if (await guide.count()) {
        await guide.waitFor({ timeout: 5_000 })
      } else {
        await cliSection.waitFor({ timeout: 5_000 })
      }
    },
  },
]

async function main() {
  // Dynamic import: if Playwright isn't installed, skip cleanly (exit 0) rather
  // than throwing at module load before this guard can run.
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    const msg = 'Playwright not installed — run: pnpm exec playwright install chromium'
    if (STRICT) {
      // In strict mode this is a CI gate: a missing dependency must fail, not
      // silently pass, otherwise the smoke check provides false assurance.
      console.error(`FAIL cli-setup-smoke (${msg})`)
      process.exit(1)
    }
    console.log(`SKIP cli-setup-smoke (${msg})`)
    process.exit(0)
  }

  // Persistent context so a one-time headed sign-in is reused by later headless
  // runs (a fresh newContext() would always land on the login page and SKIP).
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: !HEADED })
  const page = context.pages()[0] ?? (await context.newPage())
  let failed = 0
  let skipped = 0

  for (const check of CHECKS) {
    const url = `${BASE}${check.path}`
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
      const status = response?.status() ?? 0
      if (status >= 400) throw new Error(`HTTP ${status}`)
      if (!(await isSignedIn(page))) {
        console.log(`SKIP ${check.name} (sign in required — open ${BASE} in browser once)`)
        skipped += 1
        continue
      }
      await check.assert(page)
      console.log(`OK ${check.name}`)
    } catch (err) {
      console.error(`FAIL ${check.name}:`, err instanceof Error ? err.message : err)
      failed += 1
    }
  }

  await context.close()

  if (failed > 0) process.exit(1)
  if (skipped > 0 && STRICT) {
    console.error('Strict mode: auth required for CLI setup smoke')
    process.exit(1)
  }
  if (skipped > 0) {
    console.log(`Skipped ${skipped} check(s) — re-run after signing in via headed browser`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
