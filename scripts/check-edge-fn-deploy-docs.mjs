#!/usr/bin/env node
/**
 * Fail when self-host docs deploy a function name that is not a directory
 * under packages/server/supabase/functions/ (excl. _shared).
 *
 * Scans:
 *   - apps/docs/content/self-hosting/edge-functions.mdx
 *   - SELF_HOSTED.md
 *
 *   pnpm check:edge-fn-deploy-docs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FUNCTIONS_DIR = path.join(ROOT, 'packages/server/supabase/functions')

const DOC_FILES = [
  'apps/docs/content/self-hosting/edge-functions.mdx',
  'SELF_HOSTED.md',
]

const DEPLOY_RE = /supabase\s+functions\s+deploy\s+([a-z0-9][a-z0-9_-]*)/gi

function listFunctionDirs() {
  return new Set(
    readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '_shared')
      .map((d) => d.name),
  )
}

const known = listFunctionDirs()
const failures = []

for (const rel of DOC_FILES) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) {
    failures.push(`missing doc file: ${rel}`)
    continue
  }
  const source = readFileSync(abs, 'utf8')
  DEPLOY_RE.lastIndex = 0
  let match
  const seen = new Set()
  while ((match = DEPLOY_RE.exec(source)) !== null) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    if (!known.has(name)) {
      failures.push(`${rel}: deploy target "${name}" is not a functions/ directory`)
    }
  }
}

if (failures.length > 0) {
  console.error('✗ edge-fn-deploy-docs: phantom or mistyped function deploys:\n')
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    `\nKnown functions (${known.size}): run \`ls packages/server/supabase/functions\` or \`pnpm docs-stats\`.`,
  )
  process.exit(1)
}

console.log(
  `✓ edge-fn-deploy-docs: deploy names in ${DOC_FILES.length} docs match ${known.size} on-disk functions`,
)
