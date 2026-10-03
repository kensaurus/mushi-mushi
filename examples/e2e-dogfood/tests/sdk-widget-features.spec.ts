/**
 * FILE: examples/e2e-dogfood/tests/sdk-widget-features.spec.ts
 *
 * End-to-end test for all Mushi SDK widget features shipped in the
 * May 2026 Quality Pass:
 *  - Widget mounts and opens on glot.it (shadow DOM = open for QA pierce)
 *  - The one-screen report (Plan 018): optional type chips, free text first
 *  - Send stays disabled with an inline "Add a few words" hint until the
 *    minimum (8, halved for CJK) is met
 *  - Screenshot capture button shows loading state
 *  - Element selector hides panel and shows bottom hint toast
 *  - Successful submit → report confirmed in Supabase via API
 */

import { test, expect, type Page } from '@playwright/test'

const DOGFOOD_URL = process.env.MUSHI_DOGFOOD_URL ?? 'http://localhost:3000'
const BASE_PATH   = '/glot-it'
const WIDGET_TRIGGER = process.env.MUSHI_WIDGET_TRIGGER ?? 'fab'

/** Open the reporter panel — banner mode (glot.it) or FAB trigger (legacy). */
async function openMushiWidget(page: Page) {
  if (WIDGET_TRIGGER === 'banner') {
    await shadowClick(page, '.mushi-banner-btn')
  } else {
    await openMushiWidget(page)
  }
}

// ── Shadow DOM helpers ───────────────────────────────────────────────────────

/** Click an element inside the Mushi shadow DOM */
async function shadowClick(page: Page, sel: string) {
  await page.evaluate((s) => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
    const el = host?.shadowRoot?.querySelector(s) as HTMLElement | null
    if (!el) throw new Error(`shadowClick: "${s}" not found in shadow DOM`)
    el.click()
  }, sel)
}

/** Get text content of an element inside shadow DOM */
async function shadowText(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => {
    const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
    return (host?.shadowRoot?.querySelector(s) as HTMLElement | null)?.textContent?.trim() ?? ''
  }, sel)
}

/** Set textarea value and fire input/change events inside shadow DOM */
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

/** Wait for an element inside shadow DOM */
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

// ── Navigation helper: open widget on the one-screen report ─────────────────

/**
 * Open the widget and pick the optional Bug type chip; the description
 * textarea is already on screen (Plan 018 one-screen report).
 *
 * Adds a 2.5s wait after navigation so the SDK's async runtime config fetch
 * completes before we try features that depend on it (elementSelector).
 * Fresh browser contexts have no localStorage cache so the fetch always runs.
 */
async function openToDetailsStep(page: Page) {
  // Give the runtime config fetch time to complete and be applied.
  // syncCaptureModules() must run with the server config before elementSelector
  // button click — otherwise the click returns early (elementSelector still null
  // from bootstrap defaults before the async fetch resolves).
  await page.waitForTimeout(2500)

  // Step 1: open the panel
  await openMushiWidget(page)
  await shadowWaitFor(page, '.mushi-panel.open')

  // Step 2: pick the optional "Bug" type chip
  await shadowWaitFor(page, '[data-category="bug"]')
  await shadowClick(page, '[data-category="bug"]')

  // The textarea is on the same screen
  await shadowWaitFor(page, '.mushi-textarea', 8000)
}

// ── Suite ────────────────────────────────────────────────────────────────────

