#!/usr/bin/env node
/**
 * Static audit: operator pages that pass both description= and helpWhatIsIt=
 * to PageHeaderBar (Wave 5 hint dedupe).
 *
 * Usage: node scripts/audit-admin-hint-duplication.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGES_DIR = resolve(__dirname, '../apps/admin/src/pages')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('Page.tsx')) out.push(p)
  }
  return out
}

const findings = []

for (const file of walk(PAGES_DIR)) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('PageHeaderBar')) continue
  const hasDescription = /\bdescription=\{/.test(src) || /\bdescription="/.test(src)
  const hasHelp = /\bhelpWhatIsIt=\{/.test(src) || /\bhelpWhatIsIt="/.test(src)
  if (hasDescription && hasHelp) {
    findings.push(file.replace(resolve(__dirname, '..') + '/', ''))
  }
}

if (findings.length === 0) {
  console.log('OK — no PageHeaderBar pages with both description and helpWhatIsIt')
  process.exit(0)
}

console.log(`Note: ${findings.length} pages pass both description and helpWhatIsIt.`)
console.log('PageHeaderBar suppresses inline description when help is registered (Wave 5).')
console.log('Optional cleanup: remove redundant description= props from:')
for (const f of findings) console.log(`  - ${f}`)
process.exit(0)
