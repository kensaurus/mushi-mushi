#!/usr/bin/env node
/**
 * check-console-voice.mjs
 *
 * Bans corporate / AI-slop lexicon from apps/admin user-facing string literals,
 * mirroring docs/marketing/VOICE.md (same word list as check-public-voice.mjs).
 *
 * Usage: node scripts/check-console-voice.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCAN_ROOT = join(ROOT, 'apps/admin/src')

/** Console-safe subset of VOICE.md bans — product verbs like "unlock" are allowed. */
const BANNED = [
  /\bempower(s|ed|ing)?\b/i,
  /\bseamless(ly)?\b/i,
  /\brevolutionize[sd]?\b/i,
  /\bworld[- ]class\b/i,
  /\bcutting[- ]edge\b/i,
  /\bgame[- ]changer\b/i,
  /\bwe're excited to announce\b/i,
  /\bbook a demo\b/i,
  /\boperator-grade\b/i,
  /\bnext-generation\b/i,
  /\bsynerg(y|ies|istic)\b/i,
  /\bleverage this\b/i,
  /\bunleash\b/i,
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(p)
    }
  }
  return out
}

const files = walk(SCAN_ROOT)
const hits = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  // Only scan string literals roughly (single + double quotes and template heads)
  const strings = src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)
  for (const m of strings) {
    const text = m[2] ?? ''
    if (text.length < 4) continue
    // Skip import paths and className-like utility soup
    if (text.includes('/') && !text.includes(' ')) continue
    if (/^(bg-|text-|border-|flex|grid|px-|py-|gap-|rounded)/.test(text)) continue
    for (const re of BANNED) {
      if (re.test(text)) {
        hits.push({ file: relative(ROOT, file), match: text.slice(0, 80), re: String(re) })
        break
      }
    }
  }
}

/**
 * Internal jargon in the places a user reads first: sidebar and hub-view
 * names, page titles and their first line, tab names, and status-banner
 * titles (pattern P5, console journeys 2026-10-27). Case-sensitive and only
 * on those surfaces: the terms stay legitimate in help text, tooltips,
 * search keywords and code ("byok" is a tab id).
 */
const HEADER_JARGON = [
  /\bPDCA\b/,
  /\bStage [12]\b/,
  /\bBYOK\b/,
  /\bmSPRT\b/,
  /\bThompson\b/,
  /\bZ-score\b/,
  /\bPage-Hinkley\b/,
  /\b[Dd]eviance score\b/,
  /\bdrift-walker\b/,
  /\b[Cc]ontract edges?\b/,
  /\b[Cc]oherence\b/,
  /\bNL\s*(→|->)\s*SQL\b/,
  /\bRecipe\b/,
  /\bInbox\b/,
  /\bOutbox\b/,
  /\bnodes\b/,
  /\bedges\b/,
]

const ADMIN = (rel) => join(SCAN_ROOT, rel)

/** [file, line number, text] for every header-surface string literal. */
function headerSurfaces() {
  const out = []
  const push = (file, src, re) => {
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      const m = line.match(re)
      if (!m) return
      out.push([file, i + 1, m[1]])
    })
  }
  // Sidebar, palette and hub-view names.
  push(ADMIN('lib/navRegistry.ts'), readFileSync(ADMIN('lib/navRegistry.ts'), 'utf8'), /^\s+label:\s*'([^']*)'/)
  push(ADMIN('lib/pageHubs.ts'), readFileSync(ADMIN('lib/pageHubs.ts'), 'utf8'), /label:\s*'([^']*)'/)
  // Page copy: titles, first lines, tab names and section names (not the help body).
  const copySrc = readFileSync(ADMIN('lib/copy.ts'), 'utf8')
  let block = null
  const copyLines = copySrc.split('\n')
  copyLines.forEach((line, i) => {
    const open = line.match(/^\s+(tabLabels|sections|help|statLabels|actionLabels|bucketLabels|relatedLinks):\s*[{[]/)
    if (open) block = open[1]
    const header = line.match(/^\s+(title|description):\s*'((?:\\'|[^'])*)'/)
    if (header && block !== 'help') out.push([ADMIN('lib/copy.ts'), i + 1, header[2]])
    // `description:` alone on its line: the string is on the next one.
    if (/^\s+(title|description):\s*$/.test(line) && block !== 'help') {
      out.push([ADMIN('lib/copy.ts'), i + 2, (copyLines[i + 1] ?? '').trim()])
    }
    if (block === 'tabLabels' || block === 'sections') {
      const v = line.match(/:\s*'((?:\\'|[^'])*)'/)
      if (v) out.push([ADMIN('lib/copy.ts'), i + 1, v[1]])
    }
    if (/^\s+},?\s*$/.test(line) && block) block = null
  })
  // Tab rows on pages: `{ id: 'x', label: '…', description: '…' }` and multi-line forms.
  for (const file of files.filter((f) => /[\\/]pages[\\/]/.test(f))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\bid:\s*'[^']+'(?:\s+as const)?,\s*\n?\s*label:\s*'([^']*)'(?:,\s*\n?\s*description:\s*'((?:\\'|[^'])*)')?/g)) {
      const line = src.slice(0, m.index).split('\n').length
      out.push([file, line, m[1]])
      if (m[2]) out.push([file, line, m[2]])
    }
  }
  // Status banner titles: the first line a page shows.
  for (const file of files.filter((f) => /StatusBanner\.tsx$/.test(f))) {
    const src = readFileSync(file, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (!/\btitle=/.test(line)) return
      for (const s of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)) out.push([file, i + 1, s[2]])
    })
  }
  return out
}

for (const [file, line, text] of headerSurfaces()) {
  for (const re of HEADER_JARGON) {
    if (re.test(text)) {
      hits.push({ file: `${relative(ROOT, file)}:${line}`, match: text.slice(0, 80), re: `header jargon ${re}` })
      break
    }
  }
}

if (hits.length) {
  console.error(`[console-voice] ${hits.length} banned-lexicon hit(s):`)
  for (const h of hits.slice(0, 40)) {
    console.error(`  ${h.file}: "${h.match}"`)
  }
  if (hits.length > 40) console.error(`  … +${hits.length - 40} more`)
  process.exit(1)
}

console.log(`[console-voice] ok — scanned ${files.length} files, 0 banned hits`)
