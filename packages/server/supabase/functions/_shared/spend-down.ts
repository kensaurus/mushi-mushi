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
 *          dispatch). `spendDownIdleReasons` is the same "dispatched nothing"
 *          the console status line reports, for the radar rule
 *          `spend_down_idle`.
 *
 *          "Already serves" follows the resolver order exactly (ADR 0023,
 *          extended by ADR 0031): an app's own key is that app's; a shared key
 *          serves the organization's apps that have no Cursor key of their
 *          own; a universal key serves the apps of the organizations its owner
 *          owns that have neither.
 *
 *          Cursor has no API for remaining credit, so the limit is a count of
 *          dispatches, not dollars. Open reports rank by severity, the judge
 *          score and a named component, times 1.3 when the report already has
 *          Sentry or stack evidence. The worker only reads and dispatches; it
 *          never merges anything (fixes open draft PRs as usual).
 *
 *          Stop-loss and scoreboard (ADR 0028 amendment, 2026-10-21): an app
 *          whose recent spend-down PRs are reliably rarely mergeable, often
 *          held by the Opus review (ADR 0030), or whose runs mostly end without
 *          a PR is paused (one probe dispatch a day keeps evidence coming; it
 *          resumes on recovered rates, two merged-verdict probes, samples aging
 *          out after 14 days, or a Resume); and every key gets a rollup of
 *          what its runs produced.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export interface SpendDownKey {
  id: string
  provider_slug: string
  project_id: string | null
  organization_id: string | null
  /** Set for a universal key (ADR 0031); absent before migration 20261021051628. */
  owner_user_id?: string | null
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
const NO_RETRY_VERDICTS: ReadonlySet<string> = new Set(['already_fixed', 'wrong_repo', 'not_actionable', 'needs_human'])

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

/** Cursor refused to start an agent because the account ran out (no agent ran, nothing was spent). */
// Cursor's create call answers `usage_limit_exceeded` / "On-demand usage is
// required"; a run that hits the limit later fails with prose such as "You've
// hit your usage limit". Match both, never a rate limit (429 backs off).
const KEY_LIMIT_RE = /usage_limit_exceeded|on-demand usage is required|\b(?:hit|reached|exceeded) (?:your|the) (?:usage|plan|monthly)[ -]?limit|\busage limit (?:reached|exceeded)\b/i

/** A fix failure that is the Cursor account's usage limit (see KEY_LIMIT_RE). */
export function isCursorKeyLimitError(message: string | null | undefined): boolean {
  return KEY_LIMIT_RE.test(message ?? '')
}
const KEY_LIMIT_RETRY_AFTER_MS = 30 * 60_000
const KEY_LIMIT_MAX_RETRIES = 2

/**
 * Reports whose latest dispatch Cursor refused for the account's usage limit,
 * at least 30 minutes ago and at most twice in the window: spend-down may send
 * them again although they were dispatched recently. On 2026-10-23 a key
 * switched to a model its account had used up refused 47 reports in an hour,
 * and the 7-day re-dispatch cooldown then kept them from the keys that still
 * had credits.
 */
export function reportsToRetryAfterKeyLimit(
  attempts: Array<{ report_id: string; failure_category: string | null; error?: string | null; created_at: string }>,
  now: Date,
): Set<string> {
  const byReport = new Map<string, Array<{ failure_category: string | null; error?: string | null; created_at: string }>>()
  for (const a of attempts) byReport.set(a.report_id, [...(byReport.get(a.report_id) ?? []), a])
  const out = new Set<string>()
  for (const [id, list] of byReport) {
    const sorted = [...list].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
    const latest = sorted[0]
    const limited = (a: { failure_category: string | null; error?: string | null }) =>
      a.failure_category === 'cursor_api_error' && isCursorKeyLimitError(a.error)
    if (!limited(latest)) continue
    if (now.getTime() - Date.parse(latest.created_at) < KEY_LIMIT_RETRY_AFTER_MS) continue
    if (sorted.filter(limited).length > KEY_LIMIT_MAX_RETRIES) continue
    out.add(id)
  }
  return out
}

/** A report whose PR Opus held may run again after this long (ADR 0028 amendment, 2026-10-24). */
export const HELD_RETRY_AFTER_MS = 12 * 3_600_000
/** Attempts per report, counting the held ones, after which spend-down stops retrying it. */
export const HELD_MAX_ATTEMPTS = 3

/**
 * Reports whose newest attempt opened a PR that the Opus review held, at
 * least 12 hours ago, with fewer than HELD_MAX_ATTEMPTS attempts: spend-down
 * may run a new agent on them although the report is still `fixing` and
 * inside the 7-day cooldown. The new agent's prompt carries what the held
 * attempt did and why it was held (_shared/prior-attempts.ts), so it does not
 * start from the same theory. On 2026-10-24, 126 reports sat held while the
 * Cursor keys idled on "No open report to fix".
 */
export function reportsToRetryAfterHold(
  attempts: Array<{ id: string; report_id: string; created_at: string }>,
  heldAttemptIds: ReadonlySet<string>,
  now: Date,
): Set<string> {
  const byReport = new Map<string, Array<{ id: string; created_at: string }>>()
  for (const a of attempts) byReport.set(a.report_id, [...(byReport.get(a.report_id) ?? []), a])
  const out = new Set<string>()
  for (const [id, list] of byReport) {
    if (list.length >= HELD_MAX_ATTEMPTS) continue
    const latest = list.reduce((x, y) => (y.created_at > x.created_at ? y : x))
    if (!heldAttemptIds.has(latest.id)) continue
    if (now.getTime() - Date.parse(latest.created_at) < HELD_RETRY_AFTER_MS) continue
    out.add(id)
  }
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
  /** Owners of the app's organization: whose universal keys it may use (ADR 0031). */
  org_owner_ids?: string[]
}

/** A Cursor byok_keys row as the resolver sees it. */
export interface CursorPoolKey {
  id: string
  project_id: string | null
  organization_id: string | null
  owner_user_id?: string | null
  priority: number | null
  status: string
  test_status: string | null
  /** Cursor refused this key for its plan's usage limit until then: new agents go to the next key. */
  exhausted_until?: string | null
}

/**
 * Rows the resolver will use for a NEW agent (byok.ts byokPoolCandidates plus
 * agent-adapters cursorKeyForNewWork): cooldowns are transient and ignored
 * here, but a used-up key hands its apps to the next one.
 */
function usableForResolver(k: CursorPoolKey, nowMs: number): boolean {
  if (k.exhausted_until && Date.parse(k.exhausted_until) > nowMs) return false
  return (k.status === 'active' || k.status === 'quota_exhausted') && (k.test_status === 'ok' || k.test_status === 'error_quota')
}

/**
 * The Cursor key `resolveCursorApiKey` picks first for one app (ADR 0023,
 * ADR 0031): its own pool keys by priority, else its legacy Integrations key
 * ('legacy'), else its organization's shared keys by priority, else the
 * universal keys of its organization's owners by priority. Returns null when
 * nothing is usable, and 'tie' when two keys share the winning priority,
 * because the resolver's order between them is not defined.
 */
export function firstCursorKeyFor(
  project: Pick<SpendDownProject, 'id' | 'organization_id' | 'has_legacy_key' | 'org_owner_ids'>,
  keys: CursorPoolKey[],
  nowMs: number = Date.now(),
): string | 'legacy' | 'tie' | null {
  const pick = (rows: CursorPoolKey[]): string | 'tie' | null => {
    if (rows.length === 0) return null
    const sorted = [...rows].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
    if (sorted.length > 1 && (sorted[0].priority ?? 100) === (sorted[1].priority ?? 100)) return 'tie'
    return sorted[0].id
  }
  const usable = keys.filter((k) => usableForResolver(k, nowMs))
  const own = usable.filter((k) => k.project_id === project.id)
  if (own.length > 0) return pick(own)
  if (project.has_legacy_key) return 'legacy'
  if (!project.organization_id) return null
  const shared = usable.filter((k) => !k.project_id && k.organization_id === project.organization_id)
  if (shared.length > 0) return pick(shared)
  const owners = project.org_owner_ids ?? []
  return pick(usable.filter((k) => !k.project_id && !k.organization_id && !!k.owner_user_id && owners.includes(k.owner_user_id)))
}

/**
 * The apps a key pays for: the apps where it is the resolver's first pick
 * (ADR 0023, ADR 0031), so a spend-down dispatch tagged with this key is billed to it.
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

/**
 * Stop lines the worker writes when a tick dispatched nothing for a reason
 * that will not clear on its own this window: auto-fix is off, or no open
 * report is left. A cap or a full run queue is not one of these.
 */
export const SPEND_DOWN_STOP_NO_REPORT = 'No open report to fix'
export const SPEND_DOWN_STOP_AUTOFIX_OFF = 'Auto-fix is off'

export type SpendDownIdleReason = 'no_app' | 'autofix_off' | 'reports_settled'

/** The last worker tick, as stored on `byok_keys.spend_down_last_summary`. */
export interface SpendDownTick {
  dispatched?: number
  projects?: Array<{ projectId: string; dispatched: number; stopped?: string }>
  at?: string
}

/**
 * The tick when it ran today (UTC), else null. `dispatchedToday` counts from
 * UTC midnight, so an older tick's stop lines do not describe today.
 */
export function todaysSpendDownTick(tick: SpendDownTick | null, now: Date): SpendDownTick | null {
  const at = tick?.at ? Date.parse(tick.at) : NaN
  if (!Number.isFinite(at)) return null
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)
  return at >= dayStart.getTime() ? tick : null
}

