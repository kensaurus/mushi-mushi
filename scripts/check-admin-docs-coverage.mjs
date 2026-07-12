#!/usr/bin/env node
/**
 * Soft report: admin console routes in App.tsx vs apps/docs/content/admin/*.mdx.
 *
 * Default: warn-only (exit 0) so coverage can grow without blocking PRs.
 * Set ADMIN_DOCS_COVERAGE_STRICT=1 to fail when required routes lack MDX.
 *
 *   pnpm check:admin-docs-coverage
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_TSX = path.join(ROOT, 'apps/admin/src/App.tsx')
const ADMIN_DOCS = path.join(ROOT, 'apps/docs/content/admin')

/** Routes that are auth/utility chrome — not expected to have product docs. */
const SKIP_ROUTES = new Set([
  'login',
  'signup',
  'reset-password',
  'invite',
  'tester',
  'console', // redirect alias
  'fine-tuning', // redirect → prompt-lab
  'mcp/manual', // redirect → mcp
  'organization', // covered by teams.mdx
  'org', // same
  'rewards/tester-review', // nested under rewards
  'projects', // projects.mdx may use different slug — still require projects
])

/** Explicit map when App path slug ≠ MDX filename stem. */
const ROUTE_TO_MDX = {
  skills: 'skill-pipelines',
  'organization/members': 'teams',
  queue: 'queue',
  sso: 'sso',
  storage: 'storage',
  users: 'users',
}

function extractRoutes(appSrc) {
  const routes = new Set()
  const re = /path=["']\/([^"'*]+)["']/g
  let m
  while ((m = re.exec(appSrc)) !== null) {
    let p = m[1]
    // drop param segments for coverage key
    p = p.replace(/\/:[^/]+/g, '')
    p = p.replace(/\/\*$/, '')
    if (!p || p === '*') continue
    // top-level segment for nested tester etc.
    const top = p.split('/')[0]
    if (SKIP_ROUTES.has(p) || SKIP_ROUTES.has(top)) continue
    routes.add(p)
  }
  return [...routes].sort()
}

function listMdxStems() {
  if (!existsSync(ADMIN_DOCS)) return new Set()
  return new Set(
    readdirSync(ADMIN_DOCS)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => f.replace(/\.mdx$/, '')),
  )
}

const appSrc = readFileSync(APP_TSX, 'utf8')
const routes = extractRoutes(appSrc)
const mdx = listMdxStems()

const missing = []
for (const route of routes) {
  const stem = ROUTE_TO_MDX[route] ?? route.replace(/\//g, '-')
  if (mdx.has(stem) || mdx.has(route.split('/')[0])) continue
  // also accept last segment
  const last = route.split('/').pop()
  if (last && mdx.has(last)) continue
  missing.push({ route, expected: `${stem}.mdx` })
}

const strict = process.env.ADMIN_DOCS_COVERAGE_STRICT === '1'

if (missing.length === 0) {
  console.log(
    `✓ admin-docs-coverage: ${routes.length} App.tsx routes have matching admin MDX (${mdx.size} files)`,
  )
  process.exit(0)
}

const header = strict
  ? '✗ admin-docs-coverage (strict): missing admin MDX for console routes:\n'
  : '⚠ admin-docs-coverage (warn): missing admin MDX for console routes:\n'

console[strict ? 'error' : 'warn'](header)
for (const row of missing) {
  console[strict ? 'error' : 'warn'](`  - /${row.route} → expected apps/docs/content/admin/${row.expected}`)
}
console[strict ? 'error' : 'warn'](
  `\n${missing.length} gap(s). Add thin MDX pages or map in ROUTE_TO_MDX. Strict mode: ADMIN_DOCS_COVERAGE_STRICT=1`,
)

process.exit(strict ? 1 : 0)
