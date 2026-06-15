#!/usr/bin/env node
/**
 * Catalog drift guard — validates that:
 *
 *  1. Every tool in the hosted HTTP MCP (packages/server/supabase/functions/mcp/index.ts)
 *     exists in the canonical stdio catalog (packages/mcp/src/catalog.ts) with the same
 *     scope. Tools in the hosted server that are absent from, or have a different scope
 *     in, the canonical catalog are a hard failure.
 *
 *  2. Every tool in the admin's local catalog copy (apps/admin/src/lib/mcpCatalog.ts)
 *     also exists in the canonical catalog with the same scope. Tools that exist in the
 *     admin copy but NOT in the canonical catalog are a hard failure (they need to be
 *     added to the canonical, or removed from admin). Tools in the canonical that are
 *     missing from the admin copy are reported as warnings.
 *
 * Run: `node packages/mcp/scripts/check-catalog-sync.mjs`
 *
 * Exit 0 = clean; Exit 1 = hard failures found.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract { name, scope } pairs from a TypeScript catalog file using a
 * sequential line-scan: when we see `name: 'foo'` and later `scope: 'mcp:x'`
 * before the next name, pair them together. Handles multi-line objects.
 */
function extractEntries(content) {
  const entries = []
  let pendingName = null
  for (const line of content.split('\n')) {
    const nameMatch = line.match(/name:\s*'([^']+)'/)
    if (nameMatch) {
      pendingName = nameMatch[1]
    }
    const scopeMatch = line.match(/scope:\s*'(mcp:\w+)'/)
    if (scopeMatch && pendingName) {
      entries.push({ name: pendingName, scope: scopeMatch[1] })
      pendingName = null
    }
  }
  return entries
}

/**
 * Extract tool { name, scope } from the hosted TOOLS record.
 * Each entry looks like:
 *   tool_name: {
 *     scope: 'mcp:read',
 */
function extractHostedTools(content) {
  const toolsSection = content.split('const TOOLS')[1]?.split('function handleInitialize')[0] ?? ''
  const entries = []
  let pendingName = null
  for (const line of toolsSection.split('\n')) {
    const nameMatch = line.match(/^  ([a-z_]+):\s*\{/)
    if (nameMatch) {
      pendingName = nameMatch[1]
    }
    const scopeMatch = line.match(/scope:\s*'(mcp:\w+)'/)
    if (scopeMatch && pendingName) {
      entries.push({ name: pendingName, scope: scopeMatch[1] })
      pendingName = null
    }
  }
  return entries
}

// ─── Load files ──────────────────────────────────────────────────────────────

const canonicalContent = read('packages/mcp/src/catalog.ts')
const adminContent = read('apps/admin/src/lib/mcpCatalog.ts')
const hostedContent = read('packages/server/supabase/functions/mcp/index.ts')

const canonicalEntries = extractEntries(canonicalContent)
const canonicalMap = new Map(canonicalEntries.map((t) => [t.name, t.scope]))

const adminEntries = extractEntries(adminContent)
const adminMap = new Map(adminEntries.map((t) => [t.name, t.scope]))

const hostedTools = extractHostedTools(hostedContent)

// ─── Checks ──────────────────────────────────────────────────────────────────

let hardFails = 0
let warnings = 0

function fail(msg) {
  console.error(`❌ FAIL: ${msg}`)
  hardFails++
}

function warn(msg) {
  console.warn(`⚠️  WARN: ${msg}`)
  warnings++
}

function info(msg) {
  process.stdout.write(`   ${msg}\n`)
}

console.log(`\n── Catalog counts ──────────────────────────────────────────────────────────`)
console.log(`   Canonical (packages/mcp/src/catalog.ts): ${canonicalEntries.length} entries`)
console.log(`   Admin copy (apps/admin/src/lib/mcpCatalog.ts): ${adminEntries.length} entries`)
console.log(`   Hosted MCP (packages/server/supabase/functions/mcp/index.ts): ${hostedTools.length} tools`)

// CHECK 1: Hosted tools must exist in canonical catalog with matching scope
console.log(`\n── Check 1: Hosted MCP ⊆ Canonical catalog ────────────────────────────────`)
let hostedOk = 0
for (const hosted of hostedTools) {
  const canonicalScope = canonicalMap.get(hosted.name)
  if (canonicalScope === undefined) {
    fail(`Hosted tool "${hosted.name}" not in canonical catalog — add it to TOOL_CATALOG or TDD_TOOL_CATALOG in packages/mcp/src/catalog.ts`)
  } else if (canonicalScope !== hosted.scope) {
    fail(`Hosted "${hosted.name}": scope mismatch — hosted="${hosted.scope}", canonical="${canonicalScope}"`)
  } else {
    hostedOk++
  }
}
if (hostedOk > 0) info(`${hostedOk} hosted tools match canonical catalog`)

// Informational: canonical entries not in hosted (expected — hosted is a subset)
const canonicalNotInHosted = canonicalEntries.filter((t) => !hostedTools.find((h) => h.name === t.name))
if (canonicalNotInHosted.length > 0) {
  info(`${canonicalNotInHosted.length} canonical entries not yet in hosted MCP (hosted is a subset — this is expected)`)
}

// CHECK 2: Admin catalog must not have entries absent from canonical
console.log(`\n── Check 2: Admin copy ⊆ Canonical catalog ────────────────────────────────`)
let adminOk = 0
for (const admin of adminEntries) {
  const canonicalScope = canonicalMap.get(admin.name)
  if (canonicalScope === undefined) {
    fail(`Admin catalog has "${admin.name}" but canonical catalog does NOT — add to canonical or remove from admin`)
  } else if (canonicalScope !== admin.scope) {
    fail(`Admin "${admin.name}": scope mismatch — admin="${admin.scope}", canonical="${canonicalScope}"`)
  } else {
    adminOk++
  }
}
if (adminOk > 0) info(`${adminOk} admin entries match canonical catalog`)

// Informational: canonical entries not in admin (admin is intentionally a subset)
const canonicalNotInAdmin = canonicalEntries.filter((t) => !adminMap.has(t.name))
if (canonicalNotInAdmin.length > 0) {
  warn(`${canonicalNotInAdmin.length} canonical entries not mirrored in admin mcpCatalog.ts (admin is intentionally a subset — update admin when the MCP page should show new tools):`)
  for (const t of canonicalNotInAdmin) {
    process.stderr.write(`   - ${t.name}\n`)
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n── Summary ─────────────────────────────────────────────────────────────────`)
console.log(`   Hard failures: ${hardFails}`)
console.log(`   Warnings:      ${warnings}`)

if (hardFails > 0) {
  console.error(`\nFAIL — fix the ${hardFails} hard failure(s) above.\n`)
  process.exit(1)
}

console.log(`\nOK — catalog is consistent. ${warnings > 0 ? `${warnings} warnings to address over time.` : ''}\n`)
