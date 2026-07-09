#!/usr/bin/env node
/**
 * Demote inline secondary links from brand hue to LINK_ACCENT (accent-foreground).
 * MATCH: text-brand hover:underline
 * DONE:  text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const ADMIN_SRC = path.join(ROOT, 'apps/admin/src')

const MATCHES = [
  {
    match: 'text-brand hover:underline',
    done: 'text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors',
  },
  {
    match: 'text-brand hover:text-brand-hover',
    done: 'text-accent-foreground hover:text-accent',
  },
  {
    match: 'text-brand underline',
    done: 'text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors',
  },
]

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, acc)
    else if (ent.name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

let filesTouched = 0
let replacements = 0

for (const file of walk(ADMIN_SRC)) {
  let src = fs.readFileSync(file, 'utf8')
  let fileCount = 0
  for (const { match, done } of MATCHES) {
    if (!src.includes(match)) continue
    const count = src.split(match).length - 1
    src = src.split(match).join(done)
    fileCount += count
  }
  if (fileCount === 0) continue
  fs.writeFileSync(file, src)
  filesTouched += 1
  replacements += fileCount
  console.log(`${path.relative(ROOT, file)}: ${fileCount}`)
}

console.log(`\nDone: ${replacements} replacements in ${filesTouched} files`)
