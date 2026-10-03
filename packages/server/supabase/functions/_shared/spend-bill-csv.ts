/**
 * FILE: packages/server/supabase/functions/_shared/spend-bill-csv.ts
 * PURPOSE: Read a cloud bill CSV into per-day amounts (gap #22). Pure: no I/O.
 *
 * Three layouts are recognised from the header row:
 *   - focus:   the FinOps FOCUS export both Vercel and AWS Data Exports offer
 *              (BilledCost, ChargePeriodStart, ServiceName, ConsumedQuantity,
 *              ConsumedUnit, BillingCurrency, Tags).
 *   - aws_cur: an AWS Cost and Usage Report, legacy (lineItem/UnblendedCost)
 *              or 2.0 (line_item_unblended_cost) column names.
 *   - generic: any CSV with a date column and a cost column, plus optional
 *              service, quantity, unit, currency and app columns.
 *
 * Dates must be ISO (YYYY-MM-DD, optionally with a time); a 03/04/2026 style
 * date is skipped rather than guessed. Rows in another currency are skipped.
 * Every skipped row is counted and the first few are explained.
 */

export const BILL_VENDORS = ['vercel', 'aws', 'supabase', 'other'] as const
export type BillVendor = (typeof BILL_VENDORS)[number]
export type BillFormat = 'focus' | 'aws_cur' | 'generic'

export const MAX_BILL_ROWS = 50_000
const MAX_EXPLAINED_SKIPS = 10

export interface BillRow {
  day: string
  service: string
  unit: string
  amountUsd: number
  quantity: number | null
  /** The app named on the row (an app column or an app/project tag), if any. */
  app: string | null
}

export interface ParsedBill {
  format: BillFormat
  rowsRead: number
  rows: BillRow[]
  skipped: number
  /** The first few skipped rows, as "line N: reason". */
  skipReasons: string[]
}

export type ParseBillResult = { ok: true; bill: ParsedBill } | { ok: false; error: string }

/** RFC 4180 records: quoted cells, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) records.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) records.push(row)
  return records
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

const ALIASES = {
  date: ['chargeperiodstart', 'lineitem/usagestartdate', 'line_item_usage_start_date', 'date', 'day', 'usage date', 'usage_date', 'billing date', 'start date', 'period start'],
  cost: ['billedcost', 'lineitem/unblendedcost', 'line_item_unblended_cost', 'cost', 'cost (usd)', 'cost_usd', 'amount', 'amount_usd', 'amount (usd)', 'usd', 'total', 'total cost', 'charge'],
  service: ['servicename', 'product/productname', 'product_product_name', 'lineitem/productcode', 'line_item_product_code', 'service', 'product', 'metric', 'resource', 'line item', 'description'],
  quantity: ['consumedquantity', 'lineitem/usageamount', 'line_item_usage_amount', 'quantity', 'usage', 'usage quantity', 'amount used'],
  unit: ['consumedunit', 'pricing/unit', 'pricing_unit', 'unit', 'usage unit', 'units'],
  currency: ['billingcurrency', 'lineitem/currencycode', 'line_item_currency_code', 'currency', 'currency code'],
  app: ['app', 'project', 'project name', 'project_name', 'projectname', 'resourcetags/user:app', 'resourcetags/user:project', 'resourcetags/user:mushi-app', 'resource_tags_user_app', 'resource_tags_user_project'],
  tags: ['tags'],
} as const

type ColumnKey = keyof typeof ALIASES
type ColumnMap = Record<ColumnKey, number>

function columnMap(header: string[]): ColumnMap {
  const h = header.map(norm)
  const out = {} as ColumnMap
  for (const key of Object.keys(ALIASES) as ColumnKey[]) {
    out[key] = -1
    for (const alias of ALIASES[key]) {
      const i = h.indexOf(alias)
      if (i >= 0) {
        out[key] = i
        break
      }
    }
  }
  return out
}

function detectFormat(header: string[]): BillFormat {
  const h = header.map(norm)
  if (h.includes('billedcost') && h.includes('chargeperiodstart')) return 'focus'
  if (h.includes('lineitem/unblendedcost') || h.includes('line_item_unblended_cost')) return 'aws_cur'
  return 'generic'
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/

/** The UTC day of an ISO date or date-time, or null. */
export function billDay(raw: string): string | null {
  const v = raw.trim()
  const m = ISO_DAY.exec(v)
  if (!m) return null
  const [, y, mo, d] = m
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d))
  const back = new Date(t)
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return null
  // A date-time with an offset can fall on another UTC day; read it fully.
  if (v.length > 10 && /[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const parsed = Date.parse(v)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  }
  return `${y}-${mo}-${d}`
}

