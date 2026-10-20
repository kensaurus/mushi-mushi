/**
 * FILE: packages/server/supabase/functions/_shared/spend-down.ts
 * PURPOSE: The rules of spend-down mode (ADR 0028), as pure functions.
 *
 *          A Cursor key whose credits expire soon can be set to spend itself
 *          down: from `credits_expire_at - spend_down_window_days` until
 *          `credits_expire_at`, the spend-down worker dispatches fixes on its
 *          own to the apps that key already serves, at most
 *          `spend_down_daily_limit` a day, and never past an app's auto-fix
 *          caps (the fix worker checks those again for every automatic
 *          dispatch).
 *
 *          "Already serves" follows ADR 0023 exactly, so the key resolver does
 *          not change: an app's own key is that app's; a shared key serves the
 *          organization's apps that have no Cursor key of their own.
 *
 *          Cursor has no API for remaining credit, so the limit is a count of
 *          dispatches, not dollars. Open reports rank by severity, the judge
 *          score and a named component, times 1.3 when the report already has
 *          Sentry or stack evidence. The worker only reads and dispatches; it
 *          never merges anything (fixes open draft PRs as usual).
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export interface SpendDownKey {
  id: string
  provider_slug: string
  project_id: string | null
  organization_id: string | null
  status: string
  credits_expire_at: string | null
  spend_down_enabled: boolean
  spend_down_model: string | null
  spend_down_daily_limit: number
  spend_down_window_days: number
}

export type SpendDownState = 'off' | 'not_started' | 'active' | 'expired' | 'key_unusable'

export interface SpendDownWindow {
  state: SpendDownState
  /** When dispatching starts (credits_expire_at minus the window), or null. */
  startsAt: string | null
  expiresAt: string | null
}

export const SPEND_DOWN_DEFAULT_DAILY_LIMIT = 10
export const SPEND_DOWN_DEFAULT_WINDOW_DAYS = 14
/** Cloud agents running at once per app, the same bound as QA story runs. */
export const SPEND_DOWN_MAX_OPEN_PER_PROJECT = 3
/** A report dispatched in this many days is not picked again by spend-down. */
export const SPEND_DOWN_REDISPATCH_COOLDOWN_DAYS = 7

/**
 * A report whose latest fix attempt ended with one of these agent verdicts
 * (_shared/cloud-agent-no-pr.ts) is never picked again by spend-down: a new
 * run would spend the same credits to reach the same answer. A person can
 * still dispatch it.
 */
const NO_RETRY_VERDICTS = new Set(['already_fixed', 'wrong_repo'])

/** Report ids whose newest attempt carries a no-retry verdict. */
export function reportsWithNoRetryVerdict(
  attempts: Array<{ report_id: string; failure_category: string | null; created_at: string }>,
): Set<string> {
  const latest = new Map<string, { failure_category: string | null; created_at: string }>()
  for (const a of attempts) {
    const cur = latest.get(a.report_id)
    if (!cur || a.created_at > cur.created_at) latest.set(a.report_id, a)
  }
  const out = new Set<string>()
  for (const [id, a] of latest) if (a.failure_category && NO_RETRY_VERDICTS.has(a.failure_category)) out.add(id)
  return out
}

const DAY_MS = 86_400_000

export function spendDownWindow(key: SpendDownKey, now: Date): SpendDownWindow {
  const expiresAt = key.credits_expire_at
  if (!key.spend_down_enabled || key.provider_slug !== 'cursor' || !expiresAt) {
    return { state: 'off', startsAt: null, expiresAt: expiresAt ?? null }
  }
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return { state: 'off', startsAt: null, expiresAt }
  const start = end - Math.max(1, key.spend_down_window_days) * DAY_MS
  const startsAt = new Date(start).toISOString()
  if (now.getTime() >= end) return { state: 'expired', startsAt, expiresAt }
  if (key.status !== 'active') return { state: 'key_unusable', startsAt, expiresAt }
  if (now.getTime() < start) return { state: 'not_started', startsAt, expiresAt }
  return { state: 'active', startsAt, expiresAt }
}

