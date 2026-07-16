/**
 * FILE: scripts/check-humanize-parity.mjs
 * PURPOSE: Fail when admin humanizeFixError.ts and server humanize-error.ts
 *          drift (category matchers / titles). Part of `pnpm check:drift`.
 *
 * Usage: node scripts/check-humanize-parity.mjs [--check]
 * Without --check, prints a short summary and exits 0.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const adminPath = resolve(root, 'apps/admin/src/lib/humanizeFixError.ts')
const serverPath = resolve(
  root,
  'packages/server/supabase/functions/_shared/humanize-error.ts',
)

function extractTitles(src) {
  const titles = []
  const re = /title:\s*`([^`]+)`|title:\s*'([^']+)'|title:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(src))) {
    titles.push(m[1] ?? m[2] ?? m[3])
  }
  return titles
}

function extractCategories(src) {
  const cats = new Set()
  const re = /category\s*===\s*'([a-z0-9_]+)'/g
  let m
  while ((m = re.exec(src))) cats.add(m[1])
  return [...cats].sort()
}

const admin = readFileSync(adminPath, 'utf8')
const server = readFileSync(serverPath, 'utf8')
const adminTitles = extractTitles(admin)
const serverTitles = extractTitles(server)
const adminCats = extractCategories(admin)
const serverCats = extractCategories(server)

const missingOnServer = adminTitles.filter((t) => !serverTitles.includes(t))
const missingOnAdmin = serverTitles.filter((t) => !adminTitles.includes(t))
const catMissingOnServer = adminCats.filter((c) => !serverCats.includes(c))
const catMissingOnAdmin = serverCats.filter((c) => !adminCats.includes(c))

const ok =
  missingOnServer.length === 0 &&
  missingOnAdmin.length === 0 &&
  catMissingOnServer.length === 0 &&
  catMissingOnAdmin.length === 0

if (!ok) {
  console.error('humanizeFixError parity check FAILED')
  if (missingOnServer.length) console.error('  titles missing on server:', missingOnServer)
  if (missingOnAdmin.length) console.error('  titles missing on admin:', missingOnAdmin)
  if (catMissingOnServer.length) console.error('  categories missing on server:', catMissingOnServer)
  if (catMissingOnAdmin.length) console.error('  categories missing on admin:', catMissingOnAdmin)
  process.exit(1)
}

console.log(
  `humanizeFixError parity OK (${adminTitles.length} titles, ${adminCats.length} categories)`,
)