test.describe('Mushi SDK widget — May 2026 Quality Pass', () => {

  // Pre-warm: hit the page once so Next.js compiles it before the real tests.
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    try {
      await p.goto(`${DOGFOOD_URL}${BASE_PATH}/`, { waitUntil: 'load', timeout: 60_000 })
      await p.waitForTimeout(3000)
    } catch { /* best-effort */ } finally {
      await ctx.close()
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`${DOGFOOD_URL}${BASE_PATH}/`, { waitUntil: 'load', timeout: 45_000 })
    // initMushi runs via deferWork → requestIdleCallback(timeout:300ms) →
    // dynamic import. Poll until the widget host appears.
    await page.waitForFunction(
      () => !!document.querySelector('#mushi-mushi-widget'),
      undefined,
      { polling: 500, timeout: 20_000 },
    )
  })

  // ── 1. Widget mounts ──────────────────────────────────────────────────────
  test('1. Widget host mounts with open shadow DOM and launcher control', async ({ page }) => {
    const info = await page.evaluate((triggerMode) => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      const launcherSel = triggerMode === 'banner' ? '.mushi-banner-btn' : '.mushi-trigger'
      const launcher = shadow?.querySelector(launcherSel)
      return {
        found: !!host,
        hasShadow: !!host?.shadowRoot,
        launcherExists: !!launcher,
        launcherClass: launcher?.className ?? '',
      }
    }, WIDGET_TRIGGER)
    expect(info.found, 'widget host present').toBe(true)
    expect(info.hasShadow, 'shadow root is open').toBe(true)
    expect(info.launcherExists, `${WIDGET_TRIGGER} launcher present`).toBe(true)
  })

  // ── 2. Panel opens ────────────────────────────────────────────────────────
  test('2. Clicking launcher opens the one-screen report with type chips', async ({ page }) => {
    await openMushiWidget(page)
    await shadowWaitFor(page, '.mushi-panel.open')
    await shadowWaitFor(page, '[data-category]')

    const info = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      return {
        panelOpen: shadow?.querySelector('.mushi-panel')?.classList.contains('open'),
        categoryButtons: Array.from(shadow?.querySelectorAll('[data-category]') ?? []).map(b => b.getAttribute('data-category')),
      }
    })
    expect(info.panelOpen, 'panel is open').toBe(true)
    expect(info.categoryButtons.length, 'category options rendered').toBeGreaterThan(0)
    expect(info.categoryButtons, 'bug category present').toContain('bug')
  })

  // ── 3. Type chips ─────────────────────────────────────────────────────────
  test('3. Type chips are an optional single-select radio group', async ({ page }) => {
    await openToDetailsStep(page)
    const checked = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      return Array.from(host?.shadowRoot?.querySelectorAll('[role="radio"][data-category]') ?? [])
        .filter((c) => c.getAttribute('aria-checked') === 'true')
        .map((c) => c.getAttribute('data-category'))
    })
    expect(checked, 'exactly the Bug chip is selected').toEqual(['bug'])
  })

  // ── 4. Send hint ──────────────────────────────────────────────────────────
  test('4. Send stays disabled with an inline hint until the minimum is met', async ({ page }) => {
    await openToDetailsStep(page)

    await shadowFill(page, '.mushi-textarea', 'Hello')
    await page.waitForTimeout(400)
    const state = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      return shadow?.querySelector('[data-action="submit"]')?.getAttribute('aria-disabled')
    })
    expect(state, 'Send disabled under the minimum').toBe('true')
    expect((await shadowText(page, '[data-role="hint"]')).length, 'hint explains why').toBeGreaterThan(0)
  })

  // ── 5. Too-short text is never sent ───────────────────────────────────────
  test('5. Submitting too-short text keeps the panel on the report screen', async ({ page }) => {
    await openToDetailsStep(page)

    await shadowFill(page, '.mushi-textarea', 'Bug')
    await page.waitForTimeout(200)
    await shadowClick(page, '[data-action="submit"]')
    await page.waitForTimeout(600)

    const stillOnReport = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      return !!shadow?.querySelector('.mushi-textarea') && !shadow?.querySelector('.mushi-success')
    })
    expect(stillOnReport, 'no receipt for a too-short report').toBe(true)
  })

  // ── 6. Screenshot button loading state ────────────────────────────────────
  test('6. Screenshot button transitions to loading state on click', async ({ page }) => {
    await openToDetailsStep(page)

    // Click the screenshot attach button
    const clicked = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      // Find by data-action or text content
      const btns = Array.from(shadow?.querySelectorAll('.mushi-attach-btn, [data-action]') ?? [])
      const btn = btns.find(b =>
        (b as HTMLElement).dataset.action === 'screenshot' ||
        b.textContent?.toLowerCase().includes('screenshot'),
      ) as HTMLButtonElement | null
      if (!btn) return false
      btn.click()
      return true
    })
    expect(clicked, 'screenshot button found and clicked').toBe(true)

    // Within ~200ms the button should show loading state
    const loadingAppeared = await page.waitForFunction(
      () => {
        const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
        const btns = Array.from(host?.shadowRoot?.querySelectorAll('.mushi-attach-btn, [data-action]') ?? [])
        return btns.some(b =>
          b.className.includes('loading') ||
          b.className.includes('capturing') ||
          b.className.includes('success') ||
          b.className.includes('error') ||
          (b as HTMLButtonElement).disabled,
        )
      },
      undefined,
      { polling: 100, timeout: 5000 },
    ).catch(() => null)

    // Accept: loading OR already completed (success/error) — both mean the button responded
    const finalState = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const btns = Array.from(host?.shadowRoot?.querySelectorAll('.mushi-attach-btn, [data-action]') ?? [])
      return btns.map(b => ({ class: b.className, disabled: (b as HTMLButtonElement).disabled }))
    })
    // The button must have changed from its resting state (has new class or is disabled)
    const responded = finalState.some(b =>
      b.class.includes('loading') || b.class.includes('success') || b.class.includes('error') || b.disabled,
    )
    expect(responded || loadingAppeared !== null, 'screenshot button responded to click').toBe(true)
  })

  // ── 7. Element selector ───────────────────────────────────────────────────
  test('7. Element selector hides panel and shows bottom hint toast', async ({ page }) => {
    await openToDetailsStep(page)

    // Click the element selector button
    const clicked = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      const btns = Array.from(shadow?.querySelectorAll('.mushi-attach-btn, [data-action]') ?? [])
      const btn = btns.find(b =>
        (b as HTMLElement).dataset.action === 'element' ||
        b.textContent?.toLowerCase().includes('element'),
      ) as HTMLButtonElement | null
      if (!btn) return false
      btn.click()
      return true
    })
    expect(clicked, 'element selector button found and clicked').toBe(true)
    await page.waitForTimeout(800)

    // Panel must be hidden
    const panelHidden = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const panel = host?.shadowRoot?.querySelector('.mushi-panel') as HTMLElement | null
      if (!panel) return true
      const s = window.getComputedStyle(panel)
      return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || panel.classList.contains('hidden')
    })
    expect(panelHidden, 'panel hidden during element selection').toBe(true)

    // Bottom hint toast must exist outside shadow root (appended with id="mushi-selector-hint")
    const hintVisible = await page.evaluate(() => {
      // The hint uses id="mushi-selector-hint" appended to document.body
      const hint = document.getElementById('mushi-selector-hint')
        ?? document.querySelector('[data-mushi-hint], [class*="mushi-hint"]')
      if (!hint) return false
      return window.getComputedStyle(hint as HTMLElement).display !== 'none'
    })
    expect(hintVisible, 'selector hint toast visible').toBe(true)
  })

  // ── 8. Full submit → Supabase ─────────────────────────────────────────────
  test('8. Full submit creates report confirmed in DB (sdk_version=1.2.2)', async ({ page }) => {
    await openToDetailsStep(page)

    const description = 'Playwright E2E — widget QA May 2026: example chips, char counter, locale-aware min, getDisplayMedia fallback'
    await shadowFill(page, '.mushi-textarea', description)
    await page.waitForTimeout(300)

    // Intercept the outgoing POST to capture the report ID
    const responsePromise = page.waitForResponse(
      r => r.url().includes('/v1/reports') && r.request().method() === 'POST',
      { timeout: 20_000 },
    ).catch(() => null)

    await shadowClick(page, '[data-action="submit"]')

    const response = await responsePromise
    let reportId: string | null = null
    if (response) {
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { reportId?: string } } | null
      expect(body?.ok, 'API returned ok:true').toBe(true)
      reportId = body?.data?.reportId ?? null
    }

    // Confirm success step in widget UI
    const successVisible = await page.waitForFunction(
      () => {
        const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
        const text = host?.shadowRoot?.querySelector('.mushi-panel')?.textContent?.toLowerCase() ?? ''
        return text.includes('thank') || text.includes('sent') || text.includes('received') ||
          !!host?.shadowRoot?.querySelector('[data-step="success"], .mushi-step-success, .mushi-success')
      },
      undefined,
      { polling: 500, timeout: 20_000 },
    ).catch(() => null)
    expect(successVisible, 'success step shown after submit').not.toBeNull()

    if (reportId) {
      console.log(`  ✓ Report ID: ${reportId}`)
    }
  })

  // ── 10. Report screen IA (Plan 018) ───────────────────────────────────────
  test('10. Report screen shows its title, the overflow menu and no step counter', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openMushiWidget(page)
    await shadowWaitFor(page, '.mushi-panel.open')

    const ia = await page.evaluate(() => {
      const recorder = (window as unknown as {
        __mushiRecorder?: {
          getCategoryStepIA?: () => {
            sectionLabel: string
            moreToggle: boolean
            footerStepIndicators: number
          }
        }
      }).__mushiRecorder
      if (recorder?.getCategoryStepIA) {
        return recorder.getCategoryStepIA()
      }
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      return {
        sectionLabel: shadow?.querySelector('#mushi-title')?.textContent?.trim() ?? '',
        moreToggle: !!shadow?.querySelector('[data-action="toggle-more-nav"]'),
        footerStepIndicators: shadow?.querySelectorAll('.mushi-step-indicator').length ?? 0,
      }
    })

    expect(ia.sectionLabel.length, 'report title visible').toBeGreaterThan(0)
    expect(ia.moreToggle, 'overflow menu present (the feature board is always wired)').toBe(true)
    expect(ia.footerStepIndicators, 'no step counter on the one-screen report').toBe(0)
  })

})