/** Dispatches this key may still start today (UTC), never negative. */
export function remainingToday(key: Pick<SpendDownKey, 'spend_down_daily_limit'>, dispatchedToday: number): number {
  return Math.max(0, key.spend_down_daily_limit - dispatchedToday)
}

export interface SpendDownProject {
  id: string
  organization_id: string | null
  autofix_enabled: boolean
  has_repo: boolean
  /** project_settings.cursor_api_key_ref is set: the app's legacy Integrations key. */
  has_legacy_key: boolean
}

/** A Cursor byok_keys row as the resolver sees it. */
export interface CursorPoolKey {
  id: string
  project_id: string | null
  organization_id: string | null
  priority: number | null
  status: string
  test_status: string | null
}

/** Rows the resolver will use (byok.ts byokPoolCandidates); cooldowns are transient and ignored here. */
function usableForResolver(k: CursorPoolKey): boolean {
  return (k.status === 'active' || k.status === 'quota_exhausted') && (k.test_status === 'ok' || k.test_status === 'error_quota')
}

/**
 * The Cursor key `resolveCursorApiKey` picks first for one app (ADR 0023):
 * its own pool keys by priority, else its legacy Integrations key
 * ('legacy'), else its organization's shared keys by priority. Returns null
 * when nothing is usable, and 'tie' when two keys share the winning priority,
 * because the resolver's order between them is not defined.
 */
export function firstCursorKeyFor(
  project: Pick<SpendDownProject, 'id' | 'organization_id' | 'has_legacy_key'>,
  keys: CursorPoolKey[],
): string | 'legacy' | 'tie' | null {
  const pick = (rows: CursorPoolKey[]): string | 'tie' | null => {
    if (rows.length === 0) return null
    const sorted = [...rows].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
    if (sorted.length > 1 && (sorted[0].priority ?? 100) === (sorted[1].priority ?? 100)) return 'tie'
    return sorted[0].id
  }
  const usable = keys.filter(usableForResolver)
  const own = usable.filter((k) => k.project_id === project.id)
  if (own.length > 0) return pick(own)
  if (project.has_legacy_key) return 'legacy'
  if (!project.organization_id) return null
  return pick(usable.filter((k) => !k.project_id && k.organization_id === project.organization_id))
}

/**
 * The apps a key pays for: the apps where it is the resolver's first pick
 * (ADR 0023), so a spend-down dispatch tagged with this key is billed to it.
 * Apps with auto-fix off or no linked repo are left out: a dispatch there
 * would be skipped.
 */
export function spendDownProjectIds(
  key: Pick<SpendDownKey, 'id'>,
  projects: SpendDownProject[],
  keys: CursorPoolKey[],
): string[] {
  return projects
    .filter((p) => p.autofix_enabled && p.has_repo)
    .filter((p) => firstCursorKeyFor(p, keys) === key.id)
    .map((p) => p.id)
}

export interface SpendDownCandidate {
  id: string
  severity: string | null
  judge_score: number | null
  component: string | null
  report_group_id: string | null
  created_at: string
  /**
   * The report already carries Sentry or a stack (plan §4 step 3). Absent
   * scores as false so callers that have not read evidence stay unboosted.
   */
  has_cheap_evidence?: boolean
}

/** Columns `candidatesFor` must select so `spendDownCandidateFromReport` can see evidence. */
export const SPEND_DOWN_CANDIDATE_COLUMNS =
  'id, severity, judge_score, component, report_group_id, created_at, source, sentry_issue_url, sentry_event_id, custom_metadata, console_logs'

const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
/** Plan §4 step 3: a report that already has Sentry or stack evidence is a better bet. */
export const SPEND_DOWN_CHEAP_EVIDENCE_BOOST = 1.3

