#!/usr/bin/env node
/**
 * CI gate: fail when admin src uses raw semantic text on tinted backgrounds.
 *
 * Catches:
 *  1. bg-*-muted/subtle + raw text-* (legacy)
 *  2. bg-{sem}/N opacity tints + raw text-{sem} (e.g. bg-ok/15 text-ok)
 *
 * Line-scoped scan of quoted / static template class strings.
 * Skips CHIP_TONE / chipTone lines, tester portal, and canonical brandSubtle.
 *
 * Usage: node scripts/audit-chip-contrast.mjs [--strict]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_SRC = resolve(__dirname, '../apps/admin/src')
const strict = process.argv.includes('--strict')

const SEMANTIC = ['ok', 'warn', 'danger', 'info', 'accent', 'brand']
const MUTED_BG_RE = new RegExp(
  String.raw`\bbg-(?:${SEMANTIC.join('|')})-(?:muted|subtle)(?:\/[\d.]+)?\b`,
)
/** Opacity tint: bg-ok/15, bg-warn/10, bg-brand/12, etc. */
const OPACITY_BG_RE = new RegExp(
  String.raw`\bbg-(?:${SEMANTIC.join('|')})\/[\d.]+\b`,
)
/** `--color-*-subtle` aliases to muted in index.css; brand chip is canonical in CHIP_TONE.brand / brandSubtle */
const BRAND_CHIP_ALLOW_RE =
  /\bbg-brand-subtle(?:\/[\d.]+)?\b.*\btext-brand\b|\btext-brand\b.*\bbg-brand-subtle(?:\/[\d.]+)?\b|\bbg-brand\/12\b.*\btext-brand\b|\btext-brand\b.*\bbg-brand\/12\b/
const RAW_TEXT_RE = new RegExp(
  String.raw`\btext-(?:${SEMANTIC.join('|')})(?!-(?:foreground|fg)\b)\b`,
)

const SKIP_FILES = new Set(['lib/chipTone.ts'])

function stripStatePrefixed(classes) {
  return classes
    .split(/\s+/)
    .filter((cls) => !/^(?:hover:|focus:|active:|focus-visible:|group-hover:|group-hover\/[\w-]+:)/.test(cls))
    .join(' ')
}

function chunksFromLine(line) {
  const out = []
  for (const m of line.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    out.push(m[1] ?? m[2] ?? '')
  }
  if (!line.includes('${')) {
    for (const m of line.matchAll(/`([^`]*)`/g)) {
      out.push(m[1] ?? '')
    }
  }
  return out
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      // Tester portal is an intentional satellite design language — skip.
      if (name === 'tester') continue
      out.push(...walk(p))
    } else if (/\.(tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

function isViolation(atRest) {
  if (BRAND_CHIP_ALLOW_RE.test(atRest)) return false
  const hasMuted = MUTED_BG_RE.test(atRest)
  const hasOpacity = OPACITY_BG_RE.test(atRest)
  if (!hasMuted && !hasOpacity) return false
  if (!RAW_TEXT_RE.test(atRest)) return false
  return true
}

const findings = []

for (const file of walk(ADMIN_SRC)) {
  const rel = relative(ADMIN_SRC, file).replace(/\\/g, '/')
  if (SKIP_FILES.has(rel)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, idx) => {
    if (line.includes('CHIP_TONE') || line.includes('chipTone')) return
    for (const chunk of chunksFromLine(line)) {
      if (!chunk.includes('bg-') && !chunk.includes('text-')) continue
      const atRest = stripStatePrefixed(chunk)
      if (isViolation(atRest)) {
        findings.push(`${rel}:${idx + 1}`)
      }
    }
  })
}

const unique = [...new Set(findings)]

if (unique.length === 0) {
  console.log('[ok] No raw semantic-on-muted/opacity chip contrast violations in admin src')
  process.exit(0)
}

console.error(`[fail] ${unique.length} chip contrast violation(s):`)
for (const f of unique.slice(0, 50)) console.error(`  ${f}`)
if (unique.length > 50) console.error(`  … and ${unique.length - 50} more`)
process.exit(strict ? 1 : 0)
