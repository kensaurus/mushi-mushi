#!/usr/bin/env node
/**
 * check-landing-voice.mjs
 *
 * Lightweight guard for visitor-facing landing copy: banned corporate
 * vocabulary (docs/marketing/VOICE.md) and presence of the v2 hero on the
 * canonical docs landing.
 *
 * Run: node scripts/check-landing-voice.mjs
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

/** Case-insensitive banned phrases from docs/marketing/VOICE.md */
const BANNED = [
  'empower',
  'unlock',
  'seamless',
  'elevate',
  'leverage',
  'revolutionize',
  'best-in-class',
  'next generation',
  'game changer',
  'game-changer',
  'disrupt',
  'synergy',
  'delightful user experience',
  "we're excited to announce",
  'we are excited to announce',
  'book a demo',
  'institutional memory',
  'operator-grade',
]

const LANDING_PATHS = [
  'apps/docs/content/index.mdx',
  'apps/docs/lib/landing-copy.ts',
  'apps/docs/components/Pillars.tsx',
  'apps/docs/components/WhereToStartGrid.tsx',
  'apps/docs/components/QuickstartGrid.tsx',
  'apps/docs/components/DocsMediaShowcase.tsx',
  'apps/docs/components/OssTrustStrip.tsx',
  'apps/docs/components/ComparisonTable.tsx',
  'apps/docs/app/connect/page.tsx',
  'packages/marketing-ui/src/Hero.tsx',
]

const failures = []

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8')
  } catch {
    failures.push(`MISSING FILE  ${rel}`)
    return null
  }
}

for (const rel of LANDING_PATHS) {
  const content = read(rel)
  if (content === null) continue
  const lower = content.toLowerCase()
  for (const phrase of BANNED) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`${rel}\n      banned phrase: "${phrase}"`)
    }
  }
}

const indexMdx = read('apps/docs/content/index.mdx')
if (
  indexMdx !== null &&
  !(indexMdx.includes('Your AI wrote it') && indexMdx.includes('why it broke'))
) {
  failures.push(
    'apps/docs/content/index.mdx\n      missing v2 hero H1 fragments:\n      "Your AI wrote it" + "why it broke"',
  )
}

if (failures.length > 0) {
  console.error('Landing voice check failed:\n')
  for (const f of failures) {
    console.error('  ' + f.replace(/\n/g, '\n  '))
    console.error()
  }
  process.exit(1)
}

console.log(`Landing voice OK (${LANDING_PATHS.length} surfaces, ${BANNED.length} banned phrases).`)