/**
 * Why a key inside its window dispatched nothing, or null when it did not.
 * `no_app` is the console status line: no app has this key as the resolver's
 * first pick with auto-fix on and a linked repo. `autofix_off` and
 * `reports_settled` come from the last tick, only when it ran today. A cap or
 * "three fixes already running" is not idle.
 */
export function spendDownIdleReasons(input: {
  state: SpendDownState
  servedProjectIds: readonly string[]
  dispatchedToday: number
  lastSummary: SpendDownTick | null
  now: Date
}): SpendDownIdleReason[] | null {
  if (input.state !== 'active' || input.dispatchedToday > 0) return null
  if (input.servedProjectIds.length === 0) return ['no_app']
  const tick = todaysSpendDownTick(input.lastSummary, input.now)
  const projects = tick?.projects
  if (tick?.dispatched !== 0 || !projects?.length) return null
  const idleStop = (stopped: string | undefined) =>
    stopped === SPEND_DOWN_STOP_NO_REPORT || stopped === SPEND_DOWN_STOP_AUTOFIX_OFF
  const covered = input.servedProjectIds.every((id) => {
    const row = projects.find((p) => p.projectId === id)
    return row != null && row.dispatched === 0 && idleStop(row.stopped)
  })
  if (!covered) return null
  const reasons: SpendDownIdleReason[] = []
  if (projects.some((p) => p.stopped === SPEND_DOWN_STOP_AUTOFIX_OFF)) reasons.push('autofix_off')
  if (projects.some((p) => p.stopped === SPEND_DOWN_STOP_NO_REPORT)) reasons.push('reports_settled')
  return reasons
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
  /** project_settings.autofix_max_concurrent: fewer agents at once where the app's CI is slow or shared. */
  maxConcurrent?: number | null
}): number {
  const byConcurrency = (args.maxConcurrent ?? SPEND_DOWN_MAX_OPEN_PER_PROJECT) - args.openCloudAttempts
  const byAutofixCap =
    args.autofixMaxPerDay == null ? Number.POSITIVE_INFINITY : args.autofixMaxPerDay - args.autofixDispatchesToday
  return Math.max(0, Math.min(args.remainingForKey, byConcurrency, byAutofixCap))
}

