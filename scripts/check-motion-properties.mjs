#!/usr/bin/env node
/**
 * FILE: scripts/check-motion-properties.mjs
 * PURPOSE: Warn when admin / docs landing / marketing-ui CSS/TSX animate layout
 *          properties (color, width, height, padding, …) in transition
 *          declarations. Transform + opacity only — see docs/MOTION.md.
 *
 *          Warn-only (exit 0). Run: node scripts/check-motion-properties.mjs
 *          or: pnpm check:motion
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ROOTS = [
  resolve(root, 'apps/admin/src'),
  resolve(root, 'apps/docs/components/landing'),
  resolve(root, 'packages/marketing-ui/src'),
]

/** Forbidden properties inside a single transition value. */
const FORBIDDEN =
  /\b(?:color|background(?:-color)?|border(?:-color)?|width|height|padding|margin|top|left|right|bottom|font-size|box-shadow|text-shadow|filter|stroke-width)\b/i

/** Allowed meter / shell exceptions when the ONLY forbidden prop is one of these. */
const METER_OK = /^(?:width|stroke-dashoffset)$/i

const EXT = /\.(css|tsx|ts)$/

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

/** Extract transition values without spanning into following JS object keys. */
function extractTransitionValues(src) {
  const out = []
  // CSS: transition: … ;
  const cssRe = /\btransition(?:-property)?\s*:\s*([^;{]+)/gi
  let m
  while ((m = cssRe.exec(src))) {
    out.push({ index: m.index, value: m[1].trim() })
  }
  // JS/TSX: transition: '…' | transition: "…"
  const jsRe = /\btransition\s*:\s*(['"])(.*?)\1/gi
  while ((m = jsRe.exec(src))) {
    out.push({ index: m.index, value: m[2].trim() })
  }
  // Tailwind-ish in strings already covered by callers of transition-[…]
  const twRe = /transition-\[([^\]]+)\]/gi
  while ((m = twRe.exec(src))) {
    out.push({ index: m.index, value: m[1].trim() })
  }
  return out
}

function isForbiddenValue(value) {
  // Skip Motion/framer spring objects mistakenly caught — no CSS props
  if (/stiffness|damping|type:\s*['"]spring/.test(value)) return false
  if (/staggerChildren|duration:\s*0\.\d/.test(value) && !FORBIDDEN.test(value)) return false

  const props = value
    .split(',')
    .map((p) => p.trim().split(/\s+/)[0])
    .filter(Boolean)

  const bad = []
  for (const prop of props) {
    if (/^(opacity|transform|translate|scale|rotate|none|all)$/i.test(prop)) continue
    if (METER_OK.test(prop)) continue // meter / SVG ring exception
    if (FORBIDDEN.test(prop) || FORBIDDEN.test(value)) {
      // If value is only opacity+transform timings, ignore false positives
      const onlyOk = value
        .split(',')
        .every((part) => {
          const head = part.trim().split(/\s+/)[0]
          return /^(opacity|transform)/i.test(head) || !head
        })
      if (onlyOk) continue
      bad.push(prop)
    }
  }
  // Re-check: if forbidden word appears as a property name in the list
  for (const part of value.split(',')) {
    const head = part.trim().split(/\s+/)[0]
    if (METER_OK.test(head)) continue
    if (/^(opacity|transform)/i.test(head)) continue
    if (FORBIDDEN.test(head)) bad.push(head)
  }
  return bad.length > 0
}

const hits = []
for (const base of ROOTS) {
  for (const file of walk(base)) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(root, file).replace(/\\/g, '/')
    if (
      rel.includes('AnimatedDisclosure') ||
      rel.includes('motion-tokens') ||
      rel.includes('landing-stagger')
    ) {
      continue
    }
    // Shell width + SVG meter exceptions by path
    if (rel.endsWith('Layout.tsx') || rel.endsWith('StageHealthRing.tsx')) continue

    for (const { index, value } of extractTransitionValues(src)) {
      if (!isForbiddenValue(value)) continue
      // Skip width-only meters
      const heads = value.split(',').map((p) => p.trim().split(/\s+/)[0])
      if (heads.every((h) => METER_OK.test(h) || /^(opacity|transform)/i.test(h))) continue

      const line = src.slice(0, index).split('\n').length
      hits.push({ rel, line, snippet: value.slice(0, 80) })
    }
  }
}

if (hits.length) {
  console.warn(
    `[check-motion-properties] ${hits.length} warning(s) — prefer transform/opacity (docs/MOTION.md):\n`,
  )
  for (const h of hits.slice(0, 40)) {
    console.warn(`  ${h.rel}:${h.line}  ${h.snippet.replace(/\s+/g, ' ')}`)
  }
  if (hits.length > 40) console.warn(`  … and ${hits.length - 40} more`)
} else {
  console.log('[check-motion-properties] ok — no layout transition warnings')
}

process.exit(0)
