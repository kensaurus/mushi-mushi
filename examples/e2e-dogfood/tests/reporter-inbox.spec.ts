/**
 * FILE: reporter-inbox.spec.ts
 * PURPOSE: E2E coverage for reporter token scoping + My Reports inbox visibility.
 *
 * OVERVIEW:
 * - Submits a report via the widget using the same session's reporter token.
 * - Asserts project-scoped localStorage key is written.
 * - Opens the My Reports tab and confirms the submission appears in the list.
 *
 * DEPENDENCIES:
 * - Playwright test runner, glot.it dogfood host (MUSHI_DOGFOOD_URL)
 * - MUSHI_PROJECT_ID env (defaults to glot.it dogfood project)
 */

import { test, expect, type Page } from '@playwright/test'

const DOGFOOD_URL = process.env.MUSHI_DOGFOOD_URL ?? 'http://localhost:3000'
const BASE_PATH = '/glot-it'
const WIDGET_TRIGGER = process.env.MUSHI_WIDGET_TRIGGER ?? 'banner'
const PROJECT_ID =
  process.env.MUSHI_PROJECT_ID ?? '542b34e0-019e-41fe-b900-7b637717bb86'

async function shadowClick(page: Page, sel: string) {
  await page.evaluate((s) => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
    const el = host?.shadowRoot?.querySelector(s) as HTMLElement | null
    if (!el) throw new Error(`shadowClick: "${s}" not found in shadow DOM`)
    el.click()
  }, sel)
}

async function shadowFill(page: Page, sel: string, text: string) {
  await page.evaluate(([s, t]: [string, string]) => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
    const el = host?.shadowRoot?.querySelector(s) as HTMLTextAreaElement | HTMLInputElement | null
    if (!el) throw new Error(`shadowFill: "${s}" not found`)
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, t)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, [sel, text] as [string, string])
}

async function shadowWaitFor(page: Page, sel: string, timeout = 8000) {
  await page.waitForFunction(
    (s) => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      return !!host?.shadowRoot?.querySelector(s)
    },
    sel,
    { polling: 300, timeout },
  )
}

async function openMushiWidget(page: Page) {
  if (WIDGET_TRIGGER === 'banner') {
    await shadowClick(page, '.mushi-banner-btn')
  } else {
    await shadowClick(page, '.mushi-trigger')
  }
}

async function openToDetailsStep(page: Page) {
  await page.waitForTimeout(2500)
  await openMushiWidget(page)
  await shadowWaitFor(page, '.mushi-panel.open')
  await shadowWaitFor(page, '[data-category="bug"]')
  await shadowClick(page, '[data-category="bug"]')
  await shadowWaitFor(page, '.mushi-intent-btn')
  await shadowClick(page, '.mushi-intent-btn')
  await shadowWaitFor(page, '.mushi-textarea', 8000)
}

test.describe('Reporter inbox — token scoping + My Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DOGFOOD_URL}${BASE_PATH}/`, { waitUntil: 'load', timeout: 45_000 })
    await page.waitForFunction(
      () => !!document.querySelector('#mushi-mushi-widget'),
      undefined,
      { polling: 500, timeout: 20_000 },
    )
  })

  test('project-scoped reporter token is persisted before submit', async ({ page }) => {
    const tokenKey = `mushi:reporter-token:${PROJECT_ID}`
    const tokenBefore = await page.evaluate((key) => localStorage.getItem(key), tokenKey)

    await openToDetailsStep(page)

    const tokenAfter = await page.evaluate((key) => localStorage.getItem(key), tokenKey)
    expect(tokenAfter, 'reporter token written to project-scoped key').toBeTruthy()
    expect(tokenAfter?.startsWith('mushi_'), 'token format').toBe(true)
    if (tokenBefore) {
      expect(tokenAfter).toBe(tokenBefore)
    }
  })

  test('submitted report appears in My Reports tab', async ({ page }) => {
    const marker = `RT-TEST-INBOX-${Date.now()}`
    await openToDetailsStep(page)
    await shadowFill(page, '.mushi-textarea', `${marker}: reporter inbox E2E verification`)

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/v1/reports') && r.request().method() === 'POST',
      { timeout: 20_000 },
    )

    await shadowClick(page, '[data-action="submit"]')
    const response = await responsePromise
    expect(response.status(), 'ingest HTTP status').toBeGreaterThanOrEqual(200)
    expect(response.status()).toBeLessThan(300)

    await page.waitForTimeout(1500)

    // Re-open widget and switch to My Reports tab
    await openMushiWidget(page)
    await shadowWaitFor(page, '.mushi-panel.open')

    const openedInbox = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      const tab =
        shadow?.querySelector('[data-tab="inbox"], [data-action="inbox"], .mushi-tab-inbox') as HTMLElement | null
        ?? Array.from(shadow?.querySelectorAll('button, [role="tab"]') ?? []).find((el) =>
          /my reports|your reports|inbox/i.test(el.textContent ?? ''),
        ) as HTMLElement | undefined
      tab?.click()
      return !!tab
    })
    expect(openedInbox, 'My Reports tab control found').toBe(true)

    await page.waitForFunction(
      (needle) => {
        const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
        const text = host?.shadowRoot?.querySelector('.mushi-panel')?.textContent ?? ''
        return text.includes(needle)
      },
      marker,
      { polling: 500, timeout: 25_000 },
    )
  })
})
