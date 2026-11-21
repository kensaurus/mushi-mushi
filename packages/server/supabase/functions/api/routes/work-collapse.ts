/**
 * FILE: packages/server/supabase/functions/api/routes/work-collapse.ts
 * PURPOSE: The one-shot collapse of the code-audit backlog filed before ADR
 *          0065 (`mushi work --collapse-backlog`). Served by `api-ext` with
 *          the other work routes.
 *
 *            GET  /v1/admin/work/code-audit/backlog?projectId=  the open
 *                 code_audit reports the CLI groups on its clone (mcp:read)
 *            POST /v1/admin/work/code-audit/collapse  { projectId, tag, apply,
 *                 groups } closes each group's children as duplicates of its
 *                 parent (mcp:write, a non-viewer); without `apply` it only counts
 *
 *          The CLI computes the groups (it has the clone that roots each
 *          finding); the server checks every id and writes only what it can
 *          undo. Every row it changes carries custom_metadata.collapse =
 *          { tag, role, from_status | prev_* }, so one UPDATE on the tag
 *          reverts the run (collapseRevertSql in packages/cli). A child in
 *          `fixing` (a live PR) is never closed. Running it again changes
 *          nothing that is already collapsed.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import type { getServiceClient } from '../../_shared/db.ts'
import { appendAffectedScreen, CODE_AUDIT_OPEN_STATUSES, safeRepoPath, type AffectedScreen } from '../../_shared/work-modes.ts'

type Db = ReturnType<typeof getServiceClient>
// deno-lint-ignore no-explicit-any
type Ctx = Context<any>

export interface CollapseRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  access: (c: Ctx, db: Db, userId: string, projectId: string) => Promise<{ allowed: boolean; role: string | null }>
  now: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG_RE = /^collapse_\d{4}_\d{2}_\d{2}$/
const MAX_GROUPS = 1000
const MAX_ROWS = 2000

export interface CollapseGroup {
  parentId: string
  patternKey: string
  title: string | null
  screens: AffectedScreen[]
  childIds: string[]
}

export interface CollapseBody {
  projectId: string
  tag: string
  apply: boolean
  groups: CollapseGroup[]
}

// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(CONTROL, ' ').trim().slice(0, max) : '')

/** Parse a collapse request; every id, key and screen is checked. */
export function parseCollapseBody(raw: unknown): { ok: true; value: CollapseBody } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send the collapse as a JSON object.' }
  const b = raw as Record<string, unknown>
  if (typeof b.projectId !== 'string' || !UUID_RE.test(b.projectId)) return { ok: false, message: 'projectId must be a uuid.' }
  if (typeof b.tag !== 'string' || !TAG_RE.test(b.tag)) return { ok: false, message: 'tag must look like collapse_2026_11_21.' }
  if (!Array.isArray(b.groups) || b.groups.length > MAX_GROUPS) return { ok: false, message: `groups must be a list of at most ${MAX_GROUPS}.` }
  const groups: CollapseGroup[] = []
  for (const g of b.groups as Array<Record<string, unknown>>) {
    if (!g || typeof g.parentId !== 'string' || !UUID_RE.test(g.parentId)) return { ok: false, message: 'Each group needs a parentId.' }
    const patternKey = clean(g.patternKey, 400)
    if (patternKey.length < 3) return { ok: false, message: 'Each group needs its pattern key.' }
    if (!Array.isArray(g.childIds) || g.childIds.length === 0 || g.childIds.length > MAX_ROWS || !g.childIds.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
      return { ok: false, message: 'Each group needs a list of child ids.' }
    }
    const screens: AffectedScreen[] = []
    for (const s of Array.isArray(g.screens) ? (g.screens as Array<Record<string, unknown>>).slice(0, 50) : []) {
      const file = safeRepoPath(s?.file)
      const screen = safeRepoPath(s?.screen) ?? file
      if (!file || !screen || typeof s.line !== 'number' || !Number.isInteger(s.line) || s.line < 1) continue
      screens.push({ screen, file, line: s.line, title: clean(s.title, 200), at: clean(s.at, 40) })
    }
    const title = clean(g.title, 200)
    groups.push({ parentId: g.parentId, patternKey, title: title.length >= 3 ? title : null, screens, childIds: [...new Set(g.childIds as string[])].filter((id) => id !== g.parentId) })
  }
  return { ok: true, value: { projectId: b.projectId, tag: b.tag, apply: b.apply === true, groups } }
}

