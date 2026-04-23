#!/usr/bin/env node
/**
 * FILE: scripts/check-jsx-unicode-escapes.mjs
 * PURPOSE: Fail CI if any .tsx/.jsx file in apps/admin/src/** contains a
 *          `\uXXXX` escape sequence inside a JSX attribute value or JSX
 *          text child.
 *
 *          Background — the 2026-04-23 InboxPage regression: a `\u2026`
 *          inside a JSX surface like `<Loading text="Loading inbox\u2026" />`
 *          renders as the literal six-character string `\u2026` instead of
 *          `…`, because JSX attribute values and JSX text children are
 *          NOT JavaScript string literals — they are HTML-attribute-like
 *          and JSX-text-like surfaces, so escape sequences are not
 *          processed. The same `\u2026` inside `{...}` braces (e.g.
 *          `{'Loading inbox\u2026'}`) IS a real JS string and renders
 *          correctly.
 *
 *          This guard catches the bad form before it ships:
 *            - JSX attribute string  : `prop="...\uXXXX..."`        BAD
 *            - JSX text child        : `>foo \uXXXX bar<`           BAD
 *            - JS string in braces   : `{'\uXXXX'}` / `{`...\uXXXX`}` OK
 *            - JS string elsewhere   : `const x = '\uXXXX'`         OK
 *            - Comment / JSDoc       : `// \uXXXX` / `* \uXXXX`     OK
 *
 *          Exits 0 if clean, 1 if violations found. Wave T (2026-04-23).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = resolve(process.cwd(), 'apps/admin/src')
const exts = new Set(['.tsx', '.jsx'])

/** Collect every .tsx/.jsx file under apps/admin/src/. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
      out.push(...walk(full))
    } else if (exts.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

// JSX attribute string: `=` followed by a double-quoted string that
// contains a `\uXXXX` sequence. JSX attribute values use HTML-style
// quoting and do NOT process JS escapes.
const JSX_ATTR_ESCAPE = /=\"[^\"]*\\u[0-9a-fA-F]{4}[^\"]*\"/

// JSX text child: a `\uXXXX` sequence appearing between `>` and `<` on a
// single line that is NOT inside `{...}` braces. We rule out the in-braces
// case (which IS a valid JS expression) by requiring zero `{` or `}` to
// occur between the `>` and the escape, and zero between the escape and
// the closing `<`. This is intentionally conservative — multi-line JSX
// text with escapes will slip through, but those are vanishingly rare in
// this codebase and any human reviewer will catch them.
const JSX_TEXT_ESCAPE = />[^<{}]*\\u[0-9a-fA-F]{4}[^<{}]*</

/** Skip lines that are clearly JSDoc / line comments. */
function isComment(line) {
  const trimmed = line.trimStart()
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
}

function checkFile(absPath) {
  const src = readFileSync(absPath, 'utf8')
  const lines = src.split(/\r?\n/)
  const violations = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isComment(line)) continue

    if (JSX_ATTR_ESCAPE.test(line)) {
      violations.push({ line: i + 1, kind: 'jsx-attr', preview: line.trim() })
      continue
    }
    if (JSX_TEXT_ESCAPE.test(line)) {
      violations.push({ line: i + 1, kind: 'jsx-text', preview: line.trim() })
    }
  }

  return violations
}

function main() {
  let failed = 0
  const files = walk(ROOT)
  for (const f of files) {
    const v = checkFile(f)
    if (v.length === 0) continue
    failed += v.length
    const rel = relative(process.cwd(), f)
    for (const item of v) {
      console.log(`${rel}:${item.line}  [${item.kind}]  ${item.preview}`)
    }
  }

  if (failed > 0) {
    console.error(
      `\n\u274c check-jsx-unicode-escapes: ${failed} violation${failed === 1 ? '' : 's'} found.`,
    )
    console.error(
      "   JSX attribute values and JSX text children are NOT JS string literals,",
    )
    console.error(
      "   so `\\u2026` renders as the literal text `\\u2026`, not `\u2026`. Fix by either:",
    )
    console.error(
      "     1. Replacing the escape with the literal Unicode character (preferred), or",
    )
    console.error(
      "     2. Wrapping in JS braces: `{'\\u2026'}` (works but uglier).",
    )
    process.exit(1)
  }
  console.log(`\u2705 check-jsx-unicode-escapes: scanned ${files.length} files, 0 violations.`)
}

main()
