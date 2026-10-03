/**
 * spend-ledger.ts — the per-app spend ledger (gap #22, Plan 020 §6).
 *
 *   GET    /v1/admin/orgs/:orgId/spend                     adminOrApiKey(mcp:read)  30-day ledger per app
 *   POST   /v1/admin/orgs/:orgId/spend/imports             adminOrApiKey(mcp:write), owner/admin  import a bill CSV
 *   DELETE /v1/admin/orgs/:orgId/spend/imports/:importId   adminOrApiKey(mcp:write), owner/admin  remove an import; its days go
 *                                                                                                  back to the next newest import
 *                                                                                                  that has them
 *
 * Every route follows the portfolio access rule: an account-level key (MCP,
 * CLI) or a member session, and the caller's visible apps only. Bill imports
 * write money figures every member of the team sees, so they also need the
 * session user or the key owner to be a team owner or admin.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { readBodyCapped } from '../../_shared/read-body-capped.ts'
import { aggregateBill, BILL_VENDORS, parseBillCsv, type BillVendor } from '../../_shared/spend-bill-csv.ts'
import { MAX_LEDGER_ROWS_PER_IMPORT, recordBillImport, removeBillImport } from '../../_shared/spend-bill-imports.ts'
import { buildSpendLedger } from '../../_shared/spend-ledger.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

const slog = log.child('spend-ledger')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A month of daily FOCUS or CUR rows for a few apps fits well under this. Counted in UTF-8 bytes. */
export const MAX_BILL_CSV_BYTES = 5 * 1024 * 1024
/**
 * The request body cap, checked before anything is parsed. JSON escaping can
 * double a CSV (every quote and newline becomes two bytes), so the body may be
 * up to twice the CSV cap plus room for the other fields; the CSV itself is
 * then held to MAX_BILL_CSV_BYTES exactly.
 */
export const MAX_IMPORT_BODY_BYTES = 2 * MAX_BILL_CSV_BYTES + 64 * 1024

type Db = ReturnType<typeof getServiceClient>

export interface SpendRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  now: () => Date
}

export const defaultSpendDeps: SpendRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  now: () => new Date(),
}

const importSchema = z.object({
  vendor: z.enum(BILL_VENDORS),
  /** Every row goes to this app. Omit it to match each row's app column to an app name or slug. */
  projectId: z.string().uuid().nullable().optional(),
  filename: z.string().max(200).optional(),
  csv: z.string().min(1),
}).strict()

async function isOrgAdmin(db: Db, orgId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin'
}

async function loadProjects(db: Db, ids: string[]): Promise<{ ok: true; rows: Array<{ id: string; name: string | null; slug: string | null }> } | { ok: false }> {
  if (ids.length === 0) return { ok: true, rows: [] }
  const { data, error } = await db.from('projects').select('id, name, slug').in('id', ids)
  if (error) return { ok: false }
  return { ok: true, rows: (data ?? []) as Array<{ id: string; name: string | null; slug: string | null }> }
}