/** dispatch_metadata for a spend-down dispatch; `trigger: 'automatic'` keeps the auto-fix caps on. */
export function spendDownDispatchMetadata(
  key: Pick<SpendDownKey, 'id' | 'spend_down_model'>,
  opts: { probe?: boolean } = {},
): Record<string, unknown> {
  return {
    source: 'spend_down',
    agent_override: 'cursor_cloud',
    spend_down_key_id: key.id,
    ...(key.spend_down_model ? { model_override: key.spend_down_model } : {}),
    ...(opts.probe ? { spend_down_probe: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Stop-loss (ADR 0028 amendment, 2026-10-21): stop spending on an app where
// spend-down does not produce mergeable work, without pausing average apps.
// ---------------------------------------------------------------------------

/** Only spend-down runs dispatched in the last this-many days are samples. */
export const SPEND_DOWN_SAMPLE_MAX_AGE_DAYS = 14
/** The newest this-many reviews (and finished runs) inside that age are read. */
export const SPEND_DOWN_YIELD_WINDOW = 40
/**
 * No rule decides on fewer samples than this. With 20, the one-sided bound
 * below can tell 1-in-20 mergeable (paused) from 2-in-20 (not paused).
 */
export const SPEND_DOWN_MIN_SAMPLES = 20
/**
 * One-sided 95% Wilson bound. Each rule asks one directional question ("is
 * the merge rate below 20%?"), so the one-sided bound is the 95% test. A
 * 2026-10-21 simulation at the baseline (60% PR, 25% no-PR; reviews 29% merge,
 * 22% hold) with a 40-sample window pauses 2.5% of average apps within 200
 * runs (a 20-sample window: 22.6%) and 98% of 5%-merge apps within 100.
 */
export const SPEND_DOWN_WILSON_Z = 1.645
/**
 * Pause when even the optimistic (upper) bound of the merge rate is under
 * 20%: the app is reliably below the 29% baseline, not just unlucky.
 */
export const SPEND_DOWN_MIN_MERGE_RATE = 0.2
/** Pause when even the pessimistic (lower) bound of the hold rate is over 35% (baseline 22%). */
export const SPEND_DOWN_MAX_HOLD_RATE = 0.35
/**
 * Pause when the lower bound of the no-PR-verdict share of finished runs is
 * over 50% (baseline 25%): most runs end with the agent saying there is
 * nothing it can fix, and each one spends credits to say so.
 */
export const SPEND_DOWN_MAX_NO_PR_SHARE = 0.5
/**
 * Hysteresis: a paused app resumes only once the point estimates clear these,
 * a margin inside the pause lines so an app near a line does not flap.
 */
export const SPEND_DOWN_RESUME_MERGE_RATE = 0.25
export const SPEND_DOWN_RESUME_HOLD_RATE = 0.3
export const SPEND_DOWN_RESUME_NO_PR_SHARE = 0.45
/** A paused app still gets this many spend-down dispatches per UTC day, so evidence keeps arriving. */
export const SPEND_DOWN_PROBES_PER_DAY = 1
/** A paused app resumes when its newest this-many reviewed probes (since the pause) all got "merge". */
export const SPEND_DOWN_PROBE_RECOVERY = 2

/** Agent verdicts that end a run without a PR (_shared/cloud-agent-no-pr.ts). */
export const SPEND_DOWN_NO_PR_VERDICTS = ['already_fixed', 'not_actionable', 'needs_human', 'wrong_repo'] as const
export type SpendDownNoPrVerdict = (typeof SPEND_DOWN_NO_PR_VERDICTS)[number]

export type SpendDownRunOutcome = 'in_flight' | 'pr_opened' | 'no_pr_verdict' | 'other_failure'

const OPEN_ATTEMPT_STATUSES = new Set(['pending', 'queued', 'running'])
const OPEN_JOB_STATUSES = new Set(['queued', 'running'])

/**
 * Where one spend-down run (a fix_dispatch_jobs row and its fix_attempts row)
 * ended. Order matters:
 *   - an attempt still open is in flight even with a PR attached
 *     (agent-adapters attachPendingPr attaches a draft PR before the agent
 *     finishes, and the finished agent's files decide);
 *   - `validation_rejected` is a notes-only PR or a pre-PR guard stop, not a
 *     fix, so it is another failure even with a pr_url;
 *   - an agent verdict (already fixed, not actionable, ...) is a no-PR verdict;
 *   - then any PR counts as opened.
 */
export function classifySpendDownRun(
  job: { status: string | null; pr_url?: string | null },
  attempt: { status: string | null; pr_url?: string | null; failure_category?: string | null } | null,
): SpendDownRunOutcome {
  if (attempt) {
    if (OPEN_ATTEMPT_STATUSES.has(attempt.status ?? '')) return 'in_flight'
    if (attempt.failure_category === 'validation_rejected') return 'other_failure'
    if (attempt.failure_category && NO_RETRY_VERDICTS.has(attempt.failure_category)) return 'no_pr_verdict'
    if (nonEmptyText(attempt.pr_url)) return 'pr_opened'
    return 'other_failure'
  }
  if (OPEN_JOB_STATUSES.has(job.status ?? '')) return 'in_flight'
  return nonEmptyText(job.pr_url) ? 'pr_opened' : 'other_failure'
}

/** One spend-down run of an app, as the stop-loss reads it. */
export interface SpendDownYieldRun {
  /** When it was dispatched. */
  at: string
  outcome: SpendDownRunOutcome
  /** The latest completed Opus verdict on its PR, if any. */
  verdict: string | null
  reviewedAt: string | null
  /** Dispatched as the paused app's daily probe. */
  probe: boolean
  /**
   * Its fix regressed after Mushi merged it (`fix_attempts.regressed_at`,
   * ADR 0035): counted as a hold whatever the review said.
   */
  regressedAt?: string | null
}

export interface SpendDownYieldSamples {
  /** The app's spend-down runs (any key) since the age and reset cut-off, newest dispatch first. */
  runs: SpendDownYieldRun[]
}

/** Where the app stood after the previous tick. */
export interface SpendDownPauseState {
  paused: boolean
  /** When the current pause began. */
  pausedAt: string | null
}

export type SpendDownResumedBy = 'rates' | 'probes' | 'samples_aged_out'

export interface SpendDownStopLoss {
  paused: boolean
  /** Plain words for the console and the tick summary; null when not paused. */
  reason: string | null
  /** 'paused' or 'resumed' on the tick the state changed, else null. */
  transition: 'paused' | 'resumed' | null
  resumedBy: SpendDownResumedBy | null
  /** When the current pause began (kept across ticks), else null. */
  pausedAt: string | null
  /**
   * Set on a probe-driven resume: the dispatch time of the oldest resuming
   * probe. The caller stores it as the app's stop-loss reset, so later ticks
   * count only the probes and what follows, not the old window that paused
   * the app (which would pause it again on the next tick).
   */
  resetAt: string | null
  reviewed: number
  mergeVerdicts: number
  holdVerdicts: number
  mergeRate: number | null
  holdRate: number | null
  /** One-sided 95% Wilson upper bound of the merge rate (null under 20 reviews). */
  mergeUpper: number | null
  /** One-sided 95% Wilson lower bound of the hold rate (null under 20 reviews). */
  holdLower: number | null
  finishedRuns: number
  noPrVerdicts: number
  noPrShare: number | null
  /** One-sided 95% Wilson lower bound of the no-PR share (null under 20 finished runs). */
  noPrLower: number | null
}

/** Wilson score interval of k successes in n trials at `z`; [0, 1] when n is 0. */
export function wilsonInterval(k: number, n: number, z = SPEND_DOWN_WILSON_Z): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 1 }
  const p = k / n
  const z2 = z * z
  const d = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / d
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) }
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

const NO_PR_WORDS = 'already fixed, not actionable, needs a person or wrong repo'

/**
 * Should spend-down stop dispatching to this app? Reads its newest 40 Opus
 * reviews (a fix that regressed after a Mushi merge counts as a hold) and
 * newest 40 finished runs from the last 14 days (and after its last Resume). Not paused, it pauses when, with at least 20 samples, the
 * one-sided 95% Wilson bound says the merge rate is under 20%, the hold rate
 * over 35%, or the no-PR-verdict share over 50%. Paused, it resumes when:
 *   - the point estimates clear the hysteresis lines (merge above 25%, hold
 *     under 30%, no-PR under 45%; a rule with under 20 samples has cleared);
 *     this covers the old samples aging out after 14 days; or
 *   - its newest 2 reviewed daily probes since the pause both got "merge".
 */
export function spendDownStopLoss(
  samples: SpendDownYieldSamples,
  previous: SpendDownPauseState = { paused: false, pausedAt: null },
  now: Date = new Date(),
): SpendDownStopLoss {
  // A merged fix that regressed (ADR 0035) counts as a hold: the merge
  // verdict it had was wrong, and the app's yield must say so.
  const reviews = samples.runs
    .map((r) => (r.regressedAt ? { ...r, verdict: 'hold', reviewedAt: r.reviewedAt ?? r.regressedAt } : r))
    .filter((r) => r.verdict === 'merge' || r.verdict === 'fix_first' || r.verdict === 'hold')
    .sort((a, b) => String(b.reviewedAt ?? b.at).localeCompare(String(a.reviewedAt ?? a.at)))
    .slice(0, SPEND_DOWN_YIELD_WINDOW)
  const finished = samples.runs.filter((r) => r.outcome !== 'in_flight').slice(0, SPEND_DOWN_YIELD_WINDOW)

  const reviewed = reviews.length
  const mergeVerdicts = reviews.filter((r) => r.verdict === 'merge').length
  const holdVerdicts = reviews.filter((r) => r.verdict === 'hold').length
  const noPrVerdicts = finished.filter((r) => r.outcome === 'no_pr_verdict').length
  const mergeRate = reviewed > 0 ? mergeVerdicts / reviewed : null
  const holdRate = reviewed > 0 ? holdVerdicts / reviewed : null
  const noPrShare = finished.length > 0 ? noPrVerdicts / finished.length : null
  const enoughReviews = reviewed >= SPEND_DOWN_MIN_SAMPLES
  const enoughRuns = finished.length >= SPEND_DOWN_MIN_SAMPLES
  const mergeUpper = enoughReviews ? wilsonInterval(mergeVerdicts, reviewed).upper : null
  const holdLower = enoughReviews ? wilsonInterval(holdVerdicts, reviewed).lower : null
  const noPrLower = enoughRuns ? wilsonInterval(noPrVerdicts, finished.length).lower : null

  const mergeLine = `${mergeVerdicts} of the last ${reviewed} reviewed fixes were mergeable (${pct(mergeRate ?? 0)})`
  const holdLine = `Opus said hold on ${holdVerdicts} of the last ${reviewed} reviewed fixes (${pct(holdRate ?? 0)})`
  const noPrLine = `the agent opened no PR on ${noPrVerdicts} of the last ${finished.length} runs (${pct(noPrShare ?? 0)}): ${NO_PR_WORDS}`

  const stats = {
    reviewed,
    mergeVerdicts,
    holdVerdicts,
    mergeRate,
    holdRate,
    mergeUpper,
    holdLower,
    finishedRuns: finished.length,
    noPrVerdicts,
    noPrShare,
    noPrLower,
  }

  if (!previous.paused) {
    const reasons: string[] = []
    if (mergeUpper != null && mergeUpper < SPEND_DOWN_MIN_MERGE_RATE) reasons.push(mergeLine)
    if (holdLower != null && holdLower > SPEND_DOWN_MAX_HOLD_RATE) reasons.push(holdLine)
    if (noPrLower != null && noPrLower > SPEND_DOWN_MAX_NO_PR_SHARE) reasons.push(noPrLine)
    if (reasons.length === 0) {
      return { paused: false, reason: null, transition: null, resumedBy: null, pausedAt: null, resetAt: null, ...stats }
    }
    return {
      paused: true,
      reason: `Paused: ${reasons.join('; ')}`,
      transition: 'paused',
      resumedBy: null,
      pausedAt: now.toISOString(),
      resetAt: null,
      ...stats,
    }
  }

  // Paused: probe-driven recovery first, then the hysteresis lines.
  const pausedAt = previous.pausedAt
  const probes = reviews.filter((r) => r.probe && (!pausedAt || r.at >= pausedAt)).slice(0, SPEND_DOWN_PROBE_RECOVERY)
  if (probes.length >= SPEND_DOWN_PROBE_RECOVERY && probes.every((r) => r.verdict === 'merge')) {
    const resetAt = probes.map((r) => r.at).sort()[0]
    return { paused: false, reason: null, transition: 'resumed', resumedBy: 'probes', pausedAt: null, resetAt, ...stats }
  }
  const holding: string[] = []
  if (enoughReviews && (mergeRate ?? 0) <= SPEND_DOWN_RESUME_MERGE_RATE) {
    holding.push(`${mergeLine}, resumes above ${pct(SPEND_DOWN_RESUME_MERGE_RATE)}`)
  }
  if (enoughReviews && (holdRate ?? 0) >= SPEND_DOWN_RESUME_HOLD_RATE) {
    holding.push(`${holdLine}, resumes under ${pct(SPEND_DOWN_RESUME_HOLD_RATE)}`)
  }
  if (enoughRuns && (noPrShare ?? 0) >= SPEND_DOWN_RESUME_NO_PR_SHARE) {
    holding.push(`${noPrLine}, resumes under ${pct(SPEND_DOWN_RESUME_NO_PR_SHARE)}`)
  }
  if (holding.length > 0) {
    return {
      paused: true,
      reason: `Paused: ${holding.join('; ')}`,
      transition: null,
      resumedBy: null,
      pausedAt,
      resetAt: null,
      ...stats,
    }
  }
  const resumedBy: SpendDownResumedBy = enoughReviews || enoughRuns ? 'rates' : 'samples_aged_out'
  return { paused: false, reason: null, transition: 'resumed', resumedBy, pausedAt: null, resetAt: null, ...stats }
}

/** The later of two ISO times (either may be missing). */
function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}

