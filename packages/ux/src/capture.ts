// SPDX-License-Identifier: MIT
/**
 * Browser sessions and screenshots. Every session goes through the write
 * guard (guard.ts) before any page opens.
 *
 * A session can reuse the persistent profile `mushi-ux login` created, so
 * captures see the signed-in app. The profile lives outside the repo and is
 * never named to the coding agent (ADR 0006).
 */

import { randomUUID } from 'node:crypto'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
import { installGuard, isGuardNoise, type AllowRule, type GuardLog, type GuardPolicy } from './guard.js'
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
   * A cached profile opens the page in that profile. Copying the profile
   * into a second browser with storageState signs the capture out.
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
  /** Persistent profile directory from `mushi-ux login`, or `--profile-dir` (a cached, signed-in profile); omit for a clean browser. */
  profileDir?: string
  /**
   * Browser build to open it with. 'chrome' opens a profile Google Chrome
   * created (playwright-cli's cached profiles) with the installed Chrome; the
   * bundled Chromium is older and may refuse or rewrite such a profile.
   */
  channel?: 'chrome' | 'chromium'
  headless?: boolean
  allow?: readonly AllowRule[]
  /** Extra selectors to ignore on top of DEFAULT_IGNORE. */
  ignore?: readonly string[]
  /** Write policy (guard.ts). Default read-only; fresh-eyes runs may write to the app's own origins (ADR 0053). */
  policy?: GuardPolicy
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

/**
 * Key prefix for the per-origin localStorage snapshot a profile session
 * keeps in the page. The run id makes a crashed run's key stale: the next
 * run deletes it instead of treating it as the profile.
 * @internal Exported for tests only.
 */
export const PROFILE_LS_PREFIX = '__mushiLsBaseline:'

/**
 * @internal Exported for tests only. Runs in every top-level document of a
 * profile session, before the app. The first document on an origin snapshots
 * the profile's localStorage; a later tab restores that snapshot so captures
 * do not share client state. The same tab keeps what it writes.
 */
export function profileStorageInitScript(runId: string): string {
  return `(() => {
  try {
    if (window.top !== window) return
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return
    const PREFIX = ${JSON.stringify(PROFILE_LS_PREFIX)}
    const KEY = ${JSON.stringify(PROFILE_LS_PREFIX + runId)}
    const READY = ${JSON.stringify(`${PROFILE_LS_PREFIX}ready:${runId}`)}
    const namesOf = () => {
      const names = []
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i)
        if (name) names.push(name)
      }
      return names
    }
    for (const name of namesOf()) if (name.startsWith(PREFIX) && name !== KEY) localStorage.removeItem(name)
    if (sessionStorage.getItem(READY) === '1') return
    let raw = localStorage.getItem(KEY)
    if (raw === null) {
      raw = JSON.stringify(namesOf().map((name) => [name, localStorage.getItem(name)]))
      localStorage.setItem(KEY, raw)
    }
    let parsed
    try { parsed = JSON.parse(raw) } catch { return }
    if (!Array.isArray(parsed)) return
    const keep = new Set(parsed.map((pair) => (pair && typeof pair[0] === 'string' ? pair[0] : '')))
    for (const name of namesOf()) if (name !== KEY && !keep.has(name)) localStorage.removeItem(name)
    for (const pair of parsed) {
      if (!pair || typeof pair[0] !== 'string' || pair[0] === KEY) continue
      localStorage.setItem(pair[0], pair[1] == null ? '' : String(pair[1]))
    }
    sessionStorage.setItem(READY, '1')
  } catch { /* storage disabled on this page */ }
})()`
}

/**
 * @internal Exported for tests only. localStorage to write back when a
 * profile session closes: the in-page baseline (what captures restore),
 * never the baseline key and never keys a later capture added.
 */
export function profileStorageAfterClose(entries: readonly (readonly [string, string])[], prefix: string): [string, string][] {
  const baseline = entries.find(([key]) => key.startsWith(prefix))?.[1] ?? null
  const plain = entries.filter(([key]) => !key.startsWith(prefix)).map(([key, value]) => [key, value] as [string, string])
  if (baseline === null) return plain
  try {
    const parsed = JSON.parse(baseline) as unknown
    if (!Array.isArray(parsed)) return plain
    const items: [string, string][] = []
    for (const pair of parsed) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || pair[0].startsWith(prefix)) continue
      items.push([pair[0], pair[1] == null ? '' : String(pair[1])])
    }
    return items
  } catch {
    return plain
  }
}

/** One capture at a time. Profile pages share an origin's localStorage, so two viewports cannot write it at once. */
export function createLease(): { acquire(): Promise<() => void>; join(): Promise<void> } {
  let tail: Promise<void> = Promise.resolve()
  return {
    acquire() {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const ready = tail.then(() => release)
      tail = gate
      return ready
    },
    join() {
      return tail
    },
  }
}

