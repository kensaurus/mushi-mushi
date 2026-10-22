/**
 * FILE: packages/server/supabase/functions/_shared/review-followup-db.ts
 * PURPOSE: The review follow-up reads and writes (ADR 0032) shared by
 *          agent-pr-review (enqueue on a "fix_first" verdict), the
 *          review-followup worker and the console / scoreboard routes: the
 *          organization's settings, the Cursor key a follow-up runs on, the
 *          key's model list (cached an hour), today's count, and the rows
 *          behind the scoreboard. Rules live in review-followup.ts.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { listCursorModelsV1, type CursorModelInfo } from './cursor-cloud.ts'
import {
  keyOwnerForProject,
  keyScopeFor,
  organizationOwnerIds,
  ownerUserColumnReady,
  withOwnerUserColumn,
  type KeyOwner,
} from './byok-scope.ts'
import {
  FOLLOWUP_DEFAULT_DAILY_LIMIT,
  FOLLOWUP_MODELS_CACHE_MS,
  FOLLOWUP_SCOREBOARD_DAYS,
  followupTrigger,
  type CiHeadState,
  type CiJobForRepair,
  type FollowupReason,
  type FollowupScoreRow,
  type PriorFollowup,
  type TriggerAttempt,
  type TriggerReview,
} from './review-followup.ts'

/** PostgREST codes while the table or a column does not exist yet (before the migration). */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])

