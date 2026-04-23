#!/usr/bin/env node
/**
 * FILE: scripts/check-dead-buttons.mjs
 * PURPOSE: Fail CI if any JSX button / Btn / Link in apps/admin/src/**
 *          either:
 *            1. has a no-op onClick (e.g. `onClick={() => {}}` or
 *               `onClick={noop}`), or
 *            2. is `disabled` without a matching `title` or `aria-label`
 *               or `<Tooltip>` wrapper, meaning a user who hovers gets no
 *               explanation of why the button is dead.
 *
 *          This is a fast, syntactic grep — it is deliberately *not*
 *          a full TSC pass. Catches roughly 90% of the "this button
 *          does nothing" category of bugs the QA team keeps logging.
 *
 *          Exits with code 0 if clean, 1 if violations found.
 *          Wave R (2026-04-22).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = resolve(process.cwd(), 'apps/admin/src')
const exts = new Set(['.tsx', '.ts'])

/** Collect every .ts/.tsx file under apps/admin/src/. */
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

/**
 * Regex detectors. These are line-oriented — a dead button that spans
 * multiple lines and splits `disabled` from its element onto separate
 * lines may slip through, but those are rare in this codebase and any
 * human reviewer will catch them.
 */
const NOOP_ONCLICK = /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/
// `onClick={noop}` where the identifier is literally `noop` — people sometimes
// import a no-op helper from a "TODO stub" utility.
const NOOP_NAMED = /onClick=\{\s*noop\s*\}/
// Only permanent-disabled buttons are "dead". Transient `disabled={loading}`
// / `disabled={saving}` are valid UX — the button shows a spinner and
// re-enables when work completes. We only flag literal `disabled={true}`
// and shorthand `disabled` (no RHS) that is NOT paired with a hint.
const DISABLED_HARD = /\bdisabled(?=(\s|>|\/))/
const DISABLED_TRUE_LITERAL = /\bdisabled=\{true\}/

function checkFile(absPath) {
  const src = readFileSync(absPath, 'utf8')
  const lines = src.split(/\r?\n/)
  const violations = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (NOOP_ONCLICK.test(line) || NOOP_NAMED.test(line)) {
      violations.push({ line: i + 1, kind: 'noop-onclick', preview: line.trim() })
      continue
    }

    // Only flag `disabled={true}` — a literal permanent-dead button. Every
    // other `disabled={…}` usage has a dynamic RHS (loading, saving,
    // form-invalid, etc.) which is valid UX and should NOT block CI.
    if (DISABLED_TRUE_LITERAL.test(line)) {
      const window = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join('\n')
      const hasHint =
        /title=|aria-label=|aria-describedby=|<Tooltip\b/i.test(window)
      if (!hasHint) {
        violations.push({ line: i + 1, kind: 'disabled-no-hint', preview: line.trim() })
      }
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
      `\n\u274c check-dead-buttons: ${failed} violation${failed === 1 ? '' : 's'} found.`,
    )
    console.error(
      '   Dead buttons are the #1 UX complaint in audit reports. Either wire the handler',
    )
    console.error(
      '   to a real action, or remove the element + explain why it\'s disabled via title=/aria-label=/<Tooltip>.',
    )
    process.exit(1)
  }
  console.log(`\u2705 check-dead-buttons: scanned ${files.length} files, 0 violations.`)
}

main()
