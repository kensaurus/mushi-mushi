// SPDX-License-Identifier: MIT
/**
 * Browser sessions and screenshots. Every session goes through the write
 * guard (guard.ts) before any page opens.
 *
 * A session can reuse the persistent profile `mushi-ux login` created, so
 * captures see the signed-in app. The profile lives outside the repo and is
 * never named to the coding agent (ADR 0006).
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { installGuard, isGuardNoise, type AllowRule, type GuardLog } from './guard.js'
import { ignoreList, ignoreStyle } from './ignore.js'
import { isFrameworkNoise, runProbes } from './probes.js'
import type { ProbeResult, ReplayStep, Surface, Viewport } from './types.js'

export interface BrowserSession {
  /** Discovery browses here; app state it leaves behind stays here. */
  context: BrowserContext
  /**
   * A clean context for one capture: the cookies and storage the session
   * started with (a saved login included), the same guard and init scripts.
   * Captures share no client state, so a screen looks the same however many
   * other screens were visited before it (glot.it /words lost its empty
   * state after other screens wrote to localStorage, 2026-10-07).
   */
  freshContext(): Promise<BrowserContext>
  /**
   * Visit each path once in the shared context, then seed every later capture
   * from the storage that leaves behind. A first-ever visit can sit on a boot
   * screen past the content wait (glot.it /chat: a skeleton on desktop, blank
   * on the phone, 2026-10-07), so captures start from a visited app, the same
   * one for every screen.
   */
  warmUp(baseUrl: string, paths: readonly string[]): Promise<void>
  guard: GuardLog
  /** Selectors hidden in screenshots and left out of every probe (ignore.ts). */
  ignore: readonly string[]
  close(): Promise<void>
}

export interface SessionOptions {
  /** Persistent profile directory from `mushi-ux login`; omit for a clean browser. */
  profileDir?: string
  headless?: boolean
  allow?: readonly AllowRule[]
  /** Extra selectors to ignore on top of DEFAULT_IGNORE. */
  ignore?: readonly string[]
}

/** Sums layout shifts not caused by input, from page start. */
const CLS_SCRIPT = `(() => {
  window.__mushiCls = 0
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__mushiCls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
})()`

export async function openSession(opts: SessionOptions = {}): Promise<BrowserSession> {
  const headless = opts.headless ?? true
  let context: BrowserContext
  let closeBrowser: () => Promise<void>
  let browser: Browser
  // Playwright's docs say requests a Service Worker handles can bypass
  // context.route. Chromium on 1.61 routed them in a probe (Plan 021 §5), but
  // the guard must not depend on that: block Service Workers outright.
  if (opts.profileDir) {
    context = await chromium.launchPersistentContext(opts.profileDir, { headless, serviceWorkers: 'block' })
    // A persistent profile cannot spawn contexts: captures run in a second browser seeded from it.
    browser = await chromium.launch({ headless })
    closeBrowser = async () => {
      await context.close()
      await browser.close()
    }
  } else {
    browser = await chromium.launch({ headless })
    context = await browser.newContext({ serviceWorkers: 'block' })
    closeBrowser = () => browser.close()
  }
  const guard = await installGuard(context, opts.allow ?? [])
  await context.addInitScript({ content: CLS_SCRIPT })
  // The state every capture starts from; warmUp replaces it with a visited app.
  let seed = await context.storageState({ indexedDB: true })
  const warmUp = async (baseUrl: string, paths: readonly string[]) => {
    const page = await context.newPage()
    try {
      for (const p of paths) {
        await gotoPatiently(page, surfaceUrl(baseUrl, p)).catch(() => null)
        await settle(page).catch(() => undefined)
      }
    } finally {
      await page.close()
    }
    seed = await context.storageState({ indexedDB: true })
  }
  const freshContext = async () => {
    const fresh = await browser.newContext({ serviceWorkers: 'block', storageState: seed })
    await installGuard(fresh, opts.allow ?? [], guard)
    await fresh.addInitScript({ content: CLS_SCRIPT })
    return fresh
  }
  return { context, freshContext, warmUp, guard, ignore: ignoreList(opts.ignore), close: closeBrowser }
}

/**
 * Wait for the network to go quiet and the DOM to stop changing, both
 * bounded. Apps that hold a socket or poll never reach "network idle", so
 * that wait is capped short and the DOM-quiet wait does the real work.
 */
