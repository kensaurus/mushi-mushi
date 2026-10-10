// ============================================================
// recompute-tester-reputation — Mushi Bounties daily reputation cron.
//
// Runs once a day (02:00 UTC) via pg_cron. For every tester with
// reputation activity in the last 30 days:
//   1. Sums the lifetime score over all reputation events (paged reads).
//   2. Counts the last-30d events in SQL for signal_pct / impact_pct.
//   3. Upserts tester_reputation row (percentages stored 0–100); a failed
//      read or upsert counts the tester as failed. See reputation.ts.
//   4. Refreshes the tester_leaderboard_30d materialized view.
//
// Schedule: 0 2 * * * (daily at 02:00 UTC)
// Auth: requireServiceRoleAuth
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { listActiveTesterIds, recomputeTesterReputation } from './reputation.ts'

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void
}

const rlog = log.child('recompute-tester-reputation')

Deno.serve(
  withSentry(async (req: Request) => {
    const authError = requireServiceRoleAuth(req)
    if (authError) return authError

    const db = getServiceClient()
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

    const uniqueIds = await listActiveTesterIds(db, since30d)

    if (!uniqueIds.length) {
      rlog.info('No active testers this window')
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    rlog.info(`Recomputing reputation for ${uniqueIds.length} testers`)

    let updated = 0
    let failed = 0

    for (const testerId of uniqueIds) {
      try {
        await recomputeTesterReputation(db, testerId, since30d)
        updated++
      } catch (err) {
        rlog.error('Failed to recompute reputation for tester', { testerId, error: String(err) })
        failed++
      }
    }

    try {
      await db.rpc('refresh_tester_leaderboard')
    } catch (err) {
      rlog.warn('Failed to refresh tester_leaderboard_30d MV', { error: String(err) })
    }

    rlog.info('Reputation recompute complete', { updated, failed, total: uniqueIds.length })

    return new Response(
      JSON.stringify({ ok: true, updated, failed, total: uniqueIds.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }),
)
