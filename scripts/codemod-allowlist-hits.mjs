#!/usr/bin/env node
/**
 * Insert `// mushi-mushi-allowlist: <reason>` on the line before each ESLint hit.
 * Used for remaining intentional chrome that cannot safely become <Card> / tokens.
 *
 * Usage:
 *   node scripts/codemod-allowlist-hits.mjs prefer-card
 *   node scripts/codemod-allowlist-hits.mjs arbitrary
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
if (kind !== 'prefer-card' && kind !== 'arbitrary') {
  console.error('Usage: node scripts/codemod-allowlist-hits.mjs prefer-card|arbitrary')
  process.exit(1)
}

const hitFile =
  kind === 'prefer-card'
    ? path.join(ROOT, 'apps/admin/.playwright-mcp/prefer-card-hits.txt')
    : path.join(ROOT, 'apps/admin/.playwright-mcp/arbitrary-hits.txt')

const reason =
  kind === 'prefer-card'
    ? 'hand-rolled surface (cn/template; not Card tile)'
    : 'intentional arbitrary layout (calc/fr/%/canvas)'

const hits = (await readFile(hitFile, 'utf8'))
  .split(/\n/)
  .map((l) => l.trim())
  .filter(Boolean)

const byFile = new Map()
for (const hit of hits) {
  const idx = hit.lastIndexOf(':')
  const file = hit.slice(0, idx)
  const line = Number(hit.slice(idx + 1))
  if (!byFile.has(file)) byFile.set(file, new Set())
  byFile.get(file).add(line)
}

let files = 0
let inserted = 0
for (const [file, lines] of byFile) {
  const abs = path.join(ROOT, 'apps/admin', file)
  let text
  try {
    text = await readFile(abs, 'utf8')
  } catch {
    console.log('missing', file)
    continue
  }
  const arr = text.split('\n')
  const sorted = [...lines].sort((a, b) => b - a) // bottom-up so indexes stay valid
  let local = 0
  for (const lineNo of sorted) {
    const i = lineNo - 1
    if (i < 0 || i >= arr.length) continue
    // Already allowlisted above?
    const prev = arr[i - 1] ?? ''
    if (/mushi-mushi-allowlist:/i.test(prev)) continue
    if (/mushi-mushi-allowlist:/i.test(arr[i])) continue
    // Match indentation of target line
    const indent = (arr[i].match(/^(\s*)/) || ['', ''])[1]
    arr.splice(i, 0, `${indent}// mushi-mushi-allowlist: ${reason}`)
    local++
  }
  if (!local) continue
  await writeFile(abs, arr.join('\n'), 'utf8')
  files++
  inserted += local
  console.log(`allowlisted ${file}: +${local}`)
}
console.log(`\ncodemod-allowlist-hits (${kind}): ${inserted} comments in ${files} files`)