export function notMigrated(err: { code?: string } | null | undefined): boolean {
  return NOT_MIGRATED.has(String(err?.code ?? ''))
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export interface FollowupSettings {
  enabled: boolean
  /** When follow-ups were last turned on; discovery reaches 3 days before it. */
  enabledAt: string | null
  /** Why Mushi turned them off on its own (the chosen key was deleted), else null. */
  offReason: string | null
  keyId: string | null
  model: string | null
  dailyLimit: number
}

export const FOLLOWUP_SETTINGS_COLUMNS =
  'id, review_followup_enabled, review_followup_enabled_at, review_followup_off_reason, review_followup_key_id, review_followup_model, review_followup_daily_limit'

export function followupSettingsFromRow(row: Record<string, unknown> | null | undefined): FollowupSettings {
  const limit = Number(row?.review_followup_daily_limit)
  return {
    // Off by default (the column default): an owner turns them on.
    enabled: row?.review_followup_enabled === true,
    enabledAt: typeof row?.review_followup_enabled_at === 'string' ? row.review_followup_enabled_at : null,
    offReason: typeof row?.review_followup_off_reason === 'string' ? row.review_followup_off_reason : null,
    keyId: typeof row?.review_followup_key_id === 'string' ? row.review_followup_key_id : null,
    model: typeof row?.review_followup_model === 'string' && row.review_followup_model.trim() ? row.review_followup_model.trim() : null,
    dailyLimit: Number.isInteger(limit) && limit > 0 ? limit : FOLLOWUP_DEFAULT_DAILY_LIMIT,
  }
}

/** The organization's follow-up settings. Throws on a read error (callers wait or fail closed). */
export async function loadFollowupSettings(db: SupabaseClient, organizationId: string): Promise<FollowupSettings> {
  const { data, error } = await db.from('organizations').select(FOLLOWUP_SETTINGS_COLUMNS).eq('id', organizationId).maybeSingle()
  if (error) throw new Error(`review follow-up settings read failed: ${error.message}`)
  return followupSettingsFromRow(data as Record<string, unknown> | null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgCursorKey {
  id: string
  label: string | null
  key_hint: string | null
  project_id: string | null
  organization_id: string | null
  /** Set for a universal key (ADR 0031): it serves every app of the organizations its owner owns. */
  owner_user_id?: string | null
  status: string
  test_status: string | null
}

/**
 * Cursor keys an organization may run follow-ups on: its shared keys, the
 * keys of its apps, and the universal keys (ADR 0031) of `universalForUserId`
 * when that user is an owner of the organization (a universal key only ever
 * serves the organizations its owner owns). Picking a key for the whole
 * organization is an owner's or admin's call (the settings route checks).
 */
export async function orgCursorKeys(
  db: SupabaseClient,
  organizationId: string,
  opts: { universalForUserId?: string | null } = {},
): Promise<{ keys: OrgCursorKey[]; projectIds: string[]; ownerIds: string[] }> {
  const { data: projects, error: pErr } = await db.from('projects').select('id').eq('organization_id', organizationId)
  if (pErr) throw new Error(`organization projects read failed: ${pErr.message}`)
  const projectIds = ((projects ?? []) as Array<{ id: string }>).map((p) => p.id)
  // Ids are spliced into a PostgREST filter: refuse anything that could change it.
  if (!/^[A-Za-z0-9-]+$/.test(organizationId) || projectIds.some((id) => !/^[A-Za-z0-9-]+$/.test(id))) {
    throw new Error('orgCursorKeys: invalid id')
  }
  const filter = projectIds.length > 0
    ? `organization_id.eq.${organizationId},project_id.in.(${projectIds.join(',')})`
    : `organization_id.eq.${organizationId}`
  const { data, error } = await db
    .from('byok_keys')
    .select('id, label, key_hint, project_id, organization_id, status, test_status')
    .eq('provider_slug', 'cursor')
    .or(filter)
  if (error) throw new Error(`organization Cursor keys read failed: ${error.message}`)
  const keys = (data ?? []) as OrgCursorKey[]
  const ownerIds = (await ownerUserColumnReady(db)) ? await organizationOwnerIds(db, organizationId) : []
  const user = opts.universalForUserId ?? null
  if (user && ownerIds.includes(user)) {
    const { data: mine, error: mineErr } = await db
      .from('byok_keys')
      .select('id, label, key_hint, project_id, organization_id, owner_user_id, status, test_status')
      .eq('provider_slug', 'cursor')
      .eq('owner_user_id', user)
    if (mineErr) throw new Error(`universal Cursor keys read failed: ${mineErr.message}`)
    keys.push(...((mine ?? []) as OrgCursorKey[]))
  }
  return { keys, projectIds, ownerIds }
}

export type FollowupKey =
  | {
      ok: true
      apiKey: string
      keyId: string | null
      cacheKey: string
      /** 'pool': a byok_keys row (key_id set); 'legacy': the app's Integrations key. Stored as key_kind. */
      source: 'pool' | 'legacy'
    }
  | { ok: false; reason: Extract<FollowupReason, 'no_cursor_key' | 'key_not_allowed' | 'platform_key' | 'key_removed'> }

async function vaultSecret(db: SupabaseClient, secretId: string | null | undefined): Promise<string | null> {
  if (!secretId) return null
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: secretId })
  if (error || typeof data !== 'string' || data.length === 0) return null
  return data
}

/**
 * One byok key by id, for this organization: a shared key of the
 * organization, a key of one of its apps, or a universal key (ADR 0031)
 * whose owner owns the organization. With `projectId`, a universal key must
 * also serve that app by ADR 0031's own scope rule (`keyScopeFor` over the
 * app's owner triple), so a key whose owner stopped owning the organization
 * never pays for it. Only an active key with a stored secret is usable;
 * `requireActive: false` is for polling a run the key already started.
 */
export async function cursorKeyById(
  db: SupabaseClient,
  keyId: string,
  organizationId: string,
  opts: {
    requireActive?: boolean
    projectId?: string
    /**
     * Only to cancel a run this key already started after the key stopped
     * serving the app (a universal key whose owner left): same Cursor
     * account, nothing new is spent. Never used to dispatch or poll.
     */
    skipScopeCheck?: boolean
  } = {},
): Promise<FollowupKey> {
  const ownerColumn = await ownerUserColumnReady(db)
  const { data, error } = await db
    .from('byok_keys')
    .select(withOwnerUserColumn('id, provider_slug, project_id, organization_id, status, vault_secret_id', ownerColumn))
    .eq('id', keyId)
    .maybeSingle()
  const key = data as
    | {
        id: string
        provider_slug: string
        project_id: string | null
        organization_id: string | null
        owner_user_id?: string | null
        status: string
        vault_secret_id: string | null
      }
    | null
  if (error || !key || key.provider_slug !== 'cursor') return { ok: false, reason: 'key_not_allowed' }
  let allowed = key.organization_id === organizationId
  if (!allowed && key.project_id) {
    const { data: p } = await db.from('projects').select('organization_id').eq('id', key.project_id).maybeSingle()
    allowed = (p as { organization_id?: string | null } | null)?.organization_id === organizationId
  }
  if (!allowed && key.owner_user_id) {
    const owner: KeyOwner = opts.projectId
      ? await keyOwnerForProject(db, { id: opts.projectId, organization_id: organizationId })
      : { projectId: '-', organizationId, universalUserIds: await organizationOwnerIds(db, organizationId) }
    allowed = keyScopeFor(key, owner) === 'universal'
  }
  if (!allowed && !opts.skipScopeCheck) return { ok: false, reason: 'key_not_allowed' }
  if (opts.requireActive !== false && key.status !== 'active') return { ok: false, reason: 'no_cursor_key' }
  const apiKey = await vaultSecret(db, key.vault_secret_id)
  if (!apiKey) return { ok: false, reason: 'no_cursor_key' }
  return { ok: true, apiKey, keyId: key.id, cacheKey: `key:${key.id}`, source: 'pool' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model list, cached per key for an hour
// ─────────────────────────────────────────────────────────────────────────────

const modelCache = new Map<string, { at: number; models: CursorModelInfo[] }>()

/** Test hook: forget every cached list. */
export function clearCursorModelCache(): void {
  modelCache.clear()
}

/**
 * GET /v1/models for one key, at most once an hour per key (keyed by the
 * byok id, never the secret). A failed read is not cached and throws.
 */
export async function cursorModelsCached(
  cacheKey: string,
  apiKey: string,
  now: Date,
  list: (apiKey: string) => Promise<CursorModelInfo[]> = (k) => listCursorModelsV1({ apiKey: k }),
): Promise<CursorModelInfo[]> {
  const hit = modelCache.get(cacheKey)
  if (hit && now.getTime() - hit.at < FOLLOWUP_MODELS_CACHE_MS) return hit.models
  const models = await list(apiKey)
  modelCache.set(cacheKey, { at: now.getTime(), models })
  return models
}

// ─────────────────────────────────────────────────────────────────────────────
// Counts and rows
// ─────────────────────────────────────────────────────────────────────────────

function utcDayStart(now: Date): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Follow-ups Cursor accepted today (UTC) across the organization's apps. Throws on a read error. */
export async function orgFollowupsToday(db: SupabaseClient, projectIds: string[], now: Date): Promise<number> {
  if (projectIds.length === 0) return 0
  const { count, error } = await db
    .from('fix_review_followups')
    .select('id', { count: 'exact', head: true })
    .in('project_id', projectIds)
    .gte('dispatched_at', utcDayStart(now))
  if (error) throw new Error(`review follow-ups today read failed: ${error.message}`)
  return count ?? 0
}

export const PRIOR_COLUMNS = 'id, head_sha_before, status, cursor_agent_id'

/** Follow-ups are on for this app's organization (and since when). Off on any read error. */
export async function followupsEnabledForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<{ enabled: boolean; enabledAt: string | null }> {
  const { data: project, error } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  const orgId = (project as { organization_id?: string | null } | null)?.organization_id ?? null
  if (error || !orgId) return { enabled: false, enabledAt: null }
  try {
    const s = await loadFollowupSettings(db, orgId)
    return { enabled: s.enabled, enabledAt: s.enabledAt }
  } catch {
    return { enabled: false, enabledAt: null }
  }
}

/**
 * Queue a follow-up for a completed review when the trigger rules allow it
 * (ADR 0032): fix_first on the PR's head, once per head, at most two per PR,
 * never on a closed or merged PR. The unique (fix_attempt_id,
 * head_sha_before) keeps a webhook and the worker's discovery from queueing
 * twice. Never throws: a failed enqueue must not fail the review around it.
 */
export async function enqueueReviewFollowup(
  db: SupabaseClient,
  input: {
    review: TriggerReview & { id: string; fix_attempt_id: string; project_id: string; report_id: string | null }
    attempt: TriggerAttempt | null
    prior?: PriorFollowup[]
    /** Check the organization has follow-ups on first (the agent-pr-review hook); discovery filters before. */
    requireEnabled?: boolean
    /** CI on the reviewed head; a "merge" review queues a CI repair only on a code failure. */
    ci?: CiHeadState | null
  },
  now: Date = new Date(),
): Promise<{ queued: boolean; reason?: FollowupReason; error?: string }> {
  try {
    if (input.requireEnabled && !(await followupsEnabledForProject(db, input.review.project_id)).enabled) {
      return { queued: false, reason: 'followups_off' }
    }
    let prior = input.prior
    if (!prior) {
      const { data, error } = await db.from('fix_review_followups').select(PRIOR_COLUMNS).eq('fix_attempt_id', input.review.fix_attempt_id)
      if (error) return { queued: false, error: error.message }
      prior = (data ?? []) as PriorFollowup[]
    }
    const decision = followupTrigger({ review: input.review, attempt: input.attempt, prior, ci: input.ci ?? null })
    if (!decision.queue) return { queued: false, reason: decision.reason }
    const at = now.toISOString()
    const { data, error } = await db
      .from('fix_review_followups')
      .upsert(
        {
          fix_review_id: input.review.id,
          fix_attempt_id: input.review.fix_attempt_id,
          project_id: input.review.project_id,
          report_id: input.review.report_id,
          pr_url: input.attempt?.pr_url ?? null,
          head_sha_before: input.review.head_sha,
          status: 'queued',
          queued_at: at,
          // The column defaults to 'findings'; written only for a CI repair, so
          // findings follow-ups keep working before migration 20261022100000.
          ...(decision.kind === 'ci_repair' ? { kind: 'ci_repair' } : {}),
        },
        { onConflict: 'fix_attempt_id,head_sha_before', ignoreDuplicates: true },
      )
      .select('id')
    if (error) return { queued: false, error: error.message }
    return { queued: ((data ?? []) as unknown[]).length > 0 }
  } catch (err) {
    return { queued: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const IN_CHUNK = 100

export const CI_REPAIR_JOB_COLUMNS =
  'project_id, head_sha, job_id, job_name, workflow_name, run_id, run_attempt, repo, status, conclusion, ci_kind, infra, gh_created_at, steps'

/**
 * The `ci_jobs` rows (Plan 022) of these heads, grouped by head. Throws on a
 * read error so callers wait instead of reading "no CI" as "not failing".
 */
export async function ciJobsForHeads(
  db: SupabaseClient,
  projectIds: string[],
  heads: string[],
): Promise<Map<string, CiJobForRepair[]>> {
  const out = new Map<string, CiJobForRepair[]>()
  const unique = [...new Set(heads.filter(Boolean))]
  if (projectIds.length === 0 || unique.length === 0) return out
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from('ci_jobs')
      .select(CI_REPAIR_JOB_COLUMNS)
      .in('project_id', projectIds)
      .in('head_sha', unique.slice(i, i + IN_CHUNK))
      .limit(2000)
    if (error) throw new Error(`CI jobs read failed: ${error.message}`)
    for (const row of (data ?? []) as Array<CiJobForRepair & { head_sha: string }>) {
      out.set(row.head_sha, [...(out.get(row.head_sha) ?? []), row])
    }
  }
  return out
}

/**
 * The follow-ups of these apps created in the last `days` days, for the
 * scoreboard. Callers pass only apps the viewer can access.
 */
export async function followupScoreRows(
  db: SupabaseClient,
  projectIds: string[],
  now: Date,
  days: number = FOLLOWUP_SCOREBOARD_DAYS,
): Promise<FollowupScoreRow[]> {
  if (projectIds.length === 0) return []
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const out: FollowupScoreRow[] = []
  for (let i = 0; i < projectIds.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from('fix_review_followups')
      .select('status, dispatched_at, head_sha_before, head_sha_after, verdict_after, findings_dropped')
      .in('project_id', projectIds.slice(i, i + IN_CHUNK))
      .gte('created_at', since)
      .limit(5000)
    if (error) {
      if (notMigrated(error as { code?: string })) return []
      throw new Error(`review follow-up scoreboard read failed: ${error.message}`)
    }
    out.push(...((data ?? []) as FollowupScoreRow[]))
  }
  return out
}
