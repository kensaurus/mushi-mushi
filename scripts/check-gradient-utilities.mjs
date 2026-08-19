#!/usr/bin/env node
/**
 * check-gradient-utilities.mjs
 *
 * Guard against invisible buttons caused by the wrong Tailwind v4 syntax for
 * gradient custom properties.
 *
 * `bg-[var(--gradient-brand)]` LOOKS right and passes lint, typecheck, and
 * every design-token check we have — but Tailwind v4 types the square-bracket
 * form as a *color*, so it compiles to:
 *
 *     background-color: var(--gradient-brand);
 *
 * which is not a valid color. The browser drops the declaration entirely and
 * the element paints nothing. In our case that silently turned the primary and
 * accent buttons (Sign in, Save, Dispatch fix) into near-white text on the bare
 * page background — roughly 1.3:1 contrast, effectively invisible.
 *
 * The documented form uses a data-type hint and compiles to `background-image`:
 *
 *     bg-(image:--gradient-brand)
 *
 * https://tailwindcss.com/docs/background-image  ("bg-(image:<custom-property>)")
 *
 * Run: node scripts/check-gradient-utilities.mjs
 * Exit 0 = clean. Exit 1 = at least one utility would silently render nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const SEARCH_ROOTS = ['apps', 'packages'].map((d) => join(ROOT, d))
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.next', 'out', 'build', '.turbo',
  '.playwright-mcp', '.playwright-cli', 'coverage', '.refactor-backups',
])
const EXTS = /\.(tsx?|jsx?|css|mdx?)$/

// `<prop>-[var(--<anything>gradient<anything>...)]` — the broken form.
//
// We only flag custom properties whose NAME mentions a gradient, so a genuine
// colour variable (`bg-[var(--color-brand)]`, a valid background-color) stays
// allowed. Covers `bg-`, `border-`, and `from-/via-/to-`, and tolerates a
// fallback value (`var(--gradient-x, red)`), which an earlier version missed.
//
// This is a source-level heuristic and cannot see a gradient token that isn't
// named `*gradient*`. The airtight check is on compiled output — see
// `assertNoGradientBackgroundColor` below, which runs when a built stylesheet
// is present.
const BROKEN = /(?:bg|border|from|via|to)-\[var\(\s*--[a-z0-9-]*gradient[a-z0-9-]*[^)]*\)\]/gi

/**
 * Compiled-output check: after a build, ANY `background-color:var(--*gradient*)`
 * in the emitted CSS is the bug, whatever syntax produced it. Skipped silently
 * when no build output exists, so the script stays useful pre-build.
 */
function assertNoGradientBackgroundColor() {
  const hits = []
  for (const root of SEARCH_ROOTS) {
    for (const file of walk(root, [], /\.css$/)) {
      if (!/[\\/](?:dist|out|\.next)[\\/]/.test(file)) continue
      const css = readFileSync(file, 'utf8')
      const rx = /background-color:\s*var\(\s*--[a-z0-9-]*gradient/gi
      if (rx.test(css)) hits.push(relative(ROOT, file))
    }
  }
  return hits
}

function walk(dir, out = [], match = EXTS) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out, match)
    else if (match.test(entry)) out.push(full)
  }
  return out
}

const failures = []
for (const root of SEARCH_ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      // Skip explanatory prose: line-leading JS/CSS comments, and any line
      // that closes a block comment or sits in Markdown/MDX (where this trap
      // is documented). Without the trailing-comment case, a `/* ... */`
      // annotation in CSS would fail the build for describing the bug.
      const isComment =
        /^\s*(\/\/|\*|\/\*)/.test(line) ||
        /\*\//.test(line) ||
        /\.mdx?$/.test(file)
      BROKEN.lastIndex = 0
      const hit = BROKEN.exec(line)
      if (hit && !isComment) {
        failures.push({
          file: relative(ROOT, file),
          line: i + 1,
          text: hit[0],
        })
      }
    })
  }
}

const compiledHits = assertNoGradientBackgroundColor()
for (const f of compiledHits) {
  failures.push({ file: f, line: 0, text: 'background-color:var(--*gradient*) in compiled CSS' })
}

if (failures.length === 0) {
  console.log(
    '✓  Gradient utilities: no `bg-[var(--*gradient*)]` — gradients use the bg-(image:--var) form that actually renders.',
  )
  process.exit(0)
}

console.error(
  'Invisible-gradient utilities detected. Tailwind v4 compiles `bg-[var(--x)]` to\n' +
    '`background-color`, so a gradient value is invalid and the browser drops it —\n' +
    'the element renders with NO background.\n',
)
for (const f of failures) {
  console.error(`FAIL  ${f.file}:${f.line}`)
  console.error(`        ${f.text}`)
  console.error(`        use: ${f.text.replace(/bg-\[var\((--[a-z0-9-]+)\)\]/i, 'bg-(image:$1)')}\n`)
}
console.error(`${failures.length} broken gradient utility(ies).`)
process.exit(1)
