/**
 * Deno-runtime mirror of `@mushi-mushi/inventory-schema`.
 *
 * Why a mirror?
 *   Supabase Edge Functions resolve dependencies via `npm:` specifier or
 *   raw URL imports — they do not see the workspace's TypeScript sources
 *   directly. Until the schema package is published to npm we keep this
 *   inline copy. The Node-side package and this file MUST stay in lockstep;
 *   `inventory-schema/src/index.test.ts` and the matching test in
 *   `_shared/__tests__/inventory.test.ts` round-trip the same fixtures
 *   against both validators to catch drift.
 *
 * Anything new the admin/CLI consumes from `@mushi-mushi/inventory-schema`
 * MUST also be added here, otherwise the server will silently reject
 * inventories that the admin's preflight just validated.
 */

import { z } from 'npm:zod@3'
import { parse as parseYaml } from 'npm:yaml@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { findOrCreateNode, createEdge } from './knowledge-graph.ts'

// ---- enums --------------------------------------------------------------

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

export const STATUS_PRIORITY: Record<Status, number> = {
  stub: 0,
  unknown: 1,
  mocked: 2,
  wired: 3,
  verified: 4,
  regressed: 5,
}

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
export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const
export const DB_OPERATIONS = ['insert', 'update', 'delete', 'upsert', 'select'] as const

// ---- helpers ------------------------------------------------------------

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'must be a slug (a-z, 0-9, dash, underscore)')

const path = z
  .string()
  .min(1)
  .max(200)
  .startsWith('/', 'must start with "/"')

// ---- schemas ------------------------------------------------------------

export const apiDepSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1).max(300),
})

export const dbDepSchema = z.object({
  table: z.string().min(1).max(120),
  schema: z.string().min(1).max(80).optional().default('public'),
  operation: z.enum(DB_OPERATIONS).optional(),
  rpc: z.string().optional(),
})

export const testRefSchema = z.object({
  file: z.string().min(1),
  name: z.string().min(1),
  framework: z.enum(['playwright', 'vitest', 'jest', 'cypress', 'other']).optional(),
})

export const elementSchema = z.object({
  id: slug,
  type: z.enum(ELEMENT_TYPES),
  action: z.string().min(1).max(300),
  backend: z.array(apiDepSchema).optional().default([]),
  db_writes: z.array(dbDepSchema).optional().default([]),
  db_reads: z.array(dbDepSchema).optional().default([]),
  crud: z.enum(['C', 'R', 'U', 'D', 'none']).optional().default('none'),
  verified_by: z.array(testRefSchema).optional().default([]),
  user_story: z.string().max(400).optional(),
  status: z.enum(STATUSES).optional(),
  last_verified: z.string().optional(),
  notes: z.string().max(1000).optional(),
  owner_team: z.string().max(80).optional(),
  testid: z.string().max(120).optional(),
})
export type Element = z.infer<typeof elementSchema>

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
  config: z.object({ token_env: z.string() }),
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

