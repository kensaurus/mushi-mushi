/**
 * FILE: examples/e2e-dogfood/tests/docs-site-smoke.spec.ts
 * PURPOSE: Smoke-test public docs surfaces after UX unification work.
 */

import { test, expect } from '@playwright/test'

const DOCS_URL = (process.env.MUSHI_DOCS_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

const ROUTES = [
  { path: '/', heading: /why it broke/i },
  { path: '/connect', heading: /Connect your AI client/i },
  { path: '/quickstart', heading: /Quickstart/i },
  { path: '/quickstart/incident-loop', heading: /incident loop/i },
  { path: '/migrations', heading: /Migration/i },
  { path: '/sdks/skills', heading: /Agent skills/i },
] as const

for (const { path, heading } of ROUTES) {
  test(`docs ${path} renders without error boundary`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${DOCS_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await expect(page.getByText('Application error')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 })
  })
}

test.describe('docs responsive smoke', () => {
  for (const width of [390, 1024] as const) {
    test(`home readable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`${DOCS_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await expect(page.getByRole('heading', { name: /why it broke/i })).toBeVisible()
      await expect(page.getByRole('list', { name: /Where to start/i })).toBeVisible()
    })
  }
})
