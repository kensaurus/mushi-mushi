#!/usr/bin/env node
/**
 * Copy published JSON Schema $id payloads to apps/docs/public/schemas/
 * so https://kensaur.us/mushi-mushi/schemas/*.json resolves after docs deploy.
 *
 *   node scripts/sync-public-schemas.mjs
 *   node scripts/sync-public-schemas.mjs --check
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'apps/docs/public/schemas')
const checkMode = process.argv.includes('--check')

const { inventoryJsonSchema } = await import(
  pathToFileURL(join(ROOT, 'packages/inventory-schema/src/json-schema.ts')).href
)
const agents = await import(pathToFileURL(join(ROOT, 'packages/agents/src/schemas.ts')).href)

const files = new Map([
  ['inventory-2.0.json', inventoryJsonSchema],
  ['expected-outcome-2.0.json', agents.EXPECTED_OUTCOME_JSON_SCHEMA],
  ['fix-context-2.0.json', agents.FIX_CONTEXT_JSON_SCHEMA],
  ['fix-result-2.0.json', agents.FIX_RESULT_JSON_SCHEMA],
  ['sandbox-provider-2.0.json', agents.SANDBOX_PROVIDER_JSON_SCHEMA],
])

mkdirSync(OUT_DIR, { recursive: true })

let drift = 0
for (const [name, schema] of files) {
  const dest = join(OUT_DIR, name)
  const next = `${JSON.stringify(schema, null, 2)}\n`
  if (checkMode) {
    if (!existsSync(dest) || readFileSync(dest, 'utf8') !== next) {
      console.error(`FAIL  ${dest} stale — run node scripts/sync-public-schemas.mjs`)
      drift++
    }
    continue
  }
  writeFileSync(dest, next, 'utf8')
  console.log('wrote', name)
}

if (checkMode) {
  if (drift) process.exit(1)
  console.log(`public schemas OK (${files.size} files)`)
}
