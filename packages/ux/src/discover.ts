// SPDX-License-Identifier: MIT
/**
 * Turns a running app into a list of surfaces: every same-origin page
 * reachable from the start paths, plus the tabs, dialogs and menus each page
 * opens. Runs inside a guarded session, so nothing it clicks can write.
 *
 * Pages whose DOM structure matches one already seen (`/reports/1` and
 * `/reports/2`) are kept once.
 */

import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import { gotoPatiently, replay, settle, surfaceUrl, type BrowserSession } from './capture.js'
import { isDestructiveLabel } from './guard.js'
import { isWorthVisiting, routesFromSource, sitemapPaths } from './routes.js'
import type { ReplayStep, Surface, SurfaceKind } from './types.js'

export interface DiscoverOptions {
  baseUrl: string
  startPaths?: string[]
  /** Repo (or app) directory to read routes from; see routes.ts. */
  sourceDir?: string
  maxPages?: number
  maxStatesPerPage?: number
  /** Paths never visited (globs on pathname), on top of sign-out routes. */
  excludePaths?: string[]
  /**
   * Visit only startPaths (and the tabs, dialogs and menus they open): no
   * routes from the source or sitemap, no following links. Set when the
   * person named the pages.
   */
  onlyStartPaths?: boolean
  onProgress?: (msg: string) => void
  /** Stops discovery between pages (the studio's Stop button). */
  signal?: AbortSignal
}

/** Redirects to one sign-in path before discovery treats it as an auth wall. */
const AUTH_WALL_REDIRECTS = 5
const SIGN_IN_PATH_RE = /\/(log-?in|sign-?in|auth)\b/i
const SIGN_OUT_PATH_RE =/\/(log-?out|sign-?out|logoff)\b/i

/** Pure: same-origin, normalized path (no hash), or null to skip. */
export function normalizeLink(href: string, baseUrl: string): string | null {
  let u: URL
  try {
    u = new URL(href, baseUrl)
  } catch {
    return null
  }
  const base = new URL(baseUrl)
  if (u.origin !== base.origin) return null
  if (!/^https?:$/.test(u.protocol)) return null
  if (SIGN_OUT_PATH_RE.test(u.pathname)) return null
  if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|csv|json|xml|txt|js|css|map)$/i.test(u.pathname)) return null
  return u.pathname + u.search
}

export function surfaceKey(path: string, steps: readonly ReplayStep[]): string {
  const raw = [path, ...steps.map((s) => s.label)].join(' > ')
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'root'
  return `${slug}-${createHash('sha1').update(raw).digest('hex').slice(0, 6)}`
}

function globMatch(glob: string, path: string): boolean {
  const re = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return re.test(path)
}

/**
 * Structural fingerprint of the visible DOM: tags and roles to depth 8, with
 * runs of identical sibling shapes collapsed so a 3-row and a 30-row table
 * hash the same.
 */
async function domHash(page: Page): Promise<string> {
  const shape = await page.evaluate(() => {
    function sig(el: Element, depth: number): string {
      const role = el.getAttribute('role')
      const head = el.tagName.toLowerCase() + (role ? `[${role}]` : '')
      if (depth >= 8 || el.tagName === 'svg') return head
      const kids: string[] = []
      for (const child of Array.from(el.children)) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(child.tagName)) continue
        // Hidden panels and closed dialogs are not part of what the user sees.
        if ((child as HTMLElement).hidden || getComputedStyle(child).display === 'none') continue
        const s = sig(child, depth + 1)
        if (kids[kids.length - 1] !== s) kids.push(s)
      }
      return kids.length ? `${head}(${kids.join(',')})` : head
    }
    return sig(document.body, 0)
  })
  return createHash('sha1').update(shape).digest('hex').slice(0, 16)
}

interface Trigger {
  selector: string
  label: string
  role: string
}

/** A quoted attribute value: backslashes escaped before quotes, or a trailing `\` would eat the closing quote. */
function quoteAttr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Pure, for tests: the selector replay uses for a trigger, by test id first, else by role and name. */
export function triggerSelector(testId: string | null, role: string, label: string): string {
  if (testId) return `[data-testid=${quoteAttr(testId)}]`
  return role ? `role=${role}[name=${quoteAttr(label)}]` : ''
}

/** Elements that open a state without navigating: tabs, dialog and menu triggers. */
async function findTriggers(page: Page): Promise<Trigger[]> {
  const raw = await page.evaluate(() => {
    const found: Array<{ testId: string | null; label: string; role: string }> = []
    const candidates = document.querySelectorAll(
      '[role="tab"]:not([aria-selected="true"]), [aria-haspopup="dialog"], [aria-haspopup="menu"], [aria-haspopup="true"], button[aria-expanded="false"]',
    )
    for (const el of Array.from(candidates)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      if (!label) continue
      const role = el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : '')
      found.push({ testId: el.getAttribute('data-testid'), label, role })
    }
    return found
  })
  const triggers: Trigger[] = []
  const seen = new Set<string>()
  for (const { testId, label, role } of raw) {
    const selector = triggerSelector(testId, role, label)
    if (!selector || seen.has(selector)) continue
    seen.add(selector)
    triggers.push({ selector, label, role })
  }
  return triggers
}