/**
 * Each app's effective stop-loss reset: the later of the console Resume
 * (`project_settings.spend_down_stop_loss_reset_at`) and the reset the worker
 * carried in the last tick's summary (`stopLossResetAt`, written on a
 * probe-driven resume and kept every tick, so it holds even before the
 * column exists).
 */
export function effectiveStopLossResets(dbResets: Map<string, string>, summary: unknown): Map<string, string> {
  const out = new Map(dbResets)
  const projects = (summary as { projects?: unknown } | null | undefined)?.projects
  if (!Array.isArray(projects)) return out
  for (const p of projects as Array<{ projectId?: unknown; stopLossResetAt?: unknown }>) {
    if (typeof p?.projectId !== 'string' || typeof p.stopLossResetAt !== 'string') continue
    const later = laterIso(out.get(p.projectId), p.stopLossResetAt)
    if (later) out.set(p.projectId, later)
  }
  return out
}

/**
 * The pause state each app ended the previous tick with, from
 * `spend_down_last_summary`, ignoring a pause that began before the app's
 * last Resume (`project_settings.spend_down_stop_loss_reset_at`).
 */
export function previousPauseStates(
  summary: unknown,
  resets: Map<string, string> = new Map(),
): Map<string, SpendDownPauseState & { reason: string | null }> {
  const projects = (summary as { projects?: unknown } | null | undefined)?.projects
  const out = new Map<string, SpendDownPauseState & { reason: string | null }>()
  if (!Array.isArray(projects)) return out
  for (const p of projects as Array<{ projectId?: unknown; paused?: unknown; pausedAt?: unknown; stopped?: unknown }>) {
    if (p?.paused !== true || typeof p.projectId !== 'string') continue
    const pausedAt = typeof p.pausedAt === 'string' ? p.pausedAt : null
    const reset = resets.get(p.projectId)
    if (reset && (!pausedAt || reset >= pausedAt)) continue
    out.set(p.projectId, { paused: true, pausedAt, reason: typeof p.stopped === 'string' ? p.stopped : null })
  }
  return out
}

