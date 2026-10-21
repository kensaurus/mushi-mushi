/**
 * FILE: packages/server/supabase/functions/_shared/spend-down-db.ts
 * PURPOSE: The spend-down reads the worker and the status route share: the
 *          apps a key pays for, how many dispatches it started today, an
 *          app's recent yield (the stop-loss samples), and the runs behind a
 *          key's scoreboard. Rules live in spend-down.ts; this file only reads.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  classifySpendDownRun,
  SPEND_DOWN_SAMPLE_MAX_AGE_DAYS,
  SPEND_DOWN_SCOREBOARD_DAYS,
  spendDownProjectIds,
  type CursorPoolKey,
  type SpendDownKey,
  type SpendDownRunRow,
  type SpendDownYieldSamples,
} from './spend-down.ts'

/**
 * Newest spend-down dispatches of one app the stop-loss reads (inside the
 * 14-day age limit). At the 2026-10-21 rates (60% open a PR) 150 runs hold
 * about 90 PRs, over the 40 reviews and 40 finished runs the rules read.
 */
const YIELD_JOB_LOOKBACK = 150
/** Ids per `in.(…)` filter: 100 uuids is about 3.7 KB of URL. */
const IN_CHUNK = 100
/** PostgREST max_rows on Supabase. */
const PAGE = 1000
/** 200 fixes a day (the daily-limit maximum) × 7 days fits in 2 pages; 10 is a guard. */
const MAX_PAGES = 10

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface JobRow {
  id: string
  project_id: string
  status: string | null
  pr_url: string | null
  fix_attempt_id: string | null
  created_at: string
  dispatch_metadata?: Record<string, unknown> | null
}

interface AttemptRow {
  id: string
  status: string | null
  pr_url: string | null
  failure_category: string | null
  merged_at?: string | null
  llm_model?: string | null
}

interface ReviewRow {
  fix_attempt_id: string
  verdict: string | null
  reviewed_at?: string | null
  cost_usd?: number | string | null
}

