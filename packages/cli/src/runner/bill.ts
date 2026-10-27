/**
 * FILE: packages/cli/src/runner/bill.ts
 * PURPOSE: `mushi runner bill`: what GitHub actually charged for Actions,
 *          read with the user's own GitHub login (GITHUB_TOKEN, else
 *          `gh auth token`) from GitHub's billing usage API:
 *
 *            GET /users/{owner}/settings/billing/usage?year=&month=
 *            GET /organizations/{owner}/settings/billing/usage?year=&month=
 *
 *          The console reads the same bill with a project token; when that
 *          token cannot see billing, `--push` uploads what this machine read
 *          (POST /v1/admin/ci/bill). The token never leaves this machine and
 *          is never printed. Only the Actions product is kept: Copilot rows
 *          are dropped before anything is shown or sent.
 *
 *          The aggregation mirrors billingRowsFromUsage in
 *          packages/server/supabase/functions/_shared/ci-billing.ts.
 */

const GITHUB_API = 'https://api.github.com'

export type OwnerType = 'User' | 'Organization'

/** One usage item as GitHub returns it, Actions only, with the fields the server accepts. */
export interface UsageItem {
  date: string
  product: string
  sku: string
  quantity: number
  unitType?: string
  pricePerUnit?: number
  grossAmount: number
  discountAmount: number
  netAmount: number
  repositoryName?: string | null
}

interface BillRepo {
  repo: string
  grossUsd: number
  discountUsd: number
  netUsd: number
  minutes: number
}

export interface BillSummary {
  owner: string
  ownerType: OwnerType
  month: string
  grossUsd: number
  discountUsd: number
  netUsd: number
  minutes: number
  repos: BillRepo[]
  skus: Array<{ sku: string; unit: string; quantity: number; netUsd: number }>
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-cli',
  }
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export function isGithubLogin(owner: string): boolean {
  return LOGIN_RE.test(owner)
}

/** `--month YYYY-MM`, or this month (UTC). */
export function parseMonth(value: string | undefined, now: Date = new Date()): { year: number; month: number } | null {
  if (value === undefined) return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  return year >= 2020 && month >= 1 && month <= 12 ? { year, month } : null
}

/** The signed-in login (`GET /user`) and an owner's type (`GET /users/{owner}`). */
export async function lookupOwner(fetchFn: FetchFn, token: string, owner: string | undefined): Promise<{ owner: string; ownerType: OwnerType } | { error: string }> {
  let login = owner
  if (!login) {
    const me = await fetchFn(`${GITHUB_API}/user`, { headers: headers(token) })
    if (me.status !== 200) return { error: `GitHub answered ${me.status} to "who am I". Sign in with \`gh auth login\` or set GITHUB_TOKEN.` }
    login = String(((await me.json()) as { login?: unknown }).login ?? '')
  }
  if (!isGithubLogin(login)) return { error: `"${login}" is not a GitHub user or organization name.` }
  const res = await fetchFn(`${GITHUB_API}/users/${encodeURIComponent(login)}`, { headers: headers(token) })
  if (res.status !== 200) return { error: `GitHub answered ${res.status} when looking up ${login}.` }
  const type = ((await res.json()) as { type?: unknown }).type
  return { owner: login, ownerType: type === 'Organization' ? 'Organization' : 'User' }
}