// ---------------------------------------------------------------------------
// Scoreboard: what the spend bought, per key × app × model × UTC day.
// ---------------------------------------------------------------------------

export const SPEND_DOWN_SCOREBOARD_DAYS = 7

/** One spend-down run, joined across fix_dispatch_jobs, fix_attempts and fix_reviews. */
export interface SpendDownRunRow {
  keyId: string
  projectId: string
  model: string
  /** YYYY-MM-DD (UTC) of the dispatch. */
  day: string
  outcome: SpendDownRunOutcome
  /** The agent verdict when outcome is no_pr_verdict. */
  noPrVerdict: string | null
  /** The latest completed Opus verdict, if the PR was reviewed. */
  verdict: string | null
  merged: boolean
  /**
   * fix_reviews.cost_usd: the cost of the latest review of this PR. A re-run
   * overwrites it, so a re-reviewed PR's earlier reviews are not in the sum.
   */
  latestReviewCostUsd: number | null
}

export interface SpendDownCounts {
  runs: number
  inFlight: number
  prsOpened: number
  noPrVerdicts: number
  noPrByVerdict: Record<SpendDownNoPrVerdict, number>
  otherFailures: number
  reviewed: number
  verdicts: { merge: number; fix_first: number; hold: number }
  merged: number
  latestReviewCostUsd: number
  /** merged / runs, null with no runs. */
  mergeYield: number | null
  /** Opus "merge" verdicts / runs, null with no runs. */
  mergeableYield: number | null
}