/** Report fields the worker can read in the same row as the ranking inputs. */
export interface SpendDownEvidenceRow {
  source?: string | null
  sentry_issue_url?: string | null
  sentry_event_id?: string | null
  custom_metadata?: unknown
  console_logs?: unknown
}

function nonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Cheap evidence already on the report: a Sentry origin, issue URL or event
 * id, stored Sentry frame paths, or a console stack. No extra lookup.
 */
export function reportHasCheapEvidence(row: SpendDownEvidenceRow): boolean {
  if (row.source === 'sentry') return true
  if (nonEmptyText(row.sentry_issue_url) || nonEmptyText(row.sentry_event_id)) return true
  const frames = (row.custom_metadata as { sentryFrames?: unknown } | null | undefined)?.sentryFrames
  if (Array.isArray(frames) && frames.some(nonEmptyText)) return true
  if (!Array.isArray(row.console_logs)) return false
  return row.console_logs.some((log) => nonEmptyText((log as { stack?: unknown } | null)?.stack))
}

export function spendDownCandidateFromReport(row: SpendDownCandidate & SpendDownEvidenceRow): SpendDownCandidate {
  return {
    id: row.id,
    severity: row.severity ?? null,
    judge_score: row.judge_score ?? null,
    component: row.component ?? null,
    report_group_id: row.report_group_id ?? null,
    created_at: row.created_at,
    has_cheap_evidence: reportHasCheapEvidence(row),
  }
}

/**
 * Highest expected value first: severity, times the judge's grade of the
 * diagnosis (a confident, graded diagnosis is a better bet), times 1.5 when
 * the diagnosis names a component the agent can open, times 1.3 when the
 * report already carries Sentry or stack evidence. One report per group,
 * so a burst of duplicates is fixed once.
 */
export function rankSpendDownCandidates(rows: SpendDownCandidate[]): SpendDownCandidate[] {
  const score = (r: SpendDownCandidate) =>
    (SEVERITY_WEIGHT[(r.severity ?? '').toLowerCase()] ?? 1) *
    (r.judge_score != null && Number.isFinite(r.judge_score) ? Math.max(0.2, r.judge_score) : 0.5) *
    (r.component && r.component.trim() ? 1.5 : 1) *
    (r.has_cheap_evidence ? SPEND_DOWN_CHEAP_EVIDENCE_BOOST : 1)
  const sorted = [...rows].sort((a, b) => score(b) - score(a) || b.created_at.localeCompare(a.created_at))
  const seenGroups = new Set<string>()
  const out: SpendDownCandidate[] = []
  for (const r of sorted) {
    if (r.report_group_id) {
      if (seenGroups.has(r.report_group_id)) continue
      seenGroups.add(r.report_group_id)
    }
    out.push(r)
  }
  return out
}

/** How many to dispatch to one app this tick. */
export function projectCapacity(args: {
  remainingForKey: number
  openCloudAttempts: number
  autofixDispatchesToday: number
  autofixMaxPerDay: number | null
}): number {
  const byConcurrency = SPEND_DOWN_MAX_OPEN_PER_PROJECT - args.openCloudAttempts
  const byAutofixCap =
    args.autofixMaxPerDay == null ? Number.POSITIVE_INFINITY : args.autofixMaxPerDay - args.autofixDispatchesToday
  return Math.max(0, Math.min(args.remainingForKey, byConcurrency, byAutofixCap))
}

/** dispatch_metadata for a spend-down dispatch; `trigger: 'automatic'` keeps the auto-fix caps on. */
export function spendDownDispatchMetadata(key: Pick<SpendDownKey, 'id' | 'spend_down_model'>): Record<string, unknown> {
  return {
    source: 'spend_down',
    agent_override: 'cursor_cloud',
    spend_down_key_id: key.id,
    ...(key.spend_down_model ? { model_override: key.spend_down_model } : {}),
  }
}
