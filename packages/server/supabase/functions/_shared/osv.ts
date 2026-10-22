/**
 * FILE: packages/server/supabase/functions/_shared/osv.ts
 * PURPOSE: OSV.dev client and advisory helpers (ADR 0038).
 *
 * - queryOsvBatch: POST /v1/querybatch with exact versions. It answers ids and
 *   `modified` only; a query with more than 1,000 hits (or a batch with more
 *   than 3,000) carries a per-query `next_page_token`, which is followed for
 *   that query alone (https://google.github.io/osv.dev/post-v1-querybatch/,
 *   read 2026-10-22).
 * - fetchOsvVuln: GET /v1/vulns/{id}. Withdrawn records drop out of POST
 *   queries but this still returns them, with `withdrawn` set.
 * - normalizeAdvisory / fixedVersionFor / cvss3BaseScore: pure.
 *
 * Only ecosystem, package name and version leave Mushi. Every response is
 * read with a byte cap (OSV's own HTTP/1.1 limit is 32 MiB). No API key; OSV
 * has no rate limit (FAQ, read 2026-10-22).
 */

import { fetchWithTimeout } from './http.ts'

export const OSV_API = 'https://api.osv.dev'
export const OSV_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
/** Queries per querybatch request. OSV states no item limit; this keeps each body small. */
export const OSV_BATCH_SIZE = 500
/** Follow-up pages per query before giving up (each page is ≤1,000 ids). */
const MAX_PAGES = 5

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export const defaultFetcher: Fetcher = (url, init) => fetchWithTimeout(url, init ?? {}, 30_000)

export interface OsvQuery {
  ecosystem: string
  name: string
  version: string
}

export interface OsvHit {
  id: string
  modified: string
}

export class OsvError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = 'OsvError'
  }
}

