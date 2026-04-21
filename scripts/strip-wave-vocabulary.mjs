#!/usr/bin/env node
// =============================================================================
// scripts/strip-wave-vocabulary.mjs
//
// Strip the internal "Wave" phase vocabulary from the repo. These labels were
// meant for our own roadmap tracking but leak into IDE hovers, AI-assistant
// context, and docs — confusing users and reviewers who don't share the
// internal timeline.
//
// Strategy: LINE-SCOPED regex replacements. Only lines that contain the token
// "wave" are touched. This keeps code, formatting, and empty parens outside
// comments completely safe.
//
// Usage:
//   node scripts/strip-wave-vocabulary.mjs              # dry run, prints diff
//   node scripts/strip-wave-vocabulary.mjs --write      # apply in place
// =============================================================================

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const WRITE = process.argv.includes('--write')

const INCLUDE_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx',
  '.md', '.mdx', '.sql', '.json',
])

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.turbo', '.next', 'dist', 'build', 'coverage',
  '.pnpm-store', '.changeset', 'pnpm-lock.yaml', '.playwright-mcp',
  'docs/screenshots', '.vercel', '.wrangler',
])

const IGNORE_FILES = new Set([
  'pnpm-lock.yaml',
  'scripts/strip-wave-vocabulary.mjs',
  'scripts/list-wave-files.mjs',
])

