/**
 * FILE: packages/server/supabase/functions/_shared/spend-bill-imports.ts
 * PURPOSE: The write side of the spend ledger's bill imports (gap #22).
 *
 * spend_ledger_entries holds one row per (app, vendor, day, service, unit),
 * owned by the newest import that has that key. Every import also keeps its
 * own rows in spend_bill_import_rows, so the ledger can always be rebuilt:
 *
 *   record  the new import is the newest, so it takes every key it has.
 *   remove  each key the import still owns goes back to the next newest
 *           import that has it (its amount and quantity, its import_id), or
 *           leaves the ledger when no other import has it. Keys a later
 *           import already took are left alone.
 *
 * Removal reads the keys from the ledger rows the import still owns, so a
 * removal that failed half way is finished by simply running it again.
 */

import type { getServiceClient } from './db.ts'
import type { BillVendor } from './spend-bill-csv.ts'

type Db = ReturnType<typeof getServiceClient>

/** The ledger's natural key. */
const LEDGER_KEY = 'project_id,vendor,day,service,unit'
/** Aggregated (app, day, service, unit) rows; one statement each, so an import is all or nothing. */
export const MAX_LEDGER_ROWS_PER_IMPORT = 20_000
/** Earlier imports' rows read when an import is removed. Past this the removal refuses instead of guessing. */
const MAX_FALLBACK_ROWS = 100_000

interface ImportEntry {
  projectId: string
  day: string
  service: string
  unit: string
  amountUsd: number
  quantity: number | null
}

interface RecordImportInput {
  organizationId: string
  projectId: string | null
  vendor: BillVendor
  filename: string | null
  format: string
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
  importedBy: string
  /** ISO timestamp; the import's created_at, which orders imports newest first. */
  now: string
  entries: ImportEntry[]
}

type RecordImportResult = { ok: true; importId: string } | { ok: false; error: string }

/** Record an import, keep its rows, and make it the owner of every key it has. All or nothing. */
export async function recordBillImport(db: Db, input: RecordImportInput): Promise<RecordImportResult> {
  const { data: imp, error: impError } = await db.from('spend_bill_imports').insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    vendor: input.vendor,
    filename: input.filename,
    format: input.format,
    rows_read: input.rowsRead,
    rows_imported: input.rowsImported,
    rows_skipped: input.rowsSkipped,
    total_usd: input.totalUsd,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    imported_by: input.importedBy,
    created_at: input.now,
  }).select('id').single()
  if (impError || !imp) return { ok: false, error: `the import could not be recorded${impError?.message ? `: ${impError.message}` : ''}` }
  const importId = (imp as { id: string }).id

  const base = (e: ImportEntry) => ({
    organization_id: input.organizationId,
    project_id: e.projectId,
    vendor: input.vendor,
    service: e.service,
    unit: e.unit,
    day: e.day,
    amount_usd: e.amountUsd,
    quantity: e.quantity,
    import_id: importId,
  })

  // The import's own copy first, so the ledger never holds a row its import cannot hand back.
  const { error: historyError } = await db.from('spend_bill_import_rows').insert(input.entries.map(base))
  if (historyError) {
    await db.from('spend_bill_imports').delete().eq('id', importId)
    return { ok: false, error: `the bill rows could not be kept: ${historyError.message}` }
  }

  const { error: writeError } = await db.from('spend_ledger_entries').upsert(
    input.entries.map((e) => ({ ...base(e), updated_at: input.now })),
    { onConflict: LEDGER_KEY },
  )
  if (writeError) {
    // The import row's delete cascades to its kept rows.
    await db.from('spend_bill_imports').delete().eq('id', importId)
    return { ok: false, error: `the ledger could not be written: ${writeError.message}` }
  }
  return { ok: true, importId }
}

interface OwnedRow { project_id: string; vendor: string; day: string; service: string; unit: string }
interface KeptRow extends OwnedRow { import_id: string; amount_usd: number | string; quantity: number | string | null }

const keyOf = (r: OwnedRow) => [r.project_id, r.vendor, r.day, r.service, r.unit].join('|')

type RemoveImportResult =
  | {
      ok: true
      /** Days that left the ledger: no other import had them. */
      rowsRemoved: number
      /** Days handed back to an earlier import. */
      rowsRestored: number
      /** How many earlier imports got days back. */
      restoredFrom: number
    }
  | { ok: false; error: string }

/**
 * Remove one import. Each ledger day it still owns goes back to the next
 * newest import that has the same app, vendor, day, service and unit, or is
 * deleted. Safe to run again after a failure.
 */
