/**
 * FILE: examples/e2e-dogfood/tests/connect-sdk-preview.spec.ts
 *
 * Admin-only guard: Connect page must render SdkInstallCard live preview
 * without stale @mushi-mushi/web prebundle import failures.
 */

import { test, expect } from '@playwright/test'

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://127.0.0.1:6464').replace(/\/$/, '')
const PROJECT_ID =
  process.env.MUSHI_E2E_PROJECT_ID ?? '6e7e0c3a-a777-4f1e-a699-6515993cf3bd'

test.describe('Connect — SdkInstallCard live preview', () => {
  test('renders widget preview without ErrorBoundary', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/connect?project=${PROJECT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })

    await expect(page.getByRole('heading', { name: /Connect & Update/i })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Something broke on this page.')).toHaveCount(0)
    await expect(page.getByText('Live preview', { exact: true })).toBeVisible()
    await expect(
      page.getByLabel('Live preview of the bug-capture widget in your app'),
    ).toBeVisible()
  })

  test('mock trigger toggles hub panel in preview', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/connect?project=${PROJECT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })

    const trigger = page.getByRole('button', {
      name: 'Mock bug-capture trigger button — click to preview panel',
    })
    await expect(trigger).toBeVisible({ timeout: 20_000 })
    await trigger.click()
    await expect(page.getByText('Report a bug').first()).toBeVisible()
  })
})
