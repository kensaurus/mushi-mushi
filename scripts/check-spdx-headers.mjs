#!/usr/bin/env node
/**
 * FILE: scripts/check-spdx-headers.mjs
 * PURPOSE: Verify that every published-package entry point carries an SPDX
 *          license identifier comment, making attribution explicit in every copy.
 *
 * USAGE:
 *   node scripts/check-spdx-headers.mjs   # exits 0 = pass, 1 = fail
 *
 * NOTES:
 *   Called from CI (ci.yml). Only checks src/index.ts of workspace packages
 *   that have "publishConfig" set (i.e. packages that ship to npm).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const SPDX_RE = /^\s*\/\/\s*SPDX-License-Identifier:/m

let failed = 0
let checked = 0

for (const name of readdirSync(PACKAGES_DIR)) {
  const manifest = join(PACKAGES_DIR, name, 'package.json')
  if (!existsSync(manifest)) continue

  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    continue
  }

  // Only check publishable packages.
  if (!pkg.publishConfig) continue

  const entry = join(PACKAGES_DIR, name, 'src', 'index.ts')
  if (!existsSync(entry)) continue

  checked++
  const src = readFileSync(entry, 'utf8')
  if (!SPDX_RE.test(src)) {
    console.error(`MISSING SPDX header: packages/${name}/src/index.ts`)
    failed++
  }
}

if (failed === 0) {
  console.log(
    `check:spdx-headers — ${checked} entry point(s) checked, all have SPDX identifiers ✓`
  )
  process.exit(0)
} else {
  console.error(
    `\ncheck:spdx-headers — ${failed}/${checked} entry point(s) are missing an SPDX header.`
  )
  console.error(
    'Add "// SPDX-License-Identifier: MIT" (or AGPL-3.0-only for server/agents/verify) as the first line of src/index.ts.'
  )
  process.exit(1)
}
