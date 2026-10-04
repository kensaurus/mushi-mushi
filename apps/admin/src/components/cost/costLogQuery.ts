/**
 * FILE: apps/admin/src/components/cost/costLogQuery.ts
 * PURPOSE: The raw cost log's API query, including the failed-calls and
 *          time-window filters the status banner links to.
 */

/** `?log_since=` tokens the log understands (the banner links with 24h). */
export const SINCE_HOURS: Record<string, number> = { '24h': 24, '7d': 24 * 7 }

/** API query for the raw log. */
export function costLogQuery(opts: {
  projectId: string
  page: number
  limit: number
  sort: string
  order: string
  q: string
  failedOnly: boolean
  since: string | null
  now?: number
}): string {
  const p = new URLSearchParams()
  p.set('project_id', opts.projectId)
  p.set('page', String(opts.page))
  p.set('limit', String(opts.limit))
  p.set('sort', opts.sort)
  p.set('order', opts.order)
  if (opts.q) p.set('q', opts.q)
  if (opts.failedOnly) p.set('status', 'failed')
  const hours = opts.since ? SINCE_HOURS[opts.since] : undefined
  if (hours) {
    // Rounded to the minute so the query string (a fetch dep) is stable.
    const now = Math.floor((opts.now ?? Date.now()) / 60_000) * 60_000
    p.set('since', new Date(now - hours * 3_600_000).toISOString())
  }
  return p.toString()
}