/** One month of Actions usage items. 401 / 403 / 404 explain which permission the token needs. */
export async function fetchActionsUsage(
  fetchFn: FetchFn,
  token: string,
  owner: string,
  ownerType: OwnerType,
  year: number,
  month: number,
): Promise<{ items: UsageItem[]; incomplete: boolean } | { error: string }> {
  const base = ownerType === 'Organization' ? 'organizations' : 'users'
  const res = await fetchFn(`${GITHUB_API}/${base}/${encodeURIComponent(owner)}/settings/billing/usage?year=${year}&month=${month}`, { headers: headers(token) })
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return {
      error:
        ownerType === 'Organization'
          ? `GitHub refused ${owner}'s bill (${res.status}): you need to be an organization owner or billing manager, and a fine-grained token needs Administration: read.`
          : `GitHub refused ${owner}'s bill (${res.status}): use a token for ${owner} itself (\`gh auth login\` as ${owner}). A classic token, which is what gh makes, needs the user scope: run \`gh auth refresh -s user\`. A fine-grained token needs Plan: read.`,
    }
  }
  if (res.status !== 200) return { error: `GitHub answered ${res.status} to the billing read.` }
  const body = (await res.json()) as { usageItems?: unknown }
  if (!Array.isArray(body.usageItems)) return { error: 'GitHub returned a billing report this version of mushi cannot read.' }
  const items: UsageItem[] = []
  for (const raw of body.usageItems) {
    if (!raw || typeof raw !== 'object') continue
    const it = raw as Record<string, unknown>
    if (String(it.product ?? '').toLowerCase() !== 'actions') continue
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    items.push({
      date: String(it.date ?? ''),
      product: String(it.product),
      sku: String(it.sku ?? ''),
      quantity: num(it.quantity),
      ...(typeof it.unitType === 'string' ? { unitType: it.unitType } : {}),
      ...(typeof it.pricePerUnit === 'number' ? { pricePerUnit: it.pricePerUnit } : {}),
      grossAmount: num(it.grossAmount),
      discountAmount: num(it.discountAmount),
      netAmount: num(it.netAmount),
      repositoryName: typeof it.repositoryName === 'string' ? it.repositoryName : null,
    })
  }
  return { items, incomplete: /rel="next"/.test(res.headers.get('link') ?? '') }
}

const r2 = (n: number) => Math.round(n * 100) / 100

function repoName(owner: string, name: string | null | undefined): string {
  if (!name) return '(no repository)'
  return name.includes('/') ? name : `${owner}/${name}`
}

export function summarizeBill(owner: string, ownerType: OwnerType, year: number, month: number, items: readonly UsageItem[]): BillSummary {
  const repos = new Map<string, BillRepo>()
  const skus = new Map<string, { sku: string; unit: string; quantity: number; netUsd: number }>()
  let gross = 0
  let discount = 0
  let net = 0
  let minutes = 0
  for (const it of items) {
    const isMin = (it.unitType ?? '').toLowerCase() === 'minutes'
    gross += it.grossAmount
    discount += it.discountAmount
    net += it.netAmount
    if (isMin) minutes += it.quantity
    const name = repoName(owner, it.repositoryName)
    const r = repos.get(name) ?? { repo: name, grossUsd: 0, discountUsd: 0, netUsd: 0, minutes: 0 }
    r.grossUsd += it.grossAmount
    r.discountUsd += it.discountAmount
    r.netUsd += it.netAmount
    if (isMin) r.minutes += it.quantity
    repos.set(name, r)
    const s = skus.get(it.sku) ?? { sku: it.sku, unit: it.unitType ?? '', quantity: 0, netUsd: 0 }
    s.quantity += it.quantity
    s.netUsd += it.netAmount
    skus.set(it.sku, s)
  }
  return {
    owner,
    ownerType,
    month: `${year}-${String(month).padStart(2, '0')}`,
    grossUsd: r2(gross),
    discountUsd: r2(discount),
    netUsd: r2(net),
    minutes: Math.round(minutes),
    repos: [...repos.values()]
      .map((r) => ({ ...r, grossUsd: r2(r.grossUsd), discountUsd: r2(r.discountUsd), netUsd: r2(r.netUsd), minutes: Math.round(r.minutes) }))
      .sort((a, b) => b.netUsd - a.netUsd || b.grossUsd - a.grossUsd || a.repo.localeCompare(b.repo)),
    skus: [...skus.values()].map((s) => ({ ...s, quantity: Math.round(s.quantity * 100) / 100, netUsd: r2(s.netUsd) })).sort((a, b) => b.netUsd - a.netUsd),
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`

export function renderBill(b: BillSummary): string[] {
  const out: string[] = []
  out.push(`GitHub Actions bill for ${b.owner}, ${b.month} (from GitHub's billing API)`)
  out.push(`  Net ${usd(b.netUsd)}   gross ${usd(b.grossUsd)}   discount ${usd(b.discountUsd)}   ${b.minutes.toLocaleString('en-US')} min`)
  out.push('  Public repos and your plan\'s included minutes are free: they show as discount.')
  if (b.repos.length === 0) {
    out.push('  No Actions usage this month.')
    return out
  }
  out.push('')
  const width = Math.min(40, Math.max(...b.repos.map((r) => r.repo.length)))
  for (const r of b.repos) {
    out.push(`  ${r.repo.padEnd(width)}  ${usd(r.netUsd).padStart(9)} net  ${usd(r.grossUsd).padStart(9)} gross  ${r.minutes.toLocaleString('en-US').padStart(7)} min`)
  }
  return out
}
