#!/usr/bin/env node
/**
 * check-migration-catalog-sync.mjs
 *
 * Migration Hub Phase 2 release gate. The Migration Hub is fronted by FOUR
 * places that each maintain their own copy of the migration-guide slug list:
 *
 *   1. apps/docs/content/migrations/_catalog.ts                       (CATALOG entries)
 *   2. packages/cli/src/migrate.ts                                    (MIGRATE_CATALOG)
 *   3. packages/server/supabase/functions/api/migration-progress-helpers.ts
 *      (KNOWN_GUIDE_SLUGS, used by the Hono progress endpoints)
 *   4. apps/admin/src/lib/migrationsCatalog.ts                        (MIGRATIONS_CATALOG,
 *      used by the MigrationsInProgressCard slug → title lookup)
 *
 * INVARIANTS ENFORCED
 *   - DOCS_ALL = every entry in apps/docs/content/migrations/_catalog.ts.
 *   - DOCS_PUBLISHED = the subset with `status: 'published'`.
 *   - API_SLUGS == DOCS_ALL.    (Sync should accept progress writes for any
 *     guide we ship, including drafts — a draft author wants their progress
 *     to survive a refresh too.)
 *   - ADMIN_SLUGS == DOCS_ALL.  (The MigrationsInProgressCard renders every
 *     guide that could possibly arrive in /v1/admin/migrations/progress.)
 *   - CLI_SLUGS ⊆ DOCS_PUBLISHED.  (CLI only suggests detectable AND
 *     published guides — drafts shouldn't surface in `mushi migrate`.)
 *
 * Adding a guide in one but not the others used to ship as a docs-only
 * change that the CLI silently ignored / the API rejected with
 * UNKNOWN_GUIDE_SLUG / the admin card rendered as a bare slug. This script
 * compares the four lists and fails CI if any invariant is violated.
 *
 * Exit codes:
 *   0 → all four lists agree under the invariants above.
 *   1 → drift detected; the report points at the exact missing/extra slug.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()

const FILES = {
  docs: 'apps/docs/content/migrations/_catalog.ts',
  cli: 'packages/cli/src/migrate.ts',
  api: 'packages/server/supabase/functions/api/migration-progress-helpers.ts',
  admin: 'apps/admin/src/lib/migrationsCatalog.ts',
}

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

const SLUG_RE = /\bslug:\s*['"]([a-z0-9][a-z0-9-]{0,79})['"]/g

function extractPropertySlugs(source) {
  const found = new Set()
  for (const match of source.matchAll(SLUG_RE)) found.add(match[1])
  return found
}

/**
 * Pull every quoted slug-shaped string from a record/array literal whose
 * declaration line matches `declarationName`. The CLI catalog programmatically
 * spreads `COMPETITOR_PACKAGES` into MIGRATE_CATALOG, so the slugs only
 * appear as object keys in COMPETITOR_PACKAGES, not as `slug: '...'` props
 * — extractPropertySlugs alone misses them.
 */
