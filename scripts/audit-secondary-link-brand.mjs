#!/usr/bin/env node
/**
 * Ensures secondary inline links use accent hue (LINK_ACCENT), not brand.
 * Primary Btn / brand chips / switcher CTAs are out of scope.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC = 'apps/admin/src'

const PATTERNS = [
  'text-brand hover:underline',
  'text-brand hover:text-brand-hover',
]

const hits = []
for (const pattern of PATTERNS) {
  try {
    const out = execSync(
      `rg -n --glob "*.tsx" -F "${pattern}" "${SRC}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    if (out) hits.push(out)
  } catch {
    // rg exit 1 = no matches
  }
}

if (hits.length > 0) {
  console.error('audit-secondary-link-brand: FAIL — demote to LINK_ACCENT (text-accent-foreground hover:text-accent …)\n')
  console.error(hits.join('\n\n'))
  process.exit(1)
}

console.log('audit-secondary-link-brand: OK (0 hits)')
