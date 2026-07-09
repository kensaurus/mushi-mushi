#!/usr/bin/env node
/**
 * Operator pages must use Btn — no raw <button> in apps/admin/src/pages.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PAGES = 'apps/admin/src/pages'

let buttonHits = ''
let legacyBtnHits = ''
try {
  buttonHits = execSync(`rg -n '<button' "${PAGES}" --glob "*.tsx"`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
} catch {
  buttonHits = ''
}
try {
  legacyBtnHits = execSync(`rg -n 'className="btn ' "${PAGES}" --glob "*.tsx"`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
} catch {
  legacyBtnHits = ''
}

const problems = [buttonHits, legacyBtnHits].filter(Boolean)
if (problems.length > 0) {
  console.error('audit-raw-button-in-pages: FAIL — use Btn from components/ui\n')
  console.error(problems.join('\n\n'))
  process.exit(1)
}

console.log('audit-raw-button-in-pages: OK (0 hits)')
