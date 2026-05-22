#!/usr/bin/env node
/**
 * check-tagline-consistency.mjs
 *
 * CI guard: every public-facing SDK README must open with the canonical
 * 12-word tagline from @mushi-mushi/brand (MUSHI_TAGLINE.full).
 *
 * Run: node scripts/check-tagline-consistency.mjs
 * Exit 0 = all good. Exit 1 = inconsistency found (list printed to stderr).
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

// The one true tagline. Mirror of MUSHI_TAGLINE.full in packages/brand/src/index.js.
const CANONICAL = 'Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI.'

// Old variants that used to live in public READMEs and should now be replaced.
const STALE_VARIANTS = [
  'Sentry sees what code throws. Mushi sees what users feel — and remembers what fixed it last time.',
  'Sentry sees what code throws. Mushi sees what users feel — and encodes every fix into the codebase genome.',
  'Sentry sees what your code throws. Mushi sees what your users feel.',
  'Your users feel a bug. You see a fix.',
]

// Directories whose READMEs must carry the canonical tagline.
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

function check(readmePath) {
  let content
  try {
    content = readFileSync(readmePath, 'utf8')
  } catch {
    // README missing — that's a separate concern, not this script's job.
    return
  }

  const rel = relative(ROOT, readmePath).replace(/\\/g, '/')

  // Check for stale variants.
  for (const stale of STALE_VARIANTS) {
    if (content.includes(stale)) {
      console.error(`FAIL  ${rel}`)
      console.error(`      Stale tagline found: "${stale}"`)
      console.error(`      Replace with the canonical form from MUSHI_TAGLINE.full:`)
      console.error(`      "${CANONICAL}"`)
      console.error()
      failures++
    }
  }
}

// Check SDK package READMEs.
for (const dir of SDK_DIRS) {
  check(join(ROOT, dir, 'README.md'))
}

// Also check the root README.
check(join(ROOT, 'README.md'))

if (failures === 0) {
  console.log(`✓  Tagline consistency: all ${SDK_DIRS.length + 1} READMEs use the canonical form.`)
  process.exit(0)
} else {
  console.error(`✗  Tagline consistency: ${failures} README(s) use a stale tagline variant.`)
  console.error(`   Fix by replacing with: "${CANONICAL}"`)
  process.exit(1)
}
