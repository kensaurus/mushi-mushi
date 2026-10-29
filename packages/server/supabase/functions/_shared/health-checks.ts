/**
 * FILE: packages/server/supabase/functions/_shared/health-checks.ts
 * PURPOSE: One Health check (plan-simplicity-2026-10, Phase 1; ADR 0054,
 *          Proposed). Mushi Mushi already had more than 60 setup and health
 *          checks under five names on five surfaces. This registry gives each
 *          one id and the same shape, so Home's "Fix these first", the Set up
 *          page, `mushi doctor` and MCP `diagnose_setup` read one list:
 *
 *            - what it found (`status`: ok | problem | unknown), in plain words;
 *            - its fix: `auto` (Mushi Mushi does it), `one_click` (a button on
 *              the page `to` names, or a server `action`) or `guided` (steps);
 *            - which automations it `blocks` while it is a problem;
 *            - its `part` (sdk, github, ai_keys, …) and, when known, how many
 *              items wait on it (`affects`).
 *
 *          The first members are adapted from the existing checkers, never
 *          re-implemented: setup gaps (`setup-gaps.ts`), SDK health
 *          (`sdk-health.ts`), the SDK diagnostics launcher verdict
 *          (`sdk-diagnostics.ts`) and the server doctor (`api/routes/doctor.ts`).
 *
 *          A check that could not be read is `unknown`, never `problem`, and
 *          `unknown` never pauses anything (the health gate, `health-gate.ts`).
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import type { SetupGap } from './setup-gaps.ts'
import type { SdkHealthProblem, SdkHealthResult } from './sdk-health.ts'
import { sdkDiagnosticVerdict } from './sdk-diagnostics.ts'

export type HealthStatus = 'ok' | 'problem' | 'unknown'
export type HealthSeverity = 'critical' | 'warn' | 'info'
export type HealthAudience = 'app_owner' | 'platform'
export type HealthSource = 'setup_gaps' | 'sdk_health' | 'sdk_diagnostics' | 'doctor'

/** The automations a problem can stop (stop the line, plan §4b). */
export const HEALTH_BLOCKS = ['autofix', 'followups', 'train', 'reporter_updates', 'reports', 'review', 'triage', 'lane'] as const
export type HealthBlock = (typeof HEALTH_BLOCKS)[number]

/** The swappable parts of plan §4a; `pipeline` and `platform` hold the server doctor's checks. */
export type HealthPart = 'sdk' | 'github' | 'ai_keys' | 'workers' | 'release' | 'notifications' | 'pipeline' | 'platform'

export type HealthFix =
  /** Mushi Mushi does it on its own (none in Phase 1). */
  | { kind: 'auto'; label: string; action: string }
  /** One button: on the console page `to`, or a server `action` the console offers there. */
  | { kind: 'one_click'; label: string; to: string; action?: string }
  /** Exact steps, for what Mushi Mushi cannot do for you. */
  | { kind: 'guided'; label: string; steps: string[]; to?: string }

export interface HealthCheck {
  /** The check's id: one per kind of check (`github_access`, `never_seen`, …). */
  id: string
  /** Unique within a project's list (`github_access:owner/repo` for one repo). */
  key: string
  projectId: string | null
  audience: HealthAudience
  part: HealthPart
  status: HealthStatus
  severity: HealthSeverity
  title: string
  detail: string
  fix: HealthFix | null
  /** Automations this check stops while it is a `problem` (never while `ok` or `unknown`). */
  blocks: HealthBlock[]
  /** "N are waiting on this", when it was counted; null when not known. */
  affects: number | null
  source: HealthSource
  checkedAt: string | null
}

interface CheckMeta {
  part: HealthPart
  severity: HealthSeverity
  blocks: HealthBlock[]
  audience?: HealthAudience
}

/**
 * Each known check id: its part, how bad a problem is, what it stops. The
 * rows follow plan §4b's table; ids not listed (a doctor check added later)
 * get UNLISTED, which stops nothing.
 */
