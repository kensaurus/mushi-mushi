#!/usr/bin/env node
/**
 * Replace AA-failing bg-*-muted + text-* pairings with CHIP_TONE constants.
 * Run: node scripts/codemod-chip-contrast.mjs [--write]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const ADMIN_SRC = join(ROOT, 'apps/admin/src')
const WRITE = process.argv.includes('--write')

/** Longest-first so border variants match before bare pairs. */
const REPLACEMENTS = [
  ['bg-ok-muted/70 text-ok-foreground border border-ok/30', 'CHIP_TONE.ok'],
  ['bg-ok-muted/60 text-ok border border-ok/30', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/50 text-ok-foreground border border-ok/25', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/50 text-ok border border-ok/25', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted text-ok border border-ok/25', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted text-ok-foreground border border-ok/30', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/50 text-ok-foreground', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/50 text-ok', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/15 text-ok', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted text-ok-foreground', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted text-ok', 'CHIP_TONE.okSubtle'],

  ['bg-warn-muted/70 text-warning-foreground border border-warn/30', 'CHIP_TONE.warn'],
  ['bg-warn-muted/50 text-warning-foreground border border-warn/30', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted/50 text-warning-foreground border border-warn/25', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted text-warn border border-warn/30', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted/20 text-warn', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted/50 text-warning-foreground', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted text-warning-foreground', 'CHIP_TONE.warnSubtle'],
  ['bg-warn-muted text-warn', 'CHIP_TONE.warnSubtle'],

  ['bg-danger-muted/70 text-danger-foreground border border-danger/30', 'CHIP_TONE.danger'],
  ['bg-danger-muted/50 text-danger-foreground border border-danger/25', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted/50 text-danger-foreground border border-danger/20', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted text-danger border border-danger/25', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted/50 text-danger', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted text-danger-foreground', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted text-danger', 'CHIP_TONE.dangerSubtle'],

  ['bg-info-muted/70 text-info-foreground border border-info/30', 'CHIP_TONE.info'],
  ['bg-info-muted/50 text-info-foreground border border-info/30', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted text-info border border-info/30', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted/50 text-info-foreground', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted/50 text-info', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted text-info-foreground', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted text-info', 'CHIP_TONE.infoSubtle'],

  ['bg-accent-muted/70 text-accent-foreground border border-accent/35', 'CHIP_TONE.accent'],
  ['bg-accent-muted/55 text-accent-foreground border border-accent/30', 'CHIP_TONE.accentSubtle'],
  ['bg-accent-muted text-accent border border-accent/30', 'CHIP_TONE.accentSubtle'],
  ['bg-accent-muted/55 text-accent', 'CHIP_TONE.accentSubtle'],
  ['bg-accent-muted text-accent', 'CHIP_TONE.accentSubtle'],

  // Legacy danger-subtle alias used in a few pages
  ['bg-danger-subtle text-danger', 'CHIP_TONE.dangerSubtle'],

  ['bg-ok-muted/20 text-ok', 'CHIP_TONE.okSubtle'],
  ['bg-ok-muted/60 text-ok', 'CHIP_TONE.okSubtle'],
  ['bg-info-muted/30 text-info', 'CHIP_TONE.infoSubtle'],
  ['bg-info-muted/20 text-info', 'CHIP_TONE.infoSubtle'],
  ['bg-warn-muted/20 text-warn', 'CHIP_TONE.warnSubtle'],
  ['bg-danger-muted/20 text-danger', 'CHIP_TONE.dangerSubtle'],
  ['bg-danger-muted/30 text-danger', 'CHIP_TONE.dangerSubtle'],
  ['text-warn bg-warn-muted/20', 'CHIP_TONE.warnSubtle'],
]

const BADGE_TONE_MAP = {
  'CHIP_TONE.okSubtle': 'okSubtle',
  'CHIP_TONE.ok': 'ok',
  'CHIP_TONE.warnSubtle': 'warnSubtle',
  'CHIP_TONE.warn': 'warn',
  'CHIP_TONE.dangerSubtle': 'dangerSubtle',
  'CHIP_TONE.danger': 'danger',
  'CHIP_TONE.infoSubtle': 'infoSubtle',
  'CHIP_TONE.info': 'info',
  'CHIP_TONE.accentSubtle': 'accentSubtle',
  'CHIP_TONE.accent': 'accent',
  'CHIP_TONE.neutral': 'neutral',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

function chipImportPath(file) {
  const rel = relative(join(file, '..'), join(ADMIN_SRC, 'lib/chipTone'))
  const normalized = rel.startsWith('.') ? rel : `./${rel}`
  return normalized.replace(/\\/g, '/')
}

function ensureChipImport(src, file) {
  if (src.includes('CHIP_TONE')) {
    if (/from ['"].*chipTone['"]/.test(src)) return src
  } else {
    return src
  }
  const importPath = chipImportPath(file)
  const importLine = `import { CHIP_TONE } from '${importPath}'\n`
  const lastImport = src.lastIndexOf('\nimport ')
  if (lastImport === -1) return importLine + src
  const lineEnd = src.indexOf('\n', lastImport + 1)
  return src.slice(0, lineEnd + 1) + importLine + src.slice(lineEnd + 1)
}

function simplifyBadgeTone(src) {
  return src.replace(
    /<Badge className=\{(`)?(\$\{)?(CHIP_TONE\.\w+)\}?(`)?\}>/g,
    (_, a, b, tone, d) => {
      const t = BADGE_TONE_MAP[tone]
      return t ? `<Badge tone="${t}">` : `<Badge className={${tone}}>`
    },
  ).replace(
    /<Badge className="(CHIP_TONE\.\w+)">/g,
    (_, tone) => {
      const t = BADGE_TONE_MAP[tone]
      return t ? `<Badge tone="${t}">` : `<Badge className="${tone}">`
    },
  ).replace(
    /<Badge className=\{(CHIP_TONE\.\w+)\}>/g,
    (_, tone) => {
      const t = BADGE_TONE_MAP[tone]
      return t ? `<Badge tone="${t}">` : `<Badge className={${tone}}>`
    },
  )
}

function transform(src, file) {
  let next = src
  let changed = false
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(from)) {
      next = next.split(from).join(to)
      changed = true
    }
  }
  if (!changed) return { src, changed: false }

  next = simplifyBadgeTone(next)
  if (next.includes('CHIP_TONE')) {
    next = ensureChipImport(next, file)
  }
  return { src: next, changed: next !== src }
}

const files = walk(ADMIN_SRC)
let touched = 0
for (const file of files) {
  const original = readFileSync(file, 'utf8')
  const { src, changed } = transform(original, file)
  if (changed) {
    touched++
    if (WRITE) writeFileSync(file, src)
    else console.log(relative(ROOT, file))
  }
}

console.log(`${WRITE ? 'Updated' : 'Would update'} ${touched} files`)
if (!WRITE) console.log('Re-run with --write to apply')
