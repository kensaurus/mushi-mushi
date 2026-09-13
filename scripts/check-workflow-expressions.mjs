#!/usr/bin/env node
/**
 * check-workflow-expressions.mjs
 *
 * Reject GitHub Actions expressions that GitHub only rejects at parse time,
 * where the failure is close to invisible.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-13, publish-vscode-extension.yml used
 *
 *     if: ${{ !inputs.dry_run && secrets.VSCE_PAT != '' }}
 *
 * The `secrets` context is not valid inside a step-level `if:`. GitHub rejects
 * the whole file, and the failure surfaces as a run with ZERO jobs whose name
 * is the file's path rather than its `name:` — no annotation, no log, nothing
 * that says "invalid expression". `gh run view --log-failed` answers
 * "log not found". It is easy to stare at.
 *
 * The fix is to resolve secrets to booleans in an `env:` block — where the
 * `secrets` context IS allowed — and compare `env.*` in the condition:
 *
 *     env:
 *       HAS_TOKEN: ${{ secrets.MY_TOKEN != '' }}
 *     # ...
 *     if: ${{ env.HAS_TOKEN == 'true' }}
 *
 * Usage: node scripts/check-workflow-expressions.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, '.github/workflows')

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))

const problems = []

for (const file of files) {
  const full = path.join(DIR, file)
  const lines = readFileSync(full, 'utf8').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find `if:` keys, then gather the expression — it may wrap onto
    // continuation lines, or use a YAML block scalar.
    const m = line.match(/^(\s*)(?:-\s+)?if\s*:\s*(.*)$/)
    if (!m) continue

    const indent = m[1].length
    let expr = m[2].trim()

    if (expr === '>' || expr === '|' || expr === '>-' || expr === '|-') expr = ''
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim() === '') break
      const nextIndent = next.length - next.trimStart().length
      if (nextIndent <= indent) break
      if (/^\s*[\w-]+\s*:/.test(next) && nextIndent <= indent + 2) break
      expr += ` ${next.trim()}`
    }

    if (/\bsecrets\s*\./.test(expr)) {
      problems.push({
        file,
        line: i + 1,
        expr: expr.slice(0, 120),
      })
    }
  }
}

if (problems.length > 0) {
  console.error('✗  `secrets` used inside an `if:` condition — GitHub rejects the whole file:\n')
  for (const p of problems) {
    console.error(`   .github/workflows/${p.file}:${p.line}`)
    console.error(`       if: ${p.expr}`)
  }
  console.error(
    '\n   A file that fails to parse produces a run with ZERO jobs, named after\n' +
      "   the file's path instead of its `name:`, with no annotation and no log.\n" +
      '\n   Resolve the secret to a boolean in an `env:` block, where `secrets` is\n' +
      '   allowed, then compare env in the condition:\n' +
      '\n       env:\n' +
      "         HAS_TOKEN: ${{ secrets.MY_TOKEN != '' }}\n" +
      "       if: ${{ env.HAS_TOKEN == 'true' }}\n",
  )
  process.exit(1)
}

console.log(`✓  workflow expressions: ${files.length} file(s), no \`secrets\` in an \`if:\`.`)