export const CHECK_META: Readonly<Record<string, CheckMeta>> = {
  // Setup gaps (setup-gaps.ts)
  github_access: { part: 'github', severity: 'critical', blocks: ['autofix', 'train'] },
  review_followup_key: { part: 'ai_keys', severity: 'critical', blocks: ['followups'] },
  autofix_agent_key: { part: 'ai_keys', severity: 'critical', blocks: ['autofix'] },
  deploy_events: { part: 'release', severity: 'warn', blocks: ['reporter_updates'] },
  slack_bot_token: { part: 'notifications', severity: 'warn', blocks: [] },
  // SDK health (sdk-health.ts); the plan's ids where it names one
  sdk_not_installed: { part: 'sdk', severity: 'critical', blocks: ['reports'] },
  sdk_no_repo: { part: 'github', severity: 'warn', blocks: [] },
  sdk_no_key: { part: 'sdk', severity: 'critical', blocks: ['reports'] },
  ci_secrets_missing: { part: 'sdk', severity: 'warn', blocks: ['reports'] },
  never_seen: { part: 'sdk', severity: 'critical', blocks: [] },
  outdated_sdk: { part: 'sdk', severity: 'info', blocks: [] },
  csp_blocks_api: { part: 'sdk', severity: 'critical', blocks: ['reports'] },
  sdk_stale: { part: 'sdk', severity: 'warn', blocks: [] },
  // SDK diagnostics (sdk-diagnostics.ts)
  banner_disabled: { part: 'sdk', severity: 'warn', blocks: ['reports'] },
  // Server doctor (api/routes/doctor.ts)
  stranded_reports: { part: 'pipeline', severity: 'warn', blocks: ['triage'] },
  dead_letter: { part: 'pipeline', severity: 'warn', blocks: ['triage'] },
  codebase_index: { part: 'github', severity: 'info', blocks: [] },
  recovery_token: { part: 'platform', severity: 'critical', blocks: [], audience: 'platform' },
  recovery_cron: { part: 'platform', severity: 'critical', blocks: [], audience: 'platform' },
  observability: { part: 'platform', severity: 'info', blocks: [], audience: 'platform' },
}

const UNLISTED: CheckMeta = { part: 'platform', severity: 'info', blocks: [] }

export function metaOf(id: string): CheckMeta {
  if (id.startsWith('platform_')) return { part: 'platform', severity: 'warn', blocks: [], audience: 'platform' }
  return CHECK_META[id] ?? UNLISTED
}

/** `github_access:owner/repo` and `codebase_index:<project>` share their check's id. */
export function checkIdOf(key: string): string {
  const i = key.indexOf(':')
  return i === -1 ? key : key.slice(0, i)
}

function make(
  key: string,
  projectId: string | null,
  source: HealthSource,
  status: HealthStatus,
  title: string,
  detail: string,
  fix: HealthFix | null,
  checkedAt: string | null,
  severity?: HealthSeverity,
): HealthCheck {
  const id = checkIdOf(key)
  const meta = metaOf(id)
  return {
    id,
    key,
    projectId,
    audience: meta.audience ?? 'app_owner',
    part: meta.part,
    status,
    severity: severity ?? meta.severity,
    title,
    detail,
    fix,
    blocks: [...meta.blocks],
    affects: null,
    source,
    checkedAt,
  }
}

// ── Setup gaps ──────────────────────────────────────────────────────────────

const GAP_FIX_LABEL: Record<string, string> = {
  github_access: 'Connect GitHub',
  review_followup_key: 'Pick a Cursor key',
  autofix_agent_key: 'Pick a key',
  deploy_events: 'Connect deploys',
  slack_bot_token: 'Reconnect Slack',
}

