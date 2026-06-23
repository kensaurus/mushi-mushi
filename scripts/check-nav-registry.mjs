#!/usr/bin/env node
/**
 * FILE: scripts/check-nav-registry.mjs
 * PURPOSE: CI guard — navRegistry sidebar paths must exist in App.tsx routes.
 *
 * USAGE: node scripts/check-nav-registry.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const APP_TSX = resolve(ROOT, 'apps/admin/src/App.tsx')
const NAV_REGISTRY = resolve(ROOT, 'apps/admin/src/lib/navRegistry.ts')

const appSrc = readFileSync(APP_TSX, 'utf8')
const navSrc = readFileSync(NAV_REGISTRY, 'utf8')

const appPaths = new Set()
for (const match of appSrc.matchAll(/<Route\s+path="([^"]+)"/g)) {
  const path = match[1]
  if (path === '/*' || path.startsWith('/tester')) continue
  appPaths.add(path.replace(/:\w+/g, '').replace(/\*$/, ''))
}

function routeExists(basePath) {
  if (appPaths.has(basePath)) return true
  for (const app of appPaths) {
    if (app === basePath || app.startsWith(`${basePath}/`) || basePath.startsWith(`${app}/`)) {
      return true
    }
  }
  return false
}

const blocks = navSrc.split(/\n  \{\n    id: 'nav:/).slice(1)
const entries = blocks.map((block) => {
  const path = block.match(/path:\s*'([^']+)'/)?.[1] ?? ''
  const inSidebar = !block.includes('inSidebar: false')
  return { path, inSidebar }
})

const errors = []

for (const { path, inSidebar } of entries) {
  if (!path) continue
  const base = path.split('?')[0]
  if (!inSidebar) {
    if (path.includes('?') && routeExists(base)) continue
    if (!routeExists(base)) {
      errors.push(`palette-only navRegistry path "${path}" has no App.tsx route for base "${base}"`)
    }
    continue
  }
  if (!routeExists(base)) {
    errors.push(`sidebar navRegistry path "${base}" missing from App.tsx`)
  }
}

if (!navSrc.includes('export function buildStageRoutes')) {
  errors.push('navRegistry must export buildStageRoutes() for pdca lock-step')
}

if (!navSrc.includes('export function routeFallbackTitle')) {
  errors.push('navRegistry must export routeFallbackTitle() for document titles')
}

if (!navSrc.includes('export function buildRouteTitleMatchers')) {
  errors.push('navRegistry must export buildRouteTitleMatchers() for document titles')
}

if (errors.length > 0) {
  console.error('check-nav-registry: FAILED\n')
  for (const e of errors) console.error(`  • ${e}`)
  process.exit(1)
}

console.log(
  `check-nav-registry: OK (${entries.length} registry entries, ${appPaths.size} app routes)`,
)
