#!/usr/bin/env node
/**
 * FILE: scripts/check-site-urls.mjs
 * PURPOSE: Fail when an absolute https://kensaur.us/mushi-mushi/... URL in the
 *          agent skills or a README points at nothing we deploy.
 *
 * These URLs are what agents and npm readers follow — skills/mushi-setup
 * sends agents to /docs/llms.txt — but scripts/check-docs-links.mjs only
 * walks apps/docs/content and skips absolute URLs and .txt, so a renamed docs
 * page or a moved public file broke them silently.
 *
 * Offline. Each URL is routed through the SAME viewer-request function
 * CloudFront runs for kensaur.us/mushi-mushi/* (scripts/cloudfront-mushi-spa-router.js,
 * loaded through the deploy's own comment-stripping build), following its
 * 301/302s, and the final S3 key is looked up in what the deploy workflows
 * publish:
 *   /mushi-mushi/docs/<route>.html      apps/docs/content/<route>.mdx|.md|/index.mdx,
 *                                       an app-router page (apps/docs/app/<route>/page.tsx),
 *                                       or apps/docs/public/<route>.html
 *   /mushi-mushi/docs/<file.ext>        apps/docs/public/<file.ext> or an app
 *                                       metadata route (robots.txt, sitemap.xml,
 *                                       manifest.webmanifest)
 *   /mushi-mushi/schemas/<file>.json    apps/docs/public/schemas/<file>.json
 *                                       (deploy-docs.yml syncs out/schemas there)
 *   /mushi-mushi/testers/<route>/index.html  apps/testers/app/<route>/page.tsx
 *   /mushi-mushi/admin/index.html       the admin SPA shell: every admin route
 *                                       resolves here, and React Router decides —
 *                                       valid, but not verifiable statically
 * Anything else is an S3 key no workflow writes, i.e. a 404.
 *
 * `#fragment` and `?query` are ignored. Templated URLs (`/docs${path}`,
 * `/llm-md/<path>.md`) are skipped and counted.
 *
 * Usage: node scripts/check-site-urls.mjs   (exit 1 on any dead URL)
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { stripSource } from './build-cf-function.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DOCS = join(ROOT, 'apps/docs')
const TESTERS = join(ROOT, 'apps/testers')
const ROUTER = join(ROOT, 'scripts/cloudfront-mushi-spa-router.js')

// App-router metadata routes Next.js emits at build time (apps/docs/app/*.ts).
const DOCS_METADATA_ROUTES = {
  'robots.txt': 'app/robots.ts',
  'sitemap.xml': 'app/sitemap.ts',
  'manifest.webmanifest': 'app/manifest.ts',
}

// Dead URLs found when this check was added, in files another change owns.
// Printed on every run; an entry whose URL is fixed or removed fails as stale,
// so the list only shrinks. Never add to it to get a run green.
// Key: "<repo-relative file> <url>".
const KNOWN_DEAD = new Map()

// Characters that end a URL in markdown, HTML attributes and code spans.
const URL_RE = /https?:\/\/(?:www\.)?kensaur\.us(\/mushi-mushi(?:[/?#][^\s)"'<>`\]*]*)?)?(?![\w/])/g
const TEMPLATE_NEXT = /^[<{$]/

/**
 * Absolute kensaur.us/mushi-mushi URLs in a text, with 1-based line numbers.
 * @returns {{ url: string, path: string, line: number, templated: boolean }[]}
 */
export function extractSiteUrls(text) {
  const out = []
  for (const m of text.matchAll(URL_RE)) {
    if (!m[1]) continue
    let path = m[1]
    const next = text.slice(m.index + m[0].length, m.index + m[0].length + 1)
    const templated = TEMPLATE_NEXT.test(next) || path.includes('${')
    path = path.replace(/[.,;:!]+$/, '')
    const line = text.slice(0, m.index).split('\n').length
    out.push({ url: m[0].replace(/[.,;:!]+$/, ''), path, line, templated })
  }
  return out
}

/** The CloudFront viewer-request handler, as deployed. */
export function loadRouter(file = ROUTER) {
  const src = stripSource(readFileSync(file, 'utf8'))
  // A CloudFront Function is a plain script with a top-level `handler`.
  const handler = new Function('event', `${src}\nreturn handler(event);`)
  return (uri) =>
    handler({ request: { uri, querystring: {}, headers: { host: { value: 'kensaur.us' } } } })
}

/**
 * Follow the router to the S3 key it would read.
 * @returns {{ key: string, hops: string[] } | { error: string, hops: string[] }}
 */