interface Row {
  id: string
  status: string
  title: string | null
  closed_reason: string | null
  parent_report_id: string | null
  pattern_key: string | null
  affected_screens: unknown
  custom_metadata: Record<string, unknown> | null
}

async function openParents(db: Db, projectId: string): Promise<number | null> {
  const { count, error } = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('source', 'code_audit')
    .is('parent_report_id', null)
    .in('status', [...CODE_AUDIT_OPEN_STATUSES])
  return error ? null : count ?? 0
}

export interface CollapseResult {
  tag: string
  applied: boolean
  /** Open code_audit reports (parents) before and after; after is a forecast without `apply`. */
  before: number
  after: number
  groups: number
  children: number
  /** Children left open: a live PR (fixing), another parent, already closed, or not this app's. */
  skipped: number
  /** Groups whose pattern key another open report holds now (filed after the deploy). */
  keyTaken: number
}

/**
 * Check every group against the database and, with `apply`, close each
 * group's children as duplicates of its parent. Idempotent: a child already
 * collapsed is no longer open, and a parent keeps the prev_* of its first run.
 */
export async function applyCollapse(db: Db, body: CollapseBody, now: Date): Promise<CollapseResult | null> {
  const before = await openParents(db, body.projectId)
  if (before === null) return null
  const ids = [...new Set(body.groups.flatMap((g) => [g.parentId, ...g.childIds]))]
  const rows = new Map<string, Row>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('reports')
      .select('id, status, title, closed_reason, parent_report_id, pattern_key, affected_screens, custom_metadata')
      .eq('project_id', body.projectId)
      .eq('source', 'code_audit')
      .in('id', ids.slice(i, i + 200))
    if (error) return null
    for (const r of (data ?? []) as Row[]) rows.set(r.id, r)
  }
  const open = (r: Row | undefined): r is Row => !!r && !r.parent_report_id && (CODE_AUDIT_OPEN_STATUSES as readonly string[]).includes(r.status)
  const nowIso = now.toISOString()
  const out: CollapseResult = { tag: body.tag, applied: body.apply, before, after: before, groups: 0, children: 0, skipped: 0, keyTaken: 0 }
  const used = new Set<string>()
  for (const g of body.groups) {
    const parent = rows.get(g.parentId)
    if (!open(parent) || used.has(parent.id)) {
      out.skipped += g.childIds.length
      continue
    }
    used.add(parent.id)
    const kids = g.childIds.map((id) => rows.get(id)).filter((r): r is Row => open(r) && r.status !== 'fixing' && !used.has(r.id))
    out.skipped += g.childIds.length - kids.length
    if (kids.length === 0) continue
    for (const k of kids) used.add(k.id)
    if (!body.apply) {
      out.groups++
      out.children += kids.length
      continue
    }
    const meta = parent.custom_metadata ?? {}
    const earlier = (meta.collapse as Record<string, unknown> | undefined)?.tag === body.tag ? (meta.collapse as Record<string, unknown>) : null
    let screens = Array.isArray(parent.affected_screens) ? (parent.affected_screens as AffectedScreen[]) : []
    for (const s of g.screens) screens = appendAffectedScreen(screens, s)
    const { data: took, error: pErr } = await db
      .from('reports')
      .update({
        ...(parent.pattern_key ? {} : { pattern_key: g.patternKey }),
        affected_screens: screens,
        ...(g.title ? { title: g.title } : {}),
        updated_at: nowIso,
        custom_metadata: {
          ...meta,
          collapse: {
            tag: body.tag,
            role: 'parent',
            children: (Number(earlier?.children) || 0) + kids.length,
            prev_title: earlier ? earlier.prev_title : parent.title ?? null,
            prev_pattern_key: earlier ? earlier.prev_pattern_key : parent.pattern_key ?? null,
            prev_affected_screens: earlier ? earlier.prev_affected_screens : (Array.isArray(parent.affected_screens) ? parent.affected_screens : null),
          },
        },
      })
      .eq('id', parent.id)
      .eq('status', parent.status)
      .select('id')
    if (pErr?.code === '23505') {
      out.keyTaken++
      out.skipped += kids.length
      continue
    }
    if (pErr || !took || (took as unknown[]).length === 0) {
      out.skipped += kids.length
      continue
    }
    out.groups++
    for (const k of kids) {
      const { data: moved } = await db
        .from('reports')
        .update({
          status: 'dismissed',
          closed_reason: 'duplicate',
          parent_report_id: parent.id,
          updated_at: nowIso,
          custom_metadata: { ...(k.custom_metadata ?? {}), collapse: { tag: body.tag, role: 'child', from_status: k.status, from_closed_reason: k.closed_reason, parent: parent.id } },
        })
        .eq('id', k.id)
        .eq('status', k.status)
        .is('parent_report_id', null)
        .select('id')
      if (moved && (moved as unknown[]).length > 0) out.children++
      else out.skipped++
    }
  }
  if (body.apply) {
    const after = await openParents(db, body.projectId)
    out.after = after ?? before - out.children
  } else {
    out.after = before - out.children
  }
  return out
}

