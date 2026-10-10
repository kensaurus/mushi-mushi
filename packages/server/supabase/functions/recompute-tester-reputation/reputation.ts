/**
 * FILE: packages/server/supabase/functions/recompute-tester-reputation/reputation.ts
 * PURPOSE: Per-tester reputation recompute for the daily cron.
 *
 *          The 30d signal and impact inputs are head-only `count: 'exact'`
 *          queries, so Postgres counts and no event rows come back. The
 *          lifetime score and the active-tester list still need rows
 *          (PostgREST aggregates are off and the canonical SQL function lives
 *          in the unexposed `private` schema), so those reads page until an
 *          empty page instead of trusting one capped read: PostgREST
 *          `max_rows` (1000) used to truncate them silently.
 *
 *          Any failed read or write throws, so the caller counts the tester
 *          as failed instead of overwriting a real score with 0.
 *
 *          Pure apart from the injected client, so the vitest suite can run it.
 */

type Db = { from: (table: string) => any }

export const SUBMISSION_KINDS = [
  'submission_accepted',
  'submission_duplicate',
  'submission_informative',
  'submission_spam',
  'submission_not_applicable',
]

export const HIGH_IMPACT_KINDS = ['bounty_severe', 'bounty_above_avg']

/** Rows asked for per page. The server may return fewer (its own max_rows). */
const PAGE_SIZE = 1000

/** Percentage rounded to one decimal, clamped to the table's 0–100 CHECK. */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10)
}

type Row = Record<string, unknown>
type Page = { data?: Row[] | null; error?: { message: string } | null }

/** Reads every row of a query ordered by `id`, advancing by what each page returned. */
async function readAllPages(page: (from: number, to: number) => PromiseLike<Page>): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) return rows
    rows.push(...data)
  }
}

async function countEvents(
  db: Db,
  testerId: string,
  since: string,
  kinds: string[],
): Promise<number> {
  const { count, error } = await db
    .from('tester_reputation_events')
    .select('id', { count: 'exact', head: true })
    .eq('tester_id', testerId)
    .gte('created_at', since)
    .in('kind', kinds)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Distinct testers with at least one reputation event since `since`. */
export async function listActiveTesterIds(db: Db, since: string): Promise<string[]> {
  const rows = await readAllPages((from, to) =>
    db
      .from('tester_reputation_events')
      .select('id, tester_id')
      .gte('created_at', since)
      .order('id')
      .range(from, to),
  )
  return [...new Set(rows.map((r) => r.tester_id as string))]
}

export interface TesterReputation {
  score: number
  signal_pct: number
  impact_pct: number
}

export async function computeTesterReputation(
  db: Db,
  testerId: string,
  since30d: string,
): Promise<TesterReputation> {
  const [lifetimeEvents, total, accepted, highImpact] = await Promise.all([
    readAllPages((from, to) =>
      db
        .from('tester_reputation_events')
        .select('id, delta_score')
        .eq('tester_id', testerId)
        .order('id')
        .range(from, to),
    ),
    countEvents(db, testerId, since30d, SUBMISSION_KINDS),
    countEvents(db, testerId, since30d, ['submission_accepted']),
    countEvents(db, testerId, since30d, HIGH_IMPACT_KINDS),
  ])

  const score = Math.max(
    -100,
    lifetimeEvents.reduce((s, e) => s + ((e.delta_score as number | null) ?? 0), 0),
  )

  return {
    score,
    signal_pct: pct(accepted, total),
    // Bounty events are not a subset of the window's submission events (the
    // submission can predate the window), so the clamp in pct() keeps this
    // inside the CHECK (impact_pct BETWEEN 0 AND 100).
    impact_pct: pct(highImpact, total),
  }
}

/** Recomputes and upserts one tester's row. Throws when any read or the upsert fails. */
export async function recomputeTesterReputation(
  db: Db,
  testerId: string,
  since30d: string,
): Promise<void> {
  const rep = await computeTesterReputation(db, testerId, since30d)
  const { error } = await db
    .from('tester_reputation')
    .upsert(
      { tester_id: testerId, ...rep, recomputed_at: new Date().toISOString() },
      { onConflict: 'tester_id' },
    )
  if (error) throw new Error(error.message)
}
