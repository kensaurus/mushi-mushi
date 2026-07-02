#!/usr/bin/env node
/**
 * Fix codemod regressions: literal 'CHIP_TONE.xxx' strings → real references.
 * Also converts simple Badge className="CHIP_TONE.xxx" → tone prop.
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

function transform(src, file) {
  let next = src
  const original = src

  // Fix broken partial replacements
  next = next.replace(/CHIP_TONE\.(\w+)-foreground/g, 'CHIP_TONE.$1')

  // 'CHIP_TONE.foo' or "CHIP_TONE.foo" in object/string contexts → CHIP_TONE.foo
  next = next.replace(/(['"])CHIP_TONE\.(\w+)\1/g, 'CHIP_TONE.$2')

  // Badge with only CHIP_TONE class
  next = next.replace(
    /<Badge className=\{CHIP_TONE\.(\w+)\}>/g,
    '<Badge tone="$1">',
  )
  next = next.replace(
    /<Badge className="CHIP_TONE\.(\w+)">/g,
    '<Badge tone="$1">',
  )
  next = next.replace(
    /<Badge className=\{`CHIP_TONE\.(\w+)`\}>/g,
    '<Badge tone="$1">',
  )
  // Badge with CHIP_TONE + extra classes → tone + className
  next = next.replace(
    /<Badge className=\{`(\$\{)?CHIP_TONE\.(\w+)\}? ([^`]+)`\}>/g,
    '<Badge tone="$2" className="$3">',
  )
  next = next.replace(
    /<Badge className=\{`CHIP_TONE\.(\w+) ([^`]+)`\}>/g,
    '<Badge tone="$1" className="$2">',
  )
  next = next.replace(
    /<Badge className=\{CHIP_TONE\.(\w+) \+ ' ([^']+)'\}>/g,
    '<Badge tone="$1" className="$2">',
  )
  next = next.replace(
    /<Badge className=\{`(\$\{)?CHIP_TONE\.(\w+)\}?([^`]*?)`\}>/g,
    (match, _a, tone, rest) => {
      const extra = rest?.trim()
      return extra ? `<Badge tone="${tone}" className="${extra}">` : `<Badge tone="${tone}">`
    },
  )

  if (next === original) return { src, changed: false }
  if (next.includes('CHIP_TONE')) {
    next = ensureChipImport(next, file)
  }
  return { src: next, changed: true }
}

const files = walk(ADMIN_SRC)
let touched = 0
for (const file of files) {
  const original = readFileSync(file, 'utf8')
  const { src, changed } = transform(original, file)
  if (changed) {
    writeFileSync(file, src)
    touched++
  }
}
console.log(`Fixed ${touched} files`)
