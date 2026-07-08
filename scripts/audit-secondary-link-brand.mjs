#!/usr/bin/env node
/**
 * Ensures secondary inline links use accent hue (LINK_ACCENT), not brand.
 * Primary Btn / brand chips / switcher CTAs are out of scope.
 *
 * Self-contained Node walk (same approach as audit-raw-css-var-classes.mjs)
 * so CI runners and contributors don't need ripgrep installed.
 *
 * Run: node scripts/audit-secondary-link-brand.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCAN_ROOT = join(ROOT, 'apps/admin/src')

const PATTERNS = [
  'text-brand hover:underline',
  'text-brand hover:text-brand-hover',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(SCAN_ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (PATTERNS.some((pattern) => line.includes(pattern))) {
      hits.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`)
    }
  })
}

if (hits.length > 0) {
  console.error(
    'audit-secondary-link-brand: FAIL — demote to LINK_ACCENT (text-accent-foreground hover:text-accent …)\n',
  )
  console.error(hits.join('\n'))
  process.exit(1)
}

console.log('audit-secondary-link-brand: OK (0 hits)')
