/**
 * FILE: apps/admin/src/components/portfolio/spendView.ts
 * PURPOSE: Pure view helpers for the spend ledger on /portfolio (gap #22).
 *          A source that failed to read shows "Couldn't read", never $0; a
 *          source with nothing connected shows "Not connected".
 */

import type { BadgeTone } from '../ui'
import type { BillVendor, LedgerApp, LedgerSource, SpendLedgerResponse } from '../../lib/portfolioTypes'
import { isPublicDemo } from '../../lib/publicDemo'
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

/**
 * The ledger without the public demo app (2026-11-18: keep-but-hide). Its row goes, and its
 * amounts come off the footer, so "All apps" is still the sum of the rows shown. Matched by
 * id (the page knows the demo from the portfolio and the project list) or by its name, so the
 * row stays out even when this read lands first.
 */
export function withoutPublicDemo(data: SpendLedgerResponse, demoIds: ReadonlySet<string>): SpendLedgerResponse {
  const isDemo = (a: LedgerApp) => demoIds.has(a.projectId) || isPublicDemo({ name: a.name, slug: null })
  const hidden = data.apps.filter(isDemo)
  if (hidden.length === 0) return data
  const sum = (pick: (a: LedgerApp) => number | null) => hidden.reduce((n, a) => n + (pick(a) ?? 0), 0)
  const t = data.totals
  return {
    ...data,
    apps: data.apps.filter((a) => !isDemo(a)),
    totals: {
      mushiLlmUsd: t.mushiLlmUsd - sum((a) => a.mushiLlm.usd),
      providerLlmUsd: t.providerLlmUsd - sum((a) => a.providerLlm.usd),
      ciUsd: t.ciUsd - sum((a) => a.ci.usd),
      supabaseUsd: t.supabaseUsd - sum((a) => a.supabase.usd),
      billsUsd: t.billsUsd - sum((a) => a.bills.usd),
      totalUsd: t.totalUsd - sum((a) => a.totalUsd),
    },
  }
}

/** Most spend first; an unread total still sorts by what was read. */
export function sortBySpend<T extends Pick<LedgerApp, 'totalUsd' | 'name'>>(apps: readonly T[]): T[] {
  return [...apps].sort((a, b) => b.totalUsd - a.totalUsd || a.name.localeCompare(b.name))
}

export interface SpendPart {
  key: 'mushi' | 'provider' | 'ci' | 'cloud'
  label: string
  usd: number
}

/** The four kinds of spend, in legend order (the stacked bar's segments). */
export const SPEND_PARTS: ReadonlyArray<Omit<SpendPart, 'usd'>> = [
  { key: 'mushi', label: 'Mushi Mushi AI' },
  { key: 'provider', label: 'AI provider' },
  { key: 'ci', label: 'CI' },
  { key: 'cloud', label: 'Cloud bills' },
]

/** Where an app's money goes: only sources that were read; cloud = Supabase plus imported bills. */
export function spendSplit(app: Pick<LedgerApp, 'mushiLlm' | 'providerLlm' | 'ci' | 'supabase' | 'bills'>): SpendPart[] {
  const usd = (s: LedgerSource) => (s.state === 'ok' && s.usd != null ? s.usd : 0)
  const by: Record<SpendPart['key'], number> = {
    mushi: usd(app.mushiLlm),
    provider: usd(app.providerLlm),
    ci: usd(app.ci),
    cloud: usd(app.supabase) + usd(app.bills),
  }
  return SPEND_PARTS.map((p) => ({ ...p, usd: by[p.key] }))
}

/** How many apps have nothing connected for a column (its header offers ONE connect action). */
export function notConnectedCount(apps: ReadonlyArray<Pick<LedgerApp, 'providerLlm' | 'ci' | 'supabase' | 'bills'>>, column: 'providerLlm' | 'ci' | 'supabase' | 'bills'): number {
  return apps.filter((a) => a[column].state === 'not_connected').length
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
/**
 * What removing an import did to the ledger. A day the import owned goes back
 * to the next newest import that has it, or leaves the ledger; an import whose
 * days a later import already replaced changes nothing, and says so.
 */
export function removalSummary(r: { rowsRemoved: number; rowsRestored: number; restoredFrom: number }): string {
  const days = (n: number) => `${n} row${n === 1 ? '' : 's'}`
  if (r.rowsRemoved === 0 && r.rowsRestored === 0) {
    return 'Import removed. The ledger did not change: a later import had already replaced all of its rows.'
  }
  const parts = ['Import removed.']
  if (r.rowsRemoved > 0) parts.push(`${days(r.rowsRemoved)} left the ledger.`)
  if (r.rowsRestored > 0) parts.push(`${days(r.rowsRestored)} went back to ${r.restoredFrom === 1 ? 'the earlier import' : `${r.restoredFrom} earlier imports`} that had them.`)
  return parts.join(' ')
}

export function importSummary(r: { rowsImported: number; rowsSkipped: number; totalUsd: number; periodStart: string | null; periodEnd: string | null; unmatchedApps: string[]; skipReasons: string[] }): string {
  const period = r.periodStart && r.periodEnd ? ` for ${r.periodStart} to ${r.periodEnd}` : ''
  const parts = [`Imported ${r.rowsImported} row${r.rowsImported === 1 ? '' : 's'} (${formatUsd(r.totalUsd)})${period}.`]
  if (r.rowsSkipped > 0) parts.push(`Skipped ${r.rowsSkipped}.`)
  if (r.unmatchedApps.length > 0) parts.push(`No app named: ${r.unmatchedApps.join(', ')}.`)
  if (r.skipReasons.length > 0) parts.push(r.skipReasons.slice(0, 3).join('; '))
  return parts.join(' ')
}
