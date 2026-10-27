// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * search-rank — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Search rank check. Daily at 04:47 (pg_cron `mushi-search-rank`), and right
 * after "Check now" on /credits: for each keyword not checked in the last 7
 * days (at most 40 a run), ask Firecrawl /v2/search for the top 20 results
 * in its country, on the app's own Firecrawl key, and store the app's
 * position (`_shared/search-rank.ts`), the leading hosts, and a history row.
 *
 * Auth: `requireServiceRoleAuth`. `POST { projectId }` checks that app's
 * keywords whatever their age.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveFirecrawl } from '../_shared/firecrawl.ts'
import { COUNTRY_LOCATION, rankOf, SEARCH_RANK_EVERY_DAYS, SEARCH_RANK_RESULTS, topHosts } from '../_shared/search-rank.ts'

const log = rootLog.child('search-rank')
const PER_RUN = 40

export interface SearchRankDeps {
  now?: () => Date
  fetch?: typeof fetch
  resolveKey?: (db: SupabaseClient, projectId: string) => Promise<string | null>
}

export async function runSearchRanks(db: SupabaseClient, deps: SearchRankDeps = {}, projectId?: string): Promise<{ checked: number; failed: number }> {
  const now = deps.now ?? (() => new Date())
  const f = deps.fetch ?? fetch
  const resolveKey = deps.resolveKey ?? (async (c: SupabaseClient, pid: string) => (await resolveFirecrawl(c, pid))?.key ?? null)
  let q = db.from('search_rank_keywords').select('id, project_id, query, country, target, last_checked_at')
  if (projectId) q = q.eq('project_id', projectId)
  else q = q.or(`last_checked_at.is.null,last_checked_at.lt.${new Date(now().getTime() - SEARCH_RANK_EVERY_DAYS * 86_400_000 + 3_600_000).toISOString()}`)
  const { data, error } = await q.order('last_checked_at', { ascending: true }).limit(PER_RUN)
  if (error) throw new Error(`search-rank read failed: ${error.message}`)
  const keys = new Map<string, string | null>()
  let checked = 0
  let failed = 0
  for (const k of (data ?? []) as Array<{ id: string; project_id: string; query: string; country: string; target: string }>) {
    if (!keys.has(k.project_id)) keys.set(k.project_id, await resolveKey(db, k.project_id))
    const key = keys.get(k.project_id)
    const at = now().toISOString()
    if (!key) {
      await db.from('search_rank_keywords').update({ last_error: 'No Firecrawl key this app can use.', last_checked_at: at }).eq('id', k.id)
      failed++
      continue
    }
    try {
      const res = await f('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: k.query, limit: SEARCH_RANK_RESULTS, country: k.country, location: COUNTRY_LOCATION[k.country] ?? undefined }),
      })
      const body = (await res.json().catch(() => ({}))) as { data?: { web?: Array<{ url?: string }> } | Array<{ url?: string }>; error?: string }
      if (!res.ok) throw new Error(`Firecrawl search ${res.status}: ${String(body.error ?? '').slice(0, 160)}`)
      const results = Array.isArray(body.data) ? body.data : (body.data?.web ?? [])
      const rank = rankOf(results, k.target)
      await db.from('search_rank_keywords').update({ last_rank: rank, last_top: topHosts(results), last_checked_at: at, last_error: null }).eq('id', k.id)
      await db.from('search_rank_history').insert({ keyword_id: k.id, project_id: k.project_id, checked_at: at, rank })
      checked++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('search-rank check failed', { keywordId: k.id, err: message })
      await db.from('search_rank_keywords').update({ last_error: message.slice(0, 300), last_checked_at: at }).eq('id', k.id)
      failed++
    }
  }
  return { checked, failed }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const result = await runSearchRanks(getServiceClient(), {}, typeof body.projectId === 'string' ? body.projectId : undefined)
  return new Response(JSON.stringify({ ok: true, data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('search-rank', handler))
}
