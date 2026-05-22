// ============================================================
// recompute-tester-reputation — Mushi Bounties daily reputation cron.
//
// Runs once a day (02:00 UTC) via pg_cron. For every active tester:
//   1. Loads all tester_reputation_events for the last 30d.
//   2. Computes score = sum(delta_score), signal_pct = accepted/total,
//      impact_pct = sigma-weighted ratio.
//   3. Upserts tester_reputation row.
//   4. Refreshes the tester_leaderboard_30d materialized view.
//
// HackerOne-style scoring (from tester_reputation_events.delta_score):
//   +7  submission_accepted
//   +2  submission_duplicate
//   0   submission_informative
//   -5  submission_not_applicable  (unused in v1)
//   -10 submission_spam
//   +50 bounty ≥ μ+1σ   (bounty_severe)
//   +25 bounty > μ       (bounty_above_avg)
//   +15 bounty ≥ μ-1σ    (bounty_below_avg)
//
// Schedule: 0 2 * * * (daily at 02:00 UTC)
// Auth: requireServiceRoleAuth
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

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

    // Fetch all testers with at least one reputation event in the last 30d.
    const { data: activeTesterIds } = await db
      .from('tester_reputation_events')
      .select('tester_id')
      .gte('created_at', since30d)

    if (!activeTesterIds?.length) {
      rlog.info('No active testers this window')
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const uniqueIds = [...new Set(activeTesterIds.map((r) => r.tester_id as string))]
    rlog.info(`Recomputing reputation for ${uniqueIds.length} testers`)

    let updated = 0
    let failed = 0

    // Compute per-tester stats.
    const submissionKinds = new Set([
      'submission_accepted',
      'submission_duplicate',
      'submission_informative',
      'submission_spam',
      'submission_not_applicable',
    ])

    for (const testerId of uniqueIds) {
      try {
        // Lifetime score (all events, not just 30d).
        const { data: allEvents } = await db
          .from('tester_reputation_events')
          .select('kind, delta_score, created_at')
          .eq('tester_id', testerId)

        const lifetimeScore = (allEvents ?? []).reduce((s, e) => s + (e.delta_score ?? 0), 0)

        // 30d signal_pct and impact_pct.
        const events30d = (allEvents ?? []).filter((e) => e.created_at >= since30d)
        const submissionEvents = events30d.filter((e) => submissionKinds.has(e.kind ?? ''))
        const accepted = submissionEvents.filter((e) => e.kind === 'submission_accepted').length
        const total = submissionEvents.length
        const signalPct = total > 0 ? accepted / total : 0

        // impact_pct: ratio of high-impact events (bounty_severe + bounty_above_avg).
        const highImpact = events30d.filter((e) =>
          e.kind === 'bounty_severe' || e.kind === 'bounty_above_avg',
        ).length
        const impactPct = total > 0 ? highImpact / total : 0

        await db
          .from('tester_reputation')
          .upsert(
            {
              tester_id: testerId,
              score: lifetimeScore,
              signal_pct: signalPct,
              impact_pct: impactPct,
              recomputed_at: new Date().toISOString(),
            },
            { onConflict: 'tester_id' },
          )

        updated++
      } catch (err) {
        rlog.error('Failed to recompute reputation for tester', { testerId, error: String(err) })
        failed++
      }
    }

    // Refresh the leaderboard materialized view (non-fatal if it fails).
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
