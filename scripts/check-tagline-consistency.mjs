#!/usr/bin/env node
/**
 * check-tagline-consistency.mjs
 *
 * CI guard for narrative consistency on primary surfaces. Four rules:
 *   1. No stale tagline variants anywhere (hard fail).
 *   2. Every primary README MUST lead with the v2 hero (hard fail if missing).
 *   3. The legacy v1 line is comparison-tables-only — allowed to coexist as
 *      supporting copy, but it can never substitute for the v2 hero.
 *   4. The hero's offer line (MUSHI_TAGLINE_V2.heroOffer) is quoted verbatim
 *      in VOICE.md and carries no price or number.
 *
 * This is the guardrail that keeps the v1/v2 conflict from drifting back.
 *
 * Run: node scripts/check-tagline-consistency.mjs
 * Exit 0 = all good. Exit 1 = inconsistency found (list printed to stderr).
 */

import { readFileSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

const CANONICAL_V2 = 'Your AI wrote it. Mushi Mushi tells you why it broke.'
const CANONICAL_LEGACY =
  'Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI.'

const STALE_VARIANTS = [
  'Sentry sees what code throws. Mushi sees what users feel — and remembers what fixed it last time.',
  'Sentry sees what code throws. Mushi sees what users feel — and encodes every fix into the codebase genome.',
  'Sentry sees what your code throws. Mushi sees what your users feel.',
  'Your users feel a bug. You see a fix.',
]

const SDK_DIRS = [
  'packages/web',
  'packages/react',
  'packages/vue',
  'packages/svelte',
  'packages/angular',
  'packages/react-native',
  'packages/capacitor',
  'packages/node',
  'packages/cli',
  'packages/mcp',
]

let failures = 0
let checked = 0
let missingV2 = 0

function check(readmePath) {
  let content
  try {
    content = readFileSync(readmePath, 'utf8')
  } catch {
    return
  }

  checked++
  const rel = relative(ROOT, readmePath).replace(/\\/g, '/')

  for (const stale of STALE_VARIANTS) {
    if (content.includes(stale)) {
      console.error(`FAIL  ${rel}`)
      console.error(`      Stale tagline found: "${stale}"`)
      console.error(`      Replace with MUSHI_TAGLINE_V2.hero:`)
      console.error(`      "${CANONICAL_V2}"`)
      console.error()
      failures++
    }
  }

  const hasV2 = content.includes(CANONICAL_V2)
  const hasLegacy = content.includes(CANONICAL_LEGACY)

  // Rule 2: every primary README must lead with the v2 hero.
  if (!hasV2) {
    console.error(`FAIL  ${rel}`)
    if (hasLegacy) {
      console.error(`      Uses the legacy v1 Sentry-contrast line as its tagline.`)
      console.error(`      v1 is comparison-tables-only — it cannot substitute for the hero.`)
    } else {
      console.error(`      Missing the canonical v2 hero on a primary surface.`)
    }
    console.error(`      Add MUSHI_TAGLINE_V2.hero:`)
    console.error(`      "${CANONICAL_V2}"`)
    console.error()
    failures++
    missingV2++
  }
}

for (const dir of SDK_DIRS) {
  check(join(ROOT, dir, 'README.md'))
}
check(join(ROOT, 'README.md'))

// Rule 4: the offer line that follows the hero (owner decision D1,
// docs/plan-gtm-november-2026.md §3) lives in the brand ladder, is quoted
// verbatim in VOICE.md's ladder table, and never carries a price. Prices
// change with the plan; the ladder is copied onto npm, READMEs and posts.
const { MUSHI_TAGLINE_V2 } = await import(pathToFileURL(join(ROOT, 'packages/brand/src/index.js')).href)
const offer = MUSHI_TAGLINE_V2.heroOffer
const voice = readFileSync(join(ROOT, 'docs/marketing/VOICE.md'), 'utf8')
if (typeof offer !== 'string' || offer.length === 0) {
  console.error('FAIL  packages/brand/src/index.js')
  console.error('      MUSHI_TAGLINE_V2.heroOffer is missing (the line that follows the hero).')
  console.error()
  failures++
} else {
  if (/[$€£¥]|\d/.test(offer)) {
    console.error('FAIL  packages/brand/src/index.js')
    console.error(`      MUSHI_TAGLINE_V2.heroOffer carries a price or number: "${offer}"`)
    console.error('      Prices belong on the pricing page, never in the tagline ladder.')
    console.error()
    failures++
  }
  if (!voice.includes(`*"${offer}"*`)) {
    console.error('FAIL  docs/marketing/VOICE.md')
    console.error('      The ladder table does not quote MUSHI_TAGLINE_V2.heroOffer verbatim:')
    console.error(`      "${offer}"`)
    console.error()
    failures++
  }
}

if (failures === 0) {
  console.log(`✓  Tagline consistency: all ${checked} primary READMEs lead with the v2 hero, no stale variants; the offer line matches VOICE.md and carries no price.`)
  process.exit(0)
} else {
  console.error(`\n${failures} tagline inconsistency(ies) found`)
  if (missingV2 > 0) {
    console.error(`(${missingV2} primary README(s) missing the v2 hero).`)
  }
  console.error()
  process.exit(1)
}
