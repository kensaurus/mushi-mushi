#!/usr/bin/env node
/**
 * Dev check: every Layout nav route should have a copy entry in lib/copy.ts (beginner mode).
 * Run: node scripts/check-page-copy.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const layout = readFileSync(resolve(ROOT, 'apps/admin/src/components/Layout.tsx'), 'utf8')
const copy = readFileSync(resolve(ROOT, 'apps/admin/src/lib/copy.ts'), 'utf8')

const paths = new Set()
for (const m of layout.matchAll(/path:\s*'([^']+)'/g)) {
  const p = m[1].split('?')[0]
  paths.add(p)
}

const missing = []
for (const p of [...paths].sort()) {
  const needle = `'${p}':`
  const inBeginner = copy.includes(`beginner: {`) && copy.split('beginner: {')[1]?.includes(needle)
  const inAdvanced = copy.includes(`advanced: {`) && copy.split('advanced: {')[1]?.includes(needle)
  if (!inBeginner && !inAdvanced) missing.push(p)
}

if (missing.length) {
  console.error('Missing copy entries for nav routes:')
  for (const p of missing) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`OK — ${paths.size} nav routes have copy entries.`)
