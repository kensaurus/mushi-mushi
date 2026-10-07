// SPDX-License-Identifier: MIT
/**
 * Start paths read from the source, so discovery reaches pages nothing links
 * to (a settings tab only the sidebar opens, a page behind a button).
 *
 * - React Router: absolute `path="/x"` props and `path: '/x'` route objects.
 *   Relative child paths are left to the crawler, which follows the links
 *   their layouts render.
 * - Next.js: `app/**\/page.*` and `pages/**\/*.*` files.
 * - Anything with a parameter (`:id`, `[id]`, `*`) is skipped: there is no
 *   safe value to invent for it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.worktrees', '.mushi', '.mushi-ux', 'coverage', '__tests__'])
const SOURCE_RE = /\.(tsx|ts|jsx|js|mjs)$/
const MAX_FILES = 4000

function isStatic(path: string): boolean {
  return path.startsWith('/') && !/[:*[\]]/.test(path) && !path.includes('//')
}

/** Pure, for tests: absolute static paths declared in one React Router source file. */
export function reactRouterPaths(source: string): string[] {
  const out: string[] = []
  const re = /\bpath\s*[=:]\s*\{?\s*(["'`])(\/[^"'`]*)\1/g
  for (const m of source.matchAll(re)) if (isStatic(m[2])) out.push(m[2])
  return out
}

/** Pure, for tests: the URL path a Next.js route file serves, or null. */
export function nextRoutePath(relFile: string): string | null {
  const parts = relFile.split(/[\\/]/)
  const appAt = parts.lastIndexOf('app')
  const pagesAt = parts.lastIndexOf('pages')
  let segs: string[]
  if (appAt >= 0 && /^page\.(tsx|jsx|ts|js|mdx)$/.test(parts[parts.length - 1])) {
    segs = parts.slice(appAt + 1, -1).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
  } else if (pagesAt >= 0 && SOURCE_RE.test(parts[parts.length - 1])) {
    segs = parts.slice(pagesAt + 1)
    const last = segs.pop()?.replace(SOURCE_RE, '') ?? ''
    if (last.startsWith('_') || segs[0] === 'api') return null
    if (last !== 'index') segs.push(last)
  } else {
    return null
  }
  const path = '/' + segs.join('/')
  return isStatic(path) ? path : null
}

/**
 * A route worth a screen in the burndown: concrete (no template or dynamic
 * segments) and not an error, auth-callback, API or dev-only page.
 */
export function isWorthVisiting(route: string): boolean {
  return route.startsWith('/') && !/[$[{:*]/.test(route) && !/^\/(api|_|404|500)(\/|$)|\/callback(\/|$)|^\/dev(\/|$)/.test(route)
}

export function routesFromSource(root: string): string[] {
  const found = new Set<string>()
  let files = 0
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || files > MAX_FILES) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      if (!SOURCE_RE.test(name) && !name.endsWith('.mdx')) continue
      if (/\.(test|spec|stories)\./.test(name)) continue
      files++
      const rel = relative(root, abs)
      const next = nextRoutePath(rel)
      if (next) found.add(next)
      if (st.size < 400_000 && /\.(tsx|jsx|ts|js)$/.test(name)) {
        const text = readFileSync(abs, 'utf8')
        if (text.includes('Route') || text.includes('createBrowserRouter') || text.includes('createRoutesFromElements')) {
          for (const p of reactRouterPaths(text)) found.add(p)
        }
      }
    }
  }
  walk(root, 0)
  return [...found].sort()
}

/** Paths listed in /sitemap.xml on the same origin; empty when there is none. */
export async function sitemapPaths(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(new URL('/sitemap.xml', baseUrl), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('xml')) return []
    const xml = await res.text()
    const origin = new URL(baseUrl).origin
    const out = new Set<string>()
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      try {
        const u = new URL(m[1])
        // Production sitemaps list the live domain; map their paths onto this server.
        const path = u.pathname + u.search
        if (u.origin === origin || isStatic(u.pathname)) out.add(path)
      } catch {
        /* not a URL */
      }
    }
    return [...out]
  } catch {
    return []
  }
}


const COMPONENT_DIRS = ['_components', 'components']
const MAX_SCREEN_FILES = 12

/**
 * The source files that render one URL path, so the agent starts editing
 * instead of searching: the Next.js page file, the layout beside it, and
 * the components kept next to it. Empty when the router is not one we read
 * (the agent then finds the files itself). On glot.it an attempt spent its
 * whole 15 minutes searching for /practice's files (2026-10-06).
 */
export function screenFiles(root: string, urlPath: string): string[] {
  const want = urlPath.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  let page: string | null = null
  let files = 0
  const walk = (dir: string, depth: number) => {
    if (page || depth > 8 || files > MAX_FILES) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (page) return
      if (SKIP_DIRS.has(name)) continue
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      files++
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (nextRoutePath(rel) === want) page = rel
    }
  }
  walk(root, 0)
  // Set inside walk(), which TypeScript's narrowing does not follow.
  const found = page as string | null
  if (!found) return []
  const dir = found.includes('/') ? found.slice(0, found.lastIndexOf('/')) : ''
  const out: string[] = [found]
  const list = (d: string) => {
    try {
      return readdirSync(join(root, d))
    } catch {
      return []
    }
  }
  for (const name of list(dir)) if (/^layout\.(tsx|jsx|ts|js)$/.test(name)) out.push(dir ? `${dir}/${name}` : name)
  for (const sub of COMPONENT_DIRS) {
    const d = dir ? `${dir}/${sub}` : sub
    for (const name of list(d)) if (SOURCE_RE.test(name) && !/\.(test|spec|stories)\./.test(name)) out.push(`${d}/${name}`)
  }
  return out.slice(0, MAX_SCREEN_FILES)
}