/** "$1,234.50", "(12.00)" and "-3" as numbers; null when not a number. */
export function billAmount(raw: string): number | null {
  let v = raw.trim().replace(/[$,\s]/g, '')
  if (v === '') return null
  let negative = false
  if (/^\(.*\)$/.test(v)) {
    negative = true
    v = v.slice(1, -1)
  }
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(v)) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function appFromTags(raw: string): string | null {
  const v = raw.trim()
  if (!v.startsWith('{')) return null
  try {
    const tags = JSON.parse(v) as Record<string, unknown>
    for (const key of ['mushi-app', 'app', 'project', 'projectName', 'ProjectName', 'user:app', 'user:project']) {
      const t = tags[key]
      if (typeof t === 'string' && t.trim()) return t.trim()
    }
  } catch {
    // Not JSON: no app.
  }
  return null
}

/** Parse a bill CSV. Fails only when the header has no date or no cost column, or the file is too big. */
export function parseBillCsv(text: string): ParseBillResult {
  const records = parseCsvRecords(text)
  if (records.length === 0) return { ok: false, error: 'The file is empty.' }
  const header = records[0]
  const col = columnMap(header)
  if (col.date < 0 || col.cost < 0) {
    return { ok: false, error: 'Mushi could not find a date column and a cost column. Upload a FOCUS export (Vercel or AWS), an AWS Cost and Usage Report, or a CSV with date, service and cost columns.' }
  }
  const data = records.slice(1)
  if (data.length > MAX_BILL_ROWS) return { ok: false, error: `The file has ${data.length} rows; the limit is ${MAX_BILL_ROWS}. Export daily rather than hourly, or split the file by month.` }

  const rows: BillRow[] = []
  const skipReasons: string[] = []
  let skipped = 0
  const skip = (line: number, reason: string) => {
    skipped++
    if (skipReasons.length < MAX_EXPLAINED_SKIPS) skipReasons.push(`line ${line}: ${reason}`)
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  data.forEach((r, idx) => {
    const line = idx + 2
    const currency = cell(r, col.currency)
    if (currency && currency.toUpperCase() !== 'USD') return skip(line, `currency ${currency.slice(0, 10)} is not USD`)
    const day = billDay(cell(r, col.date))
    if (!day) return skip(line, 'the date is not YYYY-MM-DD')
    const amount = billAmount(cell(r, col.cost))
    if (amount === null) return skip(line, 'the cost is not a number')
    const qtyRaw = cell(r, col.quantity)
    const quantity = qtyRaw ? billAmount(qtyRaw) : null
    const app = cell(r, col.app) || (col.tags >= 0 ? appFromTags(cell(r, col.tags)) : null)
    rows.push({
      day,
      service: cell(r, col.service).slice(0, 120),
      unit: cell(r, col.unit).slice(0, 60),
      amountUsd: amount,
      quantity,
      app: app ? app.slice(0, 200) : null,
    })
  })

  return { ok: true, bill: { format: detectFormat(header), rowsRead: data.length, rows, skipped, skipReasons } }
}

export interface LedgerEntryDraft {
  projectId: string
  day: string
  service: string
  unit: string
  amountUsd: number
  quantity: number | null
}

export interface AggregatedBill {
  entries: LedgerEntryDraft[]
  /** Rows whose app could not be matched to one of the caller's apps. */
  unmatched: number
  unmatchedApps: string[]
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
}

/**
 * Sum rows per (app, day, service, unit). `resolveProject` maps a row's app
 * name to a project id; with a fixed target app it ignores the name.
 */
export function aggregateBill(rows: readonly BillRow[], resolveProject: (app: string | null) => string | null): AggregatedBill {
  const byKey = new Map<string, LedgerEntryDraft>()
  const unmatchedApps = new Set<string>()
  let unmatched = 0
  let total = 0
  let periodStart: string | null = null
  let periodEnd: string | null = null
  for (const r of rows) {
    const projectId = resolveProject(r.app)
    if (!projectId) {
      unmatched++
      unmatchedApps.add(r.app ?? '(no app column)')
      continue
    }
    const key = `${projectId}|${r.day}|${r.service}|${r.unit}`
    const e = byKey.get(key) ?? { projectId, day: r.day, service: r.service, unit: r.unit, amountUsd: 0, quantity: null }
    e.amountUsd += r.amountUsd
    if (r.quantity !== null) e.quantity = (e.quantity ?? 0) + r.quantity
    byKey.set(key, e)
    total += r.amountUsd
    if (!periodStart || r.day < periodStart) periodStart = r.day
    if (!periodEnd || r.day > periodEnd) periodEnd = r.day
  }
  const entries = [...byKey.values()].map((e) => ({ ...e, amountUsd: Math.round(e.amountUsd * 10000) / 10000 }))
  return { entries, unmatched, unmatchedApps: [...unmatchedApps].slice(0, 10), totalUsd: Math.round(total * 100) / 100, periodStart, periodEnd }
}