async function openedKind(page: Page, trigger: Trigger): Promise<SurfaceKind | null> {
  return page.evaluate((role) => {
    const visible = (sel: string) =>
      Array.from(document.querySelectorAll(sel)).some((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
    if (visible('[role="dialog"], [role="alertdialog"], dialog[open]')) return 'dialog'
    if (visible('[role="menu"], [role="listbox"]')) return 'menu'
    if (role === 'tab') return 'tab'
    return null
  }, trigger.role) as Promise<SurfaceKind | null>
}

/**
 * Pure: a screen's name. The page title, unless another screen already has
 * that title (an SPA often keeps one <title>), then a name from the path:
 * "/" → "Home", "/account/settings/" → "Account / Settings".
 */
export function pageLabel(title: string, path: string, others: ReadonlyArray<{ label: string }>): string {
  const t = title.trim()
  if (t && !others.some((o) => o.label === t)) return t
  const parts = new URL(path, 'http://x').pathname.split('/').filter(Boolean)
  const fromPath = parts.length
    ? parts.map((p) => decodeURIComponent(p).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(' / ')
    : 'Home'
  return others.some((o) => o.label === fromPath) ? `${fromPath} (${path})` : fromPath
}

export async function discover(session: BrowserSession, opts: DiscoverOptions): Promise<Surface[]> {
  const maxPages = opts.maxPages ?? 40
  const maxStates = opts.maxStatesPerPage ?? 8
  const exclude = opts.excludePaths ?? []
  const progress = opts.onProgress ?? (() => {})
  const only = Boolean(opts.onlyStartPaths && opts.startPaths?.length)
  const seeded = [
    ...(opts.startPaths?.length ? opts.startPaths : ['/']),
    ...(only ? [] : (opts.sourceDir ? routesFromSource(opts.sourceDir) : []).filter(isWorthVisiting)),
    ...(only ? [] : (await sitemapPaths(opts.baseUrl)).filter(isWorthVisiting)),
  ]
  const queue = [...new Set(seeded)]
  progress(only ? `${queue.length} page(s) you named` : `${queue.length} start path(s) from the source, sitemap and options`)
  const visited = new Set<string>()
  const seenShapes = new Set<string>()
  // Many start paths landing on the same sign-in page = an auth wall.
  const redirectsTo = new Map<string, number>()
  const surfaces: Surface[] = []
  const page = await session.context.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })

  try {
    // Pass 2 only re-tries pages the person named that pass 1 dropped (a slow
    // first compile, a navigation racing a click): glot.it lost /practice
    // inside a run while the same build found it on its own (2026-10-06).
    for (let pass = 1; pass <= 2; pass++) {
    if (pass === 2) {
      if (!only) break
      const strip = (p: string) => p.replace(/\/(?=\?|$)/, '')
      const missing = [...new Set(seeded)].filter((p) => !surfaces.some((s) => s.kind === 'page' && strip(s.path) === strip(p)))
      if (missing.length === 0) break
      progress(`retrying ${missing.join(', ')}: not captured on the first pass`)
      for (const p of missing) {
        visited.delete(p)
        visited.delete(strip(p) + '/')
        visited.delete(strip(p))
      }
      queue.push(...missing)
    }
    while (queue.length > 0 && surfaces.filter((s) => s.kind === 'page').length < maxPages) {
      if (opts.signal?.aborted) throw new Error('Stopped.')
      const path = queue.shift() as string
      if (visited.has(path)) {
        if (only) progress(`skipped ${path}: already visited`)
        continue
      }
      visited.add(path)
      if (exclude.some((g) => globMatch(g, new URL(path, opts.baseUrl).pathname))) continue

      const failed = (err: Error) => {
        progress(`skipped ${path}: it did not load (${err.message.split('\n')[0].slice(0, 120)})`)
        return undefined
      }
      const res = await gotoPatiently(page, surfaceUrl(opts.baseUrl, path)).catch(failed)
      if (res === undefined) continue
      // null = no response after a retry (the page reloaded itself twice): go
      // on with what is on screen rather than drop the page without a word.
      if (res && res.status() >= 400) {
        progress(`skipped ${path}: HTTP ${res.status()}`)
        continue
      }
      await settle(page)
      const landed = new URL(page.url())
      if (landed.origin !== new URL(opts.baseUrl).origin) {
        progress(`skipped ${path}: it leaves the app for ${landed.origin}`)
        continue
      }
      const landedPath = landed.pathname + landed.search
      // `/practice` → `/practice/` is the same page; loading it again only cost
      // time and, on glot.it, lost /practice and /chat (2026-10-06).
      const sameModuloSlash = (a: string, b: string) => a.replace(/\/(?=\?|$)/, '') === b.replace(/\/(?=\?|$)/, '')
      if (landedPath !== path && sameModuloSlash(landedPath, path)) {
        visited.add(landedPath)
        if (visited.has(landedPath) && surfaces.some((s) => s.kind === 'page' && s.path === landedPath)) continue
      } else if (landedPath !== path && only) {
        progress(`skipped ${path}: it opens ${landedPath} instead`)
      }
      if (landedPath !== path && !sameModuloSlash(landedPath, path)) {
        // Redirected (sign-in wall, trailing slash): record the target instead.
        if (!visited.has(landedPath)) queue.unshift(landedPath)
        const n = (redirectsTo.get(landed.pathname) ?? 0) + 1
        redirectsTo.set(landed.pathname, n)
        if (n === AUTH_WALL_REDIRECTS && SIGN_IN_PATH_RE.test(landed.pathname)) {
          // Seeded routes behind the wall would each cost a load and redirect; drop them.
          const skipped = queue.filter((p) => p !== landedPath).length
          queue.splice(0, queue.length, ...queue.filter((p) => p === landedPath))
          progress(
            `${n} paths redirect to ${landed.pathname}: the app needs a signed-in session. ` +
              `Skipping the other ${skipped} queued path(s). Run \`mushi-ux login --url ${opts.baseUrl}\` and pass --login-url.`,
          )
        }
        continue
      }

      const here = landedPath
      const shape = await domHash(page)
      // A page the person named is always worked on: in an app shell several
      // routes share one structure while loading, and glot.it lost /words,
      // /chat and /account to this check (2026-10-06).
      if (seenShapes.has(shape) && !only) continue
      seenShapes.add(shape)
      const title = pageLabel(await page.title(), here, surfaces)
      surfaces.push({ key: surfaceKey(here, []), kind: 'page', path: here, steps: [], label: title, domHash: shape })
      progress(`page ${here}`)

      const links = await page.$$eval('a[href]', (as) =>
        as.map((a) => ({ href: a.getAttribute('href') ?? '', label: (a as HTMLElement).innerText.trim() })),
      )
      for (const { href, label } of links) {
        if (isDestructiveLabel(label)) continue
        const next = normalizeLink(href, page.url())
        if (!only && next && !visited.has(next) && !queue.includes(next)) queue.push(next)
      }

      const triggers = (await findTriggers(page)).filter((t) => !isDestructiveLabel(t.label)).slice(0, maxStates)
      for (const trigger of triggers) {
        const step: ReplayStep = { action: 'click', selector: trigger.selector, label: trigger.label }
        try {
          await gotoPatiently(page, surfaceUrl(opts.baseUrl, here))
          await settle(page)
          await replay(page, [step])
        } catch {
          continue
        }
        const after = new URL(page.url())
        if (after.pathname + after.search !== here) {
          // The "tab" was a link in disguise; crawl it as a page.
          const next = normalizeLink(page.url(), opts.baseUrl)
          if (!only && next && !visited.has(next) && !queue.includes(next)) queue.push(next)
          continue
        }
        const kind = await openedKind(page, trigger)
        if (!kind) continue
        const stateShape = await domHash(page)
        if (seenShapes.has(stateShape)) continue
        seenShapes.add(stateShape)
        surfaces.push({
          key: surfaceKey(here, [step]),
          kind,
          path: here,
          steps: [step],
          label: `${title} › ${trigger.label}`,
          domHash: stateShape,
        })
        progress(`${kind} ${here} › ${trigger.label}`)
      }
    }
    }
  } finally {
    await page.close()
  }
  return tidyLabels(surfaces)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Drops the site name most page titles repeat ("Account — glot.it" →
 * "Account"), so the burndown reads as a list of screens. The site name is
 * the first or last title segment shared by at least two pages and half of
 * them. A home page titled "Site – tagline" becomes "Home". A label that
 * would collide with another keeps its full title.
 * @internal Exported for tests only.
 */
export function tidyLabels<T extends { label: string; path: string; kind: string }>(surfaces: T[]): T[] {
  const SEP = /\s+[|–—·:-]\s+/
  const pages = surfaces.filter((s) => s.kind === 'page')
  const counts = new Map<string, number>()
  for (const s of pages) {
    const parts = s.label.split(SEP).map((p) => p.trim())
    if (parts.length < 2) continue
    for (const p of new Set([parts[0]!, parts[parts.length - 1]!])) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const site = [...counts].filter(([, n]) => n >= 2 && n * 2 >= pages.length).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!site) return surfaces
  const sep = String.raw`\s+[|–—·:-]\s+`
  const trailing = new RegExp(`${sep}${escapeRe(site)}(?=$|\\s›)`)
  const leading = new RegExp(`^${escapeRe(site)}${sep}`)
  const renamed = new Map<string, string>()
  for (const s of pages) {
    let next = s.label.replace(trailing, '')
    if (leading.test(next)) next = s.path === '/' ? 'Home' : next.replace(leading, '')
    if (next && next !== s.label) renamed.set(s.label, next)
  }
  const taken = new Set(pages.map((s) => s.label))
  const finalName = new Map<string, string>()
  for (const [from, to] of renamed) {
    if (taken.has(to) || [...finalName.values()].includes(to)) continue
    finalName.set(from, to)
  }
  return surfaces.map((s) => {
    const page = s.label.split(' › ')[0]!
    const to = finalName.get(page)
    return to ? { ...s, label: to + s.label.slice(page.length) } : s
  })
}
