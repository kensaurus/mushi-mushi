#!/usr/bin/env node
/**
 * CI gate: fail when admin source uses text-[var(--color-*)] arbitrary classes.
 * Prefer semantic @theme utilities (text-danger-foreground, etc.).
 *
 * Run: node scripts/audit-raw-css-var-classes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCAN_ROOT = join(ROOT, 'apps/admin/src')
const PATTERN = /text-\[var\(--color-/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(SCAN_ROOT)) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) {
      if (/mushi-mushi-allowlist:/.test(lines[i - 1] ?? '')) return
      hits.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() })
    }
    PATTERN.lastIndex = 0
  })
}

if (hits.length > 0) {
  console.error('audit-raw-css-var-classes: found text-[var(--color-*)] usage:\n')
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.text}`)
  }
  process.exit(1)
}

console.log('audit-raw-css-var-classes: OK (0 hits)')
