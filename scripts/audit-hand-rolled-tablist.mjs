#!/usr/bin/env node
/**
 * Flags hand-rolled role="tablist" outside the canonical TabbedSubNav primitive.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC = 'apps/admin/src'

const ALLOWLIST = [
  'TabbedSubNav.tsx',
  'forms.tsx', // SegmentedControl uses radiogroup, not tablist — listed for safety
]

let out = ''
try {
  out = execSync(`rg -n 'role="tablist"' "${SRC}" --glob "*.tsx"`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
} catch {
  console.log('audit-hand-rolled-tablist: OK (0 hits)')
  process.exit(0)
}

const hits = out
  .split('\n')
  .filter((line) => line && !ALLOWLIST.some((f) => line.includes(f)))

if (hits.length > 0) {
  console.error('audit-hand-rolled-tablist: FAIL — use SegmentedControl or nav without tablist\n')
  console.error(hits.join('\n'))
  process.exit(1)
}

console.log('audit-hand-rolled-tablist: OK (0 hits)')
