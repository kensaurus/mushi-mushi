/**
 * FILE: examples/e2e-dogfood/tests/sdk-widget-a11y.spec.ts
 *
 * WCAG 2.4.11-oriented checks for the embedded Mushi widget:
 *  - Host `--mushi-banner-offset` tracks banner height when trigger is banner
 *  - Focused panel control is not fully obscured by a sticky host header + banner
 */

import { test, expect, type Page } from '@playwright/test'

const DOGFOOD_URL = process.env.MUSHI_DOGFOOD_URL ?? 'http://localhost:3000'
const BASE_PATH = '/glot-it'

async function dogfoodAppReachable(
  request: import('@playwright/test').APIRequestContext,
): Promise<boolean> {
  try {
    const res = await request.get(`${DOGFOOD_URL}${BASE_PATH}/`, { timeout: 8_000 })
    return res.ok()
  } catch {
    return false
  }
}

async function shadowClick(page: Page, sel: string) {
  await page.evaluate((s) => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
    const el = host?.shadowRoot?.querySelector(s) as HTMLElement | null
    if (!el) throw new Error(`shadowClick: "${s}" not found`)
    el.click()
  }, sel)
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

test.describe('Mushi SDK widget — banner offset + focus visibility', () => {
  test.beforeEach(async ({ page, request }) => {
    const reachable = await dogfoodAppReachable(request)
    test.skip(
      !reachable,
      `Dogfood app not reachable at ${DOGFOOD_URL}${BASE_PATH}/ — start glot.it or set MUSHI_DOGFOOD_URL`,
    )
    await page.goto(`${DOGFOOD_URL}${BASE_PATH}/`, { waitUntil: 'load', timeout: 45_000 })
    await page.waitForFunction(
      () => !!document.querySelector('#mushi-mushi-widget'),
      undefined,
      { polling: 500, timeout: 20_000 },
    )
  })

  test('banner offset CSS var is published when banner launcher is active', async ({ page }) => {
    await page.evaluate(() => {
      const sticky = document.createElement('div')
      sticky.id = 'qa-sticky-host-header'
      sticky.setAttribute('data-qa-sticky', '1')
      sticky.textContent = 'Sticky host chrome'
      Object.assign(sticky.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        height: '48px',
        zIndex: '1000',
        background: '#111',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '12px',
        fontSize: '14px',
      })
      document.body.prepend(sticky)
      document.documentElement.style.setProperty('--qa-sticky-header-h', '48px')
    })

    const offsetBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim(),
    )

    await shadowClick(page, '.mushi-trigger')
    await shadowWaitFor(page, '.mushi-panel.open')

    const metrics = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const banner = host?.shadowRoot?.querySelector('.mushi-banner') as HTMLElement | null
      const offset = getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
      return {
        offset,
        offsetBefore: offset,
        bannerHeight: banner?.getBoundingClientRect().height ?? 0,
        bannerVisible: !!banner && banner.offsetHeight > 0,
      }
    })

    // Widget may use FAB or banner depending on runtime config — when banner exists,
    // offset must be a positive px value (host contract from widget.ts).
    if (metrics.bannerVisible) {
      expect(parseFloat(metrics.offset || '0')).toBeGreaterThan(0)
    } else {
      expect(metrics.offset === '' || metrics.offset === '0px' || offsetBefore === metrics.offset).toBeTruthy()
    }
  })

  test('focused textarea is not fully covered by sticky host header', async ({ page }) => {
    await page.evaluate(() => {
      const sticky = document.createElement('div')
      sticky.id = 'qa-sticky-host-header-focus'
      Object.assign(sticky.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        height: '56px',
        zIndex: '1000',
        background: '#222',
      })
      document.body.prepend(sticky)
    })

    await page.waitForTimeout(1500)
    await shadowClick(page, '.mushi-trigger')
    await shadowWaitFor(page, '.mushi-panel.open')
    await shadowWaitFor(page, '[data-category="bug"]')
    await shadowClick(page, '[data-category="bug"]')
    await shadowWaitFor(page, '.mushi-intent-btn')
    await shadowClick(page, '.mushi-intent-btn')
    await shadowWaitFor(page, '.mushi-textarea')

    const visible = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const ta = host?.shadowRoot?.querySelector('.mushi-textarea') as HTMLTextAreaElement | null
      if (!ta) return { ok: false, reason: 'no-textarea' }
      ta.focus()
      const rect = ta.getBoundingClientRect()
      const stickyH = 56
      const visibleHeight = Math.max(0, rect.bottom - Math.max(rect.top, stickyH))
      const ratio = rect.height > 0 ? visibleHeight / rect.height : 0
      return { ok: ratio >= 0.5, ratio, top: rect.top, height: rect.height }
    })

    expect(visible.ok, `textarea visibility ratio ${visible.ratio}`).toBe(true)
  })
})