function extractFromNamedLiteral(source, declarationName) {
  const re = new RegExp(
    `(?:const|let|var)\\s+${declarationName}[^=]*=\\s*(?<body>[\\s\\S]*?)(?:\\}|\\])\\s*[;\\n]`,
    'm',
  )
  const m = source.match(re)
  if (!m?.groups?.body) return new Set()
  const found = new Set()
  for (const item of m.groups.body.matchAll(/['"]([a-z0-9][a-z0-9-]{0,79})['"]\s*:/g)) {
    found.add(item[1])
  }
  return found
}

function extractFromArrayLiteral(source, exportName) {
  const re = new RegExp(
    `export const ${exportName}[^=]*=\\s*\\[(?<body>[\\s\\S]*?)\\]`,
    'm',
  )
  const m = source.match(re)
  if (!m?.groups?.body) return new Set()
  const found = new Set()
  for (const item of m.groups.body.matchAll(/['"]([a-z0-9][a-z0-9-]{0,79})['"]/g)) {
    found.add(item[1])
  }
  return found
}

function extractDocsCatalog(source) {
  const all = new Set()
  const published = new Set()
  // Each entry is rendered as a `{ ... }` literal carrying both a slug and
  // a status. The pattern intentionally doesn't try to balance braces
  // (which JS regex can't do); instead it captures slug + the status that
  // appears closest after it inside the same literal.
  const entryRe = /\{\s*slug:\s*['"]([a-z0-9][a-z0-9-]{0,79})['"][\s\S]*?\bstatus:\s*['"]([a-z]+)['"]/g
  for (const m of source.matchAll(entryRe)) {
    const [, slug, status] = m
    all.add(slug)
    if (status === 'published') published.add(slug)
  }
  return { all, published }
}

const docsSource = read(FILES.docs)
const cliSource = read(FILES.cli)
const apiSource = read(FILES.api)
const adminSource = read(FILES.admin)

const docs = extractDocsCatalog(docsSource)
// CLI catalog union: explicit `slug: '...'` properties on MigrateGuide
// objects, plus the COMPETITOR_PACKAGES keys that get spread in via
// `...Object.entries(COMPETITOR_PACKAGES).map(...)`. Both shapes count as
// "the CLI knows about this slug".
const cli = new Set([
  ...extractPropertySlugs(cliSource),
  ...extractFromNamedLiteral(cliSource, 'COMPETITOR_PACKAGES'),
])
const api = extractFromArrayLiteral(apiSource, 'KNOWN_GUIDE_SLUGS')
const admin = extractPropertySlugs(adminSource)

if (docs.all.size === 0) {
  console.error(
    'check-migration-catalog-sync: extracted 0 slugs from the docs catalog. ' +
      'Did the file shape change? Update the regex in this script.',
  )
  process.exit(1)
}

const issues = []

function diff(label, a, b, contextA, contextB) {
  const inAOnly = [...a].filter((s) => !b.has(s)).sort()
  const inBOnly = [...b].filter((s) => !a.has(s)).sort()
  if (inAOnly.length === 0 && inBOnly.length === 0) return
  issues.push({ label, contextA, contextB, inAOnly, inBOnly })
}

// API_SLUGS == DOCS_ALL
diff(
  'api ≠ docs (API allowlist must include every docs catalog entry, including drafts)',
  api,
  docs.all,
  `${FILES.api} (KNOWN_GUIDE_SLUGS)`,
  `${FILES.docs} (CATALOG)`,
)

// ADMIN_SLUGS == DOCS_ALL
diff(
  'admin ≠ docs (admin card catalog must include every docs catalog entry, including drafts)',
  admin,
  docs.all,
  `${FILES.admin} (MIGRATIONS_CATALOG)`,
  `${FILES.docs} (CATALOG)`,
)

// CLI ⊆ DOCS_PUBLISHED — only flag CLI entries that aren't published.
const cliExtras = [...cli].filter((s) => !docs.published.has(s)).sort()
if (cliExtras.length > 0) {
  issues.push({
    label: 'cli has slugs that are not published in docs',
    contextA: `${FILES.cli} (MIGRATE_CATALOG)`,
    contextB: `${FILES.docs} (CATALOG, status: 'published' only)`,
    inAOnly: cliExtras,
    inBOnly: [],
  })
}

if (issues.length === 0) {
  console.log(
    `check-migration-catalog-sync: ✓ docs (${docs.all.size} total / ${docs.published.size} published), ` +
      `cli (${cli.size}), api (${api.size}), admin (${admin.size}) all agree under the sync invariants.`,
  )
  process.exit(0)
}

console.error('check-migration-catalog-sync: drift detected — slug sets disagree.\n')
for (const issue of issues) {
  console.error(`  ${issue.label}:`)
  if (issue.inAOnly.length > 0) {
    console.error(`    only in ${issue.contextA}:`)
    for (const s of issue.inAOnly) console.error(`      - ${s}`)
  }
  if (issue.inBOnly.length > 0) {
    console.error(`    only in ${issue.contextB}:`)
    for (const s of issue.inBOnly) console.error(`      - ${s}`)
  }
}
console.error('\nFix: update the file(s) above so the lists agree.')
process.exit(1)
