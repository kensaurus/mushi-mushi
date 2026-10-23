/**
 * FILE: packages/server/supabase/functions/_shared/vuln-feeds.ts
 * PURPOSE: The enrichment feeds of ADR 0038, each pulled, never scraped:
 *          - CISA's known-exploited list: one JSON file (CC0 1.0), read once
 *            a day;
 *          - EPSS from api.first.org: exploit-likelihood per CVE, batched;
 *          - endoflife.date API v1: release lines and whether each is still
 *            supported (https://endoflife.date/docs/api/v1/, schema 1.2.1,
 *            read 2026-10-22).
 *
 * Network only; parsing is pure and exported for tests. Every read is
 * byte-capped. A failed read throws so the caller can say "not checked"
 * instead of "nothing found".
 */

import { defaultFetcher, readJsonCapped, type Fetcher } from './osv.ts'
import type { Runtime } from './runtime-detect.ts'

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
export const EPSS_URL = 'https://api.first.org/data/v1/epss'
export const ENDOFLIFE_URL = 'https://endoflife.date/api/v1/products'
/** Hosts a local-only install must allow (ADR 0034), with api.osv.dev. */
export const VULN_FEED_HOSTS = ['api.osv.dev', 'www.cisa.gov', 'api.first.org', 'endoflife.date'] as const

const KEV_MAX_BYTES = 16 * 1024 * 1024
const EPSS_MAX_BYTES = 2 * 1024 * 1024
const EOL_MAX_BYTES = 2 * 1024 * 1024
/** CVEs per EPSS request: keeps the query string short. */
export const EPSS_BATCH = 50

export class FeedError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = 'FeedError'
  }
}

async function getJson(url: string, fetcher: Fetcher, maxBytes: number, what: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'mushi-mushi/1.0 (+https://kensaur.us/mushi-mushi)' } })
  } catch (err) {
    throw new FeedError(`${what} read failed: ${String(err).slice(0, 160)}`)
  }
  if (!res.ok) throw new FeedError(`${what} answered ${res.status}`, res.status)
  try {
    return await readJsonCapped(res, maxBytes)
  } catch (err) {
    throw new FeedError(`${what} could not be read: ${String((err as Error)?.message ?? err).slice(0, 160)}`)
  }
}

// ── CISA known-exploited list ────────────────────────────────────────────────

export interface KevEntry {
  cveId: string
  dateAdded: string | null
  dueDate: string | null
  /** CISA's `knownRansomwareCampaignUse`: "Known" or "Unknown". */
  ransomware: string | null
}

export function parseKev(body: unknown): { catalogVersion: string | null; entries: KevEntry[] } {
  const b = body as { catalogVersion?: unknown; vulnerabilities?: unknown } | null
  const list = Array.isArray(b?.vulnerabilities) ? b!.vulnerabilities as Array<Record<string, unknown>> : null
  if (!list) throw new FeedError('the known-exploited list has no "vulnerabilities" array')
  const entries: KevEntry[] = []
  for (const v of list) {
    const cveId = typeof v?.cveID === 'string' && /^CVE-\d{4}-\d{4,}$/.test(v.cveID) ? v.cveID : null
    if (!cveId) continue
    const date = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null)
    entries.push({
      cveId,
      dateAdded: date(v.dateAdded),
      dueDate: date(v.dueDate),
      ransomware: typeof v.knownRansomwareCampaignUse === 'string' ? v.knownRansomwareCampaignUse.slice(0, 20) : null,
    })
  }
  return { catalogVersion: typeof b?.catalogVersion === 'string' ? b.catalogVersion.slice(0, 40) : null, entries }
}

export async function fetchKev(fetcher: Fetcher = defaultFetcher): Promise<{ catalogVersion: string | null; entries: KevEntry[] }> {
  return parseKev(await getJson(KEV_URL, fetcher, KEV_MAX_BYTES, "CISA's known-exploited list"))
}

// ── EPSS ─────────────────────────────────────────────────────────────────────

export interface EpssScore {
  cveId: string
  epss: number
  percentile: number
  date: string | null
}

export function parseEpss(body: unknown): EpssScore[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new FeedError('EPSS answered without a "data" array')
  const out: EpssScore[] = []
  for (const row of data as Array<Record<string, unknown>>) {
    const cveId = typeof row?.cve === 'string' ? row.cve : null
    const epss = Number(row?.epss)
    const percentile = Number(row?.percentile)
    if (!cveId || !Number.isFinite(epss) || epss < 0 || epss > 1) continue
    out.push({ cveId, epss, percentile: Number.isFinite(percentile) ? percentile : 0, date: typeof row.date === 'string' ? row.date.slice(0, 10) : null })
  }
  return out
}

/** EPSS for each CVE that has a score (a new CVE often has none yet). */
export async function fetchEpss(cveIds: readonly string[], fetcher: Fetcher = defaultFetcher): Promise<EpssScore[]> {
  const ids = [...new Set(cveIds.filter((c) => /^CVE-\d{4}-\d{4,}$/.test(c)))]
  const out: EpssScore[] = []
  for (let i = 0; i < ids.length; i += EPSS_BATCH) {
    const batch = ids.slice(i, i + EPSS_BATCH)
    const url = `${EPSS_URL}?cve=${batch.join(',')}&limit=${EPSS_BATCH}`
    out.push(...parseEpss(await getJson(url, fetcher, EPSS_MAX_BYTES, 'EPSS')))
  }
  return out
}

// ── endoflife.date ───────────────────────────────────────────────────────────

/** endoflife.date product names for the runtimes Mushi detects. */
export const ENDOFLIFE_PRODUCT: Readonly<Record<Runtime, string>> = { php: 'php', node: 'nodejs', python: 'python', go: 'go' }

export interface ReleaseLine {
  /** The release line: "8.3", "20", "3.12", "1.23". */
  cycle: string
  isEol: boolean
  eolFrom: string | null
  isMaintained: boolean
  latest: string | null
  latestDate: string | null
}

export function parseEndOfLife(body: unknown): ReleaseLine[] {
  const releases = (body as { result?: { releases?: unknown } } | null)?.result?.releases
  if (!Array.isArray(releases)) throw new FeedError('endoflife.date answered without result.releases')
  const out: ReleaseLine[] = []
  for (const r of releases as Array<Record<string, unknown>>) {
    const cycle = typeof r?.name === 'string' ? r.name.slice(0, 20) : null
    if (!cycle) continue
    const latest = r.latest as { name?: unknown; date?: unknown } | null
    out.push({
      cycle,
      isEol: r.isEol === true,
      eolFrom: typeof r.eolFrom === 'string' ? r.eolFrom.slice(0, 10) : null,
      isMaintained: r.isMaintained === true,
      latest: typeof latest?.name === 'string' ? latest.name.slice(0, 40) : null,
      latestDate: typeof latest?.date === 'string' ? latest.date.slice(0, 10) : null,
    })
  }
  return out
}

export async function fetchReleaseLines(runtime: Runtime, fetcher: Fetcher = defaultFetcher): Promise<ReleaseLine[]> {
  return parseEndOfLife(await getJson(`${ENDOFLIFE_URL}/${ENDOFLIFE_PRODUCT[runtime]}`, fetcher, EOL_MAX_BYTES, `endoflife.date (${runtime})`))
}