export async function removeBillImport(
  db: Db,
  input: { organizationId: string; importId: string; vendor: BillVendor; now: string },
): Promise<RemoveImportResult> {
  const { organizationId, importId, vendor, now } = input

  const { data: ownedData, error: ownedError } = await db
    .from('spend_ledger_entries')
    .select('project_id, vendor, day, service, unit')
    .eq('organization_id', organizationId)
    .eq('import_id', importId)
    .limit(MAX_LEDGER_ROWS_PER_IMPORT + 1)
  if (ownedError) return { ok: false, error: `the import's ledger rows could not be read: ${ownedError.message}` }
  const owned = (ownedData ?? []) as OwnedRow[]
  if (owned.length > MAX_LEDGER_ROWS_PER_IMPORT) return { ok: false, error: 'the import owns more ledger rows than one removal handles' }

  let restore: Array<Record<string, unknown>> = []
  if (owned.length > 0) {
    const projects = [...new Set(owned.map((r) => r.project_id))]
    const days = owned.map((r) => r.day).sort()
    const { data: keptData, error: keptError } = await db
      .from('spend_bill_import_rows')
      .select('import_id, project_id, vendor, day, service, unit, amount_usd, quantity')
      .eq('organization_id', organizationId)
      .eq('vendor', vendor)
      .neq('import_id', importId)
      .in('project_id', projects)
      .gte('day', days[0])
      .lte('day', days[days.length - 1])
      .limit(MAX_FALLBACK_ROWS + 1)
    if (keptError) return { ok: false, error: `the earlier imports could not be read: ${keptError.message}` }
    const kept = (keptData ?? []) as KeptRow[]
    if (kept.length > MAX_FALLBACK_ROWS) return { ok: false, error: 'too many earlier imports overlap these days to hand them back in one removal' }

    const ownedKeys = new Set(owned.map(keyOf))
    const relevant = kept.filter((r) => ownedKeys.has(keyOf(r)))
    const importIds = [...new Set(relevant.map((r) => r.import_id))]
    const createdAt = new Map<string, string>()
    if (importIds.length > 0) {
      const { data: metaData, error: metaError } = await db.from('spend_bill_imports').select('id, created_at').in('id', importIds).limit(importIds.length)
      if (metaError) return { ok: false, error: `the earlier imports could not be read: ${metaError.message}` }
      for (const m of (metaData ?? []) as Array<{ id: string; created_at: string }>) createdAt.set(m.id, m.created_at)
    }
    // Newest first; the id breaks a tie in created_at so the choice never depends on read order.
    const newer = (a: KeptRow, b: KeptRow) => {
      const ca = createdAt.get(a.import_id) ?? ''
      const cb = createdAt.get(b.import_id) ?? ''
      return ca !== cb ? ca > cb : a.import_id > b.import_id
    }
    const best = new Map<string, KeptRow>()
    for (const r of relevant) {
      // A row whose import is already gone is not a fallback.
      if (!createdAt.has(r.import_id)) continue
      const k = keyOf(r)
      const cur = best.get(k)
      if (!cur || newer(r, cur)) best.set(k, r)
    }
    restore = [...best.values()].map((r) => ({
      organization_id: organizationId,
      project_id: r.project_id,
      vendor: r.vendor,
      service: r.service,
      unit: r.unit,
      day: r.day,
      amount_usd: Number(r.amount_usd) || 0,
      quantity: r.quantity === null ? null : Number(r.quantity),
      import_id: r.import_id,
      updated_at: now,
    }))
    if (restore.length > 0) {
      const { error: restoreError } = await db.from('spend_ledger_entries').upsert(restore, { onConflict: LEDGER_KEY })
      if (restoreError) return { ok: false, error: `the earlier imports' days could not be put back: ${restoreError.message}` }
    }
  }

  const { data: removedData, error: removeError } = await db
    .from('spend_ledger_entries')
    .delete()
    .eq('organization_id', organizationId)
    .eq('import_id', importId)
    .select('id')
  if (removeError) return { ok: false, error: `the import's ledger rows could not be removed: ${removeError.message}` }
  const { error: importError } = await db.from('spend_bill_imports').delete().eq('id', importId).eq('organization_id', organizationId)
  if (importError) return { ok: false, error: `the import could not be removed: ${importError.message}` }

  return {
    ok: true,
    rowsRemoved: ((removedData ?? []) as unknown[]).length,
    rowsRestored: restore.length,
    restoredFrom: new Set(restore.map((r) => r.import_id)).size,
  }
}