export interface SpendDownScoreRow extends SpendDownCounts {
  keyId: string
  projectId: string
  model: string
  day: string
}

function emptyCounts(): SpendDownCounts {
  return {
    runs: 0,
    inFlight: 0,
    prsOpened: 0,
    noPrVerdicts: 0,
    noPrByVerdict: { already_fixed: 0, not_actionable: 0, needs_human: 0, wrong_repo: 0 },
    otherFailures: 0,
    reviewed: 0,
    verdicts: { merge: 0, fix_first: 0, hold: 0 },
    merged: 0,
    latestReviewCostUsd: 0,
    mergeYield: null,
    mergeableYield: null,
  }
}

function addRun(c: SpendDownCounts, r: SpendDownRunRow): void {
  c.runs++
  if (r.outcome === 'in_flight') c.inFlight++
  else if (r.outcome === 'pr_opened') c.prsOpened++
  else if (r.outcome === 'no_pr_verdict') {
    c.noPrVerdicts++
    if (r.noPrVerdict && r.noPrVerdict in c.noPrByVerdict) c.noPrByVerdict[r.noPrVerdict as SpendDownNoPrVerdict]++
  } else c.otherFailures++
  if (r.verdict === 'merge' || r.verdict === 'fix_first' || r.verdict === 'hold') {
    c.reviewed++
    c.verdicts[r.verdict]++
  }
  if (r.merged) c.merged++
  if (r.latestReviewCostUsd != null && Number.isFinite(r.latestReviewCostUsd)) c.latestReviewCostUsd += r.latestReviewCostUsd
}

