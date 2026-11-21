/**
 * FILE: packages/server/supabase/functions/api/routes/work-collapse.ts
 * PURPOSE: The one-shot collapse of the code-audit backlog filed before ADR
 *          0065 (`mushi work --collapse-backlog`). Served by `api-ext` with
 *          the other work routes.
 *
 *            GET  /v1/admin/work/code-audit/backlog?projectId=  the open
 *                 code_audit reports the CLI groups on its clone (mcp:read)
 *            POST /v1/admin/work/code-audit/collapse  { projectId, tag, apply,
 *                 groups, cap? } closes each group's children as duplicates of
 *                 its parent (mcp:write, a non-viewer); without `apply` it only
 *                 counts. With `cap` (`--apply-cap`), an app still over
 *                 project_settings.code_audit_open_cap keeps its best parents by
 *                 severity × confidence; the rest wait in code_audit_deferred,
 *                 dismissed as `deferred_over_cap`, and the audit lane's recheck
 *                 restores them as slots free. A report with a live PR is never
 *                 set aside.
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
import { auditCategory, auditPatternKey } from '../../_shared/audit-taxonomy.ts'
import {
  appendAffectedScreen,
  auditFindingScore,
  auditKey,
  CODE_AUDIT_OPEN_STATUSES,
  codeAuditOpenCap,
  DEFERRED_OVER_CAP,
  parseAuditFinding,
  safeRepoPath,
  type AffectedScreen,
  type AuditFinding,
} from '../../_shared/work-modes.ts'

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
  /** `--apply-cap`: every parent the CLI saw, with the finding it would wait as. */
  cap: { candidates: Array<{ reportId: string; finding: unknown }> } | null
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
  let cap: CollapseBody['cap'] = null
  if (b.cap !== undefined && b.cap !== null) {
    const c = b.cap as Record<string, unknown>
    if (!Array.isArray(c.candidates) || c.candidates.length > MAX_ROWS) return { ok: false, message: `cap.candidates must be a list of at most ${MAX_ROWS}.` }
    const candidates: Array<{ reportId: string; finding: unknown }> = []
    for (const x of c.candidates as Array<Record<string, unknown>>) {
      if (!x || typeof x.reportId !== 'string' || !UUID_RE.test(x.reportId)) return { ok: false, message: 'Each cap candidate needs a reportId.' }
      candidates.push({ reportId: x.reportId, finding: x.finding })
    }
    cap = { candidates }
  }
  return { ok: true, value: { projectId: b.projectId, tag: b.tag, apply: b.apply === true, groups, cap } }
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
  /** `--apply-cap`: what the open cap does after the collapse. */
  cap?: CapResult
  /** The cap step could not read what it needs; the collapse above stands, nothing was set aside. */
  capFailed?: boolean
}

export interface CapResult {
  cap: number
  /** Open code_audit reports after the collapse, before the cap. */
  openBefore: number
  /** After the cap: the parents kept, plus every one that cannot be set aside. */
  openAfter: number
  deferred: number
  /** Kept open whatever the cap: a live PR (fixing, or an attempt with an open PR). */
  keptLivePr: number
  /** Kept open: no finding the server could re-file later (no candidate, or one it refused). */
  keptNoFinding: number
}

/** Reports with a fix in flight: an attempt queued or running, or an open (or unread) PR. */
async function livePrReports(db: Db, ids: readonly string[]): Promise<Set<string> | null> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('fix_attempts')
      .select('report_id')
      .in('report_id', ids.slice(i, i + 200))
      .is('merged_at', null)
      .or('status.in.(queued,running),pr_state.in.(open,draft),and(pr_url.not.is.null,pr_state.is.null)')
    if (error) return null
    for (const r of (data ?? []) as Array<{ report_id: string }>) out.add(r.report_id)
  }
  return out
}

/**
 * The open cap over what is open after the collapse (`closing` = children it
 * closes, for a dry run). Ranked by severity × confidence, then oldest first;
 * the best keep their slots, the rest wait in code_audit_deferred with their
 * report dismissed as `deferred_over_cap` and its old status in
 * custom_metadata.cap. Never a report with a live PR.
 */
