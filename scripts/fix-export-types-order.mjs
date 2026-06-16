#!/usr/bin/env node
/**
 * FILE: fix-export-types-order.mjs
 * PURPOSE: Reorder package.json export conditions so `types` precedes `import`/`require`.
 *          Fixes esbuild/tsup warning: "The condition types here will never be used..."
 *
 * USAGE:
 *   node scripts/fix-export-types-order.mjs          # fix in place
 *   node scripts/fix-export-types-order.mjs --check  # exit 1 if any file needs fixing
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const checkOnly = process.argv.includes('--check')
const root = join(import.meta.dirname, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name === 'package.json') out.push(p)
  }
  return out
}

/** Put `types` first when it is a sibling of import/require (esbuild/TS resolution). */
function reorderCondition(cond) {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
    return { changed: false, value: cond }
  }

  const keys = Object.keys(cond)
  if (!keys.includes('types')) return { changed: false, value: cond }

  const typeIdx = keys.indexOf('types')
  const importIdx = keys.indexOf('import')
  const requireIdx = keys.indexOf('require')
  const importIsString = importIdx >= 0 && typeof cond.import === 'string'
  const requireIsString = requireIdx >= 0 && typeof cond.require === 'string'

  const typesAlreadyFirst =
    (importIsString ? typeIdx < importIdx : true) &&
    (requireIsString ? typeIdx < requireIdx : true)

  if (typesAlreadyFirst) return { changed: false, value: cond }

  const next = { types: cond.types }
  if (importIsString) next.import = cond.import
  if (requireIsString) next.require = cond.require
  for (const k of keys) {
    if (!(k in next)) next[k] = cond[k]
  }
  return { changed: true, value: next }
}

function fixExports(exportsField) {
  if (!exportsField || typeof exportsField !== 'object') {
    return { changed: false, value: exportsField }
  }
  let changed = false
  const next = {}
  for (const [subpath, cond] of Object.entries(exportsField)) {
    if (typeof cond === 'string') {
      next[subpath] = cond
      continue
    }
    const r = reorderCondition(cond)
    changed ||= r.changed
    next[subpath] = r.value
  }
  return { changed, value: next }
}

const roots = ['packages', 'apps', 'examples'].map((d) => join(root, d))
const fixed = []

for (const base of roots) {
  let pkgFiles = []
  try {
    pkgFiles = walk(base)
  } catch {
    continue
  }
  for (const pkgPath of pkgFiles) {
    const raw = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    if (!pkg.exports) continue
    const { changed, value } = fixExports(pkg.exports)
    if (!changed) continue
    if (checkOnly) {
      fixed.push(relative(root, pkgPath))
      continue
    }
    pkg.exports = value
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    fixed.push(relative(root, pkgPath))
  }
}

if (checkOnly) {
  if (fixed.length === 0) {
    console.log('All package.json export maps have types before import/require.')
    process.exit(0)
  }
  console.error(`${fixed.length} package.json file(s) need types-first export order:`)
  for (const f of fixed) console.error(`  ${f}`)
  console.error('\nRun: node scripts/fix-export-types-order.mjs')
  process.exit(1)
}

console.log(`Fixed ${fixed.length} package.json file(s):`)
for (const f of fixed) console.log(`  ${f}`)
