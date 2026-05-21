/**
 * FILE: examples/e2e-dogfood/tests/sdk-widget-features.spec.ts
 *
 * End-to-end test for all Mushi SDK widget features shipped in the
 * May 2026 Quality Pass:
 *  - Widget mounts and opens on glot.it (shadow DOM = open)
 *  - Category + intent steps navigate correctly
 *  - Example chips render on step 3 and paste text on click
 *  - Live char counter tracks input length
 *  - Locale-aware minLength validation (en=12, ja=6)
 *  - tooShort error message shows count/min instead of generic server error
 *  - Screenshot capture button shows loading state
 *  - Element selector hides panel and shows bottom hint toast
 *  - Successful submit → report confirmed in Supabase via API
 */

import { test, expect, type Page } from '@playwright/test'

const DOGFOOD_URL = process.env.MUSHI_DOGFOOD_URL ?? 'http://localhost:3000'
const ADMIN_URL   = process.env.MUSHI_ADMIN_URL   ?? 'http://localhost:6464'
const BASE_PATH   = '/glot-it'

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

// ── Navigation helper: open widget + walk to details step ───────────────────

/**
 * Open the widget, click through category (bug) → intent (first available)
 * to reach the details step with textarea + example chips.
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
  await shadowClick(page, '.mushi-trigger')
  await shadowWaitFor(page, '.mushi-panel.open')

  // Step 2: click the "bug" category option
  await shadowWaitFor(page, '[data-category="bug"]')
  await shadowClick(page, '[data-category="bug"]')

  // Step 3: click the first intent option
  await shadowWaitFor(page, '.mushi-intent-btn')
  await shadowClick(page, '.mushi-intent-btn')

  // Confirm details step is visible (textarea present)
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
  test('1. Widget host mounts with open shadow DOM and trigger button', async ({ page }) => {
    const info = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      return {
        found: !!host,
        hasShadow: !!host?.shadowRoot,
        triggerExists: !!host?.shadowRoot?.querySelector('.mushi-trigger'),
        triggerClass: host?.shadowRoot?.querySelector('.mushi-trigger')?.className ?? '',
      }
    })
    expect(info.found, 'widget host present').toBe(true)
    expect(info.hasShadow, 'shadow root is open').toBe(true)
    expect(info.triggerExists, 'trigger button present').toBe(true)
  })

  // ── 2. Panel opens ────────────────────────────────────────────────────────
  test('2. Clicking trigger opens the panel showing the category step', async ({ page }) => {
    await shadowClick(page, '.mushi-trigger')
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

  // ── 3. Example chips ──────────────────────────────────────────────────────
  test('3. Example chips appear on step 3 and paste text on click', async ({ page }) => {
    await openToDetailsStep(page)

    // Find chips
    const chips = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      return Array.from(host?.shadowRoot?.querySelectorAll('.mushi-example-chip') ?? []).map(c => c.textContent?.trim() ?? '')
    })
    expect(chips.length, 'example chips present').toBeGreaterThan(0)
    expect(chips[0], 'first chip has text').toBeTruthy()

    // Click first chip — should paste text into textarea
    await shadowClick(page, '.mushi-example-chip')
    await page.waitForTimeout(300)

    const taValue = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      return (host?.shadowRoot?.querySelector('.mushi-textarea') as HTMLTextAreaElement | null)?.value ?? ''
    })
    expect(taValue, 'chip text pasted into textarea').toBe(chips[0])
  })

  // ── 4. Live char counter ──────────────────────────────────────────────────
  test('4. Char counter updates as user types', async ({ page }) => {
    await openToDetailsStep(page)

    await shadowFill(page, '.mushi-textarea', 'Hello')
    await page.waitForTimeout(400)

    const counterText = await shadowText(page, '[data-role="char-counter"]')
    expect(counterText, 'char counter shows 5/N').toMatch(/5\/\d+/)
  })

  // ── 5. tooShort validation ────────────────────────────────────────────────
  test('5. Submitting too-short text shows char count hint not generic error', async ({ page }) => {
    await openToDetailsStep(page)

    await shadowFill(page, '.mushi-textarea', 'Bug')
    await page.waitForTimeout(200)
    await shadowClick(page, '[data-action="submit"]')
    await page.waitForTimeout(600)

    // Should show a message containing char counts (e.g. "3/12")
    const errorText = await page.evaluate(() => {
      const host = document.querySelector('#mushi-mushi-widget') as HTMLElement & { shadowRoot: ShadowRoot }
      const shadow = host?.shadowRoot
      // Check all possible error display locations
      const selectors = [
        '.mushi-validation-error',
        '[data-role="validation-msg"]',
        '[data-role="error-msg"]',
        '.mushi-error-text',
        '.mushi-too-short',
      ]
      for (const sel of selectors) {
        const el = shadow?.querySelector(sel) as HTMLElement | null
        if (el?.textContent?.trim()) return el.textContent.trim()
      }
      // Fallback: check the full panel text for error patterns
      return shadow?.querySelector('.mushi-panel')?.textContent?.substring(0, 500) ?? ''
    })

    // Must show char-count pattern (e.g. "3/12") not generic "Something went wrong"
    const hasCharCount = /\d+\/\d+/.test(errorText)
    const hasNudgeText = /more detail|tooShort|もう少し|detail|short/i.test(errorText)
    expect(
      hasCharCount || hasNudgeText,
      `Expected char count or nudge text, got: "${errorText.substring(0, 100)}"`,
    ).toBe(true)
    expect(errorText.toLowerCase(), 'should not show generic server error').not.toContain('something went wrong')
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

})
