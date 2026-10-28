/**
 * The free Production Check page (/check): API calls and the pure helpers the
 * page renders with. The server side is
 * packages/server/supabase/functions/api/routes/production-check.ts.
 *
 * The docs site is a static export, so a report lives at `/check?id=<uuid>`
 * (the link we share and email). `/check/<uuid>` also works: the docs 404 page
 * renders the report for that path (app/check/CheckPathFallback.tsx).
 */

import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'
import { PUBLIC_API_URL } from './public-diagram'
import { DOCS_SITE } from './structured-data'

export type Severity = 'high' | 'medium' | 'low'

export interface CheckFinding {
  rule: string
  severity: Severity
  title: string
  why: string
  fix: string
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

export const CHECK_SIGNUP_HREF = `${ADMIN_DEMO_BASE}/signup?src=check`

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
  return parts.length ? parts.join(', ') : 'Nothing to fix on the pages Mushi could read'
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function call<T>(path: string, init: RequestInit | undefined, fetchImpl: typeof fetch): Promise<ApiResult<T>> {
  try {
    const res = await fetchImpl(`${PUBLIC_API_URL}${path}`, init)
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } } | null
    if (res.ok && body?.ok && body.data) return { ok: true, data: body.data }
    return { ok: false, status: res.status, message: body?.error?.message ?? 'Something went wrong. Try again in a minute.' }
  } catch {
    return { ok: false, status: 0, message: 'Could not reach Mushi. Check your connection and try again.' }
  }
}

export function startCheck(
  input: { url: string; email?: string; src?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ id: string; status: string; cached: boolean }>> {
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
