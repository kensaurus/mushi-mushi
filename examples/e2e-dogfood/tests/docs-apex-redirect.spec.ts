/**
 * FILE: examples/e2e-dogfood/tests/docs-apex-redirect.spec.ts
 * PURPOSE: Production smoke tests for docs apex + mis-prefixed routing.
 */

import { test, expect } from '@playwright/test'

const PROD = (process.env.MUSHI_DOCS_PROD_URL ?? 'https://kensaur.us').replace(/\/$/, '')

const INCIDENT_HEADING = /incident loop/i

test.describe('docs apex redirect (production)', () => {
  test('apex /quickstart/incident-loop redirects to canonical docs URL', async ({ page }) => {
    const response = await page.goto(`${PROD}/quickstart/incident-loop`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    expect(response?.url()).toContain('/mushi-mushi/docs/quickstart/incident-loop')
    const body = await page.content()
    expect(body).not.toMatch(/NoSuchKey/)
    expect(body).not.toMatch(/<Code>NoSuchKey<\/Code>/)
    await expect(page.getByRole('heading', { name: INCIDENT_HEADING }).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('/mushi-mushi/quickstart/incident-loop redirects to docs (not admin login)', async ({
    page,
  }) => {
    await page.goto(`${PROD}/mushi-mushi/quickstart/incident-loop`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    expect(page.url()).toContain('/mushi-mushi/docs/quickstart/incident-loop')
    await expect(page.getByRole('heading', { name: INCIDENT_HEADING }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Sign in to your account')).toHaveCount(0)
  })

  test('canonical docs URL returns 200', async ({ page }) => {
    const response = await page.goto(`${PROD}/mushi-mushi/docs/quickstart/incident-loop`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: INCIDENT_HEADING }).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})
