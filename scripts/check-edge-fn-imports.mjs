#!/usr/bin/env node
/**
 * FILE: scripts/check-edge-fn-imports.mjs
 *
 * Lint guard for Supabase Edge Function deploys.
 *
 * The deploy bundler (`scripts/deploy-edge-function.mjs`) ships ONLY:
 *
 *   - packages/server/supabase/functions/<slug>/**
 *   - packages/server/supabase/functions/_shared/**
 *
 * That means a file inside `_shared/` MUST NOT import from a sibling
 * function directory — the imported file isn't included in the upload
 * tarball, and Supabase's server-side bundler rejects the deploy with
 * a misleading HTTP 400 when the import can't be resolved.
 *
 * This regressed once already (2026-05-05): `_shared/inventory-guards.ts`
 * silently reached into `../api/shared.ts` for `accessibleProjectIds`,
 * which made every NON-`api` function that pulled in `inventory-guards`
 * (i.e. inventory-crawler + synthetic-monitor) fail to deploy with no
 * actionable error. The fix was to move the helper into
 * `_shared/project-access.ts`. This script makes that mistake catchable
 * at PR time instead of release time.
 *
 * Rules enforced
 * ──────────────
 *   1. No file under `packages/server/supabase/functions/_shared/**`
 *      may import from a sibling function directory using a `../<dir>/`
 *      relative path. Imports inside `./` (the `_shared` dir itself)
 *      and `npm:` / `jsr:` / `https://` specifiers are fine.
 *
 *   2. No file under `packages/server/supabase/functions/<slug>/**`
 *      (where `<slug> != _shared`) may import from a DIFFERENT sibling
 *      function dir — e.g. `synthetic-monitor` reaching into `../api/`.
 *      Functions are deployed independently, so cross-function imports
 *      have the same missing-bundle-file risk.
 *
 * Run: node scripts/check-edge-fn-imports.mjs
 */

import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const FUNCTIONS_ROOT = resolve(
  ROOT,
  'packages/server/supabase/functions',
)

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return out
    throw err
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await walk(p)))
    else if (ent.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) out.push(p)
  }
  return out
}

// `import ... from '...'` and `import('...')` (dynamic). We only care about
// the relative-path string, not the names imported.
const STATIC_IMPORT_RE = /^\s*(?:import|export)\s+(?:[^'"`]+from\s+)?['"]([^'"`\n]+)['"]/gm
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"`\n]+)['"]\s*\)/g

function* extractImports(src) {
  for (const m of src.matchAll(STATIC_IMPORT_RE)) yield m[1]
  for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) yield m[1]
}

/**
 * Resolve `spec` as it would appear from a file inside `fnDir`.
 * Returns the relative path under FUNCTIONS_ROOT if it does land there,
 * or null if the import escapes the functions tree (deno std, npm:, etc).
 */
function resolveImport(fileAbs, spec) {
  if (!spec.startsWith('.')) return null
  const fileDir = resolve(fileAbs, '..')
  const target = resolve(fileDir, spec)
  if (!target.startsWith(FUNCTIONS_ROOT + sep) && target !== FUNCTIONS_ROOT) {
    return null
  }
  return relative(FUNCTIONS_ROOT, target).split(sep).join('/')
}

function topLevelDir(rel) {
  const idx = rel.indexOf('/')
  return idx === -1 ? rel : rel.slice(0, idx)
}

async function main() {
  const violations = []
  let entries
  try {
    entries = await readdir(FUNCTIONS_ROOT, { withFileTypes: true })
  } catch (err) {
    console.error(`error reading ${FUNCTIONS_ROOT}: ${err.message}`)
    process.exit(2)
  }
  const fnDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  for (const fnName of fnDirs) {
    const fnAbs = join(FUNCTIONS_ROOT, fnName)
    const files = await walk(fnAbs)
    for (const fileAbs of files) {
      const src = readFileSync(fileAbs, 'utf8')
      const fileRel = relative(FUNCTIONS_ROOT, fileAbs).split(sep).join('/')
      for (const spec of extractImports(src)) {
        const resolved = resolveImport(fileAbs, spec)
        if (!resolved) continue
        const targetTopDir = topLevelDir(resolved)
        if (targetTopDir === fnName) continue
        if (targetTopDir === '_shared' && fnName !== '_shared') continue
        // Otherwise: cross-function or _shared → sibling function
        violations.push({
          file: fileRel,
          spec,
          resolved,
          fromFn: fnName,
          toFn: targetTopDir,
        })
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      'edge-fn imports OK: no _shared/ → sibling-function or cross-function relative imports',
    )
    process.exit(0)
  }

  console.error('edge-fn import guard FAILED')
  console.error('')
  console.error(
    'A Supabase Edge Function deploy bundle ships only `<function>/` plus `_shared/`.',
  )
  console.error(
    'Cross-function relative imports (or `_shared/` reaching into a sibling function) leave',
  )
  console.error(
    'imports unresolved at deploy time and the platform rejects with a misleading HTTP 400.',
  )
  console.error('')
  console.error('Violations:')
  for (const v of violations) {
    console.error(
      `  ${v.file}\n    imports '${v.spec}'\n    -> ${v.resolved} (in '${v.toFn}/')`,
    )
  }
  console.error('')
  console.error(
    'Fix: move the imported helper into `_shared/` (or inline it into the calling function).',
  )
  process.exit(1)
}

main().catch((err) => {
  console.error('unexpected:', err)
  process.exit(2)
})