interface LooseEvents {
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
  route(url: unknown, handler: (...args: unknown[]) => unknown, options?: unknown): Promise<void>
  unroute(url: unknown, handler?: (...args: unknown[]) => unknown): Promise<void>
}

/**
 * @internal Exported for tests only. A capture's view of a persistent profile.
 * `close` closes only the pages this capture opened (closing the last window
 * quits Chrome) and drops listeners and routes it added. Every other call
 * goes to the profile, and a method that throws does so at the call.
 */
export function profileCaptureContext(context: BrowserContext, release: () => void): BrowserContext {
  const before = new Set(context.pages())
  const events = context as unknown as LooseEvents
  const listeners: { event: string; fn: (...args: unknown[]) => void }[] = []
  const routes: { url: unknown; handler: (...args: unknown[]) => unknown }[] = []
  let released = false
  const finish = () => {
    if (released) return
    released = true
    release()
  }
  const proxy = new Proxy(context, {
    get(target, prop) {
      if (prop === 'close') {
        return async () => {
          try {
            for (const route of routes.splice(0)) await events.unroute(route.url, route.handler).catch(() => {})
            for (const listener of listeners.splice(0)) events.off(listener.event, listener.fn)
            for (const page of target.pages()) {
              if (!before.has(page)) await page.close().catch(() => {})
            }
          } finally {
            finish()
          }
        }
      }
      if (prop === 'newPage') return (...args: Parameters<BrowserContext['newPage']>) => target.newPage(...args)
      if (prop === 'on' || prop === 'addListener') {
        return (event: string, fn: (...args: unknown[]) => void) => {
          events.on(event, fn)
          listeners.push({ event, fn })
          return proxy
        }
      }
      if (prop === 'once') {
        return (event: string, fn: (...args: unknown[]) => void) => {
          const wrapped = (...args: unknown[]) => {
            events.off(event, wrapped)
            const i = listeners.findIndex((listener) => listener.fn === wrapped)
            if (i >= 0) listeners.splice(i, 1)
            fn(...args)
          }
          events.on(event, wrapped)
          listeners.push({ event, fn: wrapped })
          return proxy
        }
      }
      if (prop === 'off' || prop === 'removeListener') {
        return (event: string, fn: (...args: unknown[]) => void) => {
          events.off(event, fn)
          const i = listeners.findIndex((listener) => listener.event === event && listener.fn === fn)
          if (i >= 0) listeners.splice(i, 1)
          return proxy
        }
      }
      if (prop === 'route') {
        return (url: unknown, handler: (...args: unknown[]) => unknown, options?: unknown) => {
          routes.push({ url, handler })
          return events.route(url, handler, options)
        }
      }
      if (prop === 'unroute') {
        return (url: unknown, handler?: (...args: unknown[]) => unknown) => {
          for (let i = routes.length - 1; i >= 0; i--) {
            const route = routes[i]
            if (route && route.url === url && (handler === undefined || route.handler === handler)) routes.splice(i, 1)
          }
          return events.unroute(url, handler)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  return proxy
}

/** After warm-up, captures start from the visited app: replace the pre-script snapshot with the localStorage the visit left. */
async function commitProfileBaseline(page: Page, runId: string): Promise<void> {
  try {
    const url = new URL(page.url())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  } catch {
    return
  }
  const key = PROFILE_LS_PREFIX + runId
  await page
    .evaluate(
      ({ k, prefix }) => {
        const items: [string, string][] = []
        for (let i = 0; i < localStorage.length; i++) {
          const name = localStorage.key(i)
          if (name && !name.startsWith(prefix)) items.push([name, localStorage.getItem(name) ?? ''])
        }
        localStorage.setItem(k, JSON.stringify(items))
      },
      { k: key, prefix: PROFILE_LS_PREFIX },
    )
    .catch(() => {})
}

async function writeOriginStorage(client: CDPSession, origin: string, items: readonly (readonly [string, string])[]): Promise<void> {
  const storageId = { securityOrigin: origin, isLocalStorage: true as const }
  await client.send('DOMStorage.clear', { storageId })
  for (const [key, value] of items) await client.send('DOMStorage.setDOMStorageItem', { storageId, key, value })
}

/** CDP sometimes reports an origin it has not loaded as empty. A missing baseline key means the read is not the profile. */
async function readOriginEntries(client: CDPSession, origin: string): Promise<[string, string][] | null> {
  try {
    const { entries } = await client.send('DOMStorage.getDOMStorageItems', { storageId: { securityOrigin: origin, isLocalStorage: true } })
    const pairs = entries.map((entry) => [entry[0] ?? '', entry[1] ?? ''] as [string, string])
    return pairs.some(([key]) => key.startsWith(PROFILE_LS_PREFIX)) ? pairs : null
  } catch {
    return null
  }
}

/** Put one origin back without running the app: a blank document still has that origin's localStorage. */
async function restoreOriginViaPage(context: BrowserContext, origin: string): Promise<void> {
  const page = await context.newPage()
  try {
    // A blank document, so the app cannot write storage again after we put it back.
    await page.route('**/*', (route) => {
      if (!route.request().isNavigationRequest()) return route.abort()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>.</title>' })
    })
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
    const entries = await page.evaluate(() => {
      const out: [string, string][] = []
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i)
        if (name) out.push([name, localStorage.getItem(name) ?? ''])
      }
      return out
    })
    const wanted = profileStorageAfterClose(entries, PROFILE_LS_PREFIX)
    await page.evaluate((items) => {
      const names: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i)
        if (name) names.push(name)
      }
      for (const name of names) localStorage.removeItem(name)
      for (const [key, value] of items) localStorage.setItem(key, value)
    }, wanted)
  } finally {
    await page.close().catch(() => {})
  }
}

/** Drop the baseline key and any localStorage a capture wrote on top of it. */
async function restoreProfileStorage(context: BrowserContext, origins: Iterable<string>): Promise<void> {
  const list = [...origins]
  if (!list.length) return
  let page: Page | null = null
  try {
    page = await context.newPage()
    const client = await context.newCDPSession(page)
    await client.send('DOMStorage.enable')
    for (const origin of list) {
      const entries = await readOriginEntries(client, origin)
      if (!entries) {
        await restoreOriginViaPage(context, origin).catch(() => {})
        continue
      }
      try {
        await writeOriginStorage(client, origin, profileStorageAfterClose(entries, PROFILE_LS_PREFIX))
      } catch {
        await restoreOriginViaPage(context, origin).catch(() => {})
      }
    }
  } catch {
    for (const origin of list) await restoreOriginViaPage(context, origin).catch(() => {})
  } finally {
    await page?.close().catch(() => {})
  }
}

export async function openSession(opts: SessionOptions = {}): Promise<BrowserSession> {
  const headless = opts.headless ?? true
  let context: BrowserContext
  let closeBrowser: () => Promise<void>
  let launched: Browser | null = null
  // Playwright's docs say requests a Service Worker handles can bypass
  // context.route. Chromium on 1.61 routed them in a probe (Plan 021 §5), but
  // the guard must not depend on that: block Service Workers outright.
  const channel = opts.channel === 'chrome' ? { channel: 'chrome' as const } : {}
  const profile = Boolean(opts.profileDir)
  const lease = createLease()
  const seen = new Set<string>()
  const runId = profile ? randomUUID() : ''
  if (opts.profileDir) {
    context = await chromium.launchPersistentContext(opts.profileDir, { headless, serviceWorkers: 'block', ...channel })
    // One profile, one browser. storageState does not carry the cookies and
    // IndexedDB Chrome keeps in the profile, so a second browser is signed out.
    context.on('framenavigated', (frame) => {
      if (frame.parentFrame()) return
      try {
        const url = new URL(frame.url())
        if (url.protocol === 'http:' || url.protocol === 'https:') seen.add(url.origin)
      } catch {
        /* not a url */
      }
    })
    closeBrowser = async () => {
      await lease.join()
      try {
        await restoreProfileStorage(context, seen)
      } finally {
        await context.close()
      }
    }
  } else {
    const browser = await chromium.launch({ headless, ...channel })
    launched = browser
    context = await browser.newContext({ serviceWorkers: 'block' })
    closeBrowser = () => browser.close()
  }
  const guard = await installGuard(context, opts.allow ?? [], { blocked: [] }, opts.policy)
  await context.addInitScript({ content: CLS_SCRIPT })
  if (profile) await context.addInitScript({ content: profileStorageInitScript(runId) })
  // The state every capture starts from; warmUp replaces it with a visited app.
  // A profile does not use it: the capture page is that profile.
  let seed: Awaited<ReturnType<BrowserContext['storageState']>> | undefined
  if (!profile) seed = await context.storageState({ indexedDB: true })
  const warmUp = async (baseUrl: string, paths: readonly string[]) => {
    const release = profile ? await lease.acquire() : null
    const page = await context.newPage()
    try {
      for (const p of paths) {
        await gotoPatiently(page, surfaceUrl(baseUrl, p)).catch(() => null)
        await settle(page).catch(() => undefined)
        if (profile) await commitProfileBaseline(page, runId)
      }
    } finally {
      await page.close().catch(() => {})
      release?.()
    }
    if (!profile) seed = await context.storageState({ indexedDB: true })
  }
  const freshContext = async () => {
    if (!profile) {
      if (!launched || !seed) throw new Error('Browser session failed to open.')
      const fresh = await launched.newContext({ serviceWorkers: 'block', storageState: seed })
      await installGuard(fresh, opts.allow ?? [], guard, opts.policy)
      await fresh.addInitScript({ content: CLS_SCRIPT })
      return fresh
    }
    const release = await lease.acquire()
    try {
      return profileCaptureContext(context, release)
    } catch (err) {
      release()
      throw err
    }
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

/** @internal Exported for tests only. What a page shows that may mean "still loading", measured in the page. */
export interface LoadingMarks {
  viewport: { width: number; height: number }
  /** aria-busy, a progress bar or a spinner. */
  busy: Array<{ width: number; height: number }>
  /** Skeleton or shimmer classes, or a running animation named so. */
  skeletons: Array<{ width: number; height: number }>
  /** `.animate-pulse`, or a running animation named pulse, loading or placeholder: a skeleton block or a decorative dot. */
  pulses: Array<{ width: number; height: number }>
  textLength: number
}

/** An element both sides under this is a dot (a notification badge, a status light), never a loading placeholder. */
const DOT_PX = 16
/** A pulse on less of the screen than this is decoration: a pulsing skeleton block is bigger. */
const PULSE_MIN_VIEWPORT_SHARE = 0.005

/**
 * @internal Exported for tests only. Pure: whether the page has its content.
 * Spinners and progress bars always hold it. A skeleton holds it unless it is
 * a dot; a pulse holds it only when it is bigger than decoration (the console's
 * bell dot and brand dot pulse forever: every step waited the full cap,
 * 2026-10-28). Little text means the content has not arrived yet.
 */
export function contentReady(m: LoadingMarks): boolean {
  const dot = (e: { width: number; height: number }) => e.width < DOT_PX && e.height < DOT_PX
  const smallShare = Math.max(1, m.viewport.width * m.viewport.height) * PULSE_MIN_VIEWPORT_SHARE
  if (m.busy.length) return false
  if (m.skeletons.some((e) => !dot(e))) return false
  if (m.pulses.some((e) => !dot(e) && e.width * e.height >= smallShare)) return false
  return m.textLength > 40
}

/** How many content waits on a page ran into their cap. A capped wait is not the app's real time. */
const cappedWaits = new WeakMap<Page, number>()

/** Content waits on this page that hit their cap so far (a step compares before and after). */
export function contentWaitsCapped(page: Page): number {
  return cappedWaits.get(page) ?? 0
}

/**
 * Wait (up to `maxMs`) while the page shows a loading state: aria-busy, a
 * progress bar, or a spinning element covering most of the screen. An app
 * that boots behind a splash spinner was screenshotted as an empty page with
 * a spinner and "measured" as fine (glot.it /practice, 2026-10-06). Resolves
 * true when the content is there, false when the wait hit its cap (counted
 * in contentWaitsCapped).
 */
export async function waitForContent(page: Page, maxMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  for (;;) {
    if (page.isClosed()) return false
    const marks = await page
      .evaluate((): LoadingMarks => {
        const box = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect()
          const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' ? { width: r.width, height: r.height } : null
        }
        const boxes = (sel: string) => [...document.querySelectorAll(sel)].map(box).filter((b): b is { width: number; height: number } => !!b)
        const busy = boxes('[aria-busy="true"], [role="progressbar"], .animate-spin, .spinner, [class*="spinner" i]')
        // Loading placeholders: skeleton classes, or a running skeleton/shimmer
        // animation (glot.it's Skeleton is marked only by `skeleton-wave`;
        // a regression re-shot of /words caught it mid-load, 2026-10-06).
        const skeletons = boxes('[class*="skeleton" i], [class*="shimmer" i], [data-skeleton]')
        const pulses = boxes('.animate-pulse')
        for (const a of document.getAnimations?.() ?? []) {
          const name = (a as CSSAnimation).animationName ?? ''
          const target = (a.effect as KeyframeEffect | null)?.target
          const b = target ? box(target) : null
          if (!b) continue
          if (/skeleton|shimmer/i.test(name)) skeletons.push(b)
          else if (/pulse|loading|placeholder/i.test(name)) pulses.push(b)
        }
        const textLength = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length
        return { viewport: { width: innerWidth, height: innerHeight }, busy, skeletons, pulses, textLength }
      })
      .catch(() => null)
    if (marks && contentReady(marks)) return true
    if (Date.now() >= deadline) {
      cappedWaits.set(page, contentWaitsCapped(page) + 1)
      return false
    }
    await new Promise((r) => setTimeout(r, 250))
  }
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
