/**
 * FILE: packages/server/supabase/functions/_shared/ci-billing.ts
 * PURPOSE: The real GitHub Actions bill (Plan 022 follow-up, 2026-10-27).
 *          Everything else on /ci estimates money from job times; this reads
 *          what GitHub charged, from the billing usage API:
 *
 *   GET /users/{owner}/settings/billing/usage?year=&month=          (Plan: read)
 *   GET /organizations/{owner}/settings/billing/usage?year=&month=  (Administration: read)
 *   https://docs.github.com/en/rest/billing/usage
 *
 *   billingRowsFromUsage  usage items → one row per (UTC day, repo, SKU), only
 *                         the Actions product. What the API returned on
 *                         2026-10-27: `product` is lowercase ("actions"),
 *                         `date` carries a time ("2026-10-01T00:47:27Z", many
 *                         items per day), and the user endpoint names repos
 *                         without the owner ("glot.it"); the org endpoint
 *                         names them "owner/repo".
 *   fetchBillingUsage     one month for one owner. 401 / 403 / 404 become a
 *                         typed `unavailable` result with a plain reason.
 *   monthsToSync          this month and last month, plus older months the
 *                         previous-period comparison needs and Mushi lacks.
 *   buildCiBill           stored rows → GET /v1/admin/ci/bill.
 *
 * Money stays in US dollars as GitHub reports it. Storage SKUs bill in
 * GigabyteHours: they count in money, never in minutes.
 *
 * Pure apart from fetchBillingUsage (injected fetch).
 */

import type { CiBill, CiBillMoney, CiBillOwner } from './ci-bill-types.ts'

export const GITHUB_API = 'https://api.github.com'
export const BILLING_API_VERSION = '2022-11-28'
/** At most this many usage items are accepted per month and owner (a CLI push included). */
export const MAX_USAGE_ITEMS = 20_000
export const DAY_MS = 24 * 60 * 60_000

export type BillingOwnerType = 'User' | 'Organization'
export type BillingSource = 'api' | 'cli'

export const BILLING_UNAVAILABLE_REASON =
  "The GitHub token can't read billing: use a token with billing read access (fine-grained: Plan read for a personal account, Administration read for an organization), or run `mushi runner bill --push`."

export const NO_BILL_REASON =
  'No GitHub bill yet. Connect a GitHub token with billing read access (fine-grained: Plan read for a personal account, Administration read for an organization) in the project\'s GitHub settings, or run `mushi runner bill --push` on a machine where `gh` is signed in.'

/**
 * Branches Mushi's coding agents push to: `<user>/MUSHI-…-local-cursor`
 * (`mushi work`), `cursor/mushi-fix-…` (Cursor cloud agents) and `mushi/…`.
 * Mirrored in SQL by ci_cost_facts (migration 20261027090000).
 */
export const MUSHI_AGENT_BRANCHES = ['*/MUSHI-*-local-cursor', 'cursor/mushi-fix-*', 'mushi/*'] as const
const AGENT_BRANCH_RE = /(?:^[^/]+\/MUSHI-.*-local-cursor$|^cursor\/mushi-fix-|^mushi\/)/

export function isMushiAgentBranch(branch: string | null | undefined): boolean {
  return !!branch && AGENT_BRANCH_RE.test(branch)
}

