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
 * Tests: scripts/check-workflow-expressions.test.mjs
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, '.github/workflows')

/**
 * Any access to the `secrets` context — `secrets.NAME`, `secrets['NAME']`,
 * `secrets[format(...)]` — is the same forbidden usage inside an `if:`.
 */
export const SECRETS_ACCESS_RE = /\bsecrets\s*[.[]/

/** `if:` expressions in one workflow's text that touch `secrets`. */
export function findSecretsInIf(text) {
  const found = []
  const lines = text.split(/\r?\n/)

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

    if (SECRETS_ACCESS_RE.test(expr)) {
      found.push({ line: i + 1, expr: expr.slice(0, 120) })
    }
  }
  return found
}

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  const problems = files.flatMap((file) =>
    findSecretsInIf(readFileSync(path.join(DIR, file), 'utf8')).map((p) => ({ file, ...p })),
  )
  report(problems, files.length)
  return problems.length > 0 ? 1 : 0
}

function report(problems, fileCount) {
  if (problems.length === 0) {
    console.log(`✓  workflow expressions: ${fileCount} file(s), no \`secrets\` in an \`if:\`.`)
    return
  }
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
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exitCode = main()