/** A setup gap as a registry row. `gap` is a problem; the rest keep their meaning. */
export function fromSetupGap(gap: SetupGap, checkedAt: string | null): HealthCheck {
  const status: HealthStatus = gap.status === 'gap' ? 'problem' : gap.status
  const id = checkIdOf(gap.id)
  const fix: HealthFix = { kind: 'one_click', label: GAP_FIX_LABEL[id] ?? 'Fix it', to: gap.fixHref }
  return {
    ...make(gap.id, gap.projectId, 'setup_gaps', status, gap.title, gap.summary, fix, checkedAt),
    audience: gap.audience,
  }
}

// ── SDK health ──────────────────────────────────────────────────────────────

const SDK_ID: Record<SdkHealthProblem['id'], string> = {
  not_installed: 'sdk_not_installed',
  no_repo: 'sdk_no_repo',
  no_sdk_key: 'sdk_no_key',
  ci_secrets_missing: 'ci_secrets_missing',
  never_seen: 'never_seen',
  outdated: 'outdated_sdk',
  csp_blocks_api: 'csp_blocks_api',
  stale: 'sdk_stale',
}

/** Which console page holds each SDK health fix button (the Connect page's SDK health card). */
export const SDK_HEALTH_HREF = '/connect#connect-sdk-health'

const SDK_SEVERITY: Record<SdkHealthProblem['severity'], HealthSeverity> = { error: 'critical', warn: 'warn', info: 'info' }

/** Which notes mean which checks could not run (sdk-health.ts SdkHealthNote.check). */
const NOTE_CHECKS: Record<string, string[]> = {
  repo: ['sdk_not_installed'],
  ci_secrets: ['ci_secrets_missing'],
  site_csp: ['csp_blocks_api'],
  versions: ['outdated_sdk'],
}

/**
 * SDK health's problems as registry rows, plus an `unknown` row for each
 * check a note says could not run, and an `ok` row for every other SDK check
 * (so a list with no SDK rows never reads as "not checked").
 */
export function fromSdkHealth(projectId: string, result: SdkHealthResult, checkedAt: string | null): HealthCheck[] {
  const out: HealthCheck[] = []
  const seen = new Set<string>()
  for (const p of result.problems) {
    const id = SDK_ID[p.id]
    seen.add(id)
    const fix: HealthFix | null = p.link
      ? { kind: 'one_click', label: p.link.label, to: p.link.href }
      : p.fix
        ? { kind: 'one_click', label: p.fix.label, to: SDK_HEALTH_HREF, action: p.fix.kind }
        : { kind: 'one_click', label: 'Open SDK health', to: SDK_HEALTH_HREF }
    out.push(make(id, projectId, 'sdk_health', 'problem', p.title, p.detail, fix, checkedAt, SDK_SEVERITY[p.severity]))
  }
  for (const n of result.notes) {
    for (const id of NOTE_CHECKS[n.check] ?? []) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(make(id, projectId, 'sdk_health', 'unknown', 'Not checked', n.detail, null, checkedAt))
    }
  }
  for (const id of Object.values(SDK_ID)) {
    if (seen.has(id)) continue
    out.push(make(id, projectId, 'sdk_health', 'ok', SDK_OK_TITLE[id] ?? 'SDK check', 'No problem found.', null, checkedAt))
  }
  return out
}

const SDK_OK_TITLE: Record<string, string> = {
  sdk_not_installed: 'SDK installed',
  sdk_no_repo: 'GitHub repo linked',
  sdk_no_key: 'SDK key',
  ci_secrets_missing: 'CI secrets',
  never_seen: 'SDK checked in',
  outdated_sdk: 'SDK version',
  csp_blocks_api: 'Site security policy',
  sdk_stale: 'SDK checking in',
}

/** SDK health could not be read at all: every SDK row is `unknown`, none missing. */
export function sdkHealthUnreadable(projectId: string, reason: string, checkedAt: string | null): HealthCheck[] {
  return Object.values(SDK_ID).map((id) => make(id, projectId, 'sdk_health', 'unknown', SDK_OK_TITLE[id] ?? 'SDK check', `Mushi Mushi could not run the SDK health check (${reason}).`, null, checkedAt))
}

