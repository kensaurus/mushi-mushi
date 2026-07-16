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

if (hits.length) {
  console.error(`[console-voice] ${hits.length} banned-lexicon hit(s):`)
  for (const h of hits.slice(0, 40)) {
    console.error(`  ${h.file}: "${h.match}"`)
  }
  if (hits.length > 40) console.error(`  … +${hits.length - 40} more`)
  process.exit(1)
}

console.log(`[console-voice] ok — scanned ${files.length} files, 0 banned hits`)
