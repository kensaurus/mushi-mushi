#!/usr/bin/env node
/**
 * check-positioning-consistency.mjs
 *
 * The anti-drift guard for the *constitution* (VISION.md §1). The tagline guard
 * (check-tagline-consistency.mjs) keeps the hero line honest; this one keeps the
 * deeper positioning — north-star sentence, the category we own, the primary
 * buyer, and the three "will not"s — identical across the surfaces that an LLM
 * or a human is most likely to drift:
 *
 *   - /VISION.md         the source of truth (must carry every anchor)
 *   - /AGENTS.md         the compressed copy coding agents load
 *   - /README.md         the repo front door (hero + buyer)
 *   - /package.json      the npm/GitHub fixed-width description
 *
 * Every canonical string is read from `@mushi-mushi/brand` (packages/brand),
 * so the brand package stays the single source — change a tagline there and the
 * surfaces are required to follow.
 *
 * Run: node scripts/check-positioning-consistency.mjs
 * Exit 0 = consistent. Exit 1 = drift (actionable list printed to stderr).
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

const brand = await import(
  pathToFileURL(join(ROOT, 'packages/brand/src/index.js')).href
)
const V2 = brand.MUSHI_TAGLINE_V2

const failures = []

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8')
  } catch {
    failures.push(`MISSING FILE  ${rel}`)
    return null
  }
}

/**
 * Normalize markdown prose so a wrapped, blockquoted, bold-wrapped sentence
 * still matches the canonical single-line brand string. Strips blockquote
 * prefixes (`> `), bold/italic markers (`**`, `_`, `*`), and collapses all
 * runs of whitespace (including newlines) to a single space. This tolerates
 * formatting differences while still catching real wording drift.
 */
function normalize(s) {
  return s
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mustContain(rel, needle, label) {
  const content = read(rel)
  if (content === null) return
  if (!normalize(content).includes(normalize(needle))) {
    const preview = needle.length > 88 ? needle.slice(0, 88) + '…' : needle
    failures.push(`${rel}\n      missing ${label}:\n      "${preview}"`)
  }
}

// 1. Fixed-width one-liner: byte-for-byte from the brand source. This is the
//    npm `description` + GitHub repo description + og:description fallback.
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
if (rootPkg.description !== V2.oneLiner) {
  failures.push(
    `package.json "description" drifted from MUSHI_TAGLINE_V2.oneLiner\n` +
      `      have: "${rootPkg.description}"\n` +
      `      want: "${V2.oneLiner}"`,
  )
}

// 2. North-star sentence — the source + the agent guidance must carry it verbatim.
mustContain('VISION.md', V2.northStar, 'north-star sentence (MUSHI_TAGLINE_V2.northStar)')
mustContain('AGENTS.md', V2.northStar, 'north-star sentence (MUSHI_TAGLINE_V2.northStar)')

// 3. The category we own — verbatim where positioning is declared.
mustContain('VISION.md', V2.category, 'category line (MUSHI_TAGLINE_V2.category)')
mustContain('AGENTS.md', V2.category, 'category line (MUSHI_TAGLINE_V2.category)')

// 4. The v2 hero must lead primary surfaces (reinforces the tagline guard).
//    JSX/MDX may split the sentence across tags — match the two anchors.
const HERO_A = 'Your AI wrote it'
const HERO_B = 'why it broke'
function mustContainHero(rel, label) {
  const content = read(rel)
  if (content === null) return
  const n = normalize(content)
  if (!n.includes(HERO_A) || !n.includes(HERO_B)) {
    failures.push(
      `${rel}\n      missing ${label} (need both "${HERO_A}" and "${HERO_B}")`,
    )
  }
}
mustContain('README.md', V2.hero, 'v2 hero (MUSHI_TAGLINE_V2.hero)')
mustContainHero('apps/docs/content/index.mdx', 'v2 hero on docs landing')
mustContainHero('packages/marketing-ui/src/Hero.tsx', 'v2 hero in marketing-ui Hero')

// 5. Primary-buyer anchor — every positioning surface names the buyer.
for (const f of ['VISION.md', 'AGENTS.md', 'README.md']) {
  mustContain(f, 'vibe coder', 'primary-buyer anchor ("vibe coder")')
}

// 6. The three "will not"s — the drift tripwires from VISION.md §1.7, mirrored
//    into the agent constitution.
const WILL_NOTS = [
  'will not require a monitoring stack',
  'will not lead with the integration-hub',
  'will not let the surfaces diverge',
]
for (const w of WILL_NOTS) {
  mustContain('VISION.md', w, `"will not" tripwire`)
  mustContain('AGENTS.md', w, `"will not" tripwire`)
}

if (failures.length === 0) {
  console.log(
    '\u2713  Positioning consistency: north-star, category, buyer, and the three "will not"s are aligned across VISION.md, AGENTS.md, README.md, and package.json.',
  )
  process.exit(0)
}

console.error('Positioning drift detected — fix against /VISION.md (the constitution):\n')
for (const f of failures) console.error(`FAIL  ${f}\n`)
console.error(
  `${failures.length} positioning inconsistency(ies). Canonical copy lives in packages/brand/src/index.js (MUSHI_TAGLINE_V2) and /VISION.md.`,
)
process.exit(1)