// ── SDK diagnostics (launcher) ──────────────────────────────────────────────

/**
 * Whether people can open the report button at all. Only the launcher half
 * of the fused diagnostics verdict is used: its CI-secret half is SDK
 * health's `ci_secrets_missing`, and its native half is only meaningful for
 * a native app (it flags every web-only app), so neither is repeated here.
 * `settings` null: the settings could not be read.
 */
export function bannerCheck(projectId: string, settings: { bannerEnabled: boolean; launcherMode: string | null } | null, checkedAt: string | null): HealthCheck {
  const title = 'Report button'
  if (!settings) return make('banner_disabled', projectId, 'sdk_diagnostics', 'unknown', title, 'Mushi Mushi could not read the report button settings.', null, checkedAt)
  const verdict = sdkDiagnosticVerdict({ ...settings, missingVars: null, nativeEverSeen: true, lastSeenAt: null })
  if (verdict.status === 'banner-disabled') {
    return make('banner_disabled', projectId, 'sdk_diagnostics', 'problem', title, `The report button is hidden, so your users cannot report bugs. ${verdict.recommendedFix}`, {
      kind: 'one_click',
      label: 'Turn the button on',
      to: '/projects',
    }, checkedAt)
  }
  return make('banner_disabled', projectId, 'sdk_diagnostics', 'ok', title, 'Your users can open the report button.', null, checkedAt)
}

// ── Server doctor ───────────────────────────────────────────────────────────

export interface DoctorCheckLike {
  name: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  hint?: string
}

/**
 * A server doctor line as a registry row. `fail` is a problem; `warn` is a
 * problem except a line that says it could not read (that is `unknown`).
 */
export function fromDoctorCheck(projectId: string | null, check: DoctorCheckLike, checkedAt: string | null): HealthCheck {
  const unread = /^could not read/i.test(check.summary)
  const status: HealthStatus = check.status === 'pass' ? 'ok' : unread ? 'unknown' : 'problem'
  const severity: HealthSeverity | undefined = check.status === 'warn' && metaOf(check.name).severity === 'critical' ? 'warn' : undefined
  const fix: HealthFix | null = status === 'problem' && check.hint ? { kind: 'guided', label: 'How to fix', steps: [check.hint] } : null
  return make(check.name, projectId, 'doctor', status, check.name.replace(/_/g, ' '), check.summary, fix, checkedAt, severity)
}

// ── Lists ───────────────────────────────────────────────────────────────────

const STATUS_RANK: Record<HealthStatus, number> = { problem: 0, unknown: 1, ok: 2 }
const SEVERITY_RANK: Record<HealthSeverity, number> = { critical: 0, warn: 1, info: 2 }

/** Problems first (worst, then most waiting), then unknown, then ok; stable within each. */
export function sortChecks(checks: HealthCheck[]): HealthCheck[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.c.status] - STATUS_RANK[b.c.status] ||
        SEVERITY_RANK[a.c.severity] - SEVERITY_RANK[b.c.severity] ||
        (b.c.affects ?? -1) - (a.c.affects ?? -1) ||
        a.i - b.i,
    )
    .map((x) => x.c)
}

export function countChecks(checks: ReadonlyArray<Pick<HealthCheck, 'status'>>): Record<HealthStatus, number> {
  const out: Record<HealthStatus, number> = { ok: 0, problem: 0, unknown: 0 }
  for (const c of checks) out[c.status]++
  return out
}

/** Rows with the same key: the first one wins (setup gaps before SDK health before the doctor). */
export function dedupeChecks(checks: HealthCheck[]): HealthCheck[] {
  const seen = new Set<string>()
  return checks.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
}

/**
 * SDK health's "no repo" says what setup gaps' `github_access` already says
 * when no repo is connected; keep one line.
 */
