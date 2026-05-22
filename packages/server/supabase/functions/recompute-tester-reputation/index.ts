// ============================================================
// recompute-tester-reputation — Mushi Bounties daily reputation cron.
//
// Runs once a day (02:00 UTC) via pg_cron. For every tester with
// reputation activity in the last 30 days:
//   1. Loads lifetime score from all reputation events.
//   2. Loads only the last-30d events for signal_pct / impact_pct.
//   3. Upserts tester_reputation row (percentages stored 0–100).
//   4. Refreshes the tester_leaderboard_30d materialized view.
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

const SUBMISSION_KINDS = new Set([
  'submission_accepted',
  'submission_duplicate',
  'submission_informative',
  'submission_spam',
  'submission_not_applicable',
])

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

Deno.serve(
  withSentry(async (req: Request) => {
    const authError = requireServiceRoleAuth(req)
    if (authError) return authError

    const db = getServiceClient()
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

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

    for (const testerId of uniqueIds) {
      try {
        const [{ data: lifetimeEvents }, { data: events30d }] = await Promise.all([
          db
            .from('tester_reputation_events')
            .select('delta_score')
            .eq('tester_id', testerId),
          db
            .from('tester_reputation_events')
            .select('kind')
            .eq('tester_id', testerId)
            .gte('created_at', since30d),
        ])

        const lifetimeScore = Math.max(
          -100,
          (lifetimeEvents ?? []).reduce((s, e) => s + (e.delta_score ?? 0), 0),
        )

        const submissionEvents = (events30d ?? []).filter((e) =>
          SUBMISSION_KINDS.has(e.kind ?? ''),
        )
        const accepted = submissionEvents.filter((e) => e.kind === 'submission_accepted').length
        const total = submissionEvents.length
        const signalPct = pct(accepted, total)

        const highImpact = (events30d ?? []).filter((e) =>
          e.kind === 'bounty_severe' || e.kind === 'bounty_above_avg',
        ).length
        const impactPct = pct(highImpact, total)

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