/** Read a response body as JSON, refusing more than `maxBytes`. */
export async function readJsonCapped(res: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) throw new OsvError(`response is ${declared} bytes, over the ${maxBytes} byte cap`)
  if (!res.body) return JSON.parse(await res.text())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new OsvError(`response is over the ${maxBytes} byte cap`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

interface BatchItem {
  package: { name: string; ecosystem: string }
  version: string
  page_token?: string
}

async function postBatch(items: BatchItem[], fetcher: Fetcher): Promise<Array<{ vulns?: OsvHit[]; next_page_token?: string }>> {
  let res: Response
  try {
    res = await fetcher(`${OSV_API}/v1/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: items }),
    })
  } catch (err) {
    throw new OsvError(`OSV querybatch failed: ${String(err).slice(0, 160)}`)
  }
  if (!res.ok) throw new OsvError(`OSV querybatch answered ${res.status}`, res.status)
  const body = await readJsonCapped(res, OSV_MAX_RESPONSE_BYTES) as { results?: unknown }
  const results = Array.isArray(body?.results) ? body.results as Array<{ vulns?: OsvHit[]; next_page_token?: string }> : null
  if (!results || results.length !== items.length) throw new OsvError('OSV querybatch answered a different number of results than queries')
  return results
}

/**
 * Advisory ids matching each query, in query order. A failed request
 * throws: a partial answer must not read as "no known holes".
 */
export async function queryOsvBatch(queries: readonly OsvQuery[], fetcher: Fetcher = defaultFetcher): Promise<OsvHit[][]> {
  const out: OsvHit[][] = queries.map(() => [])
  for (let start = 0; start < queries.length; start += OSV_BATCH_SIZE) {
    const slice = queries.slice(start, start + OSV_BATCH_SIZE)
    let pending: Array<{ index: number; token?: string }> = slice.map((_q, k) => ({ index: start + k }))
    for (let page = 0; pending.length > 0; page++) {
      if (page > MAX_PAGES) throw new OsvError(`OSV kept paginating after ${MAX_PAGES} pages`)
      const items = pending.map(({ index, token }) => ({
        package: { name: queries[index].name, ecosystem: queries[index].ecosystem },
        version: queries[index].version,
        ...(token ? { page_token: token } : {}),
      }))
      const results = await postBatch(items, fetcher)
      const next: Array<{ index: number; token?: string }> = []
      results.forEach((r, k) => {
        const index = pending[k].index
        for (const v of r.vulns ?? []) {
          if (v && typeof v.id === 'string') out[index].push({ id: v.id, modified: typeof v.modified === 'string' ? v.modified : '' })
        }
        if (typeof r.next_page_token === 'string' && r.next_page_token) next.push({ index, token: r.next_page_token })
      })
      pending = next
    }
  }
  return out
}

/** One OSV record, or null when OSV has none by that id. */
export async function fetchOsvVuln(id: string, fetcher: Fetcher = defaultFetcher): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetcher(`${OSV_API}/v1/vulns/${encodeURIComponent(id)}`)
  } catch (err) {
    throw new OsvError(`OSV vuln read failed: ${String(err).slice(0, 160)}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new OsvError(`OSV answered ${res.status} for ${id}`, res.status)
  const body = await readJsonCapped(res, OSV_MAX_RESPONSE_BYTES)
  return body && typeof body === 'object' ? body as Record<string, unknown> : null
}

// ── advisory shape ───────────────────────────────────────────────────────────

export interface AdvisoryRange {
  type: string
  events: Array<{ introduced?: string; fixed?: string; last_affected?: string; limit?: string }>
}

export interface AdvisoryAffected {
  ecosystem: string
  name: string
  ranges: AdvisoryRange[]
}

/** What Mushi keeps of an OSV record (vuln_advisories). */
export interface Advisory {
  id: string
  modified: string
  published: string | null
  withdrawn: string | null
  aliases: string[]
  cveIds: string[]
  summary: string
  /** The first 600 characters of `details`, for the plain-English template. */
  detailsExcerpt: string
  /** The source's own label: GitHub `CRITICAL`/`HIGH`/`MODERATE`/`LOW`, Bitnami `Critical`… */
  severityLabel: string | null
  cvssVector: string | null
  /** CVSS v3.x base score computed from the vector; null for v2/v4 vectors or none. */
  cvssScore: number | null
  /** NVD marks a contested record "** DISPUTED **"; such a record is never filed. */
  disputed: boolean
  /** The advisory page to link (osv.dev), always set. */
  url: string
  affected: AdvisoryAffected[]
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/

function asString(v: unknown, max = 2000): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

export function normalizeAdvisory(raw: Record<string, unknown>): Advisory | null {
  const id = asString(raw.id, 200)
  if (!id) return null
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.map((a) => asString(a, 200)).filter((a): a is string => Boolean(a)).slice(0, 50) : []
  const cveIds = [...new Set([id, ...aliases].filter((x) => CVE_RE.test(x)))]
  const db = asRecord(raw.database_specific)
  const severity = Array.isArray(raw.severity) ? raw.severity.map(asRecord).filter(Boolean) as Array<Record<string, unknown>> : []
  // Prefer a v3 vector (computable), then v4, then anything.
  const vector =
    severity.map((s) => asString(s.score, 300)).find((s) => s?.startsWith('CVSS:3.')) ??
    severity.map((s) => asString(s.score, 300)).find((s) => s?.startsWith('CVSS:4.')) ??
    severity.map((s) => asString(s.score, 300)).find(Boolean) ??
    null
  const summary = asString(raw.summary, 300) ?? ''
  const details = asString(raw.details, 20_000) ?? ''
  const affected: AdvisoryAffected[] = []
  for (const a of Array.isArray(raw.affected) ? raw.affected.slice(0, 200) : []) {
    const pkg = asRecord(asRecord(a)?.package)
    const ecosystem = asString(pkg?.ecosystem, 100)
    const name = asString(pkg?.name, 300)
    if (!ecosystem || !name) continue
    const ranges: AdvisoryRange[] = []
    for (const r of Array.isArray(asRecord(a)?.ranges) ? (asRecord(a)!.ranges as unknown[]) : []) {
      const rr = asRecord(r)
      const type = asString(rr?.type, 20)
      // GIT ranges are commit hashes: no package version to compare.
      if (!type || type === 'GIT' || !Array.isArray(rr?.events)) continue
      const events = (rr!.events as unknown[]).map(asRecord).filter(Boolean).map((e) => {
        const ev: AdvisoryRange['events'][number] = {}
        for (const k of ['introduced', 'fixed', 'last_affected', 'limit'] as const) {
          const v = asString(e![k], 100)
          if (v) ev[k] = v
        }
        return ev
      })
      ranges.push({ type, events })
    }
    affected.push({ ecosystem, name, ranges })
  }
  return {
    id,
    modified: asString(raw.modified, 60) ?? '',
    published: asString(raw.published, 60),
    withdrawn: asString(raw.withdrawn, 60),
    aliases,
    cveIds,
    summary,
    detailsExcerpt: details.slice(0, 600),
    severityLabel: asString(db?.severity, 30),
    cvssVector: vector,
    cvssScore: vector ? cvss3BaseScore(vector) : null,
    disputed: /\*\*\s*DISPUTED\s*\*\*/i.test(`${summary}\n${details.slice(0, 2000)}`),
    url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
    affected,
  }
}

// ── versions ─────────────────────────────────────────────────────────────────

const PRE_RANK: Record<string, number> = { dev: 0, a: 1, alpha: 1, b: 2, beta: 2, c: 3, rc: 3, pre: 3, preview: 3 }

function tokens(v: string): Array<number | string> {
  return v.trim().replace(/^v/i, '').replace(/\+.*$/, '').toLowerCase().split(/[.\-_]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/).filter(Boolean).map((t) => (/^\d+$/.test(t) ? Number(t) : t))
}

/**
 * Compare two package versions across npm, Packagist, PyPI and Go: numeric
 * parts numerically, a pre-release (1.2.0-rc.1, 1.2.0rc1, 1.2.0-beta) before
 * its release, a post-release (1.2.0.post1, 1.2.0-p1) after it. Good enough
 * to pick a fixed version from OSV's ranges; OSV itself decided the match.
 */
export function compareVersions(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i]
    const y = tb[i]
    if (x === y) continue
    if (x === undefined) return typeof y === 'string' && y in PRE_RANK ? 1 : -1
    if (y === undefined) return typeof x === 'string' && x in PRE_RANK ? -1 : 1
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return typeof y === 'string' && y in PRE_RANK ? 1 : -1
    if (typeof y === 'number') return typeof x === 'string' && x in PRE_RANK ? -1 : 1
    const rx = PRE_RANK[x] ?? 10
    const ry = PRE_RANK[y] ?? 10
    if (rx !== ry) return rx - ry
    return x < y ? -1 : 1
  }
  return 0
}

function samePackage(ecosystem: string, a: string, b: string): boolean {
  if (ecosystem === 'PyPI') return a.toLowerCase().replace(/[-_.]+/g, '-') === b.toLowerCase().replace(/[-_.]+/g, '-')
  if (ecosystem === 'Packagist') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

/**
 * The lowest version that fixes `installed`, or null when the advisory names
 * no fix for it (only `last_affected`, or an open range). A fix in a later
 * release line counts (PHP 8.1 has no 8.1 fix for php2shell; 8.2.35 is one).
 */
export function fixedVersionFor(advisory: Pick<Advisory, 'affected'>, ecosystem: string, name: string, installed: string): string | null {
  // OSV already decided that `installed` is affected; the lowest `fixed`
  // above it ends the interval it sits in (or starts a clean later line).
  const fixes: string[] = []
  for (const a of advisory.affected) {
    if (a.ecosystem !== ecosystem || !samePackage(ecosystem, a.name, name)) continue
    for (const r of a.ranges) {
      for (const e of r.events) {
        if (e.fixed !== undefined && compareVersions(e.fixed, installed) > 0) fixes.push(e.fixed)
      }
    }
  }
  return fixes.length === 0 ? null : fixes.sort(compareVersions)[0]
}

// ── CVSS v3.x base score ─────────────────────────────────────────────────────
// FIRST CVSS v3.1 specification §7.1 and Appendix A (Roundup).

const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const

function roundup(x: number): number {
  const i = Math.round(x * 100000)
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10
}

export function cvss3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null
  const m: Record<string, string> = {}
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':')
    if (k && v) m[k] = v
  }
  const av = W.AV[m.AV as keyof typeof W.AV]
  const ac = W.AC[m.AC as keyof typeof W.AC]
  const ui = W.UI[m.UI as keyof typeof W.UI]
  const c = W.CIA[m.C as keyof typeof W.CIA]
  const i = W.CIA[m.I as keyof typeof W.CIA]
  const a = W.CIA[m.A as keyof typeof W.CIA]
  const scope = m.S
  if ([av, ac, ui, c, i, a].some((x) => x === undefined) || (scope !== 'U' && scope !== 'C')) return null
  const changed = scope === 'C'
  const pr = m.PR === 'N' ? 0.85 : m.PR === 'L' ? (changed ? 0.68 : 0.62) : m.PR === 'H' ? (changed ? 0.5 : 0.27) : undefined
  if (pr === undefined) return null
  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss
  const exploitability = 8.22 * av * ac * pr * ui
  if (impact <= 0) return 0
  return changed ? roundup(Math.min(1.08 * (impact + exploitability), 10)) : roundup(Math.min(impact + exploitability, 10))
}
