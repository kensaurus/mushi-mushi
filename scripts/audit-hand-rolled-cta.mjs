#!/usr/bin/env node
/**
 * CI gate: the primary CTA look lives in apps/admin/src/lib/btnRecipe.ts.
 *
 * Fails when admin source hand-rolls a filled brand button — a class string
 * with the brand fill, brand-fg text AND a brand hover (`bg-brand … text-brand-fg
 * … hover:bg-brand-hover`). Those drifted into ~15 flat, differently padded
 * twins of the gradient <Btn>, often in the same row as the real one
 * (2026-09-23 console UI pass). Use <Btn> or `btnClass()` instead.
 *
 * Opt out per line with `mushi-mushi-allowlist: <reason>` on the same line or
 * the line above (e.g. a 20px table-row CTA that Btn's sizes cannot fit).
 *
 * Usage: node scripts/audit-hand-rolled-cta.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ADMIN_SRC = resolve(ROOT, 'apps/admin/src')
const RECIPE = resolve(ADMIN_SRC, 'lib/btnRecipe.ts')

const FILL = /(^|[\s"'`])bg-brand(?=[\s"'`])/
const FG = /\btext-brand-fg\b/
const HOVER = /\bhover:bg-brand-hover\b/
const ALLOW = /mushi-mushi-allowlist:/

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

const findings = []
const fakeLinks = []
for (const file of walk(ADMIN_SRC)) {
  if (file === RECIPE) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const rel = `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`
    const allowed = ALLOW.test(line) || ALLOW.test(lines[i - 1] ?? '')
    if (FILL.test(line) && FG.test(line) && HOVER.test(line) && !allowed) findings.push(`  ${rel}`)
    // A ghost <Btn> squashed to zero padding to pose as a link keeps the
    // ghost border: it rendered as a thin outlined box around the text.
    if (/!px-0/.test(line) && !allowed) {
      const tag = lines.slice(Math.max(0, i - 8), i + 1).join('\n')
      const open = tag.lastIndexOf('<Btn')
      if (open >= 0 && /variant="ghost"/.test(tag.slice(open))) fakeLinks.push(`  ${rel}`)
    }
  })
}

let failed = false
if (findings.length > 0) {
  failed = true
  console.error(`[fail] ${findings.length} hand-rolled primary CTA(s) — use <Btn> or btnClass() from lib/btnRecipe.ts:`)
  for (const f of findings) console.error(f)
}
if (fakeLinks.length > 0) {
  failed = true
  console.error(`[fail] ${fakeLinks.length} ghost <Btn> forced to !px-0 to look like a link — use <TextButton> (components/ui/forms.tsx):`)
  for (const f of fakeLinks) console.error(f)
}
if (failed) process.exit(1)
console.log('[ok] No hand-rolled primary CTAs or ghost-Btn text links in admin src')
