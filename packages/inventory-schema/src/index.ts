/**
 * @mushi-mushi/inventory-schema
 *
 * Single source of truth for the Mushi Mushi v2 `inventory.yaml` shape.
 * Used by:
 *   - the admin server (Hono Inventory Service routes)
 *   - the admin UI (yaml viewer + dropzone preflight)
 *   - the `mushi-mushi-cli inventory ingest` command
 *   - the `mushi-mushi-eslint-plugin` Status-Claim Verification gate
 *   - third-party MCP consumers querying the graph
 *
 * Schema mirrors the whitepaper Appendix A reference.
 */

import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

// ---- enums --------------------------------------------------------------

export const ELEMENT_TYPES = [
  'button',
  'link',
  'form',
  'input',
  'list',
  'toggle',
  'menu',
  'image',
  'media',
  'other',
] as const
export type ElementType = (typeof ELEMENT_TYPES)[number]

export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const DB_OPERATIONS = ['insert', 'update', 'delete', 'upsert', 'select'] as const
export type DbOperation = (typeof DB_OPERATIONS)[number]

export const CRUD = ['C', 'R', 'U', 'D', 'none'] as const
export type Crud = (typeof CRUD)[number]

/**
 * The six derived statuses from whitepaper §3.3.
 *
 *   stub      🔴 — UI exists but no handler / handler is empty
 *   mocked    🟠 — handler runs against mock or fake data
 *   wired     🟡 — handler hits real backend, no E2E verification
 *   verified  🟢 — E2E test passes including a ground-truth assertion
 *   regressed ⚫ — was verified, now failing
 *   unknown   ⚪ — not yet evaluated
 *
 * Status is NEVER written by hand. The customer-side `inventory.yaml`
 * file MAY include `status:` as a CLAIM that the Status-Claim gate (§5
 * Gate 5) verifies — but the on-graph status the UI renders is whatever
 * the Status Reconciler derived from observable signals.
 */
export const STATUSES = [
  'stub',
  'mocked',
  'wired',
  'verified',
  'regressed',
  'unknown',
] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_GLYPHS: Record<Status, string> = {
  stub: '🔴',
  mocked: '🟠',
  wired: '🟡',
  verified: '🟢',
  regressed: '⚫',
  unknown: '⚪',
}

export const STATUS_LABELS: Record<Status, string> = {
  stub: 'Stub',
  mocked: 'Mocked',
  wired: 'Wired',
  verified: 'Verified',
  regressed: 'Regressed',
  unknown: 'Unknown',
}

// ---- helpers ------------------------------------------------------------

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'must be a slug (a-z, 0-9, dash, underscore)')

const path = z.string().min(1).max(200).startsWith('/', 'must start with "/"')

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO-8601 timestamp')

// ---- leaf shapes --------------------------------------------------------

export const apiDepSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1).max(300),
})
export type ApiDep = z.infer<typeof apiDepSchema>

export const dbDepSchema = z.object({
  table: z.string().min(1).max(120),
  schema: z.string().min(1).max(80).optional().default('public'),
  operation: z.enum(DB_OPERATIONS).optional(),
  rpc: z.string().optional(),
})
export type DbDep = z.infer<typeof dbDepSchema>

export const testRefSchema = z.object({
  file: z.string().min(1),
  name: z.string().min(1),
  framework: z.enum(['playwright', 'vitest', 'jest', 'cypress', 'other']).optional(),
})
export type TestRef = z.infer<typeof testRefSchema>

// ---- element / action ---------------------------------------------------

export const elementSchema = z.object({
  id: slug,
  type: z.enum(ELEMENT_TYPES),
  action: z.string().min(1).max(300),
  backend: z.array(apiDepSchema).optional().default([]),
  db_writes: z.array(dbDepSchema).optional().default([]),
  db_reads: z.array(dbDepSchema).optional().default([]),
  crud: z.enum(CRUD).optional().default('none'),
  verified_by: z.array(testRefSchema).optional().default([]),
  user_story: z.string().max(400).optional(),
  status: z.enum(STATUSES).optional(),
  last_verified: isoDateTime.optional(),
  notes: z.string().max(1000).optional(),
  owner_team: z.string().max(80).optional(),
  testid: z.string().max(120).optional(),
})
export type Element = z.infer<typeof elementSchema>

