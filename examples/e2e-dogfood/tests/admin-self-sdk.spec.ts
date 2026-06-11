/**
 * Admin console dogfoods @mushi-mushi/web via mushi-self.ts.
 * Lime BetaBanner is the visible entry point — SDK launcher stays hidden (no FAB).
 */
import { test, expect } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'

async function adminHasMushiWidget(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector('#mushi-mushi-widget'))
}

async function shadowHasTrigger(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & {
      shadowRoot?: ShadowRoot
    }
    return !!host?.shadowRoot?.querySelector('.mushi-trigger')
  })
}

async function shadowHasBanner(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & {
      shadowRoot?: ShadowRoot
    }
    return !!host?.shadowRoot?.querySelector('.mushi-banner')
  })
}

test.describe('Admin self-dogfood SDK', () => {
  test('lime BetaBanner stays visible and SDK does not render FAB or duplicate banner', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/projects?tab=list`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('region', { name: 'Beta announcement' })).toBeVisible()

    // Wait for either widget mount or settle without SDK (env vars absent in CI).
    await page.waitForTimeout(3000)

    const mounted = await adminHasMushiWidget(page)
    test.skip(!mounted, 'VITE_MUSHI_SELF_* not configured — SDK not mounted')

    expect(await shadowHasTrigger(page)).toBe(false)
    expect(await shadowHasBanner(page)).toBe(false)
  })
})
