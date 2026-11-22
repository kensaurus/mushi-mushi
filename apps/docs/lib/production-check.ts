/**
 * The free Production Check page (/check): API calls and the pure helpers the
 * page renders with. The server side is
 * packages/server/supabase/functions/api/routes/production-check.ts.
 *
 * The docs site is a static export, so a report lives at `/check?id=<uuid>`
 * (the link we share and email). `/check/<uuid>` also works: the docs 404 page
 * renders the report for that path (app/check/CheckPathFallback.tsx).
 */

import { PUBLIC_API_URL } from './public-diagram'
import { DOCS_SITE } from './structured-data'

export type Severity = 'high' | 'medium' | 'low'

export interface CheckFinding {
  rule: string
  severity: Severity
  title: string
  why: string
  /** The developer steps. */
  fix: string
  /** What to paste into an AI builder. Reports stored before 2026-11-12 have none. */
  prompt?: string
  where?: string[]
}

export interface CheckReport {
  id: string
  url: string
  status: 'running' | 'done' | 'failed'
  findings: CheckFinding[]
  summary: {
    pages?: Array<{ path: string; status: number | null }>
    headers?: Record<string, boolean>
    https?: 'ok' | 'not_redirected' | 'no_https' | 'unknown'
    linksChecked?: number
    scriptsChecked?: number
    incomplete?: string[]
  }
  error: string | null
  created_at: string
  finished_at: string | null
}

/** The two next steps under a report: the no-code guide first, then the editor quickstart. */
export const CHECK_NEXT = {
  heading: 'Next: let your users tell you what else is broken.',
  body: 'This checked what a first visitor sees today. A report button in your app lets the people who use it tell you about the rest, and Mushi Mushi explains each report in plain English.',
  primary: { label: 'Add the report button (Lovable or Bolt, about 5 minutes)', href: '/quickstart/lovable-bolt?src=check-result', ctaId: 'check_next_lovable' },
  secondary: { label: 'I use Cursor or Claude Code', href: '/quickstart?src=check-result', ctaId: 'check_next_editor' },
} as const

/** What to paste into an AI builder for one finding: its prompt, or the fix text of an older report. */
export function findingPrompt(f: Pick<CheckFinding, 'prompt' | 'fix'>): string {
  return f.prompt?.trim() || f.fix
}

/** Every finding as one numbered prompt, worst first (the order the report shows). */
export function allFindingsPrompt(url: string, findings: readonly CheckFinding[]): string {
  const ordered = groupBySeverity(findings).flatMap((g) => g.items)
  if (ordered.length === 0) return ''
  if (ordered.length === 1) return findingPrompt(ordered[0])
  const lines = ordered.map((f, i) => `${i + 1}. ${findingPrompt(f)}`)
  return [`A check of my published site ${hostOf(url)} found ${ordered.length} problems. Fix them one at a time, in this order, and tell me what you changed after each one.`, '', ...lines].join('\n')
}

/** `&cached=1` on a report link: the landing box landed on a report that already existed. */
export function cachedFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('cached') === '1'
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'Fix first',
  medium: 'Fix soon',
  low: 'Nice to fix',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CHECK_PAGE_URL = `${DOCS_SITE}/check`

/** The share link for a report. */
export function reportShareUrl(id: string): string {
  return `${CHECK_PAGE_URL}?id=${id}`
}

/** The report id from `?id=` or from a `/check/<uuid>` path; null when there is none. */
export function checkIdFromLocation(pathname: string, search: string): string | null {
  const fromQuery = new URLSearchParams(search).get('id')
  if (fromQuery && UUID_RE.test(fromQuery)) return fromQuery.toLowerCase()
  const m = /\/check\/([0-9a-f-]{36})\/?$/i.exec(pathname)
  return m && UUID_RE.test(m[1]) ? m[1].toLowerCase() : null
}

/** True on `/…/check/<uuid>` (the static export has no page there; the 404 renders it). */
export function isCheckReportPath(pathname: string): boolean {
  return /\/check\/[0-9a-f-]{36}\/?$/i.test(pathname) && checkIdFromLocation(pathname, '') !== null
}