function finishCounts<T extends SpendDownCounts>(c: T): T {
  c.latestReviewCostUsd = Math.round(c.latestReviewCostUsd * 10_000) / 10_000
  c.mergeYield = c.runs > 0 ? c.merged / c.runs : null
  c.mergeableYield = c.runs > 0 ? c.verdicts.merge / c.runs : null
  return c
}

/**
 * Roll runs up per key × app × model × day, plus one total. Rows come out
 * newest day first, then by key, app and model, so the output is stable.
 */
export function spendDownScoreboard(runs: SpendDownRunRow[]): { totals: SpendDownCounts; rows: SpendDownScoreRow[] } {
  const totals = emptyCounts()
  const groups = new Map<string, SpendDownScoreRow>()
  for (const r of runs) {
    addRun(totals, r)
    const id = [r.keyId, r.projectId, r.model, r.day].join('\u0000')
    let g = groups.get(id)
    if (!g) {
      g = { keyId: r.keyId, projectId: r.projectId, model: r.model, day: r.day, ...emptyCounts() }
      groups.set(id, g)
    }
    addRun(g, r)
  }
  const rows = [...groups.values()]
    .map(finishCounts)
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        a.keyId.localeCompare(b.keyId) ||
        a.projectId.localeCompare(b.projectId) ||
        a.model.localeCompare(b.model),
    )
  return { totals: finishCounts(totals), rows }
}