export function routeToKey(route, path) {
  const hops = []
  let uri = path.split(/[?#]/)[0] || '/mushi-mushi'
  for (let i = 0; i < 6; i++) {
    hops.push(uri)
    const res = route(uri)
    if (res && typeof res.statusCode === 'number') {
      if (res.statusCode !== 301 && res.statusCode !== 302) return { error: `router answers ${res.statusCode}`, hops }
      const location = res.headers?.location?.value ?? ''
      uri = location.replace(/^https?:\/\/(?:www\.)?kensaur\.us/, '').split('?')[0]
      if (!uri.startsWith('/')) return { error: `redirects off-site to ${location}`, hops }
      continue
    }
    return { key: res.uri, hops }
  }
  return { error: 'redirect loop', hops }
}

/**
 * Whether an S3 key is something a deploy workflow publishes.
 * @param {string} key e.g. /mushi-mushi/docs/quickstart.html
 * @param {(rel: string) => boolean} exists repo-relative existence check
 * @returns {{ ok: true, kind: string } | { ok: false, reason: string }}
 */
export function keyExists(key, exists) {
  if (key === '/mushi-mushi/admin/index.html') return { ok: true, kind: 'admin-spa' }

  const docs = key.match(/^\/mushi-mushi\/docs\/(.+)$/)
  if (docs) {
    const rest = decodeURIComponent(docs[1])
    if (rest === 'index.html') {
      return exists('apps/docs/content/index.mdx')
        ? { ok: true, kind: 'docs-page' }
        : { ok: false, reason: 'no apps/docs/content/index.mdx' }
    }
    if (rest.endsWith('.html')) {
      const route = rest.slice(0, -'.html'.length)
      const candidates = [
        `apps/docs/content/${route}.mdx`,
        `apps/docs/content/${route}.md`,
        `apps/docs/content/${route}/index.mdx`,
        `apps/docs/app/${route}/page.tsx`,
        `apps/docs/public/${rest}`,
      ]
      if (candidates.some(exists)) return { ok: true, kind: 'docs-page' }
      return { ok: false, reason: `no docs page for /${route} (looked for ${candidates.join(', ')})` }
    }
    if (DOCS_METADATA_ROUTES[rest] && exists(`apps/docs/${DOCS_METADATA_ROUTES[rest]}`)) {
      return { ok: true, kind: 'docs-metadata-route' }
    }
    if (exists(`apps/docs/public/${rest}`)) return { ok: true, kind: 'docs-public-file' }
    return { ok: false, reason: `no apps/docs/public/${rest}` }
  }

  const schema = key.match(/^\/mushi-mushi\/schemas\/([^/]+\.json)$/)
  if (schema) {
    return exists(`apps/docs/public/schemas/${schema[1]}`)
      ? { ok: true, kind: 'schema' }
      : { ok: false, reason: `no apps/docs/public/schemas/${schema[1]}` }
  }

  const testers = key.match(/^\/mushi-mushi\/testers\/(?:(.+)\/)?index\.html$/)
  if (testers) {
    const route = testers[1] ?? ''
    const candidates = [`apps/testers/app/${route ? `${route}/` : ''}page.tsx`, `apps/testers/src/app/${route ? `${route}/` : ''}page.tsx`]
    return candidates.some(exists) ? { ok: true, kind: 'testers-page' } : { ok: false, reason: `no testers page for /${route}` }
  }

  return { ok: false, reason: `no deploy workflow publishes S3 key ${key}` }
}

function listFiles() {
  const files = [join(ROOT, 'README.md')]
  for (const dir of readdirSync(join(ROOT, 'packages'))) {
    const readme = join(ROOT, 'packages', dir, 'README.md')
    if (existsSync(readme)) files.push(readme)
  }
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (name.endsWith('.md')) files.push(abs)
    }
  }
  walk(join(ROOT, 'skills'))
  return files
}

function main() {
  const route = loadRouter()
  const exists = (rel) => existsSync(join(ROOT, rel))
  const dead = []
  const known = []
  const seenKnown = new Set()
  const counts = {}
  let templated = 0
  let checked = 0

  for (const abs of listFiles()) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    for (const u of extractSiteUrls(readFileSync(abs, 'utf8'))) {
      if (u.templated) {
        templated++
        continue
      }
      checked++
      const routed = routeToKey(route, u.path)
      if ('error' in routed) {
        dead.push(`${rel}:${u.line} ${u.url} — ${routed.error} (${routed.hops.join(' → ')})`)
        continue
      }
      const found = keyExists(routed.key, exists)
      const knownKey = `${rel} ${u.url}`
      if (KNOWN_DEAD.has(knownKey)) {
        seenKnown.add(knownKey)
        if (found.ok) dead.push(`${rel}:${u.line} ${u.url} — resolves now; remove it from KNOWN_DEAD`)
        else known.push(`${rel}:${u.line} ${u.url} — ${KNOWN_DEAD.get(knownKey)}`)
        continue
      }
      if (!found.ok) {
        const via = routed.hops.length > 1 ? ` (via ${routed.hops.join(' → ')})` : ''
        dead.push(`${rel}:${u.line} ${u.url} — ${found.reason}${via}`)
        continue
      }
      counts[found.kind] = (counts[found.kind] ?? 0) + 1
    }
  }

  for (const key of KNOWN_DEAD.keys()) {
    if (!seenKnown.has(key)) dead.push(`${key} — listed in KNOWN_DEAD but no longer present; remove the entry`)
  }
  for (const k of known) console.warn(`KNOWN DEAD ${k}`)

  if (!existsSync(DOCS) || !existsSync(TESTERS)) {
    console.error('check-site-urls: apps/docs or apps/testers is missing; cannot resolve URLs')
    return 2
  }
  const summary = Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
  if (dead.length > 0) {
    console.error(`check-site-urls: ${dead.length} dead kensaur.us URL(s):\n`)
    for (const d of dead) console.error(`  • ${d}`)
    console.error('\nFix the link, or restore the page/file it points at.')
    return 1
  }
  console.log(`check-site-urls: ${checked} kensaur.us/mushi-mushi URL(s) resolve (${summary}); ${templated} templated skipped ✓`)
  return 0
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exitCode = main()