// Patterns applied ONLY to lines that contain "wave" (case insensitive).
// Order matters: most specific first.
const LINE_PATTERNS = [
  // Standalone parenthetical "(Wave X ...)" / "(Audit Wave X ...)"
  { re: /\s*\((?:Audit )?Wave [A-Z0-9]+(?:[ .,§][^)]*)?\)\s*\.?/g, replace: '' },

  // "Audit Wave X" inline
  { re: /Audit Wave [A-Z0-9]+(?:\s+(?:Phase\s+\d+|P\d+|bugfix|§[\d.]+))?\s*[—:-]?\s*/g, replace: '' },

  // "PURPOSE: Wave X — foo" / "PURPOSE: Wave X, §2.2 — foo"
  { re: /(PURPOSE:\s*)Wave [A-Z0-9]+(?:\s*,\s*§[\d.]+[^—\n]*)?\s*[—-]\s*/g, replace: '$1' },

  // Bold changelog headings "**Wave K — foo**" → "**foo**"
  { re: /\*\*Wave [A-Z0-9]+\s*[—-]\s*/g, replace: '**' },
  // "**Wave U**" bare tag → drop entirely
  { re: /\s*\*\*Wave [A-Z0-9]+\*\*\s*/g, replace: ' ' },

  // "Wave L hardening:" / "Wave N reframe:" intro labels
  { re: /Wave [A-Z0-9]+ (?:hardening|reframe|overhaul|polish|baseline):\s*/g, replace: '' },

  // Possessive / adjective forms "Wave K's" / "Wave L-touched"
  { re: /Wave [A-Z0-9]+(?:'s|-touched|-style)\s*/g, replace: '' },
  { re: /Wave-[A-Z]-touched\s*/g, replace: '' },
  { re: /Wave-[A-Z]\b\s*/g, replace: '' },

  // Compound "Wave R/S/T/U"
  { re: /Wave [RSTU](?:\s*\/\s*[RSTU])+\b/g, replace: '' },

  // Leading " Wave X:" / " Wave X —" prefix at comment start, remove but keep rest
  { re: /(^|\s|\*\s|\/\/\s|\/\*\s?|- )Wave [A-Z0-9]+(?:\s+Phase\s+\d+)?\s*[:—-]\s+/g, replace: '$1' },

  // Heading separator "— Wave X: foo" → "— foo"
  { re: /(—\s*)Wave [A-Z0-9]+:\s*/g, replace: '$1' },

  // README subtitle pattern ">Wave N — foo" / "Wave L PDCA cockpit" at sub-caption start
  { re: /\bWave [A-Z]\s+(?:rewrite|— )/g, replace: '' },
  { re: /\bWave [A-Z] (?:PDCA cockpit — )/g, replace: '' },
  { re: />Wave [A-Z](?:\s+[—–-])?\s*/g, replace: '>' },
  // "Wave X — " at start of a caption/fragment
  { re: /\bWave [A-Z]\b\s+[—–-]\s+/g, replace: '' },
  // "Wave N custom" / "Wave N default" adjective forms
  { re: /\bWave [A-Z]\s+(?=[a-z])/g, replace: '' },

  // Version-like "Wave 4.2" → "v4.2"
  { re: /\bWave (\d+\.\d+)\b/g, replace: 'v$1' },

  // "Wave V5.3" → "V5.3"
  { re: /Wave (V\d[\d.]*)/g, replace: '$1' },

  // Narrative "this/last/next/future/engineering wave"
  { re: /\b(?:this|last|next|future|engineering|routine|deep)\s+wave\b/gi, replace: 'release' },

  // SQL migration comment strings 'Wave C C8: foo' → 'foo'
  { re: /'Wave [A-Z0-9]+(?:\s+[A-Z0-9]+)?:\s*/g, replace: "'" },

  // Markdown section headings
  { re: /^##+\s+Wave plan\b/gm, replace: (m) => m.replace(/Wave plan/, 'Release plan') },
  { re: /\bWave plan\b/g, replace: 'Release plan' },

  // Table header cell "| Wave |" → "| Phase |"
  { re: /\|\s*Wave\s*\|/g, replace: '| Phase |' },

  // GitHub labels "wave:?" → "phase:?"
  { re: /\bwave:([A-Z?])/g, replace: 'phase:$1' },

  // Remaining bare "Wave X" mid-sentence (conservative: requires leading space)
  { re: / Wave [A-Z0-9]+(?:\s+(?:Phase\s+\d+|P\d+))?(?=[\s.,;:)])/g, replace: '' },

  // Orphaned leading "Wave X" on its own line
  { re: /^Wave [A-Z0-9]+\b\s*/gm, replace: '' },

  // Lowercase vestiges
  { re: /\bwave [a-z0-9]+\b/g, replace: '' },
]

function transformLine(line) {
  let out = line
  for (const { re, replace } of LINE_PATTERNS) {
    out = out.replaceAll(re, replace)
  }
  // Only collapse multi-space inside the transformed region if there was a
  // visible change. This must NEVER run globally — it would mangle code.
  if (out !== line) {
    // Tidy: double-space → single-space, but leave indentation alone.
    // Protect leading whitespace (code indentation / markdown list markers).
    const leadMatch = out.match(/^(\s*)/)
    const lead = leadMatch ? leadMatch[1] : ''
    const rest = out.slice(lead.length).replace(/[ \t]{2,}/g, ' ')
    out = lead + rest
    // Drop orphan trailing whitespace.
    out = out.replace(/\s+$/, '')
  }
  return out
}

function transform(text) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/wave/i.test(lines[i])) lines[i] = transformLine(lines[i])
  }
  // Preserve original line-ending style (CRLF vs LF). Detect from the
  // original text and rejoin.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n'
  return lines.join(eol)
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = relative(ROOT, join(dir, entry.name)).replaceAll('\\', '/')
    if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(rel)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      yield* walk(full)
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.')
      if (dot >= 0 && INCLUDE_EXT.has(entry.name.slice(dot))) yield full
    }
  }
}

async function main() {
  const changed = []
  const remaining = []
  let scanned = 0
  for await (const file of walk(ROOT)) {
    scanned++
    const src = await readFile(file, 'utf8')
    if (!/wave/i.test(src)) continue
    const next = transform(src)
    if (next !== src) {
      changed.push({ file })
      if (WRITE) await writeFile(file, next, 'utf8')
    }
    if (/\bwave\b/i.test(next)) {
      const lines = next.split(/\r?\n/)
      const hits = lines
        .map((l, i) => (/\bwave\b/i.test(l) ? `${i + 1}: ${l.trim()}` : null))
        .filter(Boolean)
      remaining.push({ file: relative(ROOT, file).replaceAll('\\', '/'), hits })
    }
  }

  console.log(`Scanned ${scanned} files.`)
  console.log(`Would modify: ${changed.length} files.`)
  if (WRITE) console.log('Wrote changes to disk.')
  else console.log('(dry run — pass --write to apply)')

  if (remaining.length) {
    console.log(`\n${remaining.length} files still contain "wave" after transform:`)
    for (const r of remaining) {
      console.log(`  ${r.file}`)
      for (const h of r.hits.slice(0, 5)) console.log(`    ${h}`)
      if (r.hits.length > 5) console.log(`    …and ${r.hits.length - 5} more`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
