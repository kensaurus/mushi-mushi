#!/usr/bin/env node
/**
 * check-migration-ledger.mjs
 *
 * Compares the migration files in packages/server/supabase/migrations with the
 * hosted project's ledger (supabase_migrations.schema_migrations). Read-only.
 *
 * Why: `supabase db push` decides what to run by version. A migration applied
 * any other way (the Supabase MCP `apply_migration` tool stamps the apply time,
 * supabase/mcp#241) is recorded under a version no file has, so the next push
 * refuses or offers a repair that can re-run SQL. Run this before every
 * `supabase db push` and after applying SQL by hand.
 *
 * Reports:
 *   - files the ledger has under another version (same name, different version)
 *   - ledger versions with no file (applied outside the repo)
 *   - files the ledger does not have (pending: expected before a push)
 * Exits 1 on the first two. Pending files alone exit 0.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=… node scripts/check-migration-ledger.mjs [--project-ref <ref>]
 *   (ref defaults to packages/server/supabase/.temp/project-ref, from `supabase link`)
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

const migrationsDir = resolve('packages/server/supabase/migrations')
const args = process.argv.slice(2)
const refArg = args.indexOf('--project-ref')
const refFile = resolve('packages/server/supabase/.temp/project-ref')
const ref =
  (refArg !== -1 && args[refArg + 1]) ||
  (existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : '')
const token = process.env.SUPABASE_ACCESS_TOKEN

if (!ref || !token) {
  console.error('Need SUPABASE_ACCESS_TOKEN and a project ref (--project-ref or `supabase link`).')
  process.exit(2)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'select version, coalesce(name, \'\') as name from supabase_migrations.schema_migrations',
    read_only: true,
  }),
})
if (!res.ok) {
  console.error(`Ledger query failed: HTTP ${res.status} ${await res.text()}`)
  process.exit(2)
}
/** @type {{ version: string; name: string }[]} */
const ledger = await res.json()

const stem = (s) => s.replace(/^\d{14}_/, '')
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, -4))
const fileVersions = new Set(files.map((f) => f.slice(0, 14)))
const ledgerVersions = new Set(ledger.map((r) => r.version))
const fileByStem = new Map(files.map((f) => [stem(f), f]))

const renamed = []
const ledgerOnly = []
for (const row of ledger) {
  if (fileVersions.has(row.version)) continue
  const file = fileByStem.get(stem(row.name))
  if (file && !ledgerVersions.has(file.slice(0, 14))) renamed.push({ row, file })
  else ledgerOnly.push(row)
}
const renamedFiles = new Set(renamed.map((r) => r.file))
const pending = files.filter((f) => !ledgerVersions.has(f.slice(0, 14)) && !renamedFiles.has(f))

for (const { row, file } of renamed) {
  console.log(`RENAMED  ledger ${row.version} (${row.name}) is file ${file}.sql`)
  console.log(`         fix: supabase migration repair --status applied ${file.slice(0, 14)} && supabase migration repair --status reverted ${row.version}`)
}
for (const row of ledgerOnly) console.log(`NO FILE  ledger ${row.version} ${row.name}: add a forward migration that replays it, then repair it as reverted`)
for (const f of pending) console.log(`PENDING  ${f}.sql (not applied yet)`)

console.log(
  `\n${ledger.length} ledger rows, ${files.length} files: ${renamed.length} renamed, ${ledgerOnly.length} without a file, ${pending.length} pending`,
)
process.exit(renamed.length || ledgerOnly.length ? 1 : 0)
