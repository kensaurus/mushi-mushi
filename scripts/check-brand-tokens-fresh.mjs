#!/usr/bin/env node
/**
 * Regenerates editorial.css from brand.tokens.json and fails if git would change.
 */

import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = join(ROOT, 'packages/brand/src/editorial.css')

execSync('pnpm --filter @mushi-mushi/brand build:tokens', { cwd: ROOT, stdio: 'inherit' })

try {
  execSync(`git diff --exit-code "${CSS}"`, { cwd: ROOT, stdio: 'pipe' })
  console.log('[ok] brand editorial.css is fresh')
} catch {
  console.error('[fail] packages/brand/src/editorial.css is stale — run pnpm build:brand-tokens and commit')
  process.exit(1)
}
