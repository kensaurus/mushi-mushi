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
 *  3. The hosted UNTRUSTED_TOOLS set names exactly the catalog tools flagged
 *     `returnsUntrusted`, so both transports wrap the same results.
 *
 *  4. Every /v1/ API path either server (or the hosted manifest) calls is a
 *     route the api function registers.
 *
 *  5. Both transports share one feature map that covers every tool (and only tools).
 *
 *  6. Server instructions and the use_mushi intents match across transports.
 *
 *  7. Hosted tools take title, description, annotations, input and output
 *     schemas from the generated catalog copy (no hand-declared metadata), and
 *     the shared arg-aliases.ts / report-shapes.ts are byte-identical.
 *
 * Run: `node packages/mcp/scripts/check-catalog-sync.mjs`
 *
 * Exit 0 = clean; Exit 1 = hard failures found.
 */

import { readdirSync, readFileSync } from 'node:fs'
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
  const toolsSection =
    content.split('const BASE_TOOLS')[1]?.split('/** Full catalog')[0] ??
    content.split('const TOOLS')[1]?.split('function handleInitialize')[0] ??
    ''
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
// Bug fix (production-readiness audit): this used to read
// `mcp/hosted-tool-manifest.json`, a stale duplicate that was never wired
// into the hosted server. The manifest `buildManifestTools()` actually
// loads at runtime lives under `_shared/`. Reading the wrong file meant
// this drift guard silently never caught real scope/count mismatches.
const manifestContent = read('packages/server/supabase/functions/_shared/mcp-hosted-tool-manifest.json')

const canonicalEntries = extractEntries(canonicalContent)
const canonicalMap = new Map(canonicalEntries.map((t) => [t.name, t.scope]))

/** RESOURCE_CATALOG names — MCP resources on both transports, never hosted tools. */
const resourceNames = new Set(
  [...(canonicalContent.split('export const RESOURCE_CATALOG')[1]?.split('\n];')[0] ?? '').matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]),
)
/** Tool names across TOOL_CATALOG, TDD_TOOL_CATALOG and CODEBASE_TOOL_CATALOG. */
const canonicalToolNames = new Set(
  ['TOOL_CATALOG', 'TDD_TOOL_CATALOG', 'CODEBASE_TOOL_CATALOG'].flatMap((anchor) =>
    [...(canonicalContent.split(`export const ${anchor}: ToolSpec[] = [`)[1]?.split('\n];')[0] ?? '').matchAll(/^ {4}name:\s*'([^']+)'/gm)].map((m) => m[1]),
  ),
)

