#!/usr/bin/env node
/**
 * Second-pass fix: embedded "CHIP_TONE.xxx" text inside class strings → real refs.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const ADMIN_SRC = join(ROOT, 'apps/admin/src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

function chipImportPath(file) {
  const rel = relative(join(file, '..'), join(ADMIN_SRC, 'lib/chipTone'))
  const normalized = rel.startsWith('.') ? rel : `./${rel}`
  return normalized.replace(/\\/g, '/')
}

function ensureChipImport(src, file) {
  if (/from ['"].*chipTone['"]/.test(src)) return src
  const importPath = chipImportPath(file)
  const importLine = `import { CHIP_TONE } from '${importPath}'\n`
  const lastImport = src.lastIndexOf('\nimport ')
  if (lastImport === -1) return importLine + src
  const lineEnd = src.indexOf('\n', lastImport + 1)
  return src.slice(0, lineEnd + 1) + importLine + src.slice(lineEnd + 1)
}

function transform(src) {
  let next = src
  const original = src

  // Object / ternary string values: 'CHIP_TONE.foo extra' → CHIP_TONE.foo + ' extra'
  next = next.replace(
    /'CHIP_TONE\.(\w+)([^']*)'/g,
    (_m, tone, rest) => (rest ? `CHIP_TONE.${tone} + '${rest}'` : `CHIP_TONE.${tone}`),
  )

  // className="... CHIP_TONE.foo ..." → className={`... ${CHIP_TONE.foo} ...`}
  next = next.replace(
    /className="([^"]*\b)CHIP_TONE\.(\w+)([^"]*)"/g,
    (_m, before, tone, after) => {
      const parts = []
      if (before.trim()) parts.push(before.trim())
      parts.push(`\${CHIP_TONE.${tone}}`)
      if (after.trim()) parts.push(after.trim())
      return `className={\`${parts.join(' ')}\`}`
    },
  )

  // className='... CHIP_TONE.foo ...'
  next = next.replace(
    /className='([^']*\b)CHIP_TONE\.(\w+)([^']*)'/g,
    (_m, before, tone, after) => {
      const parts = []
      if (before.trim()) parts.push(before.trim())
      parts.push(`\${CHIP_TONE.${tone}}`)
      if (after.trim()) parts.push(after.trim())
      return `className={\`${parts.join(' ')}\`}`
    },
  )

  // Remaining raw WCAG violations — common patterns
  const REPLACEMENTS = [
    ['bg-ok-muted/30 text-ok', 'CHIP_TONE.okSubtle'],
    ['bg-warn-muted/30 text-warn', 'CHIP_TONE.warnSubtle'],
    ['bg-danger-muted/15 text-danger', 'CHIP_TONE.dangerSubtle'],
    ['bg-danger-muted/30 text-danger', 'CHIP_TONE.dangerSubtle'],
    ['bg-danger-muted/40 text-danger', 'CHIP_TONE.dangerSubtle'],
    ['bg-danger-muted p-2 text-2xs text-danger', 'CHIP_TONE.dangerSubtle p-2 text-2xs'],
    ['bg-warn-muted/20 px-2 py-1.5 text-2xs text-warn', 'CHIP_TONE.warnSubtle px-2 py-1.5 text-2xs'],
    ['bg-warn-muted border border-warn/30 px-3 py-2 text-2xs text-warn', 'CHIP_TONE.warnSubtle px-3 py-2 text-2xs'],
    ['bg-info-muted/40 text-info', 'CHIP_TONE.infoSubtle'],
    ['bg-info-muted/30 text-info', 'CHIP_TONE.infoSubtle'],
    ['bg-info-muted/15 text-info', 'CHIP_TONE.infoSubtle'],
    ['bg-ok-muted/15 p-2 text-2xs text-ok', 'CHIP_TONE.okSubtle p-2 text-2xs'],
    ['bg-ok-muted/30 px-2 py-0.5 text-ok', 'CHIP_TONE.okSubtle px-2 py-0.5'],
    ['bg-ok-muted/70 text-ok border border-ok/40', 'CHIP_TONE.ok'],
    ['bg-danger-muted/60 text-danger border', 'CHIP_TONE.danger + \' border\''],
    ['bg-warn-muted px-1 text-3xs font-mono font-semibold text-warn', 'CHIP_TONE.warnSubtle px-1 text-3xs font-mono font-semibold'],
    ['shrink-0 bg-ok-muted font-mono text-3xs text-ok', 'shrink-0 font-mono text-3xs'],
  ]
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(from)) next = next.split(from).join(to)
  }

  if (next === original) return { src, changed: false }
  return { src: next, changed: true }
}

const files = walk(ADMIN_SRC)
let touched = 0
for (const file of files) {
  const original = readFileSync(file, 'utf8')
  let { src, changed } = transform(original)
  if (changed && src.includes('CHIP_TONE')) {
    src = ensureChipImport(src, file)
  }
  if (changed) {
    writeFileSync(file, src)
    touched++
  }
}
console.log(`Fixed ${touched} files (embedded CHIP_TONE pass)`)