export async function settle(page: Page, quietMs = 400, maxMs = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: Math.min(maxMs, 2500) }).catch(() => {})
  await page
    .evaluate(
      ([quiet, max]) =>
        new Promise<void>((resolve) => {
          let timer = setTimeout(done, quiet)
          const stop = setTimeout(done, max)
          const mo = new MutationObserver(() => {
            clearTimeout(timer)
            timer = setTimeout(done, quiet)
          })
          mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
          function done() {
            mo.disconnect()
            clearTimeout(timer)
            clearTimeout(stop)
            resolve()
          }
        }),
      [quietMs, maxMs] as const,
    )
    .catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await waitForContent(page)
}

/**
 * Wait (up to `maxMs`) while the page shows a loading state: aria-busy, a
 * progress bar, or a spinning element covering most of the screen. An app
 * that boots behind a splash spinner was screenshotted as an empty page with
 * a spinner and "measured" as fine (glot.it /practice, 2026-10-06).
 */
export async function waitForContent(page: Page, maxMs = 20_000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const visible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect()
          const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
        }
        const busy = [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], .animate-spin, .spinner, [class*="spinner" i]')].some(visible)
        // Loading placeholders: skeleton classes, or a running skeleton/shimmer
        // animation (glot.it's Skeleton is marked only by `skeleton-wave`;
        // a regression re-shot of /words caught it mid-load, 2026-10-06).
        const skeleton =
          [...document.querySelectorAll('[class*="skeleton" i], [class*="shimmer" i], .animate-pulse, [data-skeleton]')].some(visible) ||
          (document.getAnimations?.() ?? []).some((a) => {
            const name = (a as CSSAnimation).animationName ?? ''
            const target = (a.effect as KeyframeEffect | null)?.target
            return /skeleton|shimmer|pulse|loading|placeholder/i.test(name) && !!target && visible(target)
          })
        if (skeleton) return false
        // Little text on the page means the real content has not arrived yet.
        const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()
        return !busy && text.length > 40
      },
      undefined,
      { timeout: maxMs, polling: 250 },
    )
    .catch(() => {})
}

export async function replay(page: Page, steps: readonly ReplayStep[]): Promise<void> {
  for (const step of steps) {
    await page.locator(step.selector).first().click({ timeout: 5000 })
    await settle(page)
  }
}

export function surfaceUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString()
}

/** A dev server compiling another route can hold a page for a minute; webpack often longer. */
const NAV_TIMEOUT_MS = 90_000

/** A navigation another navigation replaced, or one that ran out of time. */
const RETRY_NAV_RE = /timeout|ERR_ABORTED|interrupted by another navigation/i

/**
 * Navigate with a dev-server-sized timeout, and once more when the first try
 * times out (the route was compiling) or is replaced by the page's own reload
 * (a dev server's full reload after a slow compile). Playwright reports the
 * second case as ERR_ABORTED, or resolves to null with no error. Both cost
 * glot.it pages on 2026-10-06: home "could not load" under the 30 s default,
 * and /chat dropped with no message.
 */
export async function gotoPatiently(page: Page, url: string): Promise<Awaited<ReturnType<Page['goto']>>> {
  const go = () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  try {
    return (await go()) ?? (await go())
  } catch (err) {
    if (!RETRY_NAV_RE.test((err as Error).message)) throw err
    return go()
  }
}

export interface Capture {
  png: Buffer
  probes: ProbeResult
}

/** Load one surface at one viewport, screenshot it, and measure it. */
export async function captureSurface(
  session: BrowserSession,
  baseUrl: string,
  surface: Pick<Surface, 'path' | 'steps'>,
  viewport: Viewport,
): Promise<Capture> {
  const ctx = await session.freshContext()
  const page = await ctx.newPage()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isGuardNoise(msg.text()) && !isFrameworkNoise(msg.text())) consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err.message).slice(0, 300)))
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await gotoPatiently(page, surfaceUrl(baseUrl, surface.path))
    await settle(page)
    await replay(page, surface.steps)
    const png = await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      style: ignoreStyle(session.ignore) || undefined,
    })
    const probes = await runProbes(page, consoleErrors, session.ignore)
    return { png, probes }
  } finally {
    await ctx.close()
  }
}
