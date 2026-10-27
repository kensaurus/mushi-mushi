// ============================================================
// release-credit-summary.ts — per release: reporters credited, and how many
// of them were told.
//
// The console's release timeline (Releases page, console journeys
// 2026-10-27) shows each release's fixes and "N of M reporters told".
// `release_credits.notified_at` is stamped only once a reporter's message
// was delivered (release-reporters.ts), so `told` counts deliveries, never
// attempts. GET /v1/admin/releases?credits=1 attaches the summary.
// ============================================================

import type { getServiceClient } from './db.ts'

export interface ReleaseCreditSummary {
  /** Credit rows for the release (a reporter can hold more than one kind). */
  credited: number
  /** Credits whose reporter's message was delivered. */
  told: number
}

interface CreditRow {
  release_id: string
  notified_at: string | null
}

/** Pure: counts per release id. Releases with no credits are absent. */
export function summarizeReleaseCredits(rows: readonly CreditRow[]): Map<string, ReleaseCreditSummary> {
  const out = new Map<string, ReleaseCreditSummary>()
  for (const r of rows) {
    const s = out.get(r.release_id) ?? { credited: 0, told: 0 }
    s.credited += 1
    if (r.notified_at) s.told += 1
    out.set(r.release_id, s)
  }
  return out
}

const PAGE = 1000
/** A release list page is at most 100 releases; this bounds a runaway read. */
const MAX_PAGES = 20

type Db = ReturnType<typeof getServiceClient>

/**
 * Reads every credit of `releaseIds`, page by page (PostgREST caps a read at
 * 1,000 rows), and summarizes them. `null` when a read fails or the cap is
 * hit: the caller then leaves the summary out, so the console shows
 * "unknown", never a wrong count.
 */
export async function loadReleaseCreditSummaries(
  db: Db,
  releaseIds: readonly string[],
): Promise<Map<string, ReleaseCreditSummary> | null> {
  if (releaseIds.length === 0) return new Map()
  const rows: CreditRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await db
      .from('release_credits')
      .select('release_id, notified_at')
      .in('release_id', releaseIds as string[])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return null
    const got = (data ?? []) as CreditRow[]
    rows.push(...got)
    if (got.length < PAGE) return summarizeReleaseCredits(rows)
  }
  return null
}
