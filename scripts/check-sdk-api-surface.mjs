#!/usr/bin/env node
/**
 * Fail CI when published SDK docs drift from the shipped web package surface.
 *
 *   pnpm check:sdk-api-surface
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const WEB_INDEX = path.join(ROOT, 'packages/web/src/index.ts')
const DOC_PATHS = [
  'apps/docs/content/sdks/web.mdx',
  'apps/docs/content/quickstart/web.mdx',
  'packages/web/README.md',
]

const BANNED = [
  { pattern: /import\s*\{\s*initMushi\s*\}/, message: 'phantom initMushi import' },
  { pattern: /\binitMushi\s*\(/, message: 'phantom initMushi() call — use Mushi.init()' },
  { pattern: /onProactiveTrigger/, message: 'phantom onProactiveTrigger' },
  { pattern: /onBeforeSubmit/, message: 'phantom onBeforeSubmit — use beforeSendFeedback' },
  { pattern: /flushOfflineQueueNow/, message: 'phantom flushOfflineQueueNow — offline sync is automatic' },
]

const REQUIRED = [
  { pattern: /Mushi\.init\s*\(/, message: 'document Mushi.init() as the canonical bootstrap' },
]

function read(rel) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf8')
}

const failures = []

const webIndex = read('packages/web/src/index.ts')
if (!webIndex?.includes("export { Mushi }")) {
  failures.push({
    file: 'packages/web/src/index.ts',
    message: 'expected `export { Mushi }` — update this check if the entry export changes',
  })
}

for (const rel of DOC_PATHS) {
  const text = read(rel)
  if (!text) {
    failures.push({ file: rel, message: 'file missing' })
    continue
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of BANNED) {
      if (rule.pattern.test(line)) {
        failures.push({
          file: rel,
          line: i + 1,
          message: rule.message,
          text: line.trim(),
        })
      }
    }
  }
  const hasRequired = REQUIRED.some((r) => r.pattern.test(text))
  if (!hasRequired) {
    failures.push({
      file: rel,
      message: REQUIRED.map((r) => r.message).join('; '),
    })
  }
}

if (failures.length === 0) {
  console.log('✓ sdk-api-surface: web docs match packages/web exports')
  process.exit(0)
}

console.error(`\n✗ sdk-api-surface: ${failures.length} issue(s)\n`)
for (const f of failures) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}`)
  console.error(`    ${f.message}`)
  if (f.text) console.error(`    ${f.text}\n`)
}
process.exit(1)