const adminReexportsCanonical =
  /from\s+['"]@mushi-mushi\/mcp\/catalog['"]/.test(adminContent)
const adminEntries = adminReexportsCanonical ? canonicalEntries : extractEntries(adminContent)
const adminMap = new Map(adminEntries.map((t) => [t.name, t.scope]))

const hostedTools = (() => {
  const byName = new Map()
  for (const t of extractHostedTools(hostedContent)) byName.set(t.name, t)
  for (const [name, def] of Object.entries(JSON.parse(manifestContent))) {
    if (!byName.has(name)) byName.set(name, { name, scope: def.scope })
  }
  return [...byName.values()]
})()

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
const strictFullParity = process.argv.includes('--strict-full-parity')
let hostedOk = 0
for (const hosted of hostedTools) {
  const canonicalScope = canonicalMap.get(hosted.name)
  if (canonicalScope === undefined) {
    fail(`Hosted tool "${hosted.name}" not in canonical catalog — add it to TOOL_CATALOG or TDD_TOOL_CATALOG in packages/mcp/src/catalog.ts`)
  } else if (!canonicalToolNames.has(hosted.name)) {
    // project_dashboard & co. were hosted tools until 2026-09-22 while stdio
    // served them as resources; hosted serves them as resources too now.
    fail(`Hosted tool "${hosted.name}" is a RESOURCE_CATALOG resource, not a tool — serve it from mcp/hosted-resources.ts, not the tool manifest`)
  } else if (canonicalScope !== hosted.scope) {
    fail(`Hosted "${hosted.name}": scope mismatch — hosted="${hosted.scope}", canonical="${canonicalScope}"`)
  } else {
    hostedOk++
  }
}
if (hostedOk > 0) info(`${hostedOk} hosted tools match canonical catalog`)

// Informational: canonical tools not in hosted (expected unless --strict-full-parity).
// Resource-only names are excluded: they are resources on both transports.
const canonicalNotInHosted = canonicalEntries.filter(
  (t) => canonicalToolNames.has(t.name) && !hostedTools.find((h) => h.name === t.name),
)
if (canonicalNotInHosted.length > 0) {
  if (strictFullParity) {
    for (const t of canonicalNotInHosted) {
      fail(`Canonical tool "${t.name}" missing from hosted MCP — add to mcp/index.ts BASE_TOOLS or hosted-tool-manifest.json`)
    }
  } else {
    info(`${canonicalNotInHosted.length} canonical entries not yet in hosted MCP (hosted is a subset — this is expected)`)
  }
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

// Informational: canonical entries not in admin (subset allowed unless re-exporting canonical)
const canonicalNotInAdmin = canonicalEntries.filter((t) => !adminMap.has(t.name))
if (canonicalNotInAdmin.length > 0 && !adminReexportsCanonical) {
  warn(`${canonicalNotInAdmin.length} canonical entries not mirrored in admin mcpCatalog.ts (admin is intentionally a subset — update admin when the MCP page should show new tools):`)
  for (const t of canonicalNotInAdmin) {
    process.stderr.write(`   - ${t.name}\n`)
  }
} else if (adminReexportsCanonical) {
  info('Admin catalog re-exports @mushi-mushi/mcp/catalog (full parity)')
}

// CHECK 3: prompt-injection wrapping — one source of truth
// The stdio server wraps from the catalog's `returnsUntrusted` flag; the
// hosted server keeps its own UNTRUSTED_TOOLS set because the Deno bundle
// cannot import catalog.ts. The two must name exactly the same tools.
console.log(`\n── Check 3: Untrusted-output wrapping parity ───────────────────────────────`)
{
  const flagged = new Set()
  let pendingName = null
  for (const line of canonicalContent.split('\n')) {
    const nameMatch = line.match(/^ {4}name:\s*'([^']+)'/)
    if (nameMatch) pendingName = nameMatch[1]
    if (pendingName && /^ {4}returnsUntrusted:\s*true,/.test(line)) flagged.add(pendingName)
  }
  const hostedSetSource = hostedContent.match(/const UNTRUSTED_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1]
  if (!hostedSetSource) {
    fail('Could not find the UNTRUSTED_TOOLS set in packages/server/supabase/functions/mcp/index.ts')
  } else {
    const hostedSet = new Set([...hostedSetSource.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    for (const name of flagged) {
      if (!hostedSet.has(name)) fail(`"${name}" has returnsUntrusted in catalog.ts but the hosted UNTRUSTED_TOOLS set does not wrap it`)
    }
    for (const name of hostedSet) {
      if (!flagged.has(name)) fail(`Hosted UNTRUSTED_TOOLS wraps "${name}" but catalog.ts does not flag it returnsUntrusted`)
    }
    if (flagged.size > 0 && [...flagged].every((n) => hostedSet.has(n)) && hostedSet.size === flagged.size) {
      info(`${flagged.size} untrusted-output tools wrapped identically on both transports`)
    }
  }
}

// CHECK 4: every API path a tool calls is a route the api function registers
// Both servers proxy to the api function; a path with no handler 404s at
// runtime, and a tool that swallows that failure returns null forever
// (triage_issue shipped three such calls). Route literals are collected from
// the api sources directly, which also covers routes registered on a nested
// router the generated route manifest does not list.
console.log(`\n── Check 4: Tool API paths resolve to api routes ───────────────────────────`)
{
  /** String literals that start with /v1/ — `${…}` interpolations become a wildcard. */
  function v1Literals(source) {
    const out = []
    for (let i = 0; i < source.length; i++) {
      const quote = source[i]
      if ((quote !== "'" && quote !== '"' && quote !== '`') || !source.startsWith('/v1/', i + 1)) continue
      let j = i + 1
      let text = ''
      while (j < source.length && source[j] !== quote) {
        if (quote === '`' && source[j] === '$' && source[j + 1] === '{') {
          // Skip a (possibly nested) interpolation.
          let depth = 1
          j += 2
          while (j < source.length && depth > 0) {
            if (source[j] === '{') depth++
            else if (source[j] === '}') depth--
            j++
          }
          text += '\u0000'
          continue
        }
        text += source[j]
        j++
      }
      out.push(text)
      i = j
    }
    return out
  }
  const segmentsOf = (path) => path.split('?')[0].replace(/\/+$/, '').split('/').slice(1)

  const routesDir = resolve(ROOT, 'packages/server/supabase/functions/api')
  const routeSources = [
    read('packages/server/supabase/functions/api/index.ts'),
    ...readdirSync(resolve(routesDir, 'routes'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(resolve(routesDir, 'routes', f), 'utf8')),
  ]
  /**
   * Sub-routers mounted with `parent.route('/v1/admin/pdca', r)` register
   * relative paths (`r.post('/improve-qa-stories')`). Pair every mount prefix
   * in a file with every relative route in it — a superset, which is fine for
   * an existence check.
   */
  function mountedRoutes(source) {
    const prefixes = [...source.matchAll(/\.route\(\s*'(\/v1\/[^']*)'/g)].map((m) => m[1])
    if (prefixes.length === 0) return []
    const relative = [...source.matchAll(/\.(?:get|post|put|patch|delete|all)\(\s*'(\/[^']*)'/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith('/v1/'))
    return prefixes.flatMap((prefix) => relative.map((rel) => `${prefix}${rel === '/' ? '' : rel}`))
  }
  const routePatterns = routeSources
    .flatMap((source) => [...v1Literals(source), ...mountedRoutes(source)])
    .filter((p) => !p.includes('\u0000'))
    .map(segmentsOf)

  const matches = (toolSegs) =>
    routePatterns.some(
      (routeSegs) =>
        routeSegs.length === toolSegs.length &&
        routeSegs.every((seg, k) => seg === toolSegs[k] || seg.startsWith(':') || toolSegs[k].includes('\u0000')),
    )

  const toolPaths = [
    ...v1Literals(read('packages/mcp/src/server.ts')).map((p) => ['packages/mcp/src/server.ts', p]),
    ...v1Literals(hostedContent).map((p) => ['functions/mcp/index.ts', p]),
    ...Object.entries(JSON.parse(manifestContent)).map(([name, def]) => [
      `mcp-hosted-tool-manifest.json#${name}`,
      def.path.replace(/\{[^}]+\}/g, '\u0000'),
    ]),
  ]
  let resolved = 0
  for (const [where, path] of toolPaths) {
    if (matches(segmentsOf(path))) resolved++
    else fail(`${where}: "${path.replace(/\u0000/g, '{…}')}" matches no route registered under packages/server/supabase/functions/api`)
  }
  info(`${resolved} tool API paths resolve to registered api routes`)
}

// CHECK 5: one feature map for both transports, covering every tool
// An unmapped tool matches no feature filter, so it would vanish from every
// lean install; a drifted hosted copy would filter differently from stdio.
console.log(`\n── Check 5: Feature-group map ──────────────────────────────────────────────`)
{
  const stdioGroups = read('packages/mcp/src/feature-groups.ts')
  const hostedGroups = read('packages/server/supabase/functions/mcp/feature-groups.ts')
  if (stdioGroups !== hostedGroups) {
    fail('packages/server/supabase/functions/mcp/feature-groups.ts differs from packages/mcp/src/feature-groups.ts — copy the stdio file over it')
  }
  const mapSource = stdioGroups.split('export const TOOL_FEATURE_MAP')[1]?.split('\n}')[0] ?? ''
  const mapped = new Set([...mapSource.matchAll(/^ {2}([a-z_]+):\s*'[a-z]+',/gm)].map((m) => m[1]))
  let unmapped = 0
  for (const name of canonicalToolNames) {
    if (mapped.has(name)) continue
    fail(`"${name}" has no TOOL_FEATURE_MAP entry — it would be hidden from every feature-filtered install`)
    unmapped++
  }
  for (const name of mapped) {
    if (!canonicalToolNames.has(name)) {
      fail(`TOOL_FEATURE_MAP maps "${name}", which is not a catalog tool${resourceNames.has(name) ? ' (it is a resource)' : ''}`)
      unmapped++
    }
  }
  if (unmapped === 0 && stdioGroups === hostedGroups) info(`every tool mapped; stdio and hosted feature maps identical`)
}

// CHECK 6: server instructions and the use_mushi router agree across transports
console.log(`\n── Check 6: Server instructions + use_mushi intents ────────────────────────`)
{
  /** The single-quoted string items of the `[ … ].join(' ')` array that follows `anchor`. */
  const joinedStrings = (source, anchor) => {
    const body = source.split(anchor)[1]?.split('].join(')[0]
    return body === undefined ? null : [...body.matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)].map((m) => m[1]).join(' ')
  }
  const stdioInstructions = joinedStrings(canonicalContent, 'export const MUSHI_SERVER_INSTRUCTIONS = [')
  const hostedInstructions = joinedStrings(hostedContent, 'const SERVER_INSTRUCTIONS = [')
  if (!stdioInstructions || !hostedInstructions) {
    fail('Could not read MUSHI_SERVER_INSTRUCTIONS (catalog.ts) or SERVER_INSTRUCTIONS (functions/mcp/index.ts)')
  } else if (stdioInstructions !== hostedInstructions) {
    fail('Hosted SERVER_INSTRUCTIONS differs from MUSHI_SERVER_INSTRUCTIONS in catalog.ts — copy the catalog lines over')
  } else {
    info(`server instructions identical on both transports (${stdioInstructions.length} chars)`)
  }

  /** key → tool list for every `key: { label: '…', tools: [ … ]` entry after `anchor`. */
  const intentTools = (source, anchor) => {
    const body = source.split(anchor)[1] ?? ''
    return new Map(
      [...body.matchAll(/(\w+): \{\s*label: '[^']*',\s*tools: \[([^\]]*)\]/g)].map((m) => [
        m[1],
        [...m[2].matchAll(/'([a-z_]+)'/g)].map((t) => t[1]).join(','),
      ]),
    )
  }
  const stdioIntents = intentTools(canonicalContent, 'export const USE_MUSHI_INTENTS')
  const hostedIntents = intentTools(hostedContent, 'const INTENTS:')
  if (stdioIntents.size === 0 || hostedIntents.size === 0) {
    fail('Could not read USE_MUSHI_INTENTS (catalog.ts) or the hosted use_mushi INTENTS table')
  } else {
    let intentFails = 0
    for (const [key, tools] of stdioIntents) {
      if (hostedIntents.get(key) !== tools) {
        fail(`use_mushi intent "${key}" lists different tools on the hosted server`)
        intentFails++
      }
    }
    for (const key of hostedIntents.keys()) {
      if (!stdioIntents.has(key)) {
        fail(`hosted use_mushi intent "${key}" is missing from USE_MUSHI_INTENTS`)
        intentFails++
      }
    }
    if (intentFails === 0) info(`${stdioIntents.size} use_mushi intents identical on both transports`)
  }
}

// CHECK 7: hosted tool metadata comes from the generated catalog copy
// mcp-discovery-tools.json is regenerated from packages/mcp (its own --check
// runs in check:catalog-sync) and carries each tool's title, description,
// annotations, input schema and output schema. The hosted server must take all
// of them from there: hand-declared copies drifted (descriptions, parameter
// spellings, and outputSchema on one transport but not the other).
console.log(`\n── Check 7: Hosted metadata from the generated catalog ──────────────────────`)
{
  const manifestTools = read('packages/server/supabase/functions/mcp/manifest-tools.ts')
  const overlay = hostedContent.split('function withCatalogMetadata')[1]?.split('\n}\n')[0] ?? ''
  if (!overlay) {
    fail('functions/mcp/index.ts no longer builds hosted tools with withCatalogMetadata (metadata from MCP_DISCOVERY)')
  } else {
    for (const field of ['title', 'description', 'annotations', 'inputSchema', 'outputSchema']) {
      if (!new RegExp(`${field}: canonical\\.${field}`).test(overlay)) {
        fail(`functions/mcp/index.ts withCatalogMetadata no longer takes ${field} from MCP_DISCOVERY`)
      }
    }
  }
  for (const field of ['inputSchema', 'outputSchema']) {
    if (!new RegExp(`${field}: canonical\\??\\.${field}`).test(manifestTools)) {
      fail(`functions/mcp/manifest-tools.ts no longer takes manifest ${field} from MCP_DISCOVERY`)
    }
  }
  // A hand-written hosted tool is scope + handler only. Declaring metadata
  // next to the handler is how the two transports drifted apart.
  const baseSection = hostedContent.split('const BASE_TOOLS')[1]?.split('/** Full catalog')[0] ?? ''
  const baseEntries = baseSection.split(/\n {2}(?=[a-z_]+: \{)/).slice(1)
  let handDeclared = 0
  for (const entry of baseEntries) {
    const name = entry.match(/^([a-z_]+): \{/)?.[1]
    for (const field of ['title', 'description', 'inputSchema', 'outputSchema', 'annotations']) {
      if (new RegExp(`\\n {4}${field}:`).test(entry)) {
        fail(`hosted BASE_TOOLS "${name}" declares its own ${field} — it comes from mcp-discovery-tools.json`)
        handDeclared++
      }
    }
  }
  if (handDeclared === 0 && baseEntries.length > 0) {
    info(`${baseEntries.length} hand-written hosted tools take all metadata (incl. input/output schemas) from the catalog`)
  }

  // Files both transports run byte-for-byte: the argument alias rule and the
  // report projections behind get_report_detail / triage_issue / evidence.
  for (const file of ['arg-aliases.ts', 'report-shapes.ts']) {
    const stdio = read(`packages/mcp/src/${file}`)
    const hosted = read(`packages/server/supabase/functions/mcp/${file}`)
    if (stdio !== hosted) {
      fail(`packages/server/supabase/functions/mcp/${file} differs from packages/mcp/src/${file} — copy the stdio file over it`)
    }
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
