#!/usr/bin/env node
/**
 * sync-sdk-versions.mjs
 *
 * Called by release.yml after a successful `changeset publish` to upsert
 * the newly-published package versions into the `sdk_versions` database
 * table. This keeps the admin console's "SDK upgrade available" freshness
 * chips accurate without requiring a hand-authored migration for every
 * release.
 *
 * INPUTS (env vars):
 *   PUBLISHED               — JSON array of { name, version } (from
 *                             changesets/action `publishedPackages` output)
 *   SUPABASE_PROJECT_REF    — Supabase project ref (e.g. dxptnwrhwsqckaftyymj)
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key for the REST API write
 *
 * EXIT CODE:
 *   0 — all versions upserted (or nothing to do)
 *   1 — missing env / HTTP error
 */

const PUBLISHED_RAW = process.env.PUBLISHED ?? ''
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!PROJECT_REF || !SERVICE_ROLE_KEY) {
  console.error(
    'sync-sdk-versions: SUPABASE_PROJECT_REF and SUPABASE_SERVICE_ROLE_KEY must be set.',
  )
  process.exit(1)
}

if (!PUBLISHED_RAW.trim()) {
  console.log('sync-sdk-versions: nothing published (PUBLISHED is empty) — skipping.')
  process.exit(0)
}

let published
try {
  published = JSON.parse(PUBLISHED_RAW)
} catch {
  console.error('sync-sdk-versions: could not parse PUBLISHED JSON:', PUBLISHED_RAW.slice(0, 200))
  process.exit(1)
}

// Only sync @mushi-mushi/* packages.
const MUSHI_PACKAGES = new Set([
  '@mushi-mushi/core',
  '@mushi-mushi/web',
  '@mushi-mushi/react',
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/react-native',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/cli',
  '@mushi-mushi/mcp',
  '@mushi-mushi/node',
])

const rows = published
  .filter((p) => MUSHI_PACKAGES.has(p.name))
  .map((p) => ({
    package: p.name,
    version: p.version,
    deprecated: false,
    released_at: new Date().toISOString(),
  }))

if (rows.length === 0) {
  console.log('sync-sdk-versions: no @mushi-mushi/* packages in the publish batch — skipping.')
  process.exit(0)
}

console.log(`sync-sdk-versions: upserting ${rows.length} package(s) into sdk_versions:`)
for (const r of rows) {
  console.log(`  ${r.package}@${r.version}`)
}

const url = `https://${PROJECT_REF}.supabase.co/rest/v1/sdk_versions`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  },
  body: JSON.stringify(rows),
})

if (!res.ok) {
  const body = await res.text().catch(() => '(no body)')
  console.error(`sync-sdk-versions: Supabase upsert failed ${res.status}: ${body.slice(0, 300)}`)
  process.exit(1)
}

console.log(`sync-sdk-versions: ok — ${rows.length} version(s) recorded.`)