/** One stored bill row: `ci_billing_daily` without its ids and timestamps. */
export interface BillingDayRow {
  owner: string
  /** YYYY-MM-DD, UTC. */
  day: string
  /** `owner/repo`; '' for usage GitHub does not tie to a repository. */
  repo: string
  sku: string
  unit: string
  quantity: number
  gross_usd: number
  discount_usd: number
  net_usd: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const r2 = (n: number) => Math.round(n * 100) / 100

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

export function isGithubLogin(owner: string): boolean {
  return OWNER_RE.test(owner)
}

/** `owner/repo` from the API's repositoryName (bare on the user endpoint); '' when there is none or it is malformed. */
export function normalizeBillingRepo(owner: string, name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return ''
  const n = name.trim()
  const [a, b, extra] = n.split('/')
  if (extra !== undefined) return ''
  if (b === undefined) return REPO_NAME_RE.test(a) ? `${owner}/${a}` : ''
  return OWNER_RE.test(a) && REPO_NAME_RE.test(b) ? `${a}/${b}` : ''
}

/**
 * Usage items → one row per (day, repo, SKU), Actions only, amounts summed.
 * Owner and repo are lowercased (GitHub names are case-insensitive), so two
 * spellings of one owner never become two bills.
 * Items without a readable date, or of another product (Copilot), are left out
 * and counted in `skipped` (other products) and `invalid` (unreadable).
 */
export function billingRowsFromUsage(ownerLogin: string, items: readonly unknown[]): { rows: BillingDayRow[]; skipped: number; invalid: number } {
  const owner = ownerLogin.toLowerCase()
  const out = new Map<string, BillingDayRow>()
  let skipped = 0
  let invalid = 0
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      invalid++
      continue
    }
    const it = raw as Record<string, unknown>
    if (String(it.product ?? '').toLowerCase() !== 'actions') {
      skipped++
      continue
    }
    const day = typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(it.date) ? it.date.slice(0, 10) : null
    const sku = typeof it.sku === 'string' ? it.sku.trim().slice(0, 100) : ''
    if (!day || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || !sku) {
      invalid++
      continue
    }
    const repo = normalizeBillingRepo(owner, it.repositoryName).toLowerCase()
    const unit = typeof it.unitType === 'string' && it.unitType.trim() ? it.unitType.trim().slice(0, 40) : 'unknown'
    const key = `${day}|${repo}|${sku}`
    const row = out.get(key) ?? { owner, day, repo, sku, unit, quantity: 0, gross_usd: 0, discount_usd: 0, net_usd: 0 }
    row.quantity += num(it.quantity)
    row.gross_usd += num(it.grossAmount)
    row.discount_usd += num(it.discountAmount)
    row.net_usd += num(it.netAmount)
    out.set(key, row)
  }
  const rows = [...out.values()].map((r) => ({ ...r, quantity: r6(r.quantity), gross_usd: r6(r.gross_usd), discount_usd: r6(r.discount_usd), net_usd: r6(r.net_usd) }))
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.repo.localeCompare(b.repo) || a.sku.localeCompare(b.sku))
  return { rows, skipped, invalid }
}

export function billingUsagePath(ownerType: BillingOwnerType, owner: string, year: number, month: number): string {
  const base = ownerType === 'Organization' ? 'organizations' : 'users'
  return `/${base}/${encodeURIComponent(owner)}/settings/billing/usage?year=${year}&month=${month}`
}

export type BillingFetchResult =
  | { ok: true; items: unknown[]; incomplete: boolean }
  | { ok: false; unavailable: boolean; status: number; reason: string }

/**
 * One month of usage for one owner. 401, 403 and 404 mean the token cannot
 * read this owner's bill (GitHub answers 404 rather than 403 to a token
 * that may not see it): `unavailable`, with the reason to show. A `Link:
 * rel="next"` header (the endpoint has not paginated so far) marks the
 * result incomplete rather than silently undercounting.
 */
export async function fetchBillingUsage(opts: {
  token: string
  owner: string
  ownerType: BillingOwnerType
  year: number
  month: number
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<BillingFetchResult> {
  const doFetch = opts.fetchImpl ?? ((u: string, init: RequestInit) => fetch(u, { ...init, signal: AbortSignal.timeout(20_000) }))
  let res: Response
  try {
    res = await doFetch(`${GITHUB_API}${billingUsagePath(opts.ownerType, opts.owner, opts.year, opts.month)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': BILLING_API_VERSION,
        'User-Agent': 'mushi-mushi-ci',
      },
    })
  } catch (err) {
    return { ok: false, unavailable: false, status: 0, reason: `GitHub could not be reached: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) }
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, unavailable: true, status: res.status, reason: BILLING_UNAVAILABLE_REASON }
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, unavailable: false, status: res.status, reason: `GitHub answered ${res.status} to the billing read.` }
  }
  const body = (await res.json().catch(() => null)) as { usageItems?: unknown } | null
  if (!body || !Array.isArray(body.usageItems)) return { ok: false, unavailable: false, status: 200, reason: 'GitHub returned a billing report Mushi cannot read.' }
  const incomplete = /rel="next"/.test(res.headers.get('link') ?? '') || body.usageItems.length > MAX_USAGE_ITEMS
  return { ok: true, items: body.usageItems.slice(0, MAX_USAGE_ITEMS), incomplete }
}

export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta
  return { year: Math.floor(i / 12), month: (i % 12) + 1 }
}

/** The longest window GET /v1/admin/ci/bill serves, in days. */
export const BILL_MAX_DAYS = 90