async function applyCap(db: Db, body: CollapseBody, closing: ReadonlySet<string>, now: Date): Promise<CapResult | null> {
  const nowIso = now.toISOString()
  const { data: settings } = await db.from('project_settings').select('code_audit_open_cap').eq('project_id', body.projectId).maybeSingle()
  const cap = codeAuditOpenCap((settings as { code_audit_open_cap?: unknown } | null)?.code_audit_open_cap)
  const { data: openData, error } = await db
    .from('reports')
    .select('id, status, created_at, closed_reason, pattern_key, custom_metadata')
    .eq('project_id', body.projectId)
    .eq('source', 'code_audit')
    .is('parent_report_id', null)
    .in('status', [...CODE_AUDIT_OPEN_STATUSES])
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return null
  type OpenRow = { id: string; status: string; created_at: string; closed_reason: string | null; pattern_key: string | null; custom_metadata: Record<string, unknown> | null }
  const open = ((openData ?? []) as OpenRow[]).filter((r) => !closing.has(r.id))
  const live = await livePrReports(db, open.map((r) => r.id))
  if (!live) return null
  const findings = new Map<string, AuditFinding>()
  for (const c of body.cap?.candidates ?? []) {
    const parsed = parseAuditFinding(c.finding)
    if (parsed.ok) findings.set(c.reportId, parsed.value)
  }
  const out: CapResult = { cap, openBefore: open.length, openAfter: open.length, deferred: 0, keptLivePr: 0, keptNoFinding: 0 }
  const movable: Array<{ row: OpenRow; f: AuditFinding; score: number }> = []
  for (const r of open) {
    if (r.status === 'fixing' || live.has(r.id)) out.keptLivePr++
    else if (!findings.has(r.id)) out.keptNoFinding++
    else movable.push({ row: r, f: findings.get(r.id)!, score: auditFindingScore(findings.get(r.id)!) })
  }
  const slots = Math.max(0, cap - out.keptLivePr - out.keptNoFinding)
  movable.sort((a, b) => b.score - a.score || a.row.created_at.localeCompare(b.row.created_at))
  const wait = movable.slice(slots)
  if (!body.apply) {
    out.deferred = wait.length
    out.openAfter = open.length - wait.length
    return out
  }
  for (const { row, f, score } of wait) {
    const key = await auditKey(f)
    const patternKey = row.pattern_key ?? auditPatternKey(auditCategory({ rule: f.rule, title: f.title, userImpact: f.userImpact }), f.rootFile, f.rule)
    const finding = { ...(f as unknown as Record<string, unknown>), collapse_report_id: row.id, collapse_tag: body.tag }
    const { data: existing } = await db.from('code_audit_deferred').select('id').eq('project_id', body.projectId).eq('pattern_key', patternKey).maybeSingle()
    const prior = existing as { id: string } | null
    const { data: ins, error: dErr } = prior
      ? await db.from('code_audit_deferred').update({ finding, audit_key: key, score, updated_at: nowIso }).eq('id', prior.id).select('id')
      : await db.from('code_audit_deferred').insert({ project_id: body.projectId, pattern_key: patternKey, audit_key: key, finding, score, deferred_at: nowIso, updated_at: nowIso }).select('id')
    if (dErr || !ins || (ins as unknown[]).length === 0) continue
    const meta = row.custom_metadata ?? {}
    const { data: moved } = await db
      .from('reports')
      .update({
        status: 'dismissed',
        closed_reason: DEFERRED_OVER_CAP,
        ...(row.pattern_key ? {} : { pattern_key: patternKey }),
        updated_at: nowIso,
        custom_metadata: { ...meta, cap: { tag: body.tag, from_status: row.status, from_closed_reason: row.closed_reason ?? null, prev_pattern_key: row.pattern_key ?? null, score, cap } },
      })
      .eq('id', row.id)
      .eq('status', row.status)
      .is('parent_report_id', null)
      .select('id')
    if (moved && (moved as unknown[]).length > 0) {
      out.deferred++
      continue
    }
    // The report changed meanwhile: it stays open, and its waiting row goes.
    if (!prior) await db.from('code_audit_deferred').delete().eq('id', ((ins as Array<{ id: string }>)[0]).id)
  }
  const after = await openParents(db, body.projectId)
  out.openAfter = after ?? open.length - out.deferred
  return out
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
  /** Children this run closes (apply) or would close (dry run): out of the cap's count. */
  const closing = new Set<string>()
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
      for (const k of kids) closing.add(k.id)
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
      if (moved && (moved as unknown[]).length > 0) {
        out.children++
        closing.add(k.id)
      } else out.skipped++
    }
  }
  if (body.apply) {
    const after = await openParents(db, body.projectId)
    out.after = after ?? before - out.children
  } else {
    out.after = before - out.children
  }
  if (body.cap) {
    const capped = await applyCap(db, body, body.apply ? new Set() : closing, now)
    if (capped) out.cap = capped
    else out.capFailed = true
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