export function dropDuplicateNoRepo(checks: HealthCheck[]): HealthCheck[] {
  const noRepo = checks.some((c) => c.key === 'github_access' && c.status === 'problem')
  return noRepo ? checks.filter((c) => c.id !== 'sdk_no_repo') : checks
}

export const FIX_FIRST_MAX = 3

/**
 * Whether a problem belongs in "Fix these first": a critical one always; a
 * lesser one only while something is counted as waiting on it (a new app
 * that has never deployed has no fix waiting to go live, so "no deploy seen"
 * is not yet a root cause). "No GitHub repo connected" is never one: a repo
 * is optional (standalone first) and the setup checklist already asks for it.
 * Per-repo access lines (`github_access:owner/repo`) still are.
 */
function isRootCause(c: HealthCheck): boolean {
  if (c.audience !== 'app_owner' || c.status !== 'problem') return false
  if (c.key === 'github_access') return false
  if (c.severity === 'critical') return true
  return c.blocks.length > 0 && (c.affects ?? 0) > 0
}

/**
 * Home's "Fix these first": an app owner's root causes (isRootCause), worst
 * and most waited-on first, at most three. Every other problem stays in the
 * full list, not here.
 */
export function rootCauses(checks: HealthCheck[], max = FIX_FIRST_MAX): HealthCheck[] {
  return sortChecks(checks.filter(isRootCause)).slice(0, max)
}

// ── Root causes of pipeline groups ──────────────────────────────────────────

/**
 * Which check explains each stuck /pipeline group when it is a problem
 * (plan §1c: 207 open fix PRs, three causes). Read by `tagRootCauses` in
 * pipeline-view.ts and by `attachAffects` below.
 */
export const ROOT_CAUSE_OF_GROUP: Readonly<Record<string, string>> = {
  fix_first: 'review_followup_key',
  held_fix_first: 'review_followup_key',
  ci_red: 'review_followup_key',
  ci_red_queued: 'review_followup_key',
  held_own_ci_red: 'review_followup_key',
  held_followups_off: 'review_followup_key',
  autofix_no_agent: 'autofix_agent_key',
  no_fix_old: 'autofix_agent_key',
  not_deployed: 'deploy_events',
}

/** The check ids that are a problem, by project. */
export function problemsByProject(checks: ReadonlyArray<Pick<HealthCheck, 'projectId' | 'id' | 'status'>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const c of checks) {
    if (c.status !== 'problem' || !c.projectId) continue
    const set = out.get(c.projectId) ?? new Set<string>()
    set.add(c.id)
    out.set(c.projectId, set)
  }
  return out
}

export interface TaggedGroupLike {
  rootCause?: { checkId: string; count: number } | null
  count: number
  items: ReadonlyArray<{ projectId: string }>
}

/**
 * "N are waiting on this": each problem's count is the items of its app in
 * the stuck pipeline groups it explains (groups already tagged by
 * `tagRootCauses`). A group of one app counts whole (its item list may be
 * capped); a group of several apps counts that app's listed items. Additive:
 * a check no group points at keeps `affects: null`.
 */
export function attachAffects(checks: HealthCheck[], groups: ReadonlyArray<TaggedGroupLike>): HealthCheck[] {
  const byKey = new Map<string, number>()
  for (const g of groups) {
    if (!g.rootCause) continue
    const apps = new Set(g.items.map((i) => i.projectId))
    for (const app of apps) {
      const n = apps.size === 1 ? g.count : g.items.filter((i) => i.projectId === app).length
      const k = `${app}\u0000${g.rootCause.checkId}`
      byKey.set(k, (byKey.get(k) ?? 0) + n)
    }
  }
  return checks.map((c) => {
    const n = c.projectId ? byKey.get(`${c.projectId}\u0000${c.id}`) : undefined
    return c.status === 'problem' && n !== undefined ? { ...c, affects: n } : c
  })
}