/**
 * Months to read for one owner: always this month and last month (GitHub
 * settles a day's usage late), plus every older month back to the start of
 * the previous comparison period (2 × 30 days ago) that Mushi does not hold
 * yet (`coveredFrom`, the first day held).
 */
export function monthsToSync(now: Date, coveredFrom: string | null, comparisonDays = 30): Array<{ year: number; month: number }> {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const out = [{ year: y, month: m }, addMonths(y, m, -1)]
  const need = new Date(now.getTime() - 2 * comparisonDays * DAY_MS)
  const needStart = monthStart(need.getUTCFullYear(), need.getUTCMonth() + 1)
  for (let k = -2; k >= -4; k--) {
    const p = addMonths(y, m, k)
    const start = monthStart(p.year, p.month)
    if (start < needStart) break
    if (!coveredFrom || coveredFrom > start) out.push(p)
  }
  return out
}

/**
 * The first day Mushi holds an owner's bill from, without a gap up to today,
 * after a sync or a push. The months read form a chain from the newest one
 * down while each read worked and no month is skipped. The chain counts only
 * when it reaches today (its newest month is this month) or joins the bill
 * already held; otherwise the held span is unchanged. Reaching today, it
 * keeps the older held span only when the previous good read (`priorOkAt`)
 * fell inside the chain, so no month between them went unread.
 */
