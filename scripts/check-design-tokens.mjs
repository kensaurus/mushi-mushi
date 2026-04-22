#!/usr/bin/env node
/**
 * FILE: scripts/check-design-tokens.mjs
 * PURPOSE: Lint guard — fail the build when admin source introduces a
 *          Tailwind class that references a semantic color token that
 *          doesn't exist in `apps/admin/src/index.css`.
 *
 *          The 2026-04-21 coherency sweep found three invisible-token
 *          bugs (`bg-surface-subtle`, `text-success`) that rendered
 *          transparently in production because Tailwind silently drops
 *          classes whose `--color-*` variable is undefined. This script
 *          stops the next one at commit time.
 *
 *          Strategy: deny-list of retired / never-defined semantic aliases
 *          plus an allow-list of semantic roots that actually exist in the
 *          @theme block. A Tailwind class is flagged when:
 *
 *            (a) its token matches a deny-list prefix, OR
 *            (b) its token starts with a known semantic namespace
 *                (brand, accent, ok, warn, danger, info, surface, fg,
 *                edge, nav, overlay) but the full root isn't defined in
 *                index.css — i.e. a typo against a real namespace.
 *
 *          Run locally:  node scripts/check-design-tokens.mjs
 *          In CI:        pnpm check:design-tokens
 *          Pre-commit:   wired via scripts/install-git-hooks.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ADMIN_SRC = resolve(ROOT, 'apps/admin/src')
const TOKEN_CSS = resolve(ADMIN_SRC, 'index.css')

// Retired / never-existed aliases. Matched as a whole root or as a prefix
// before a hyphen (so `text-success-muted` is caught too).
const DENY = [
  'surface-subtle',
  'success',
  'error',
]

// Known semantic color namespaces. A Tailwind class whose root starts with
// one of these is expected to resolve to a `--color-<root>` variable; if
// the full root isn't in the allow-list extracted from index.css, it's a
// typo drift and we fail the build.
const SEMANTIC_NAMESPACES = [
  'brand',
  'accent',
  'ok',
  'warn',
  'warning',
  'danger',
  'info',
  'surface',
  'fg',
  'edge',
  'nav',
  'overlay',
  'border',
  'background',
]

// Tailwind class prefixes that *can* take a semantic color token. We only
// examine classes starting with one of these to avoid false positives on
// size / layout utilities like `text-xs`, `border-b`, `ring-2`.
const COLOR_PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via', 'divide', 'shadow', 'outline', 'decoration', 'placeholder', 'caret', 'accent']

function parseColorRoots(css) {
  const roots = new Set()
  for (const match of css.matchAll(/--color-([a-z0-9-]+):/g)) {
    roots.add(match[1])
  }
  return roots
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, acc)
    else if (/\.(tsx?|css)$/.test(entry)) acc.push(path)
  }
  return acc
}

function extractSemanticColorHits(src, file, allow) {
  const deniedHits = []
  const unknownHits = []
  const prefixAlt = COLOR_PREFIXES.join('|')
  // Match `<prefix>-<root>` where root is letters/hyphens, optional /opacity.
  // Anchored to class-boundary chars (quote, whitespace, backtick, colon, {, }, [).
  const re = new RegExp(
    `(?<=[\\s"'\`{}\\[\\]=>:;(])(${prefixAlt})-([a-z][a-z0-9-]*?)(?:\\/\\d+)?(?=[\\s"'\`{}\\[\\]=>:;)])`,
    'g',
  )
  for (const match of src.matchAll(re)) {
    const root = match[2]
    const index = match.index ?? 0
    // Deny-list: whole token or leading segment matches a retired alias.
    const deniedBase = DENY.find(
      (d) => root === d || root.startsWith(`${d}-`) || root.endsWith(`-${d}`),
    )
    if (deniedBase) {
      deniedHits.push({ token: `${match[1]}-${root}`, file, index })
      continue
    }
    // Only inspect roots that start with a known semantic namespace.
    const leadingNs = root.split('-')[0]
    if (!SEMANTIC_NAMESPACES.includes(leadingNs)) continue
    if (allow.has(root)) continue
    // `brand-hover/40` → `brand-hover` already stripped. Try progressively
    // shorter prefixes so `bg-brand-hover` validates when only `brand-hover`
    // is defined (it is) AND `bg-brand` validates when `--color-brand` is
    // defined (it is). If no prefix matches, drift.
    const parts = root.split('-')
    let matched = false
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      if (allow.has(parts.slice(0, i).join('-'))) {
        matched = true
        break
      }
    }
    if (!matched) {
      unknownHits.push({ token: `${match[1]}-${root}`, file, index })
    }
  }
  return { deniedHits, unknownHits }
}

const css = readFileSync(TOKEN_CSS, 'utf8')
const allow = parseColorRoots(css)
const files = walk(ADMIN_SRC)

const denied = []
const unknown = []

for (const file of files) {
  if (file === TOKEN_CSS) continue
  const src = readFileSync(file, 'utf8')
  const { deniedHits, unknownHits } = extractSemanticColorHits(src, file, allow)
  for (const hit of deniedHits) {
    const line = src.slice(0, hit.index).split('\n').length
    denied.push({ ...hit, line })
  }
  for (const hit of unknownHits) {
    const line = src.slice(0, hit.index).split('\n').length
    unknown.push({ ...hit, line })
  }
}

function fmt(hit) {
  const rel = relative(ROOT, hit.file).replace(/\\/g, '/')
  return `  ${rel}:${hit.line}  ${hit.token}`
}

if (denied.length > 0) {
  console.error(`\n[drift] Retired design tokens found — these render transparently:\n`)
  for (const hit of denied) console.error(fmt(hit))
  console.error(
    `\nFix: use the live semantic tokens defined in apps/admin/src/index.css.\n` +
      `  success*        → ok*      (bg-ok-muted / text-ok / border-ok)\n` +
      `  error*          → danger*  (bg-danger-muted / text-danger / border-danger)\n` +
      `  surface-subtle  → surface-raised/30  (canonical inset-panel pattern)\n`,
  )
}

if (unknown.length > 0) {
  console.error(`\n[drift] Tailwind classes reference undefined semantic tokens:\n`)
  for (const hit of unknown) console.error(fmt(hit))
  console.error(
    `\nFix: add the token to the @theme block in apps/admin/src/index.css,\n` +
      `or switch to an existing root: ${[...allow].slice(0, 12).join(', ')}, …\n`,
  )
}

if (denied.length > 0 || unknown.length > 0) process.exit(1)

console.log(`[ok] Admin design tokens are in sync with index.css (${allow.size} color roots, ${files.length} files scanned).`)
