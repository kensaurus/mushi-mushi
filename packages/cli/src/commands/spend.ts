/**
 * FILE: packages/cli/src/commands/spend.ts
 * PURPOSE: `mushi spend show|import|remove` — console parity for the spend
 *          ledger on the Portfolio page:
 *            show                → GET    /v1/admin/orgs/:orgId/spend
 *            import <file>       → POST   /v1/admin/orgs/:orgId/spend/imports
 *            remove <importId>   → DELETE /v1/admin/orgs/:orgId/spend/imports/:importId
 *          Needs an account-level key; imports and removals need the key
 *          owner to be a team owner or admin. `remove` needs --yes.
 */

import type { Command } from 'commander'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { apiCall, fmtDate, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment, requireYes } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

const VENDORS = ['vercel', 'aws', 'supabase', 'other'] as const
/** The api's cap on the CSV itself; refused here before the upload. */
const MAX_BILL_CSV_BYTES = 5 * 1024 * 1024
/** A 5 MB bill is parsed and reconciled before the api answers. */
const IMPORT_TIMEOUT_MS = 60_000

interface LedgerApp {
  projectId: string
  name: string
  totalUsd: number
}

interface LedgerData {
  organizationId: string
  from: string
  to: string
  days: number
  apps: LedgerApp[]
  totals: { mushiLlmUsd: number; providerLlmUsd: number; ciUsd: number; supabaseUsd: number; billsUsd: number; totalUsd: number }
  unattributedProviderUsd: number | null
  complete: boolean
  imports: Array<{ id: string; vendor: string; filename: string | null; totalUsd: number; periodStart: string | null; periodEnd: string | null; createdAt: string }>
}

interface ImportResult {
  importId: string
  format: string
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  skipReasons: string[]
  unmatchedApps: string[]
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
}

const usd = (n: number | null | undefined): string => `$${(n ?? 0).toFixed(2)}`
const ORG_FLAG = '--org <id>'
const ORG_DESC = 'Organization UUID (default: your only organization)'

function renderLedger(d: LedgerData): string[] {
  const lines = [`Spend ${d.from.slice(0, 10)} → ${d.to.slice(0, 10)} (${d.days} days): ${usd(d.totals.totalUsd)}`]
  lines.push(`  Mushi AI ${usd(d.totals.mushiLlmUsd)} · provider AI ${usd(d.totals.providerLlmUsd)} · CI ${usd(d.totals.ciUsd)} · Supabase ${usd(d.totals.supabaseUsd)} · bills ${usd(d.totals.billsUsd)}`)
  for (const a of [...d.apps].sort((x, y) => y.totalUsd - x.totalUsd)) lines.push(`  ${oneLine(a.name, 36).padEnd(36)} ${usd(a.totalUsd).padStart(10)}`)
  if (d.unattributedProviderUsd) lines.push(`  Provider AI not bound to an app: ${usd(d.unattributedProviderUsd)}`)
  if (!d.complete) lines.push('  Some sources could not be read; the totals are a floor.')
  if (d.imports.length > 0) {
    lines.push('Recent bill imports:')
    for (const i of d.imports) lines.push(`  ${i.vendor.padEnd(9)} ${usd(i.totalUsd).padStart(10)}  ${i.periodStart ?? '—'} → ${i.periodEnd ?? '—'}  ${oneLine(i.filename ?? '', 30)}  ${fmtDate(i.createdAt)}  (${i.id})`)
  }
  return lines
}

export function registerSpendCommands(program: Command): void {
  const spend = program
    .command('spend')
    .description('What each app costs: Mushi AI, provider AI, CI, Supabase and imported bills (needs an account-level key)')

  spend
    .command('show')
    .description('The 30-day ledger per app, and the latest bill imports')
    .option(ORG_FLAG, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<LedgerData>(`/v1/admin/orgs/${orgSegment(opts.org)}/spend`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderLedger(result.data)) console.log(line)
    })

  spend
    .command('import <file>')
    .description('Import a bill CSV (FOCUS, AWS CUR, or date,service,cost); a re-import of the same days replaces them')
    .requiredOption('--vendor <vendor>', VENDORS.join(' | '))
    .option('--project-id <id>', 'Put every row on this app (default: match an app column by name or slug)')
    .option(ORG_FLAG, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')
    .action(async (file: string, opts: { vendor: string; projectId?: string; org?: string; json?: boolean }) => {
      if (!(VENDORS as readonly string[]).includes(opts.vendor)) throw new MushiCliError('E_INVALID_INPUT', `--vendor must be one of ${VENDORS.join(', ')}`)
      const projectId = opts.projectId ? requireUuid(opts.projectId, 'project id') : undefined
      let size: number
      try {
        size = statSync(file).size
      } catch {
        throw new MushiCliError('E_INVALID_INPUT', `Cannot read ${file}.`)
      }
      if (size > MAX_BILL_CSV_BYTES) throw new MushiCliError('E_INVALID_INPUT', `${file} is over 5 MB.`, 'export daily rather than hourly rows, or split it by month')
      const csv = readFileSync(file, 'utf8')
      const config = requireConfig()
      const result = await apiCall<ImportResult>(
        `/v1/admin/orgs/${orgSegment(opts.org)}/spend/imports`,
        config,
        { method: 'POST', body: JSON.stringify({ vendor: opts.vendor, csv, filename: basename(file), ...(projectId ? { projectId } : {}) }) },
        { timeoutMs: IMPORT_TIMEOUT_MS },
      )
      if (!result.ok) dieOrgError(result)
      const r = result.data
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(r, null, 2))
        return
      }
      console.log(`Imported ${r.rowsImported} of ${r.rowsRead} row(s) (${r.format}), ${usd(r.totalUsd)} for ${r.periodStart ?? '—'} → ${r.periodEnd ?? '—'}. Import ${r.importId}.`)
      if (r.unmatchedApps.length > 0) console.log(`  No app matched: ${r.unmatchedApps.map((a) => oneLine(a, 40)).join(', ')}`)
      for (const reason of r.skipReasons.slice(0, 5)) console.log(`  Skipped: ${oneLine(reason, 120)}`)
    })

  spend
    .command('remove <importId>')
    .description('Remove a bill import; its days go back to the next newest import that has them')
    .option('--yes', 'Confirm the removal')
    .option(ORG_FLAG, ORG_DESC)
    .action(async (importId: string, opts: { yes?: boolean; org?: string }) => {
      const id = requireUuid(importId, 'import id')
      requireYes(opts.yes, 'This removes the import and its rows from the ledger.')
      const config = requireConfig()
      const result = await apiCall<{ importId: string; rowsRemoved: number; rowsRestored: number; restoredFrom: number }>(
        `/v1/admin/orgs/${orgSegment(opts.org)}/spend/imports/${id}`,
        config,
        { method: 'DELETE' },
      )
      if (!result.ok) dieOrgError(result)
      console.log(`Removed import ${id}: ${result.data.rowsRemoved} row(s) removed, ${result.data.rowsRestored} restored from ${result.data.restoredFrom} older import(s).`)
    })
}
