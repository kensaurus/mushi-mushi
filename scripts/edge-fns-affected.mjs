#!/usr/bin/env node
/**
 * edge-fns-affected.mjs
 *
 * Which Edge Functions a set of changed files can affect, so the deploy
 * workflow redeploys those instead of all ~76 on every push to master
 * (2026-10-23: 18 deploys of every function in a day).
 *
 * A function is affected when a changed file is in its own directory, or is a
 * `_shared/` file it imports directly or through other local imports. A change
 * the import graph cannot see (config.toml, deno.json, an import map, a
 * non-code file in `_shared/`, the deploy script or workflow) affects all.
 *
 * Usage (from the repo root):
 *   node scripts/edge-fns-affected.mjs --base <sha>   # git diff <sha>...HEAD
 * Prints `all` or a space-separated function list (empty when none).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE = 'packages/server/supabase'
const FUNCTIONS = `${SUPABASE}/functions`
const CODE = /\.(m?[jt]sx?|json)$/
const ALWAYS_ALL = [
  `${SUPABASE}/config.toml`,
  `${FUNCTIONS}/deno.json`,
  `${FUNCTIONS}/deno.jsonc`,
  `${FUNCTIONS}/import_map.json`,
  'scripts/deploy-edge-function.mjs',
  'scripts/edge-fns-affected.mjs',
  '.github/workflows/deploy-edge-functions.yml',
]
// Static imports, re-exports and dynamic imports with a relative specifier.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Local files a file imports (resolved, existing only). */
function localImports(file) {
  const text = readFileSync(file, 'utf8')
  const out = []
  for (const m of text.matchAll(SPECIFIER)) {
    const target = resolve(dirname(file), m[1])
    if (existsSync(target) && statSync(target).isFile()) out.push(target)
  }
  return out
}

/**
 * @param {{ root: string, changed: string[] }} args  root = repo root; changed = repo-relative paths
 * @returns {{ all: boolean, functions: string[] }}
 */
export function affectedFunctions({ root, changed }) {
  const fnRoot = join(root, FUNCTIONS)
  const names = readdirSync(fnRoot).filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(fnRoot, n)).isDirectory())
  const affected = new Set()
  const sharedChanged = []
  for (const path of changed) {
    if (ALWAYS_ALL.includes(path)) return { all: true, functions: names }
    if (!path.startsWith(`${FUNCTIONS}/`)) continue
    const rest = path.slice(FUNCTIONS.length + 1)
    const top = rest.split('/')[0]
    if (top.startsWith('_')) {
      // A shared file the graph cannot follow (a fixture, a text file read at runtime) could be anyone's.
      if (!CODE.test(rest)) return { all: true, functions: names }
      sharedChanged.push(resolve(root, path))
    } else if (names.includes(top)) {
      affected.add(top)
    } else if (!rest.includes('/')) {
      // A file directly under functions/ (not a function): be safe.
      return { all: true, functions: names }
    }
    // A deleted function's directory: nothing to deploy.
  }
  if (sharedChanged.length) {
    const wanted = new Set(sharedChanged)
    for (const fn of names) {
      if (affected.has(fn)) continue
      const seen = new Set()
      const stack = walk(join(fnRoot, fn)).filter((f) => CODE.test(f))
      let hit = false
      while (stack.length && !hit) {
        const f = stack.pop()
        if (seen.has(f)) continue
        seen.add(f)
        if (wanted.has(f)) hit = true
        else if (/\.m?[jt]sx?$/.test(f)) stack.push(...localImports(f))
      }
      if (hit) affected.add(fn)
    }
  }
  return { all: false, functions: [...affected].sort() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--base')
  const base = i > 0 ? process.argv[i + 1] : ''
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (!base) {
    process.stdout.write('all\n')
  } else {
    let changed
    try {
      changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    } catch {
      // Unknown base (force-push, shallow clone): deploy everything.
      process.stdout.write('all\n')
      process.exit(0)
    }
    const r = affectedFunctions({ root, changed })
    process.stdout.write(`${r.all ? 'all' : r.functions.join(' ')}\n`)
  }
}
