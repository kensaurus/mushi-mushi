#!/usr/bin/env node
/**
 * CI gate: a class string must not carry an unprefixed `hidden` together with
 * an unprefixed display utility (`flex`, `inline-flex`, `block`, `grid`, …).
 *
 * Both set `display`, and Tailwind's output order — not the order you wrote
 * them in — decides the winner. For `inline-flex` + `hidden`, inline-flex
 * wins: the header's plan badge ("ADMIN") and the project status chip were
 * written `inline-flex … hidden xl:inline-flex`, never hid below `xl`, and
 * were clipped at the right edge of the top bar (2026-09-23).
 *
 * Put exactly one base display in the class list: `hidden xl:inline-flex`
 * OR `inline-flex`, never both.
 *
 * Scope: static string literals and template-literal static parts in
 * apps/admin/src. Opt out with `mushi-mushi-allowlist: <reason>` on the line
 * or the line above.
 *
 * Usage: node scripts/audit-display-conflict.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ADMIN_SRC = resolve(ROOT, 'apps/admin/src')

const DISPLAY = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid',
  'table', 'contents', 'flow-root', 'list-item',
])
const ALLOW = /mushi-mushi-allowlist:/

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

const tokensOf = (s) => s.split(/\s+/).filter(Boolean)

/**
 * Class lists in a source text. A plain string literal is one list. A
 * template literal is one list made of its static text PLUS every string
 * literal inside its `${…}` interpolations — that is exactly how
 * `inline-flex … ${hideBelowXl ? 'hidden xl:inline-flex' : ''}` builds one
 * className at runtime, and it is the shape the original bug had.
 */
function classLists(src) {
  const lists = []
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1]
    const statics = body.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
    const inner = [...body.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)].flatMap((x) =>
      [...x[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((s) => s[1] ?? s[2] ?? ''),
    )
    lists.push({ index: m.index ?? 0, staticTokens: tokensOf(statics), branchTokens: inner.map(tokensOf) })
  }
  for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    lists.push({ index: m.index ?? 0, staticTokens: tokensOf(m[1] ?? m[2] ?? ''), branchTokens: [] })
  }
  return lists
}

function conflict({ staticTokens, branchTokens }) {
  const staticDisplay = staticTokens.find((t) => DISPLAY.has(t))
  if (staticTokens.includes('hidden') && staticDisplay) return `hidden + ${staticDisplay}`
  for (const b of branchTokens) {
    if (b.includes('hidden') && staticDisplay) return `${staticDisplay} + \${… 'hidden …'}`
    const branchDisplay = b.find((t) => DISPLAY.has(t))
    if (branchDisplay && staticTokens.includes('hidden')) return `hidden + \${… '${branchDisplay}'}`
  }
  return null
}

const findings = []
for (const file of walk(ADMIN_SRC)) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const seen = new Set()
  for (const list of classLists(src)) {
    const why = conflict(list)
    if (!why) continue
    const line = src.slice(0, list.index).split('\n').length
    if (seen.has(line)) continue
    if (ALLOW.test(lines[line - 1] ?? '') || ALLOW.test(lines[line - 2] ?? '')) continue
    seen.add(line)
    findings.push(`  ${relative(ROOT, file).replace(/\\/g, '/')}:${line}  ${why}`)
  }
}

if (findings.length > 0) {
  console.error(`[fail] ${findings.length} class list(s) set both \`hidden\` and a base display — one of them silently loses:`)
  for (const f of findings) console.error(f)
  process.exit(1)
}
console.log('[ok] No hidden + display conflicts in admin src')
