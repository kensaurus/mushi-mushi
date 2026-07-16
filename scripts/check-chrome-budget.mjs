#!/usr/bin/env node
/**
 * Chrome budget regression guard (Wave 2).
 *
 * Static checks that the app header / Connect SDK card keep the overflow and
 * container-query patterns landed in CONSOLE-UIUX-UNIFICATION-WAVE2.md.
 * Complements the Playwright PagePosture budget in
 * examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts.
 *
 * Failures mean a change reintroduced:
 *   - non-wrapping chrome-top-row (header overlap at ≤1280)
 *   - VersionBadge without min-w-0 (pill refuses to compress)
 *   - SdkInstallCard viewport lg:grid-cols nested under ConnectPage xl:grid
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const checks = []

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function assert(ok, id, detail) {
  checks.push({ ok, id, detail })
}

const css = read('apps/admin/src/styles/components.css')
const chromeBlock = css.match(/\.chrome-top-row\s*\{[^}]+\}/)?.[0] ?? ''
assert(
  /flex-wrap\s*:\s*wrap/.test(chromeBlock),
  'chrome-top-row-wrap',
  '.chrome-top-row must include flex-wrap: wrap (header priority+/overflow)',
)

const layout = read('apps/admin/src/components/Layout.tsx')
// Desktop sub-header right cluster (search for the distinctive ml-auto toolbar line).
assert(
  /ml-auto flex min-w-0 max-w-full shrink items-center justify-end gap-1 xl:gap-1\.5 flex-wrap/.test(
    layout,
  ),
  'layout-toolbar-wrap',
  'Desktop chrome toolbar cluster must allow flex-wrap + min-w-0',
)
assert(
  /hidden md:flex chrome-top-row/.test(layout),
  'layout-desktop-chrome',
  'Desktop sub-header must use chrome-top-row',
)

const versionBadge = read('apps/admin/src/components/VersionBadge.tsx')
assert(
  /inline-flex min-w-0 max-w-full/.test(versionBadge),
  'version-badge-minw',
  'VersionBadge trigger must include min-w-0 max-w-full',
)

const sdkCard = read('apps/admin/src/components/SdkInstallCard.tsx')
assert(
  /@container\/sdk/.test(sdkCard),
  'sdk-card-container',
  'SdkInstallCard must declare @container/sdk (named container query)',
)
assert(
  /@2xl\/sdk:grid-cols/.test(sdkCard),
  'sdk-card-cq-cols',
  'SdkInstallCard split must use @2xl/sdk:grid-cols-* (not viewport lg:)',
)
assert(
  !/lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/.test(sdkCard),
  'sdk-card-no-viewport-lg',
  'SdkInstallCard must not use viewport lg:grid-cols for the inner split',
)

const failed = checks.filter((c) => !c.ok)
if (failed.length > 0) {
  console.error('check:chrome-budget FAIL\n')
  for (const f of failed) {
    console.error(`  [${f.id}] ${f.detail}`)
  }
  process.exit(1)
}

console.log(`check:chrome-budget OK (${checks.length} assertions)`)
