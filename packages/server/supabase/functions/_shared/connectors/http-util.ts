/**
 * FILE: packages/server/supabase/functions/_shared/connectors/http-util.ts
 * PURPOSE: Small helpers the vendor connectors share: a JSON GET/POST
 *          through ctx.fetch with a deadline, and the status → probe mapping
 *          (401 = credential rejected, 403 = missing scope, 5xx = vendor down),
 *          as a sentence for people and as a ProbeFailure the radar reads.
 */

import { ConnectorError, type ConnectorContext, type ProbeFailure } from './types.ts'

export interface JsonResponse<T = unknown> {
  status: number
  body: T | null
  text: string
}

export async function fetchJson<T = unknown>(ctx: ConnectorContext, url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<JsonResponse<T>> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await ctx.fetch(url, { ...init, signal: ac.signal })
    const text = await res.text()
    let body: T | null = null
    try {
      body = text ? (JSON.parse(text) as T) : null
    } catch {
      body = null
    }
    return { status: res.status, body, text: text.slice(0, 2000) }
  } finally {
    clearTimeout(timer)
  }
}

/** A vendor answer as a one-line reason a person can act on. */
export function statusReason(vendor: string, status: number): string {
  if (status === 401) return `${vendor} rejected the credential. It may be revoked or mistyped.`
  if (status === 403) return `${vendor} accepted the credential but it lacks a permission this needs.`
  if (status === 404) return `${vendor} could not find that account, project or app with this credential.`
  if (status === 429) return `${vendor} is rate-limiting this credential. Mushi will try again later.`
  if (status >= 500) return `${vendor} answered with a server error (${status}). Mushi will try again later.`
  return `${vendor} answered ${status}.`
}

/** The same mapping as statusReason, as a value the radar can read without parsing text. */
export function failureOfStatus(status: number): ProbeFailure {
  if (status === 401) return 'credential_rejected'
  if (status === 403) return 'permission_missing'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'vendor_error'
  return 'other'
}

/** A ConnectorError for a vendor's HTTP answer: the sentence plus its classification. */
export function vendorError(vendor: string, status: number): ConnectorError {
  return new ConnectorError(statusReason(vendor, status), 'error', failureOfStatus(status))
}
