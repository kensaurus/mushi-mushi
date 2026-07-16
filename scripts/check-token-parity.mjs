#!/usr/bin/env node
/**
 * check-token-parity.mjs
 *
 * Fails when the SDK widget palette in packages/core/src/design-tokens.ts
 * drifts from packages/brand/tokens/brand.tokens.json (the DTCG SSOT).
 *
 * Also asserts admin duration / ease-stamp CSS vars still mirror core MUSHI_DURATION.
 *
 * Usage: node scripts/check-token-parity.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function fail(msg) {
  console.error(`[token-parity] FAIL: ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`[token-parity] ok: ${msg}`)
}

function normalizeHex(h) {
  const s = String(h).trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  }
  return s
}

const brand = JSON.parse(
  readFileSync(join(ROOT, 'packages/brand/tokens/brand.tokens.json'), 'utf8'),
)
const coreSrc = readFileSync(join(ROOT, 'packages/core/src/design-tokens.ts'), 'utf8')
const adminTheme = readFileSync(
  join(ROOT, 'apps/admin/src/styles/theme-tokens.css'),
  'utf8',
)

/** Extract first matching hex assignment for `key: '#…'` inside a named const block. */
function extractPaletteHex(source, constName, key) {
  const blockRe = new RegExp(
    `export const ${constName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`,
  )
  const block = source.match(blockRe)?.[1]
  if (!block) return null
  const m = block.match(new RegExp(`${key}:\\s*'(#[0-9A-Fa-f]{3,8})'`))
  return m?.[1] ?? null
}

const pairs = [
  {
    brandPath: 'color.paper',
    brandVal: brand.color.paper.$value,
    coreConst: 'MUSHI_COLORS_LIGHT',
    coreKey: 'paper',
  },
  {
    brandPath: 'color.ink',
    brandVal: brand.color.ink.$value,
    coreConst: 'MUSHI_COLORS_LIGHT',
    coreKey: 'ink',
  },
  {
    brandPath: 'color.vermillion',
    brandVal: brand.color.vermillion.$value,
    coreConst: 'MUSHI_COLORS_LIGHT',
    coreKey: 'accent',
  },
  {
    brandPath: 'color.jade → ok',
    brandVal: brand.color.jade.$value,
    coreConst: 'MUSHI_COLORS_LIGHT',
    coreKey: 'ok',
  },
  {
    brandPath: 'color.viz-danger → danger',
    brandVal: brand.color['viz-danger'].$value,
    coreConst: 'MUSHI_COLORS_LIGHT',
    coreKey: 'danger',
  },
  {
    brandPath: 'color.dark-vermillion',
    brandVal: brand.color['dark-vermillion'].$value,
    coreConst: 'MUSHI_COLORS_DARK',
    coreKey: 'accent',
  },
  {
    brandPath: 'color.dark-jade → ok',
    brandVal: brand.color['dark-jade'].$value,
    coreConst: 'MUSHI_COLORS_DARK',
    coreKey: 'ok',
  },
  {
    brandPath: 'color.dark-viz-danger → danger',
    brandVal: brand.color['dark-viz-danger'].$value,
    coreConst: 'MUSHI_COLORS_DARK',
    coreKey: 'danger',
  },
]

let mismatches = 0
for (const p of pairs) {
  const coreHex = extractPaletteHex(coreSrc, p.coreConst, p.coreKey)
  if (!coreHex) {
    fail(`Could not find ${p.coreConst}.${p.coreKey} in design-tokens.ts`)
    mismatches++
    continue
  }
  if (normalizeHex(coreHex) !== normalizeHex(p.brandVal)) {
    fail(
      `${p.brandPath}: brand ${p.brandVal} ≠ core ${p.coreConst}.${p.coreKey} ${coreHex}`,
    )
    mismatches++
  } else {
    ok(`${p.coreConst}.${p.coreKey} ↔ ${p.brandPath}`)
  }
}

// Motion: ease-stamp must appear in brand + admin
const brandEase = brand.motion['ease-stamp'].$value
if (!Array.isArray(brandEase) || brandEase.join(',') !== '0.22,1,0.36,1') {
  fail(`brand motion.ease-stamp unexpected: ${JSON.stringify(brandEase)}`)
  mismatches++
} else {
  ok('brand ease-stamp = 0.22,1,0.36,1')
}

if (!adminTheme.includes('--ease-stamp: cubic-bezier(0.22, 1, 0.36, 1)')) {
  fail('admin theme-tokens.css missing --ease-stamp cubic-bezier(0.22, 1, 0.36, 1)')
  mismatches++
} else {
  ok('admin --ease-stamp mirrors brand')
}

const durationChecks = [
  ['--duration-instant: 120ms', 'instant'],
  ['--duration-fast: 200ms', 'fast'],
  ['--duration-base: 220ms', 'base'],
  ['--duration-panel: 300ms', 'panel'],
  ['--duration-slow: 420ms', 'slow'],
  ['--duration-ring: 700ms', 'ring'],
]
for (const [css, label] of durationChecks) {
  if (!adminTheme.includes(css)) {
    fail(`admin missing ${css} (must mirror MUSHI_DURATION.${label})`)
    mismatches++
  } else {
    ok(`admin ${label} duration`)
  }
}

// Scales present in brand JSON
for (const scale of ['spacing', 'radius', 'fontSize', 'elevation', 'zIndex', 'semantic']) {
  if (!brand[scale]) {
    fail(`brand.tokens.json missing ${scale} group`)
    mismatches++
  } else {
    ok(`brand has ${scale}`)
  }
}

if (mismatches === 0) {
  console.log('[token-parity] all checks passed')
} else {
  console.error(`[token-parity] ${mismatches} failure(s)`)
  process.exit(1)
}
