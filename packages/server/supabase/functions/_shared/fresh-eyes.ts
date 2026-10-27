/**
 * FILE: packages/server/supabase/functions/_shared/fresh-eyes.ts
 * PURPOSE: The rules of fresh-eyes runs on the server (ADR 0053): the run
 *          snapshot `mushi-ux fresh-eyes --sync` sends, the screenshot names
 *          it may upload, the finding it may file, the synthetic account the
 *          operator route mints, the metric rows a finished run writes once,
 *          and which synthetic accounts the sweep deletes.
 *
 * Pure: no Deno globals, so vitest imports it directly. The reads and writes
 * are in api/routes/fresh-eyes.ts and _shared/fresh-eyes-cleanup.ts.
 */

import { z } from 'npm:zod@3'

export const FRESH_EYES_RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
/** `s<session>-step<nn>.png`, as the CLI names its screenshots. */
export const FRESH_EYES_SHOT_RE = /^s(?:[1-9]|10)-step[0-9]{2,3}\.png$/
/** Reports a run may file; the CLI caps itself at the same number. */
export const FRESH_EYES_FILE_CAP = 15
/** A synthetic account lives this long; the daily retention sweep deletes it after. */
export const SYNTHETIC_ACCOUNT_TTL_HOURS = 24
/** Accounts one operator may mint an hour. */
export const SYNTHETIC_MINTS_PER_HOUR = 12
export const SYNTHETIC_MINT_RATE_SCOPE = 'fresh_eyes_test_account'

const STALL_REASONS = ['signup_wall', 'captcha', 'external', 'dead_end', 'blocked', 'error', 'model_gave_up', 'model_unavailable', 'out_of_steps'] as const
const OPINIONS = ['confusing', 'unclear_copy', 'too_many_choices', 'gave_up'] as const

const Step = z.object({
  n: z.number().int().min(0).max(1000),
  action: z.string().max(300),
  path: z.string().max(500),
  screen: z.string().max(300),
  model_ms: z.number().int().min(0).max(3_600_000),
  app_ms: z.number().int().min(0).max(3_600_000),
  read_ms: z.number().int().min(0).max(3_600_000),
  outcome: z.enum(['ok', 'refused', 'failed', 'blocked', 'left-app', 'terminal']),
  note: z.string().max(300).nullable(),
  opinion: z.object({ category: z.enum(OPINIONS), why: z.string().max(200) }).nullable(),
  backtrack: z.boolean(),
  dead_end: z.boolean(),
  requirements: z.array(z.enum(['inbox', 'api_key', 'terminal', 'third_party_account'])).max(4),
  signals: z.array(z.enum(['console-error', 'page-error', 'server-error', 'blank-screen'])).max(20),
  shot: z.string().regex(FRESH_EYES_SHOT_RE).nullable(),
})

const Stall = z.object({ step: z.number().int().min(0), screen: z.string().max(300), reason: z.enum(STALL_REASONS), detail: z.string().max(300) })

export const FreshEyesSnapshot = z.object({
  status: z.enum(['running', 'done', 'failed']),
  goal: z.string().min(1).max(300),
  start_url: z.string().url().max(500),
  model: z.string().max(120).nullable(),
  dry_run: z.boolean(),
  has_account: z.boolean(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
  ttfv_seconds: z.number().min(0).max(86_400).nullable(),
  steps: z.number().int().min(0).max(1000),
  reached: z.number().int().min(0).max(10),
  stalled_at: z.object({ screen: z.string().max(300), reason: z.enum(STALL_REASONS), sessions: z.number().int().min(0).max(10) }).nullable(),
  findings: z
    .array(z.object({ fingerprint: z.string().regex(/^[0-9a-f]{16}$/), severity: z.enum(['high', 'medium', 'low']), basis: z.enum(['measured', 'opinion']), summary: z.string().max(300), sessions: z.array(z.number().int().min(1).max(10)).max(10) }))
    .max(50),
  sessions: z
    .array(
      z.object({
        index: z.number().int().min(1).max(10),
        outcome: z.enum(['reached', 'stalled']),
        stall: Stall.nullable(),
        ttfv_seconds: z.number().min(0).max(86_400).nullable(),
        app_seconds: z.number().min(0),
        read_seconds: z.number().min(0),
        model_seconds: z.number().min(0),
        backtracks: z.number().int().min(0),
        steps: z.array(Step).max(120),
      }),
    )
    .max(10),
  cli_version: z.string().max(40).nullable(),
})
export type FreshEyesSnapshot = z.infer<typeof FreshEyesSnapshot>

export const FreshEyesFindingBody = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    rule: z.string().regex(/^fresh-eyes-[a-z0-9-]{1,60}$/),
    basis: z.enum(['measured', 'opinion']),
    title: z.string().min(3).max(200),
    description: z.string().min(1).max(10_000),
    severity: z.enum(['high', 'medium', 'low']),
    component: z.string().max(200).optional(),
  })
  .strict()
export type FreshEyesFindingBody = z.infer<typeof FreshEyesFindingBody>