function err(c: Ctx, code: string, message: string, status: number): Response {
  return c.json({ ok: false, error: { code, message } }, status as never)
}

async function allowed(c: Ctx, deps: CollapseRouteDeps, db: Db, projectId: string, write: boolean): Promise<Response | null> {
  const userId = c.get('userId') as string
  const access = await deps.access(c, db, userId, projectId)
  if (!access.allowed) return err(c, 'NOT_FOUND', 'Project not found', 404)
  if (write && access.role === 'viewer') return err(c, 'FORBIDDEN', 'A viewer cannot change reports.', 403)
  return null
}

export function registerCodeAuditCollapseRoutes(app: Hono, deps: CollapseRouteDeps): void {
  app.get('/v1/admin/work/code-audit/backlog', deps.adminOrApiKeyRead, async (c) => {
    const projectId = c.req.query('projectId') ?? ''
    if (!UUID_RE.test(projectId)) return err(c, 'VALIDATION_ERROR', 'projectId must be a uuid.', 400)
    const db = deps.getServiceClient()
    const denied = await allowed(c, deps, db, projectId, false)
    if (denied) return denied
    const { data, error } = await db
      .from('reports')
      .select('id, project_id, source, status, severity, title, description, created_at, custom_metadata, pattern_key, parent_report_id')
      .eq('project_id', projectId)
      .eq('source', 'code_audit')
      .is('parent_report_id', null)
      .in('status', [...CODE_AUDIT_OPEN_STATUSES])
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS)
    if (error) return err(c, 'DB_ERROR', 'Could not read the open code-audit reports.', 503)
    return c.json({ ok: true, data: { reports: data ?? [] } })
  })

  app.post('/v1/admin/work/code-audit/collapse', deps.adminOrApiKeyWrite, async (c) => {
    const parsed = parseCollapseBody(await c.req.json().catch(() => null))
    if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
    const db = deps.getServiceClient()
    const denied = await allowed(c, deps, db, parsed.value.projectId, parsed.value.apply)
    if (denied) return denied
    const res = await applyCollapse(db, parsed.value, deps.now())
    if (!res) return err(c, 'DB_ERROR', 'Could not read the reports to collapse. Nothing was changed.', 503)
    return c.json({ ok: true, data: res })
  })
}
