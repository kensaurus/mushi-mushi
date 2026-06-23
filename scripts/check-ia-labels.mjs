#!/usr/bin/env node
/**
 * FILE: scripts/check-ia-labels.mjs
 * PURPOSE: Fail CI when Quickstart copy uses jargon blocked by the IA voice guide.
 *
 * USAGE: node scripts/check-ia-labels.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const COPY_TS = resolve(ROOT, 'apps/admin/src/lib/copy.ts')

const src = readFileSync(COPY_TS, 'utf8')

const quickstartStart = src.indexOf('quickstart: {')
const beginnerStart = src.indexOf('beginner: {', quickstartStart)
if (quickstartStart < 0 || beginnerStart < 0) {
  console.error('check-ia-labels: could not locate quickstart block in copy.ts')
  process.exit(1)
}

const quickstartBlock = src.slice(quickstartStart, beginnerStart)

/** Whole-word jargon forbidden in Quickstart-facing copy (IA plan §7). */
const FORBIDDEN = [
  { term: 'PDCA', re: /\bPDCA\b/g },
  { term: 'DLQ', re: /\bDLQ\b/gi },
  { term: 'dead-letter', re: /dead-letter/gi },
  { term: 'MCP (raw protocol)', re: /\bMCP\b/g },
]

const ALLOWLIST = [
  '/mcp', // route keys may reference the path
  'Agent help', // approved quickstart alias
]

const hits = []

for (const { term, re } of FORBIDDEN) {
  for (const match of quickstartBlock.matchAll(re)) {
    const lineStart = quickstartBlock.lastIndexOf('\n', match.index) + 1
    const lineEnd = quickstartBlock.indexOf('\n', match.index)
    const line = quickstartBlock.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    if (ALLOWLIST.some((allowed) => line.includes(allowed))) continue
    hits.push({ term, line: line.trim().slice(0, 120) })
  }
}

if (hits.length > 0) {
  console.error('check-ia-labels: FAILED — Quickstart copy contains blocked jargon\n')
  for (const h of hits) {
    console.error(`  • [${h.term}] ${h.line}`)
  }
  process.exit(1)
}

console.log('check-ia-labels: OK (quickstart block clean)')