/**
 * What a caller may see of the apps a key pays for (ADR 0031). A universal
 * key spans every organization its owner owns, so anyone but its owner (a
 * co-owner, admin, member, viewer, or any API key) sees only the apps of the
 * requesting app's organization, both in `projects` and in the worker's last
 * summary. App and organization keys serve one organization and pass through.
 */
export function scopeSpendDownView<P extends { id: string }>(args: {
  keyIsUniversal: boolean
  callerOwnsKey: boolean
  /** Ids of the apps in the requesting app's organization (or the app alone). */
  visibleProjectIds: ReadonlySet<string>
  projects: P[]
  lastSummary: unknown
}): { projects: P[]; lastSummary: unknown } {
  if (!args.keyIsUniversal || args.callerOwnsKey) return { projects: args.projects, lastSummary: args.lastSummary ?? null }
  const projects = args.projects.filter((p) => args.visibleProjectIds.has(p.id))
  const summary = args.lastSummary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { projects, lastSummary: summary ?? null }
  const raw = summary as Record<string, unknown>
  const visible = (p: unknown) => args.visibleProjectIds.has(String((p as { projectId?: unknown } | null)?.projectId))
  const summaryProjects = Array.isArray(raw.projects) ? raw.projects.filter(visible) : []
  return {
    projects,
    lastSummary: {
      ...raw,
      projects: summaryProjects,
      // Totals would count other organizations' dispatches: report this
      // organization's share of the tick, and no key-wide day totals.
      dispatched: summaryProjects.reduce((n, p) => n + Number((p as { dispatched?: unknown }).dispatched ?? 0), 0),
      dispatchedToday: null,
      remainingToday: null,
    },
  }
}