// ---- page ---------------------------------------------------------------

export const pageSchema = z.object({
  id: slug,
  path,
  title: z.string().max(200).optional(),
  user_story: z.string().max(400).optional(),
  auth_required: z.boolean().optional().default(true),
  elements: z.array(elementSchema).optional().default([]),
  notes: z.string().max(1000).optional(),
})
export type Page = z.infer<typeof pageSchema>

// ---- dependencies registry ----------------------------------------------

export const apiRegistryEntrySchema = z.object({
  id: slug.optional(),
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1),
  schema_url: z.string().url().optional(),
  owner_team: z.string().optional(),
  notes: z.string().optional(),
})

export const databaseRegistryEntrySchema = z.object({
  id: slug,
  type: z.enum(['postgres', 'mysql', 'mongodb', 'firestore', 'supabase', 'sqlite', 'other']),
  schema_introspection_url: z.string().url().optional(),
  adapter: z.string().optional(),
  notes: z.string().optional(),
})

export const dependenciesSchema = z
  .object({
    apis: z.array(apiRegistryEntrySchema).optional().default([]),
    databases: z.array(databaseRegistryEntrySchema).optional().default([]),
  })
  .optional()
  .default({ apis: [], databases: [] })

// ---- app + auth ---------------------------------------------------------

const cookieAuth = z.object({
  type: z.literal('cookie'),
  config: z.object({
    name: z.string(),
    value_env: z.string().optional(),
    domain: z.string().optional(),
  }),
})
const bearerAuth = z.object({
  type: z.literal('bearer'),
  config: z.object({
    token_env: z.string(),
  }),
})
const oauthAuth = z.object({
  type: z.literal('oauth'),
  config: z.object({
    client_id_env: z.string(),
    client_secret_env: z.string(),
    token_url: z.string().url().optional(),
  }),
})
const scriptedAuth = z.object({
  type: z.literal('scripted'),
  config: z.object({
    login_path: path,
    script: z.string().min(1),
  }),
})

export const authConfigSchema = z.discriminatedUnion('type', [
  cookieAuth,
  bearerAuth,
  oauthAuth,
  scriptedAuth,
])
export type AuthConfig = z.infer<typeof authConfigSchema>

export const appSchema = z.object({
  id: slug,
  name: z.string().min(1).max(120),
  base_url: z.string().url(),
  preview_url: z.string().url().optional(),
  staging_url: z.string().url().optional(),
  auth: authConfigSchema.optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
})
export type App = z.infer<typeof appSchema>

// ---- user_story (top-level optional list) -------------------------------
//
// Stories ARE allowed to live as a top-level array so the User-Story Map
// can render them even when no inline `user_story:` fields are populated
// on individual elements/pages. Each story id can be referenced from any
// element via `user_story: <id>`.

export const userStorySchema = z.object({
  id: slug,
  title: z.string().min(1).max(200),
  persona: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  goal: z.string().max(400).optional(),
  pages: z.array(slug).optional().default([]),
  tags: z.array(z.string().max(40)).optional().default([]),
})
export type UserStory = z.infer<typeof userStorySchema>

// ---- top-level inventory ------------------------------------------------

export const inventorySchema = z.object({
  schema_version: z.string().refine(
    (v) => /^2(\.\d+)*$/.test(v),
    'schema_version must start with "2." (this validator targets v2)',
  ),
  app: appSchema,
  user_stories: z.array(userStorySchema).optional().default([]),
  pages: z.array(pageSchema).min(1, 'inventory.yaml must declare at least one page'),
  dependencies: dependenciesSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export type Inventory = z.infer<typeof inventorySchema>

// ---- public API ---------------------------------------------------------

export interface ValidationIssue {
  path: string
  message: string
  code: string
}

export interface ParseResult {
  ok: boolean
  inventory?: Inventory
  issues: ValidationIssue[]
}

/**
 * Parse + validate a yaml string. Returns {ok: false, issues} when the
 * yaml is structurally invalid OR fails Zod, so callers can render
 * inline errors without throwing. `issues[].path` is dot/bracket-notation
 * (e.g. `pages[2].elements[0].backend[0].method`) so the admin yaml
 * viewer can highlight the right field.
 */
export function parseInventory(raw: string): ParseResult {
  let json: unknown
  try {
    json = parseYaml(raw)
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'YAML_PARSE',
          message: err instanceof Error ? err.message : 'invalid yaml',
        },
      ],
    }
  }

  const result = inventorySchema.safeParse(json)
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({
        path: i.path.length === 0 ? '$' : i.path.map(formatSegment).join(''),
        code: i.code,
        message: i.message,
      })),
    }
  }
  return { ok: true, inventory: result.data, issues: [] }
}