/** `?src=` passed through to the check (where the visitor came from), sanitized. */
/**
 * The address a link pre-fills (`/check?url=…`, e.g. from an outreach email):
 * http(s) only and at most 2048 characters. It only fills the field: the
 * visitor still presses the button, so a link preview or a bot opening the
 * link spends no check.
 */
export function urlFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get('url')?.trim()
  if (!v || v.length > 2048) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? v : null
  } catch {
    return null
  }
}

export function srcFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get('src')
  return v && /^[A-Za-z0-9._:-]{1,64}$/.test(v) ? v : null
}

/** Findings grouped high → low, empty groups left out. */
export function groupBySeverity(findings: readonly CheckFinding[]): Array<{ severity: Severity; label: string; items: CheckFinding[] }> {
  return (['high', 'medium', 'low'] as const)
    .map((severity) => ({ severity, label: SEVERITY_LABEL[severity], items: findings.filter((f) => f.severity === severity) }))
    .filter((g) => g.items.length > 0)
}

const COUNT_WORDS: Record<Severity, string> = { high: 'to fix first', medium: 'to fix soon', low: 'nice to fix' }

/** "2 to fix first, 1 to fix soon": only the non-zero parts. */
export function countLine(findings: readonly CheckFinding[]): string {
  const parts = groupBySeverity(findings).map((g) => `${g.items.length} ${COUNT_WORDS[g.severity]}`)
  return parts.length ? parts.join(', ') : 'Nothing to fix on the pages Mushi Mushi could read'
}

/**
 * The address as a person typed it: host plus path, no scheme, query or
 * trailing slash ("kensaur.us/the-wanting-mind"). An app hosted under a path
 * must see its own path in the report title, not just the shared host.
 */
export function hostOf(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.host}${path}`
  } catch {
    return url
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; code?: string }

/**
 * Shown when an address does not lead anywhere we can open (the same words the API uses for a misspelled one).
 * @internal Exported for tests.
 */
export const UNREACHABLE_ADDRESS_MESSAGE =
  'We couldn’t reach that address. Check the spelling, or paste the link you share with your users (for example https://my-app.lovable.app).'

/**
 * The words for a refused address. The API answers NOT_PUBLIC both for a
 * plainly local or private address (its message says so) and for a name that
 * leads to no public website, which for a visitor is a spelling problem.
 */
/** @internal Exported for tests. */
export function checkErrorMessage(code: string | undefined, message: string): string {
  if (code === 'NOT_PUBLIC' && !/private|local|port number/i.test(message)) return UNREACHABLE_ADDRESS_MESSAGE
  return message
}

async function call<T>(path: string, init: RequestInit | undefined, fetchImpl: typeof fetch): Promise<ApiResult<T>> {
  try {
    const res = await fetchImpl(`${PUBLIC_API_URL}${path}`, init)
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null
    if (res.ok && body?.ok && body.data) return { ok: true, data: body.data }
    const code = body?.error?.code
    return { ok: false, status: res.status, message: checkErrorMessage(code, body?.error?.message ?? 'Something went wrong. Try again in a minute.'), ...(code ? { code } : {}) }
  } catch {
    return { ok: false, status: 0, message: 'Could not reach Mushi Mushi. Check your connection and try again.' }
  }
}

/**
 * What to tell a visitor whose site was already checked today (one check per
 * site a day): they get that report, and an email only when one went out.
 */
export function cachedNotice(cached: boolean, askedForEmail: boolean, emailed: boolean): string | null {
  if (!cached) return null
  const base = 'This site was already checked in the last 24 hours, so this is that report.'
  if (!askedForEmail) return base
  return emailed
    ? `${base} We emailed you the link.`
    : `${base} No email was sent this time: copy the link with “Share this report” instead.`
}

export function startCheck(
  input: { url: string; email?: string; src?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ id: string; status: string; cached: boolean; emailed?: boolean }>> {
  return call(
    '/v1/public/production-check',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.url, ...(input.email ? { email: input.email } : {}), ...(input.src ? { src: input.src } : {}) }),
    },
    fetchImpl,
  )
}

export function loadCheck(id: string, fetchImpl: typeof fetch = fetch): Promise<ApiResult<CheckReport>> {
  return call(`/v1/public/production-check/${encodeURIComponent(id)}`, undefined, fetchImpl)
}