export function nextCoveredFrom(
  existing: string | null,
  results: ReadonlyArray<{ year: number; month: number; ok: boolean }>,
  now: Date,
  priorOkAt: string | null = null,
): string | null {
  const idx = (r: { year: number; month: number }) => r.year * 12 + (r.month - 1)
  const sorted = [...results].sort((a, b) => idx(b) - idx(a))
  if (sorted.length === 0 || !sorted[0].ok) return existing
  const top = sorted[0]
  const next = addMonths(top.year, top.month, 1)
  const isCurrent = idx(top) === now.getUTCFullYear() * 12 + now.getUTCMonth()
  if (!isCurrent && !(existing && existing <= monthStart(next.year, next.month))) return existing
  let earliest = top
  for (const r of sorted.slice(1)) {
    if (!r.ok || idx(r) !== idx(earliest) - 1) break
    earliest = r
  }
  const start = monthStart(earliest.year, earliest.month)
  if (!existing || existing >= start) return start
  if (isCurrent && !(priorOkAt && priorOkAt.slice(0, 10) >= start)) return start
  return existing
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/ci/bill
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredBillRow extends BillingDayRow {
  source: BillingSource
}

export interface BillSyncRow {
  owner: string
  owner_type: string | null
  last_ok_at: string | null
  last_attempt_at: string | null
  last_error: string | null
  last_source: string | null
  covered_from: string | null
}

export interface BuildCiBillInput {
  now: Date
  days: number
  rows: readonly StoredBillRow[]
  sync: readonly BillSyncRow[]
  /** Paid (private, GitHub-hosted) billed minutes from ci_jobs, and those on agent branches. */
  agent: { billedMinutes: number; agentBilledMinutes: number } | null
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const zero = (): CiBillMoney => ({ grossUsd: 0, discountUsd: 0, netUsd: 0 })
const isMinutes = (unit: string) => unit.toLowerCase() === 'minutes'

function add(m: CiBillMoney, r: BillingDayRow): void {
  m.grossUsd += num(r.gross_usd)
  m.discountUsd += num(r.discount_usd)
  m.netUsd += num(r.net_usd)
}

function round(m: CiBillMoney): CiBillMoney {
  return { grossUsd: r2(m.grossUsd), discountUsd: r2(m.discountUsd), netUsd: r2(m.netUsd) }
}

export function buildCiBill(input: BuildCiBillInput): CiBill {
  const { now, days } = input
  const today = isoDay(now)
  // The window holds `days` whole UTC days ending today.
  const from = isoDay(new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS))
  const prevFrom = isoDay(new Date(Date.parse(`${from}T00:00:00Z`) - days * DAY_MS))
  const prevTo = isoDay(new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS))
  const monthFrom = `${today.slice(0, 7)}-01`

  const owners: CiBillOwner[] = input.sync
    .map((s): CiBillOwner => ({
      owner: s.owner,
      ownerType: s.owner_type === 'User' || s.owner_type === 'Organization' ? s.owner_type : null,
      lastOkAt: s.last_ok_at,
      lastAttemptAt: s.last_attempt_at,
      lastError: s.last_error,
      lastSource: s.last_source === 'api' || s.last_source === 'cli' ? s.last_source : null,
      coveredFrom: s.covered_from,
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner))
  const read = owners.filter((o) => o.lastOkAt)
  const available = read.length > 0 || input.rows.length > 0
  // A span is complete only when every owner whose bill was read is held from its first day.
  const coveredFrom = (d: string) => read.length > 0 && read.every((o) => !!o.coveredFrom && (o.coveredFrom as string) <= d)

  const totals = { ...zero(), minutes: 0 }
  const prev = { ...zero(), minutes: 0 }
  const month = zero()
  const byRepo = new Map<string, CiBillMoney & { repo: string; owner: string; minutes: number }>()
  const bySku = new Map<string, CiBillMoney & { sku: string; unit: string; quantity: number }>()
  const byDay = new Map<string, CiBillMoney>()
  let dataThrough: string | null = null

  for (const r of input.rows) {
    if (r.day > today) continue
    if (!dataThrough || r.day > dataThrough) dataThrough = r.day
    if (r.day >= monthFrom) add(month, r)
    if (r.day >= prevFrom && r.day <= prevTo) {
      add(prev, r)
      if (isMinutes(r.unit)) prev.minutes += num(r.quantity)
    }
    if (r.day < from) continue
    add(totals, r)
    if (isMinutes(r.unit)) totals.minutes += num(r.quantity)
    const repoKey = r.repo.toLowerCase()
    const re = byRepo.get(repoKey) ?? { ...zero(), repo: r.repo, owner: r.owner, minutes: 0 }
    add(re, r)
    if (isMinutes(r.unit)) re.minutes += num(r.quantity)
    byRepo.set(repoKey, re)
    const se = bySku.get(r.sku) ?? { ...zero(), sku: r.sku, unit: r.unit, quantity: 0 }
    add(se, r)
    se.quantity += num(r.quantity)
    bySku.set(r.sku, se)
    const de = byDay.get(r.day) ?? zero()
    add(de, r)
    byDay.set(r.day, de)
  }

  const dayList: CiBill['byDay'] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${today}T00:00:00Z`); t += DAY_MS) {
    const d = isoDay(new Date(t))
    dayList.push({ day: d, ...round(byDay.get(d) ?? zero()) })
  }

  const previousComplete = available && coveredFrom(prevFrom)
  const previousTotals = previousComplete ? { ...round(prev), minutes: Math.round(prev.minutes) } : null
  const totalsOut = { ...round(totals), minutes: Math.round(totals.minutes) }
  const change = previousTotals
    ? {
        netUsd: r2(totalsOut.netUsd - previousTotals.netUsd),
        netPct: previousTotals.netUsd > 0 ? Math.round(((totalsOut.netUsd - previousTotals.netUsd) / previousTotals.netUsd) * 1000) / 1000 : null,
      }
    : null

  const agent = input.agent
  return {
    generatedAt: now.toISOString(),
    window: { days, from, to: today },
    previousWindow: { from: prevFrom, to: prevTo },
    provenance: 'measured',
    currency: 'USD',
    available,
    repoScoped: false,
    unavailableReason: available ? null : (owners.find((o) => o.lastError)?.lastError ?? NO_BILL_REASON),
    owners,
    month: { label: today.slice(0, 7), from: monthFrom, ...round(month) },
    totals: totalsOut,
    previousTotals,
    change,
    windowComplete: available && coveredFrom(from),
    byRepo: [...byRepo.values()]
      .map((r) => ({ ...r, ...round(r), minutes: Math.round(r.minutes) }))
      .sort((a, b) => b.netUsd - a.netUsd || b.grossUsd - a.grossUsd || a.repo.localeCompare(b.repo)),
    bySku: [...bySku.values()]
      .map((s) => ({ ...s, ...round(s), quantity: Math.round(s.quantity * 100) / 100 }))
      .sort((a, b) => b.netUsd - a.netUsd || b.grossUsd - a.grossUsd),
    byDay: dayList,
    dataThrough,
    agentShare:
      agent && agent.billedMinutes > 0
        ? {
            provenance: 'estimated',
            billedMinutes: agent.billedMinutes,
            agentBilledMinutes: agent.agentBilledMinutes,
            share: Math.round((agent.agentBilledMinutes / agent.billedMinutes) * 1000) / 1000,
            branches: [...MUSHI_AGENT_BRANCHES],
          }
        : null,
  }
}
