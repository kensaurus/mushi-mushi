#!/usr/bin/env node
/**
 * Mechanical arbitrary-token drain for admin:
 * replace safe rem/px arbitraries with standard Tailwind scale tokens.
 * Does NOT touch calc()/minmax()/fr grids — those need allowlist comments.
 *
 * Usage: node scripts/codemod-drain-arbitraries.mjs [--dry-run]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'apps/admin/src')
const dry = process.argv.includes('--dry-run')

/** Exact token → replacement (whole class segment). */
const MAP = {
  'max-w-[14rem]': 'max-w-56',
  'max-w-[12rem]': 'max-w-48',
  'max-w-[10rem]': 'max-w-40',
  'max-w-[16rem]': 'max-w-64',
  'max-w-[18rem]': 'max-w-72',
  'max-w-[8rem]': 'max-w-32',
  'max-w-[9rem]': 'max-w-36',
  'max-w-[24rem]': 'max-w-96',
  'max-w-[28rem]': 'max-w-md',
  'max-w-[200px]': 'max-w-48',
  'max-w-[160px]': 'max-w-40',
  'max-w-[150px]': 'max-w-36',
  'max-w-[100rem]': 'max-w-none',
  'min-w-[10rem]': 'min-w-40',
  'min-w-[12rem]': 'min-w-48',
  'min-w-[28rem]': 'min-w-md',
  'min-w-[40rem]': 'min-w-xl',
  'min-w-[2.75rem]': 'min-w-11',
  'min-w-[3.25rem]': 'min-w-13',
  'min-w-[1rem]': 'min-w-4',
  'min-h-[3rem]': 'min-h-12',
  'min-h-[2rem]': 'min-h-8',
  'min-h-[2.25rem]': 'min-h-9',
  'min-h-[1.25rem]': 'min-h-5',
  'min-h-[1.375rem]': 'min-h-5.5',
  'w-[60%]': 'w-3/5',
  'w-[4.5rem]': 'w-18',
  'lg:w-[4.5rem]': 'lg:w-18',
  'w-[28rem]': 'w-md',
  'max-h-[28rem]': 'max-h-112',
  'max-h-[480px]': 'max-h-120',
  'tracking-[0.08em]': 'tracking-widest',
  'xl:min-w-[9rem]': 'xl:min-w-36',
}

// Only keep replacements that exist in default Tailwind / this project's theme.
// Drop inventing w-18 / max-h-112 / min-w-13 / min-h-5.5 / w-md unless theme has them.
const SAFE = {
  'max-w-[14rem]': 'max-w-56',
  'max-w-[12rem]': 'max-w-48',
  'max-w-[10rem]': 'max-w-40',
  'max-w-[16rem]': 'max-w-64',
  'max-w-[18rem]': 'max-w-72',
  'max-w-[8rem]': 'max-w-32',
  'max-w-[9rem]': 'max-w-36',
  'max-w-[24rem]': 'max-w-96',
  'max-w-[200px]': 'max-w-48',
  'max-w-[160px]': 'max-w-40',
  'max-w-[150px]': 'max-w-36',
  'min-w-[10rem]': 'min-w-40',
  'min-w-[12rem]': 'min-w-48',
  'min-w-[2.75rem]': 'min-w-11',
  'min-w-[1rem]': 'min-w-4',
  'min-h-[3rem]': 'min-h-12',
  'min-h-[2rem]': 'min-h-8',
  'min-h-[2.25rem]': 'min-h-9',
  'min-h-[1.25rem]': 'min-h-5',
  'w-[60%]': 'w-3/5',
  'tracking-[0.08em]': 'tracking-widest',
  'xl:min-w-[9rem]': 'xl:min-w-36',
  'max-w-[28rem]': 'max-w-md',
}

async function walk(dir, out = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'ui') continue // ui allowlisted
      await walk(full, out)
    } else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) out.push(full)
  }
  return out
}

function rewrite(text) {
  let next = text
  let count = 0
  for (const [from, to] of Object.entries(SAFE)) {
    if (!next.includes(from)) continue
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const before = next
    next = next.replace(re, to)
    if (next !== before) {
      const n = (before.match(re) || []).length
      count += n
    }
  }
  return { next, count }
}

const files = await walk(SRC)
let changedFiles = 0
let total = 0
for (const file of files) {
  const text = await readFile(file, 'utf8')
  const { next, count } = rewrite(text)
  if (!count) continue
  changedFiles++
  total += count
  const rel = path.relative(ROOT, file)
  if (dry) console.log(`would ${rel}: ${count}`)
  else {
    await writeFile(file, next, 'utf8')
    console.log(`fixed ${rel}: ${count}`)
  }
}
console.log(`\ncodemod-drain-arbitraries: ${total} replacements in ${changedFiles} files${dry ? ' (dry-run)' : ''}`)
