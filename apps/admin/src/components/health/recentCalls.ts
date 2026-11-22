/**
 * FILE: apps/admin/src/components/health/recentCalls.ts
 * PURPOSE: Recent LLM calls grouped by what they share (round 3, 2026-11-19): eight rows each said
 *          "webhooks-github-in… text-embedding-3-small byok" with the function cut and ~500 px
 *          free. One group header names the function, model and key once; its rows keep only
 *          what differs (time, latency, tokens, links). Groups keep the newest-first order.
 */

interface RecentCallLike {
  function_name: string
  used_model: string
  fallback_used: boolean
  status: string
  key_source: string | null
}

interface RecentCallGroup<T extends RecentCallLike> {
  key: string
  fn: string
  model: string
  keySource: string | null
  fallback: boolean
  status: string
  rows: T[]
}

export function groupRecentCalls<T extends RecentCallLike>(rows: readonly T[]): RecentCallGroup<T>[] {
  const groups = new Map<string, RecentCallGroup<T>>()
  for (const r of rows) {
    const keySource = r.key_source && r.key_source !== 'env' ? r.key_source : null
    const key = [r.function_name, r.used_model, keySource ?? '', r.fallback_used ? 'fb' : '', r.status].join('|')
    let g = groups.get(key)
    if (!g) {
      g = { key, fn: r.function_name, model: r.used_model, keySource, fallback: r.fallback_used, status: r.status, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(r)
  }
  return [...groups.values()]
}