/**
 * Convenience for callers that already have a parsed object (e.g. the
 * server has just JSON.parse'd a webhook body). Returns the same
 * ParseResult shape so error-handling is uniform.
 */
export function validateInventory(value: unknown): ParseResult {
  const result = inventorySchema.safeParse(value)
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({
        path: i.path.length === 0 ? '$' : i.path.map(formatSegment).join(''),
        code: i.code,
        message: i.message,
      })),
    }
  }
  return { ok: true, inventory: result.data, issues: [] }
}

function formatSegment(seg: string | number, idx: number): string {
  if (typeof seg === 'number') return `[${seg}]`
  return idx === 0 ? seg : `.${seg}`
}

/**
 * Inventory aggregate stats. Computed once at ingest time and stashed
 * on `inventories.stats` so the admin PageHero can render without a
 * second round-trip.
 */
export interface InventoryStats {
  pages: number
  elements: number
  actions: number
  user_stories: number
  api_deps: number
  db_deps: number
  tests: number
  /** Status counts ARE claimed (not derived) at ingest time — these
   *  are upper bounds the Status Reconciler then truths up. */
  claimed_status: Record<Status, number>
}

export function computeStats(inv: Inventory): InventoryStats {
  const apiSet = new Set<string>()
  const dbSet = new Set<string>()
  const testSet = new Set<string>()
  const claimed: Record<Status, number> = {
    stub: 0,
    mocked: 0,
    wired: 0,
    verified: 0,
    regressed: 0,
    unknown: 0,
  }

  let elementCount = 0
  let actionCount = 0

  for (const p of inv.pages) {
    for (const e of p.elements) {
      elementCount += 1
      // Every element that declares an `action` description is treated as
      // exposing one Action node. Without an action, it's UI plumbing
      // (e.g. a label that doesn't trigger anything).
      if (e.action) actionCount += 1
      const status = (e.status ?? 'unknown') as Status
      claimed[status] += 1
      for (const a of e.backend ?? []) apiSet.add(`${a.method}:${a.path}`)
      for (const d of e.db_writes ?? []) dbSet.add(`${d.schema ?? 'public'}.${d.table}`)
      for (const d of e.db_reads ?? []) dbSet.add(`${d.schema ?? 'public'}.${d.table}`)
      for (const t of e.verified_by ?? []) testSet.add(`${t.file}::${t.name}`)
    }
  }

  for (const a of inv.dependencies?.apis ?? []) apiSet.add(`${a.method}:${a.path}`)
  for (const d of inv.dependencies?.databases ?? []) dbSet.add(d.id)

  return {
    pages: inv.pages.length,
    elements: elementCount,
    actions: actionCount,
    user_stories: inv.user_stories?.length ?? 0,
    api_deps: apiSet.size,
    db_deps: dbSet.size,
    tests: testSet.size,
    claimed_status: claimed,
  }
}

/**
 * Status priority order for derivation rules (§3.3). Higher index = stronger
 * claim. Used by the Reconciler to compare CLAIMED vs DERIVED status when
 * generating the disagreement log.
 */
export const STATUS_PRIORITY: Record<Status, number> = {
  stub: 0,
  unknown: 1,
  mocked: 2,
  wired: 3,
  verified: 4,
  regressed: 5,
}

/**
 * Status fingerprint helper — stable string that can be diffed across
 * commits to detect inventory drift without comparing whole nodes.
 */
export function elementFingerprint(pageId: string, e: Element): string {
  return `${pageId}/${e.id}::${e.type}::${e.action}`
}