export const appSchema = z.object({
  id: slug,
  name: z.string().min(1).max(120),
  base_url: z.string().url(),
  preview_url: z.string().url().optional(),
  staging_url: z.string().url().optional(),
  auth: authConfigSchema.optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export const inventorySchema = z.object({
  schema_version: z
    .string()
    .refine(
      (v) => /^2(\.\d+)*$/.test(v),
      'schema_version must start with "2." (this validator targets v2)',
    ),
  app: appSchema,
  user_stories: z.array(userStorySchema).optional().default([]),
  pages: z.array(pageSchema).min(1, 'inventory.yaml must declare at least one page'),
  dependencies: z
    .object({
      apis: z.array(z.unknown()).optional().default([]),
      databases: z.array(z.unknown()).optional().default([]),
    })
    .optional()
    .default({ apis: [], databases: [] }),
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

function formatSegment(seg: string | number, idx: number): string {
  if (typeof seg === 'number') return `[${seg}]`
  return idx === 0 ? seg : `.${seg}`
}

export function parseInventoryYaml(raw: string): ParseResult {
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
  return validateInventoryObject(json)
}

export function validateInventoryObject(value: unknown): ParseResult {
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

// ---- stats --------------------------------------------------------------

export interface InventoryStats {
  pages: number
  elements: number
  actions: number
  user_stories: number
  api_deps: number
  db_deps: number
  tests: number
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
      if (e.action) actionCount += 1
      const status = (e.status ?? 'unknown') as Status
      claimed[status] += 1
      for (const a of e.backend ?? []) apiSet.add(`${a.method}:${a.path}`)
      for (const d of e.db_writes ?? []) dbSet.add(`${d.schema ?? 'public'}.${d.table}`)
      for (const d of e.db_reads ?? []) dbSet.add(`${d.schema ?? 'public'}.${d.table}`)
      for (const t of e.verified_by ?? []) testSet.add(`${t.file}::${t.name}`)
    }
  }
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

// ---- ingestion ---------------------------------------------------------
//
// `ingestInventory` expands a validated Inventory into the bidirectional
// graph: one App node, one Page node per page, one Element + Action node
// per element, and one ApiDep / DbDep / Test / UserStory node per
// dependency. Edges (`contains`, `triggers`, `calls`, `writes`, `reads`,
// `verified_by`, `implements`) wire them into the existing
// graph_nodes / graph_edges store.
//
// Idempotent — re-ingesting the same yaml just refreshes metadata.
// The previous current snapshot is marked is_current=false in a single
// transaction by the calling route; this helper itself only writes graph
// + the new snapshot row.

export interface IngestResult {
  inventoryId: string
  appNodeId: string
  nodeCount: number
  edgeCount: number
}

export async function ingestInventory(
  db: SupabaseClient,
  projectId: string,
  inv: Inventory,
  rawYaml: string,
  meta: {
    commitSha?: string | null
    source?: 'explicit' | 'crawler' | 'hybrid' | 'cli'
    ingestedBy?: string | null
    validationErrors?: ValidationIssue[]
  } = {},
): Promise<IngestResult> {
  // 1. Mark old snapshot as not-current.
  await db
    .from('inventories')
    .update({ is_current: false })
    .eq('project_id', projectId)
    .eq('is_current', true)

  // 2. Insert new snapshot row.
  const stats = computeStats(inv)
  const { data: snapshot, error: snapErr } = await db
    .from('inventories')
    .insert({
      project_id: projectId,
      commit_sha: meta.commitSha ?? null,
      schema_version: inv.schema_version,
      raw_yaml: rawYaml,
      parsed: inv as unknown as Record<string, unknown>,
      validation_errors: meta.validationErrors ?? [],
      source: meta.source ?? 'explicit',
      ingested_by: meta.ingestedBy ?? null,
      is_current: true,
      stats: stats as unknown as Record<string, unknown>,
    })
    .select('id')
    .single()
  if (snapErr || !snapshot) {
    throw new Error(`Failed to insert inventory snapshot: ${snapErr?.message ?? 'unknown'}`)
  }

  // 3. Expand into graph nodes + edges.
  let nodeCount = 0
  let edgeCount = 0
  const incNode = (n: number) => (nodeCount += n)
  const incEdge = (n: number) => (edgeCount += n)

  const appNodeId = await findOrCreateNode(db, projectId, 'app', inv.app.id, {
    name: inv.app.name,
    base_url: inv.app.base_url,
  })
  incNode(1)

  const storyNodeIds = new Map<string, string>()
  for (const story of inv.user_stories ?? []) {
    const id = await findOrCreateNode(db, projectId, 'user_story', story.id, {
      title: story.title,
      persona: story.persona,
      description: story.description,
      goal: story.goal,
      tags: story.tags,
    })
    storyNodeIds.set(story.id, id)
    incNode(1)
  }

  for (const page of inv.pages) {
    const pageNodeId = await findOrCreateNode(
      db,
      projectId,
      'page_v2',
      `${inv.app.id}/${page.id}`,
      {
        page_id: page.id,
        title: page.title,
        path: page.path,
        auth_required: page.auth_required,
        user_story: page.user_story,
      },
    )
    incNode(1)
    await createEdge(db, projectId, appNodeId, pageNodeId, 'contains')
    incEdge(1)

    if (page.user_story && storyNodeIds.has(page.user_story)) {
      // story → contains → page (so the User-Story Map can render
      // story → page → element → action without a join)
      await createEdge(
        db,
        projectId,
        storyNodeIds.get(page.user_story)!,
        pageNodeId,
        'contains',
      )
      incEdge(1)
    }

    for (const el of page.elements) {
      const elementNodeId = await findOrCreateNode(
        db,
        projectId,
        'element',
        `${inv.app.id}/${page.id}/${el.id}`,
        {
          element_id: el.id,
          type: el.type,
          testid: el.testid ?? el.id,
          owner_team: el.owner_team,
          notes: el.notes,
        },
      )
      incNode(1)
      await createEdge(db, projectId, pageNodeId, elementNodeId, 'contains')
      incEdge(1)

      const actionLabel = `${inv.app.id}/${page.id}/${el.id}#${el.type}`
      const actionNodeId = await findOrCreateNode(db, projectId, 'action', actionLabel, {
        action: el.action,
        crud: el.crud,
        // Status here is the customer's CLAIMED status (whitepaper §3.3).
        // The Status Reconciler is the only thing that should ever flip
        // this to a derived value — but we record the claim so the
        // disagreement log can render "claimed: verified, derived: wired".
        claimed_status: el.status ?? 'unknown',
        status: 'unknown',
        last_verified: el.last_verified,
      })
      incNode(1)
      await createEdge(db, projectId, elementNodeId, actionNodeId, 'triggers')
      incEdge(1)

      const attachedStory = el.user_story ?? page.user_story
      if (attachedStory && storyNodeIds.has(attachedStory)) {
        await createEdge(
          db,
          projectId,
          actionNodeId,
          storyNodeIds.get(attachedStory)!,
          'implements',
        )
        incEdge(1)
      }

      for (const api of el.backend ?? []) {
        const apiNodeId = await findOrCreateNode(
          db,
          projectId,
          'api_dep',
          `${api.method}:${api.path}`,
          { method: api.method, path: api.path },
        )
        incNode(1)
        await createEdge(db, projectId, actionNodeId, apiNodeId, 'calls')
        incEdge(1)
      }

      for (const dw of el.db_writes ?? []) {
        const dbNodeId = await findOrCreateNode(
          db,
          projectId,
          'db_dep',
          `${dw.schema ?? 'public'}.${dw.table}`,
          { table: dw.table, schema: dw.schema ?? 'public' },
        )
        incNode(1)
        await createEdge(db, projectId, actionNodeId, dbNodeId, 'writes', 1, {
          operation: dw.operation,
        })
        incEdge(1)
      }

      for (const dr of el.db_reads ?? []) {
        const dbNodeId = await findOrCreateNode(
          db,
          projectId,
          'db_dep',
          `${dr.schema ?? 'public'}.${dr.table}`,
          { table: dr.table, schema: dr.schema ?? 'public' },
        )
        incNode(1)
        await createEdge(db, projectId, actionNodeId, dbNodeId, 'reads')
        incEdge(1)
      }

      for (const t of el.verified_by ?? []) {
        const testNodeId = await findOrCreateNode(
          db,
          projectId,
          'test',
          `${t.file}::${t.name}`,
          { file: t.file, name: t.name, framework: t.framework },
        )
        incNode(1)
        await createEdge(db, projectId, actionNodeId, testNodeId, 'verified_by')
        incEdge(1)
      }
    }
  }

  return { inventoryId: snapshot.id as string, appNodeId, nodeCount, edgeCount }
}

// ---- diff ---------------------------------------------------------------

export interface InventoryDiffEntry {
  kind: 'added' | 'removed' | 'changed'
  type: 'page' | 'element' | 'action' | 'api_dep' | 'db_dep' | 'test' | 'user_story'
  id: string
  before?: unknown
  after?: unknown
}

export function diffInventories(before: Inventory | null, after: Inventory): InventoryDiffEntry[] {
  const out: InventoryDiffEntry[] = []
  const beforeKeys = new Set<string>()
  if (before) {
    for (const story of before.user_stories ?? []) beforeKeys.add(`user_story:${story.id}`)
    for (const p of before.pages) {
      beforeKeys.add(`page:${p.id}`)
      for (const e of p.elements) {
        beforeKeys.add(`element:${p.id}/${e.id}`)
      }
    }
  }
  const afterKeys = new Set<string>()
  for (const story of after.user_stories ?? []) afterKeys.add(`user_story:${story.id}`)
  for (const p of after.pages) {
    afterKeys.add(`page:${p.id}`)
    for (const e of p.elements) afterKeys.add(`element:${p.id}/${e.id}`)
  }

  for (const k of afterKeys) {
    if (!beforeKeys.has(k)) {
      const [type, id] = k.split(':') as [InventoryDiffEntry['type'], string]
      out.push({ kind: 'added', type, id })
    }
  }
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) {
      const [type, id] = k.split(':') as [InventoryDiffEntry['type'], string]
      out.push({ kind: 'removed', type, id })
    }
  }
  return out
}