export function registerSpendLedgerRoutes(app: Hono<{ Variables: Variables }>, deps: SpendRouteDeps = defaultSpendDeps): void {
  app.get('/v1/admin/orgs/:orgId/spend', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const projects = await loadProjects(db, access.projectIds)
    if (!projects.ok) return jsonError(c, 'DB_ERROR', 'The apps could not be read. Try again in a minute.', 500)
    try {
      const data = await buildSpendLedger(db, {
        organizationId: access.orgId,
        projects: projects.rows.map((p) => ({ id: p.id, name: p.name ?? p.slug ?? p.id.slice(0, 8) })),
        now: deps.now(),
      })
      return c.json({ ok: true, data })
    } catch (err) {
      slog.error('spend ledger failed', { orgId: access.orgId, err: (err as Error)?.message ?? String(err) })
      return jsonError(c, 'SPEND_FAILED', 'The spend ledger could not be built. Try again in a minute.', 500)
    }
  })

  app.post('/v1/admin/orgs/:orgId/spend/imports', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const userId = c.get('userId') as string
    if (!(await isOrgAdmin(db, access.orgId, userId))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can import bills.', 403)
    const tooLarge = () => jsonError(c, 'PAYLOAD_TOO_LARGE', 'The CSV is over 5 MB. Export daily rather than hourly rows, or split it by month.', 413)
    // Refuse an oversized upload before it is buffered or parsed: by its declared
    // length, then by the bytes that actually arrive (a chunked body has no length).
    if (Number(c.req.header('content-length') ?? '0') > MAX_IMPORT_BODY_BYTES) return tooLarge()
    const text = await readBodyCapped(c.req.raw, MAX_IMPORT_BODY_BYTES)
    if (text === null) return tooLarge()
    let raw: unknown = null
    try {
      raw = JSON.parse(text)
    } catch {
      return jsonError(c, 'VALIDATION_ERROR', 'body: the request is not valid JSON', 400)
    }
    const rawCsv = (raw as { csv?: unknown } | null)?.csv
    if (typeof rawCsv === 'string' && new TextEncoder().encode(rawCsv).byteLength > MAX_BILL_CSV_BYTES) return tooLarge()
    const parsed = importSchema.safeParse(raw)
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 400)
    const body = parsed.data
    if (body.projectId && !access.projectIds.includes(body.projectId)) return jsonError(c, 'NOT_FOUND', 'That app is not in this team.', 404)

    const bill = parseBillCsv(body.csv)
    if (!bill.ok) return jsonError(c, 'VALIDATION_ERROR', bill.error, 400)

    const projects = await loadProjects(db, access.projectIds)
    if (!projects.ok) return jsonError(c, 'DB_ERROR', 'The apps could not be read. Try again in a minute.', 500)
    const byName = new Map<string, string>()
    for (const p of projects.rows) {
      for (const n of [p.slug, p.name]) if (n) byName.set(n.trim().toLowerCase(), p.id)
    }
    const fixed = body.projectId ?? null
    const agg = aggregateBill(bill.bill.rows, (appName) => fixed ?? (appName ? byName.get(appName.trim().toLowerCase()) ?? null : null))
    if (agg.entries.length === 0) {
      const why = fixed
        ? 'No row could be imported.'
        : agg.unmatched > 0
          ? `No row named one of your apps (seen: ${agg.unmatchedApps.join(', ')}). Pick the app to import into, or add an app column with the app's name or slug.`
          : 'No row could be imported.'
      return jsonError(c, 'NOTHING_IMPORTED', `${why}${bill.bill.skipReasons.length ? ` ${bill.bill.skipReasons.slice(0, 3).join('; ')}` : ''}`, 400)
    }

    if (agg.entries.length > MAX_LEDGER_ROWS_PER_IMPORT) {
      return jsonError(c, 'PAYLOAD_TOO_LARGE', `The bill has ${agg.entries.length} distinct app, day, service and unit combinations; the limit is ${MAX_LEDGER_ROWS_PER_IMPORT}. Split it by month.`, 413)
    }

    const recorded = await recordBillImport(db, {
      organizationId: access.orgId,
      projectId: fixed,
      vendor: body.vendor,
      filename: body.filename ?? null,
      format: bill.bill.format,
      rowsRead: bill.bill.rowsRead,
      rowsImported: bill.bill.rows.length - agg.unmatched,
      rowsSkipped: bill.bill.skipped + agg.unmatched,
      totalUsd: agg.totalUsd,
      periodStart: agg.periodStart,
      periodEnd: agg.periodEnd,
      importedBy: userId,
      now: deps.now().toISOString(),
      entries: agg.entries,
    })
    if (!recorded.ok) {
      slog.error('bill import write failed', { orgId: access.orgId, err: recorded.error })
      return jsonError(c, 'DB_ERROR', 'The bill could not be saved. Nothing was imported.', 500)
    }
    const importId = recorded.importId
    return c.json({
      ok: true,
      data: {
        importId,
        format: bill.bill.format,
        rowsRead: bill.bill.rowsRead,
        rowsImported: bill.bill.rows.length - agg.unmatched,
        rowsSkipped: bill.bill.skipped + agg.unmatched,
        skipReasons: bill.bill.skipReasons,
        unmatchedApps: agg.unmatchedApps,
        totalUsd: agg.totalUsd,
        periodStart: agg.periodStart,
        periodEnd: agg.periodEnd,
      },
    })
  })

  app.delete('/v1/admin/orgs/:orgId/spend/imports/:importId', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    if (!(await isOrgAdmin(db, access.orgId, c.get('userId') as string))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can remove an import.', 403)
    const importId = c.req.param('importId') ?? ''
    if (!UUID_RE.test(importId)) return jsonError(c, 'NOT_FOUND', 'Import not found', 404)
    const { data: row, error: readError } = await db.from('spend_bill_imports').select('id, vendor').eq('id', importId).eq('organization_id', access.orgId).maybeSingle()
    if (readError) return jsonError(c, 'DB_ERROR', 'The import could not be read.', 500)
    if (!row) return jsonError(c, 'NOT_FOUND', 'Import not found', 404)
    const removed = await removeBillImport(db, {
      organizationId: access.orgId,
      importId,
      vendor: (row as { vendor: BillVendor }).vendor,
      now: deps.now().toISOString(),
    })
    if (!removed.ok) {
      slog.error('bill import removal failed', { orgId: access.orgId, importId, err: removed.error })
      return jsonError(c, 'DB_ERROR', 'The import could not be removed. Try again: a retry finishes what this one started.', 500)
    }
    return c.json({ ok: true, data: { importId, rowsRemoved: removed.rowsRemoved, rowsRestored: removed.rowsRestored, restoredFrom: removed.restoredFrom } })
  })
}
