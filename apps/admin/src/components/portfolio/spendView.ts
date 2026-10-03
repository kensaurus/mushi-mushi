/**
 * FILE: apps/admin/src/components/portfolio/spendView.ts
 * PURPOSE: Pure view helpers for the spend ledger on /portfolio (gap #22).
 *          A source that failed to read shows "Couldn't read", never $0; a
 *          source with nothing connected shows "Not connected".
 */

import type { BadgeTone } from '../ui'
import type { BillVendor, LedgerApp, LedgerSource } from '../../lib/portfolioTypes'
import { formatUsd } from './portfolioView'

export interface LedgerCell {
  text: string
  /** Muted for not connected, danger for a failed read, none for an amount. */
  tone: 'amount' | 'muted' | 'danger'
  title: string | undefined
}

export function ledgerCell(source: LedgerSource): LedgerCell {
  if (source.state === 'error') return { text: "Couldn't read", tone: 'danger', title: source.detail ?? 'This source could not be read. The total leaves it out.' }
  if (source.state === 'not_connected' || source.usd === null) return { text: 'Not connected', tone: 'muted', title: source.detail ?? undefined }
  return { text: formatUsd(source.usd), tone: 'amount', title: source.detail ?? undefined }
}

/** The app total, marked when a source failed so it reads as "at least". */
export function ledgerTotal(app: Pick<LedgerApp, 'totalUsd' | 'complete'>): { text: string; tone: BadgeTone | null; title: string | undefined } {
  if (!app.complete) return { text: `${formatUsd(app.totalUsd)}+`, tone: 'warnSubtle', title: 'At least this much: a source could not be read and is left out.' }
  return { text: formatUsd(app.totalUsd), tone: null, title: undefined }
}

const VENDOR_LABEL: Record<BillVendor, string> = { vercel: 'Vercel', aws: 'AWS', supabase: 'Supabase', other: 'Other' }

export function vendorLabel(v: BillVendor): string {
  return VENDOR_LABEL[v] ?? v
}

/** "Vercel $20.00 · AWS $3.10" for the bills cell title. */
export function billsBreakdown(app: Pick<LedgerApp, 'bills'>): string | undefined {
  if (app.bills.state !== 'ok' || app.bills.byVendor.length === 0) return app.bills.detail ?? undefined
  return app.bills.byVendor.map((b) => `${vendorLabel(b.vendor)} ${formatUsd(b.usd)}`).join(' · ')
}

/** "120 GB Egress · 1.2M Function invocations" for the Supabase cell title. */
export function supabaseUsage(app: Pick<LedgerApp, 'supabase'>): string | undefined {
  if (app.supabase.state !== 'ok') return app.supabase.detail ?? undefined
  if (app.supabase.usage.length === 0) return app.supabase.detail ?? undefined
  return app.supabase.usage.map((u) => `${u.quantity.toLocaleString('en-US')} ${u.unit}${u.service ? ` ${u.service}` : ''}`).join(' · ')
}

/** A summary of an import result a person can act on. */
export function importSummary(r: { rowsImported: number; rowsSkipped: number; totalUsd: number; periodStart: string | null; periodEnd: string | null; unmatchedApps: string[]; skipReasons: string[] }): string {
  const period = r.periodStart && r.periodEnd ? ` for ${r.periodStart} to ${r.periodEnd}` : ''
  const parts = [`Imported ${r.rowsImported} row${r.rowsImported === 1 ? '' : 's'} (${formatUsd(r.totalUsd)})${period}.`]
  if (r.rowsSkipped > 0) parts.push(`Skipped ${r.rowsSkipped}.`)
  if (r.unmatchedApps.length > 0) parts.push(`No app named: ${r.unmatchedApps.join(', ')}.`)
  if (r.skipReasons.length > 0) parts.push(r.skipReasons.slice(0, 3).join('; '))
  return parts.join(' ')
}