async function readByIds<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
  what: string,
): Promise<T[]> {
  if (ids.length === 0) return []
  const results = await Promise.all(
    chunks(ids, IN_CHUNK).map((part) => db.from(table).select(columns).in(column, part)),
  )
  const out: T[] = []
  for (const { data, error } of results) {
    if (error) throw new Error(`spend-down: ${what} read failed: ${error.message}`)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

/**
 * The stop-loss samples of one app: its spend-down runs (any key, never a
 * manual or auto-fix dispatch) dispatched in the last 14 days and after its
 * last Resume (`resetAt`), newest first, each with where it ended and the
 * Opus verdict of its PR.
 */
export async function projectYieldSamples(
  db: SupabaseClient,
  projectId: string,
  now: Date,
  resetAt: string | null = null,
): Promise<SpendDownYieldSamples> {
  const ageCutoff = new Date(now.getTime() - SPEND_DOWN_SAMPLE_MAX_AGE_DAYS * 86_400_000).toISOString()
  const since = resetAt && resetAt > ageCutoff ? resetAt : ageCutoff
  const { data, error } = await db
    .from('fix_dispatch_jobs')
    .select('id, project_id, status, pr_url, fix_attempt_id, created_at, dispatch_metadata')
    .eq('project_id', projectId)
    .eq('dispatch_metadata->>source', 'spend_down')
    // gte: after a probe-driven resume the reset is the first resuming
    // probe's dispatch time, and that probe is evidence for the new window.
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(YIELD_JOB_LOOKBACK)
  if (error) throw new Error(`spend-down: yield dispatch read failed: ${error.message}`)
  const jobs = (data ?? []) as JobRow[]
  const attemptIds = jobs.map((j) => j.fix_attempt_id).filter((id): id is string => !!id)
  const [attempts, reviews] = await Promise.all([
    readByIds<AttemptRow>(db, 'fix_attempts', 'id, status, pr_url, failure_category', 'id', attemptIds, 'yield attempts'),
    readByIds<ReviewRow>(db, 'fix_reviews', 'fix_attempt_id, verdict, reviewed_at', 'fix_attempt_id', attemptIds, 'yield reviews'),
  ])
  const attemptById = new Map(attempts.map((a) => [a.id, a]))
  const reviewByAttempt = new Map(reviews.map((r) => [r.fix_attempt_id, r]))
  return {
    runs: jobs.map((j) => {
      const review = j.fix_attempt_id ? reviewByAttempt.get(j.fix_attempt_id) ?? null : null
      return {
        at: j.created_at,
        outcome: classifySpendDownRun(j, j.fix_attempt_id ? attemptById.get(j.fix_attempt_id) ?? null : null),
        verdict: review?.verdict ?? null,
        reviewedAt: review?.reviewed_at ?? null,
        probe: j.dispatch_metadata?.spend_down_probe === true,
      }
    }),
  }
}

/** One read of each app's samples per tick or request (an app can come up under several keys). */
export type SpendDownYieldCache = Map<string, Promise<SpendDownYieldSamples>>

export function cachedYieldSamples(
  cache: SpendDownYieldCache,
  db: SupabaseClient,
  projectId: string,
  now: Date,
  resetAt: string | null,
): Promise<SpendDownYieldSamples> {
  const id = `${projectId}\u0000${resetAt ?? ''}`
  let hit = cache.get(id)
  if (!hit) {
    hit = projectYieldSamples(db, projectId, now, resetAt)
    // A failed read is not cached, so the next caller retries.
    hit.catch(() => cache.delete(id))
    cache.set(id, hit)
  }
  return hit
}

/**
 * Persist a probe-driven resume as the app's stop-loss reset (service role),
 * so the next tick's window starts at the resuming probes. Returns the error
 * text, or null; before the migration the column is missing and the caller
 * relies on the reset it also carries in the tick summary.
 */
export async function writeStopLossReset(db: SupabaseClient, projectId: string, resetAt: string): Promise<string | null> {
  const { error } = await db
    .from('project_settings')
    .update({ spend_down_stop_loss_reset_at: resetAt })
    .eq('project_id', projectId)
  return error ? error.message : null
}

/** How long one tick may hold a key (the cron runs every 10 minutes). */
export const SPEND_DOWN_TICK_LEASE_MS = 9 * 60_000

/**
 * Claim a key for one tick, so two overlapping runs cannot both dispatch on
 * it (double probes, double-spent daily limit). A conditional update on
 * `byok_keys.spend_down_claimed_until`: it succeeds only when no other tick
 * holds an unexpired lease. A transaction-scoped advisory lock would not do:
 * each PostgREST request is its own transaction, so the lock would be gone
 * before the dispatches. Before the migration adds the column the claim
 * reports 'unsupported' and the caller proceeds (the cron is single-flight
 * in practice).
 */
export async function claimKeyTick(
  db: SupabaseClient,
  keyId: string,
  now: Date,
): Promise<'claimed' | 'busy' | 'unsupported'> {
  const { data, error } = await db
    .from('byok_keys')
    .update({ spend_down_claimed_until: new Date(now.getTime() + SPEND_DOWN_TICK_LEASE_MS).toISOString() })
    .eq('id', keyId)
    .or(`spend_down_claimed_until.is.null,spend_down_claimed_until.lt.${now.toISOString()}`)
    .select('id')
  if (error) return 'unsupported'
  return Array.isArray(data) && data.length > 0 ? 'claimed' : 'busy'
}

/**
 * When each app was last resumed by hand (`project_settings.
 * spend_down_stop_loss_reset_at`). Fails open to "never": before the
 * migration adds the column the read errors, and the stop-loss then simply
 * uses the 14-day age limit.
 */
export async function stopLossResets(
  db: SupabaseClient,
  projectIds: string[],
): Promise<{ resets: Map<string, string>; error: string | null }> {
  const resets = new Map<string, string>()
  if (projectIds.length === 0) return { resets, error: null }
  const { data, error } = await db
    .from('project_settings')
    .select('project_id, spend_down_stop_loss_reset_at')
    .in('project_id', projectIds)
  if (error) return { resets, error: error.message }
  for (const row of (data ?? []) as Array<{ project_id: string; spend_down_stop_loss_reset_at?: string | null }>) {
    if (row.spend_down_stop_loss_reset_at) resets.set(row.project_id, row.spend_down_stop_loss_reset_at)
  }
  return { resets, error: null }
}

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * Every spend-down run one key paid for in the last `days` days, joined to
 * its attempt (outcome, merged, model) and its Opus review (verdict, cost).
 * Reads existing tables only; the rollup is spendDownScoreboard().
 */
export async function keyScoreboardRuns(
  db: SupabaseClient,
  keyId: string,
  now: Date,
  days: number = SPEND_DOWN_SCOREBOARD_DAYS,
): Promise<SpendDownRunRow[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const jobs: JobRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from('fix_dispatch_jobs')
      .select('id, project_id, status, pr_url, fix_attempt_id, created_at, dispatch_metadata')
      .eq('dispatch_metadata->>spend_down_key_id', keyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`spend-down: scoreboard dispatch read failed: ${error.message}`)
    const rows = (data ?? []) as JobRow[]
    jobs.push(...rows)
    if (rows.length < PAGE) break
  }
  const attemptIds = jobs.map((j) => j.fix_attempt_id).filter((id): id is string => !!id)
  const [attempts, reviews] = await Promise.all([
    readByIds<AttemptRow>(
      db,
      'fix_attempts',
      'id, status, pr_url, failure_category, merged_at, llm_model',
      'id',
      attemptIds,
      'scoreboard attempts',
    ),
    readByIds<ReviewRow>(db, 'fix_reviews', 'fix_attempt_id, verdict, cost_usd', 'fix_attempt_id', attemptIds, 'scoreboard reviews'),
  ])
  const attemptById = new Map(attempts.map((a) => [a.id, a]))
  const reviewByAttempt = new Map(reviews.map((r) => [r.fix_attempt_id, r]))
  return jobs.map((j) => {
    const attempt = j.fix_attempt_id ? attemptById.get(j.fix_attempt_id) ?? null : null
    const review = j.fix_attempt_id ? reviewByAttempt.get(j.fix_attempt_id) ?? null : null
    const outcome = classifySpendDownRun(j, attempt)
    const override = j.dispatch_metadata?.model_override
    const cost = review?.cost_usd == null ? null : Number(review.cost_usd)
    return {
      keyId,
      projectId: j.project_id,
      // The model the dispatch asked for, so a run groups the same before and after it finishes.
      model: (typeof override === 'string' && override.trim()) || attempt?.llm_model?.trim() || 'app default',
      day: utcDay(j.created_at),
      outcome,
      noPrVerdict: outcome === 'no_pr_verdict' ? attempt?.failure_category ?? null : null,
      verdict: review?.verdict ?? null,
      merged: !!attempt?.merged_at,
      latestReviewCostUsd: cost != null && Number.isFinite(cost) ? cost : null,
    }
  })
}

function utcDayStart(now: Date): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Dispatches this key started today (UTC), any status. */
export async function keyDispatchesToday(db: SupabaseClient, keyId: string, now: Date): Promise<number> {
  const { count, error } = await db
    .from('fix_dispatch_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('dispatch_metadata->>spend_down_key_id', keyId)
    .gte('created_at', utcDayStart(now))
  if (error) throw new Error(`spend-down: could not count today's dispatches: ${error.message}`)
  return count ?? 0
}

export async function keyProjects(db: SupabaseClient, key: SpendDownKey): Promise<{
  ids: string[]
  settings: Map<string, Record<string, unknown>>
}> {
  const projectQuery = key.project_id
    ? db.from('projects').select('id, organization_id').eq('id', key.project_id)
    : db
        .from('projects')
        .select('id, organization_id')
        .eq('organization_id', key.organization_id ?? '00000000-0000-0000-0000-000000000000')
  const { data: projectRows, error } = await projectQuery
  if (error) throw new Error(`spend-down: projects read failed: ${error.message}`)
  const projects = (projectRows ?? []) as Array<{ id: string; organization_id: string | null }>
  const allIds = projects.map((p) => p.id)
  if (allIds.length === 0) return { ids: [], settings: new Map() }
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((o): o is string => !!o))]

  // Every Cursor key that could win for these apps: their own and their
  // organization's shared ones (the same rows resolveCursorApiKey reads).
  const ownFilter = `project_id.in.(${allIds.join(',')})`
  const keyFilter = orgIds.length > 0 ? `${ownFilter},organization_id.in.(${orgIds.join(',')})` : ownFilter
  const [settingsRes, reposRes, keysRes] = await Promise.all([
    db
      .from('project_settings')
      .select('project_id, autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd, cursor_api_key_ref')
      .in('project_id', allIds),
    db.from('project_repos').select('project_id').in('project_id', allIds),
    db
      .from('byok_keys')
      .select('id, project_id, organization_id, priority, status, test_status')
      .eq('provider_slug', 'cursor')
      .or(keyFilter),
  ])
  if (settingsRes.error) throw new Error(`spend-down: project_settings read failed: ${settingsRes.error.message}`)
  if (reposRes.error) throw new Error(`spend-down: project_repos read failed: ${reposRes.error.message}`)
  if (keysRes.error) throw new Error(`spend-down: byok_keys read failed: ${keysRes.error.message}`)

  const settings = new Map<string, Record<string, unknown>>()
  for (const s of (settingsRes.data ?? []) as Array<Record<string, unknown>>) settings.set(String(s.project_id), s)
  const withRepo = new Set(((reposRes.data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  const legacy = (id: string) => {
    const ref = settings.get(id)?.cursor_api_key_ref
    return typeof ref === 'string' && ref.trim() !== ''
  }

  const ids = spendDownProjectIds(
    key,
    projects.map((p) => ({
      id: p.id,
      organization_id: p.organization_id,
      autofix_enabled: settings.get(p.id)?.autofix_enabled === true,
      has_repo: withRepo.has(p.id),
      has_legacy_key: legacy(p.id),
    })),
    (keysRes.data ?? []) as CursorPoolKey[],
  )
  return { ids, settings }
}
