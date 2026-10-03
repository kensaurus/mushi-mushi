/**
 * FILE: packages/server/supabase/functions/_shared/connectors/http-util.ts
 * PURPOSE: Small helpers the vendor connectors share: a JSON GET/POST
 *          through ctx.fetch with a deadline, and the status → probe mapping
 *          (401 = credential rejected, 403 = missing scope, 5xx = vendor down).
 */

import type { ConnectorContext } from './types.ts'

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