/** The ux_runs columns a snapshot writes (kind fresh_eyes). */
export function freshEyesRunRow(s: FreshEyesSnapshot, ctx: { projectId: string; localRunId: string; userId: string; now: Date }): Record<string, unknown> {
  return {
    project_id: ctx.projectId,
    local_run_id: ctx.localRunId,
    created_by: ctx.userId,
    kind: 'fresh_eyes',
    mode: 'local',
    agent: 'fresh-eyes',
    status: s.status,
    model: s.model,
    goal: s.goal,
    start_url: s.start_url,
    timeline: s.sessions,
    ttfv_seconds: s.ttfv_seconds,
    steps: s.steps,
    reached: s.reached,
    stalled_at: s.stalled_at,
    findings: s.findings,
    dry_run: s.dry_run,
    has_account: s.has_account,
    counts: { sessions: s.sessions.length, reached: s.reached, findings: s.findings.length },
    cli_version: s.cli_version,
    started_at: s.started_at,
    finished_at: s.finished_at,
    updated_at: ctx.now.toISOString(),
  }
}

/**
 * The metric rows a run writes once, on the snapshot that finishes it: the
 * steps always, time to first value only when a session reached the goal. A
 * dry run measures only up to the sign-up wall, so it writes none.
 */
export function freshEyesMetricRows(s: FreshEyesSnapshot, ctx: { projectId: string; localRunId: string; wasDone: boolean }): Array<{ project_id: string; metric_name: string; dimension: string; value: number; ts: string }> {
  if (s.status !== 'done' || ctx.wasDone || s.dry_run) return []
  const ts = s.finished_at ?? s.started_at
  const rows = [{ project_id: ctx.projectId, metric_name: 'fresh_eyes.steps', dimension: ctx.localRunId, value: s.steps, ts }]
  if (s.ttfv_seconds != null) rows.push({ project_id: ctx.projectId, metric_name: 'fresh_eyes.ttfv_seconds', dimension: ctx.localRunId, value: s.ttfv_seconds, ts })
  return rows
}

/** Bucket path of one screenshot, or null if the name is not one the CLI makes. */
export function freshEyesShotPath(projectId: string, runRowId: string, name: string): string | null {
  return FRESH_EYES_SHOT_RE.test(name) ? `${projectId}/${runRowId}/fresh-eyes/${name}` : null
}

/** The `reports` row a finding becomes (source 'fresh_eyes'). */
export function freshEyesReportRow(f: FreshEyesFindingBody, ctx: { reportId: string; projectId: string; actorId: string; localRunId: string; now: Date }): Record<string, unknown> {
  const at = ctx.now.toISOString()
  return {
    id: ctx.reportId,
    project_id: ctx.projectId,
    title: f.title,
    description: f.description,
    category: f.basis === 'measured' ? 'bug' : 'other',
    user_category: f.basis === 'measured' ? 'bug' : 'other',
    severity: f.severity,
    ...(f.component ? { component: f.component } : {}),
    environment: { platform: 'fresh_eyes' },
    custom_metadata: { source: 'fresh_eyes', fresh_eyes_fingerprint: f.fingerprint, fresh_eyes_rule: f.rule, basis: f.basis, run: ctx.localRunId },
    status: 'new',
    source: 'fresh_eyes',
    reporter_token_hash: 'fresh-eyes',
    reporter_user_id: ctx.actorId,
    synced_at: at,
    created_at: at,
  }
}

/**
 * Whether an earlier report with the same fingerprint stops a refile: an open
 * one holds it, a dismissed one is never filed again (as for the code audit,
 * `auditKeyBlocks`); a fixed one may be, when a later run sees it again.
 */
export function blocksRefile(status: string | null | undefined): boolean {
  return !!status && !['fixed', 'verified', 'resolved'].includes(status)
}

// ── Synthetic accounts ──────────────────────────────────────────────────────

/** A domain no mailbox answers on; override with MUSHI_FRESH_EYES_EMAIL_DOMAIN. */
export const DEFAULT_SYNTHETIC_EMAIL_DOMAIN = 'synthetic.kensaur.us'
const DOMAIN_RE = /^(?=.{3,200}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

export function syntheticEmailDomain(raw: string | null | undefined): string {
  const d = (raw ?? '').trim().toLowerCase()
  return DOMAIN_RE.test(d) ? d : DEFAULT_SYNTHETIC_EMAIL_DOMAIN
}

/** A new synthetic identity from random bytes (≥ 16 for the id, ≥ 18 for the password). */
export function syntheticIdentity(random: Uint8Array, domain: string, now: Date): { email: string; password: string; name: string; expiresAt: string } {
  if (random.length < 34) throw new Error('need at least 34 random bytes')
  const hex = [...random.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const password = [...random.slice(16, 34)].map((b) => alphabet[b % alphabet.length]).join('') + '-9a'
  return {
    email: `fresh-eyes-${hex}@${domain}`,
    password,
    name: `Fresh Eyes ${hex.slice(0, 4)}`,
    expiresAt: new Date(now.getTime() + SYNTHETIC_ACCOUNT_TTL_HOURS * 3_600_000).toISOString(),
  }
}

/** Accounts the sweep deletes now. */
export function expiredSyntheticAccounts<T extends { user_id: string; expires_at: string }>(rows: readonly T[], now: Date): T[] {
  return rows.filter((r) => Date.parse(r.expires_at) <= now.getTime())
}

/**
 * Of the organizations a synthetic user owns, the ones it may delete: no other
 * member, and no project owned by anyone else.
 */
export function orgsOwnedAlone(
  orgs: ReadonlyArray<{ id: string }>,
  members: ReadonlyArray<{ organization_id: string; user_id: string }>,
  projects: ReadonlyArray<{ organization_id: string | null; owner_id: string | null }>,
  userId: string,
): string[] {
  return orgs
    .map((o) => o.id)
    .filter((id) => members.every((m) => m.organization_id !== id || m.user_id === userId))
    .filter((id) => projects.every((p) => p.organization_id !== id || p.owner_id === userId))
}
