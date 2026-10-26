/**
 * FILE: packages/server/supabase/functions/_shared/pipeline-view.ts
 * PURPOSE: The bug-to-merge pipeline as one picture (console /pipeline):
 *          Reported → Triaged → Fix PR → Reviewed → CI → Release train →
 *          Merged → Deployed. Every open item sits in exactly one stage, in
 *          a group whose reason is said in plain words ("12 PRs: their own
 *          CI is red"), with the time it entered that stage.
 *
 *          Pure: the route reads the rows, this file decides. Time in stage
 *          never comes from `updated_at`, which the workers touch on every
 *          tick; it comes from the moment the item entered the stage
 *          (queued_at, agent_started_at, the review's completed_at, the
 *          PR's created_at, the report's created_at).
 *
 *          Order matters. A PR's own CI decides before its place in the
 *          merge queue: a red PR "waiting for the next train" only makes the
 *          next train red too (2026-10-26: 43 queued PRs of one app were red
 *          on their own head, and its trains failed 37 times in 5 days).
 *          A test machine stop is not a code failure (ADR 0033), and
 *          `skipped` is not green.
 */

import { ciHeadState, type CiJobForRepair } from './review-followup.ts'

export const PIPELINE_STAGES = [
  { id: 'reported', label: 'Reported' },
  { id: 'triaged', label: 'Triaged' },
  { id: 'pr', label: 'Fix PR' },
  { id: 'review', label: 'Reviewed' },
  { id: 'ci', label: 'CI' },
  { id: 'train', label: 'Release train' },
  { id: 'merged', label: 'Merged' },
  { id: 'deployed', label: 'Deployed' },
] as const
export type PipelineStageId = (typeof PIPELINE_STAGES)[number]['id']

/** What the console can do for a group's items (each maps to one route). */
export type PipelineAction =
  | 're_review'
  | 'rerun_ci'
  | 'ci_repair'
  | 'update_branch'
  | 'conflict_agent'
  | 'mark_ready'
  | 'queue_merge'
  | 'remove'
  | 'close'

export type GroupTone = 'stuck' | 'moving' | 'done'

export interface PipelineItem {
  /** Fix attempt id, report id (reported/triaged) or deploy id. */
  id: string
  projectId: string
  reportId: string | null
  title: string
  repo: string | null
  prNumber: number | null
  prUrl: string | null
  queueId: string | null
  /** When the item entered this stage. */
  since: string
  lastError: string | null
  lastEventAt: string | null
  /** What the latest fix event said ("Release train: this fix breaks CI"). */
  lastEventLabel: string | null
  failingChecks: string[]
  review: { verdict: string | null; summary: string | null; findings: string[] } | null
  queueDetail: string | null
}

export interface PipelineGroup {
  id: string
  stage: PipelineStageId
  tone: GroupTone
  /** With the count: "12 PRs: their own CI is red". */
  label: string
  count: number
  oldestAt: string | null
  actions: PipelineAction[]
  settings: { label: string; to: string } | null
  items: PipelineItem[]
}

export interface PipelineStage {
  id: PipelineStageId
  label: string
  count: number
  stuck: number
  oldestAt: string | null
  groups: PipelineGroup[]
}

// ── Input rows (columns the route selects) ──────────────────────────────────

export interface ReportRow {
  id: string
  project_id: string
  status: string
  title: string | null
  summary: string | null
  description: string | null
  created_at: string
  processing_error: string | null
}

export interface AttemptRow {
  id: string
  project_id: string
  report_id: string | null
  status: string
  agent: string | null
  pr_url: string | null
  pr_number: number | null
  pr_state: string | null
  commit_sha: string | null
  check_run_conclusion: string | null
  error: string | null
  summary: string | null
  created_at: string
  completed_at: string | null
  merged_at: string | null
}

export interface ReviewRow {
  fix_attempt_id: string
  status: string
  verdict: string | null
  summary: string | null
  findings: unknown
  error: string | null
  completed_at: string | null
  created_at: string
}

export interface QueueRow {
  id: string
  fix_attempt_id: string
  project_id: string
  repo: string
  pr_number: number
  state: string
  detail: string | null
  queued_at: string
  agent_started_at: string | null
  conflict_agents: number | null
}

export interface FollowupRow {
  fix_attempt_id: string
  status: string
  kind: string | null
}

export interface EventRow {
  fix_attempt_id: string
  at: string
  label: string | null
}

export interface DeployRow {
  project_id: string
  observed_version: string | null
  ok: boolean | null
  observed_at: string
}

export interface PipelineInput {
  now: Date
  reports: ReportRow[]
  attempts: AttemptRow[]
  reviews: ReviewRow[]
  queue: QueueRow[]
  followups: FollowupRow[]
  ciJobs: Map<string, CiJobForRepair[]>
  deploys: DeployRow[]
  /** Recent fix events; the latest per attempt is shown. */
  events?: EventRow[]
  /** Apps whose organization has review follow-ups on; their CI-red and fix-first groups drop the setting link. */
  followupsOn?: Set<string>
}

// ── Thresholds ──────────────────────────────────────────────────────────────

const HOUR = 3600_000
/** A report not triaged after this is stuck (triage normally takes minutes). */
export const TRIAGE_STUCK_MS = HOUR
/** A triaged report with no fix after this is stuck. */
export const FIX_START_STUCK_MS = 3 * 24 * HOUR
/** An agent still running after this is stuck. */
export const AGENT_STUCK_MS = 6 * HOUR
/** A review not finished after this is stuck. */
export const REVIEW_STUCK_MS = 2 * HOUR
/** CI still running after this is stuck. */
export const CI_STUCK_MS = 3 * HOUR
/** A conflict agent (ADR 0041) times out at 90 min; past that nothing moves the row. */
export const CONFLICT_STUCK_MS = 90 * 60_000
/** The merge queue's per-PR conflict-agent cap (`MAX_CONFLICT_AGENTS`). */
export const CONFLICT_AGENT_CAP = 2
/** Merged and no deploy seen after this, on an app that records deploys. */
export const DEPLOY_STUCK_MS = 24 * HOUR
/** Merged/deployed/failed-agent windows. */
export const RECENT_MS = 7 * 24 * HOUR
/** Items listed per group; counts are always whole. */
export const MAX_ITEMS_PER_GROUP = 100

export const FOLLOWUPS_SETTING = { label: 'Review follow-ups setting', to: '/settings?tab=byok#review-followups' }
/** Spend-down (ADR 0028) is the server's automatic dispatcher; its on/off switch per Cursor key. */
export const DISPATCH_SETTING = { label: 'Cursor keys and spend-down', to: '/credits#cursor-fix-bugs' }

// ── Helpers ─────────────────────────────────────────────────────────────────

const ACTIVE_QUEUE = new Set(['queued', 'waiting', 'resolving', 'blocked'])
const ACTIVE_FOLLOWUP = new Set(['queued', 'dispatched', 'running'])

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function age(now: Date, iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? now.getTime() - t : 0
}

function clip(s: string | null | undefined, n = 300): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || null
}

/** The findings' issues, short, for a review's evidence. */
export function findingLines(findings: unknown, max = 5): string[] {
  if (!Array.isArray(findings)) return []
  return findings
    .map((f) => {
      const o = (f ?? {}) as { issue?: unknown; severity?: unknown; file?: unknown }
      const issue = typeof o.issue === 'string' ? o.issue : ''
      if (!issue) return ''
      const sev = typeof o.severity === 'string' ? `${o.severity}: ` : ''
      return clip(`${sev}${issue}`, 220) ?? ''
    })
    .filter(Boolean)
    .slice(0, max)
}

/** `owner/repo` from a PR URL, lower-cased. */
export function repoOfPrUrl(url: string | null): string | null {
  const m = url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i)
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

/**
 * What a merge-queue row's `detail` says, as a stable group key. The worker
 * writes these sentences (merge-queue/worker.ts, train.ts); unknown text
 * falls into `other` and its own words are shown.
 */
export function queueDetailKind(detail: string | null): 'followups_off' | 'ci_failed' | 'fix_first' | 'hold' | 'train_failed' | 'train_conflict' | 'next_train' | 'other' {
  const d = (detail ?? '').toLowerCase()
  if (d.includes('follow-ups are off')) return 'followups_off'
  if (d.startsWith('ci failed')) return 'ci_failed'
  if (d.includes('fix first')) return 'fix_first'
  if (d.includes('hold')) return 'hold'
  if (d.includes('release train failed')) return 'train_failed'
  if (d.includes('conflicts with the other fixes')) return 'train_conflict'
  if (d === '' || d.includes('next release train') || d.includes('waits for the next')) return 'next_train'
  return 'other'
}

/** The latest review per fix attempt (PostgREST has no DISTINCT ON). */
export function latestReviews(rows: ReviewRow[]): Map<string, ReviewRow> {
  const out = new Map<string, ReviewRow>()
  for (const r of rows) {
    const prev = out.get(r.fix_attempt_id)
    if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) out.set(r.fix_attempt_id, r)
  }
  return out
}

/** Failing check names in a "CI failed: a, b, c." train or queue detail. */
export function failedChecksFromDetail(detail: string | null): string[] {
  const m = (detail ?? '').match(/^CI failed:\s*(.+?)\.?\s*$/i)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

// ── Group builder ───────────────────────────────────────────────────────────

interface GroupSpec {
  stage: PipelineStageId
  tone: GroupTone
  noun: [string, string]
  text: string
  actions: PipelineAction[]
  settings?: { label: string; to: string } | null
}

class Groups {
  private map = new Map<string, { spec: GroupSpec; items: PipelineItem[] }>()
  add(id: string, spec: GroupSpec, item: PipelineItem): void {
    const g = this.map.get(id) ?? { spec, items: [] }
    g.items.push(item)
    this.map.set(id, g)
  }
  build(): PipelineGroup[] {
    return [...this.map.entries()].map(([id, { spec, items }]) => {
      items.sort((a, b) => a.since.localeCompare(b.since))
      return {
        id,
        stage: spec.stage,
        tone: spec.tone,
        label: `${plural(items.length, spec.noun[0], spec.noun[1])}: ${spec.text}`,
        count: items.length,
        oldestAt: items[0]?.since ?? null,
        actions: spec.actions,
        settings: spec.settings ?? null,
        items: items.slice(0, MAX_ITEMS_PER_GROUP),
      }
    })
  }
}

const PR: [string, string] = ['PR', 'PRs']
const REPORT: [string, string] = ['report', 'reports']

function reportTitle(r: ReportRow): string {
  return clip(r.title ?? r.summary ?? r.description, 140) ?? 'Untitled report'
}

// ── The classifier ──────────────────────────────────────────────────────────

export function buildPipeline(input: PipelineInput): PipelineStage[] {
  const { now } = input
  const groups = new Groups()
  const reviews = latestReviews(input.reviews)
  const queueByAttempt = new Map(input.queue.filter((q) => ACTIVE_QUEUE.has(q.state)).map((q) => [q.fix_attempt_id, q]))
  const followupActive = new Set(input.followups.filter((f) => ACTIVE_FOLLOWUP.has(f.status)).map((f) => f.fix_attempt_id))
  const reportsById = new Map(input.reports.map((r) => [r.id, r]))
  const lastEvent = new Map<string, EventRow>()
  for (const e of input.events ?? []) {
    const prev = lastEvent.get(e.fix_attempt_id)
    if (!prev || e.at > prev.at) lastEvent.set(e.fix_attempt_id, e)
  }
  // Reports with a fix in flight: not "waiting for a fix", and an older failed attempt is not stuck.
  const liveReports = new Set(
    input.attempts
      .filter((a) => a.report_id && !a.merged_at && (a.status === 'running' || a.status === 'pending' || a.pr_state === 'open' || a.pr_state === 'draft'))
      .map((a) => a.report_id as string),
  )

  const itemOf = (a: AttemptRow, since: string, extra: Partial<PipelineItem> = {}): PipelineItem => {
    const q = queueByAttempt.get(a.id) ?? null
    const rv = reviews.get(a.id) ?? null
    const report = a.report_id ? reportsById.get(a.report_id) : undefined
    const ev = lastEvent.get(a.id)
    return {
      id: a.id,
      projectId: a.project_id,
      reportId: a.report_id,
      title: report ? reportTitle(report) : clip(a.summary, 140) ?? (a.pr_number ? `Fix PR #${a.pr_number}` : 'Fix'),
      repo: q?.repo ?? repoOfPrUrl(a.pr_url),
      prNumber: a.pr_number,
      prUrl: a.pr_url,
      queueId: q?.id ?? null,
      since,
      lastError: null,
      lastEventAt: ev?.at ?? null,
      lastEventLabel: clip(ev?.label, 140),
      failingChecks: [],
      review: rv ? { verdict: rv.verdict, summary: clip(rv.summary, 400), findings: findingLines(rv.findings) } : null,
      queueDetail: q?.detail ?? null,
      ...extra,
    }
  }

  for (const a of input.attempts) {
    // Merged (last 7 days): Merged, or Deployed when a deploy was seen after it.
    if (a.merged_at || a.pr_state === 'merged') {
      const at = a.merged_at ?? a.completed_at ?? a.created_at
      if (age(now, at) > RECENT_MS) continue
      const deploys = input.deploys.filter((d) => d.project_id === a.project_id && d.ok !== false)
      const after = deploys.filter((d) => Date.parse(d.observed_at) >= Date.parse(at)).sort((x, y) => x.observed_at.localeCompare(y.observed_at))[0]
      if (after) {
        groups.add('deployed', { stage: 'deployed', tone: 'done', noun: ['fix', 'fixes'], text: 'deployed', actions: [] }, itemOf(a, after.observed_at, { lastEventAt: after.observed_at, queueDetail: after.observed_version ? `Seen live in ${after.observed_version}.` : null }))
      } else if (deploys.length > 0 && age(now, at) > DEPLOY_STUCK_MS) {
        groups.add('not_deployed', { stage: 'merged', tone: 'stuck', noun: ['fix', 'fixes'], text: 'merged over a day ago, no deploy seen since', actions: [] }, itemOf(a, at))
      } else {
        groups.add('merged', { stage: 'merged', tone: 'done', noun: ['fix', 'fixes'], text: deploys.length ? 'merged, waiting for the next deploy' : 'merged (this app records no deploys)', actions: [] }, itemOf(a, at))
      }
      continue
    }

    // The agent never opened a PR.
    if (!a.pr_url) {
      if (a.status === 'running' || a.status === 'pending') {
        const stuck = age(now, a.created_at) > AGENT_STUCK_MS
        groups.add(stuck ? 'agent_slow' : 'agent_running', { stage: 'pr', tone: stuck ? 'stuck' : 'moving', noun: ['fix', 'fixes'], text: stuck ? 'agent still running after 6 hours' : 'agent writing the fix', actions: [] }, itemOf(a, a.created_at))
      } else if (a.status === 'failed' && age(now, a.created_at) <= RECENT_MS && !(a.report_id && liveReports.has(a.report_id))) {
        groups.add('agent_failed', { stage: 'pr', tone: 'stuck', noun: ['fix', 'fixes'], text: 'agent failed, no PR opened', actions: [] }, itemOf(a, a.completed_at ?? a.created_at, { lastError: clip(a.error) }))
      }
      continue
    }
    if (a.pr_state !== 'open' && a.pr_state !== 'draft') continue

    const q = queueByAttempt.get(a.id) ?? null
    const rv = reviews.get(a.id) ?? null
    const jobs = a.commit_sha ? input.ciJobs.get(a.commit_sha) ?? [] : []
    const ci = ciHeadState(jobs)
    const failing = ci.state === 'code_failure' ? ci.failing.map((f) => f.name) : []
    const reviewedAt = rv?.completed_at ?? rv?.created_at ?? a.created_at

    // 2. A conflict agent's row: resolving until the agent pushes.
    if (q?.state === 'resolving') {
      const since = q.agent_started_at ?? q.queued_at
      const capped = (q.conflict_agents ?? 0) >= CONFLICT_AGENT_CAP
      const off = queueDetailKind(q.detail) === 'followups_off'
      const stuck = off || age(now, since) > CONFLICT_STUCK_MS
      const text = off
        ? 'merge conflict, but follow-ups are off so no agent may push'
        : capped && stuck
          ? 'merge conflict, both conflict agents used'
          : stuck
            ? `waiting on a conflict agent for over ${Math.round(CONFLICT_STUCK_MS / 60_000)} min`
            : 'a conflict agent is merging the base in'
      groups.add(off ? 'conflict_off' : capped && stuck ? 'conflict_capped' : stuck ? 'conflict_stuck' : 'conflict_running', {
        stage: 'train',
        tone: stuck ? 'stuck' : 'moving',
        noun: PR,
        text,
        actions: stuck ? ['update_branch', ...(capped || off ? [] : (['conflict_agent'] as PipelineAction[])), 'remove'] : [],
        settings: off ? FOLLOWUPS_SETTING : null,
      }, itemOf(a, since, { lastError: clip(q.detail) }))
      continue
    }

    // 3. The review.
    if (!rv || (rv.status !== 'completed' && rv.status !== 'skipped')) {
      const failed = rv?.status === 'failed'
      const stuck = failed || age(now, rv?.created_at ?? a.created_at) > REVIEW_STUCK_MS
      groups.add(failed ? 'review_failed' : stuck ? 'review_slow' : 'review_running', {
        stage: 'review',
        tone: stuck ? 'stuck' : 'moving',
        noun: PR,
        text: failed ? 'the review failed' : rv ? (stuck ? 'review not finished after 2 hours' : 'Opus is reviewing') : stuck ? 'never reviewed' : 'waiting for a review',
        actions: stuck ? ['re_review'] : [],
      }, itemOf(a, rv?.created_at ?? a.created_at, { lastError: clip(rv?.error) }))
      continue
    }
    if (rv.verdict === 'hold') {
      groups.add('hold', { stage: 'review', tone: 'stuck', noun: PR, text: 'Opus says hold; a person decides', actions: ['re_review', 'close'] }, itemOf(a, reviewedAt))
      continue
    }
    if (rv.verdict === 'fix_first') {
      if (followupActive.has(a.id)) {
        groups.add('fix_first_working', { stage: 'review', tone: 'moving', noun: PR, text: 'a follow-up agent works on the review findings', actions: [] }, itemOf(a, reviewedAt))
      } else {
        groups.add('fix_first', { stage: 'review', tone: 'stuck', noun: PR, text: 'Opus says fix first; no follow-up agent is on it', actions: ['re_review', 'close'], settings: FOLLOWUPS_SETTING }, itemOf(a, reviewedAt))
      }
      continue
    }

    // A draft after its review: host repos run no CI on drafts (their gate fails
    // on purpose), so a red check here is not a test result. The review marks a
    // PR ready after merge / fix first; one still a draft is stuck until marked ready.
    if (a.pr_state === 'draft') {
      const stuck = age(now, reviewedAt) > HOUR
      groups.add('draft_no_ci', { stage: 'pr', tone: stuck ? 'stuck' : 'moving', noun: ['draft', 'drafts'], text: 'CI never ran', actions: ['mark_ready', 'close'] }, itemOf(a, reviewedAt))
      continue
    }

    // 4. The PR's own CI, before its place in the queue (unless it rides a train now).
    if (q?.state !== 'waiting') {
      if (ci.state === 'code_failure') {
        const queued = q && q.state !== 'blocked'
        groups.add(queued ? 'ci_red_queued' : 'ci_red', {
          stage: 'ci',
          tone: 'stuck',
          noun: PR,
          text: queued ? 'their own CI is red, yet they wait for a release train' : 'their own CI is red',
          actions: ['ci_repair', 'rerun_ci', 'update_branch', ...(q ? (['remove'] as PipelineAction[]) : []), 'close'],
          settings: FOLLOWUPS_SETTING,
        }, itemOf(a, reviewedAt, { failingChecks: failing, lastError: clip(q?.detail) }))
        continue
      }
      if (ci.state === 'infra') {
        groups.add('ci_infra', { stage: 'ci', tone: 'stuck', noun: PR, text: 'the test machine stopped; the code was not tested', actions: ['rerun_ci'] }, itemOf(a, reviewedAt))
        continue
      }
      if (ci.state === 'none' && (a.check_run_conclusion ?? '').toLowerCase() === 'failure') {
        // ci_jobs not collected for this head; the PR's check summary says red.
        groups.add(q && q.state !== 'blocked' ? 'ci_red_queued' : 'ci_red', {
          stage: 'ci',
          tone: 'stuck',
          noun: PR,
          text: q && q.state !== 'blocked' ? 'their own CI is red, yet they wait for a release train' : 'their own CI is red',
          actions: ['ci_repair', 'rerun_ci', 'update_branch', ...(q ? (['remove'] as PipelineAction[]) : []), 'close'],
          settings: FOLLOWUPS_SETTING,
        }, itemOf(a, reviewedAt, { failingChecks: failedChecksFromDetail(q?.detail ?? null), lastError: clip(q?.detail) }))
        continue
      }
      if (ci.state === 'pending') {
        const stuck = age(now, reviewedAt) > CI_STUCK_MS
        groups.add(stuck ? 'ci_slow' : 'ci_running', { stage: 'ci', tone: stuck ? 'stuck' : 'moving', noun: PR, text: stuck ? 'CI still running after 3 hours' : 'CI running', actions: stuck ? ['rerun_ci'] : [] }, itemOf(a, reviewedAt))
        continue
      }
      if (ci.state === 'none' && ['skipped', 'cancelled', ''].includes((a.check_run_conclusion ?? '').toLowerCase())) {
        groups.add('ci_never_ran', { stage: 'ci', tone: 'stuck', noun: PR, text: 'CI never ran on their latest commit', actions: ['update_branch', 'rerun_ci'] }, itemOf(a, reviewedAt))
        continue
      }
    }

    // 5. Approved and green (or riding a train): the merge queue.
    if (!q) {
      groups.add('not_queued', { stage: 'train', tone: 'stuck', noun: PR, text: 'approved and green, not queued to merge', actions: ['queue_merge', 'close'] }, itemOf(a, reviewedAt))
      continue
    }
    const kind = queueDetailKind(q.detail)
    const since = q.queued_at
    if (q.state === 'waiting') {
      groups.add('in_train', { stage: 'train', tone: 'moving', noun: PR, text: 'riding a release train', actions: [] }, itemOf(a, since))
      continue
    }
    if (q.state === 'blocked') {
      const spec: Record<string, Omit<GroupSpec, 'stage' | 'noun'>> = {
        followups_off: { tone: 'stuck', text: 'held: merge conflict, and follow-ups are off', actions: ['update_branch', 'remove'], settings: FOLLOWUPS_SETTING },
        ci_failed: { tone: 'stuck', text: 'held: CI failed', actions: ['ci_repair', 'rerun_ci', 'remove'] },
        fix_first: { tone: 'stuck', text: 'held: Opus says fix first', actions: ['re_review', 'remove'], settings: FOLLOWUPS_SETTING },
        hold: { tone: 'stuck', text: 'held: Opus says hold', actions: ['re_review', 'remove', 'close'] },
      }
      const s = spec[kind] ?? { tone: 'stuck' as const, text: 'held by the merge queue', actions: ['update_branch', 'remove'] as PipelineAction[] }
      groups.add(`held_${kind in spec ? kind : 'other'}`, { stage: 'train', noun: PR, ...s }, itemOf(a, since, { lastError: clip(q.detail), failingChecks: failedChecksFromDetail(q.detail) }))
      continue
    }
    if (kind === 'train_failed') {
      groups.add('after_red_train', { stage: 'train', tone: 'stuck', noun: PR, text: 'their release train failed CI; waiting for a later one', actions: ['update_branch', 'remove'] }, itemOf(a, since, { lastError: clip(q.detail) }))
    } else if (kind === 'train_conflict') {
      groups.add('train_conflict', { stage: 'train', tone: 'moving', noun: PR, text: 'conflict with other fixes in the train; next train', actions: ['update_branch'] }, itemOf(a, since, { lastError: clip(q.detail) }))
    } else {
      groups.add('next_train', { stage: 'train', tone: 'moving', noun: PR, text: 'approved, waiting for the next release train', actions: [] }, itemOf(a, since))
    }
  }

  // Reports that have not reached a fix.
  for (const r of input.reports) {
    const item: PipelineItem = {
      id: r.id,
      projectId: r.project_id,
      reportId: r.id,
      title: reportTitle(r),
      repo: null,
      prNumber: null,
      prUrl: null,
      queueId: null,
      since: r.created_at,
      lastError: clip(r.processing_error),
      lastEventAt: null,
      lastEventLabel: null,
      failingChecks: [],
      review: null,
      queueDetail: null,
    }
    if (r.status === 'new' || r.status === 'queued' || r.status === 'pending') {
      const failed = !!r.processing_error
      const stuck = failed || age(now, r.created_at) > TRIAGE_STUCK_MS
      groups.add(failed ? 'triage_failed' : stuck ? 'triage_slow' : 'triage_running', {
        stage: 'reported',
        tone: stuck ? 'stuck' : 'moving',
        noun: REPORT,
        text: failed ? 'triage failed' : stuck ? 'not triaged after an hour' : 'being triaged',
        actions: [],
      }, item)
    } else if (r.status === 'classified' && !liveReports.has(r.id)) {
      const stuck = age(now, r.created_at) > FIX_START_STUCK_MS
      groups.add(stuck ? 'no_fix_old' : 'no_fix', {
        stage: 'triaged',
        tone: stuck ? 'stuck' : 'moving',
        noun: REPORT,
        text: stuck ? 'triaged over 3 days ago, no fix started' : 'triaged, waiting for a fix',
        actions: [],
      }, item)
    }
  }

  const all = groups.build()
  // The follow-ups link helps only where they are off (held / conflict groups say "off" outright and keep it).
  if (input.followupsOn) {
    for (const g of all) {
      if (g.settings === FOLLOWUPS_SETTING && ['ci_red', 'ci_red_queued', 'fix_first', 'held_fix_first'].includes(g.id) && g.items.every((i) => input.followupsOn!.has(i.projectId))) {
        g.settings = null
      }
    }
  }
  return PIPELINE_STAGES.map((s) => {
    const mine = all
      .filter((g) => g.stage === s.id)
      .sort((a, b) => Number(b.tone === 'stuck') - Number(a.tone === 'stuck') || b.count - a.count)
    const stuckGroups = mine.filter((g) => g.tone === 'stuck')
    const oldest = mine.filter((g) => g.tone !== 'done').map((g) => g.oldestAt).filter((x): x is string => !!x).sort()[0] ?? null
    return {
      id: s.id,
      label: s.label,
      count: mine.reduce((n, g) => n + g.count, 0),
      stuck: stuckGroups.reduce((n, g) => n + g.count, 0),
      oldestAt: oldest,
      groups: mine,
    }
  })
}

// ── Who opens fixes ─────────────────────────────────────────────────────────

/**
 * Agents that only the server dispatches. Everything else that opens a PR is
 * a person's own lane (`mcp`: `mushi work`, the CLI and the editor).
 */
export const LOCAL_AGENTS: ReadonlySet<string> = new Set(['mcp', 'local'])

export interface AgentKeyRow {
  project_id: string | null
  organization_id: string | null
  owner_user_id: string | null
  status: string | null
  spend_down_enabled: boolean | null
  exhausted_until: string | null
}

export interface DispatcherInput {
  now: Date
  projects: Array<{ id: string; name: string; organization_id: string | null; owner_id: string | null }>
  /** organization id → its owners' user ids (a universal key serves its owner's organizations, ADR 0031). */
  orgOwners: Map<string, Set<string>>
  autofixOn: Set<string>
  cursorKeys: AgentKeyRow[]
  /** fix_dispatch_jobs of the last 48 h. */
  jobs: Array<{ project_id: string; created_at: string }>
  /** fix attempts of the last 7 days: who opened them and when. */
  attempts: Array<{ project_id: string; agent: string | null; status: string; created_at: string }>
}

export interface DispatcherStatus {
  projectId: string
  name: string
  autofixOn: boolean
  /** Who opened fixes in the last 7 days. */
  opener: 'server' | 'local' | 'both' | 'nobody'
  server: { agentKeys: number; offKeys: number; dispatches24h: number; dispatches48h: number; lastAt: string | null }
  local: { runs24h: number; running: number; lastAt: string | null }
  /** Plain words when auto-fix is on but the server cannot or does not dispatch. */
  problem: string | null
}

function keyServes(k: AgentKeyRow, p: DispatcherInput['projects'][number], orgOwners: DispatcherInput['orgOwners']): boolean {
  if (k.project_id) return k.project_id === p.id
  if (k.organization_id) return k.organization_id === p.organization_id
  if (k.owner_user_id) return k.owner_user_id === p.owner_id || (!!p.organization_id && !!orgOwners.get(p.organization_id)?.has(k.owner_user_id))
  return false
}

/** Per app: can the server dispatch fixes, does it, and do local lanes. */
export function buildDispatchers(input: DispatcherInput): DispatcherStatus[] {
  const now = input.now.getTime()
  const within = (iso: string, ms: number) => now - Date.parse(iso) <= ms
  return input.projects.map((p) => {
    const keys = input.cursorKeys.filter((k) => keyServes(k, p, input.orgOwners))
    const usable = keys.filter((k) => k.status === 'active' && !(k.exhausted_until && Date.parse(k.exhausted_until) > now))
    const agentKeys = usable.filter((k) => k.spend_down_enabled).length
    const mine = input.attempts.filter((a) => a.project_id === p.id)
    const serverAttempts = mine.filter((a) => !LOCAL_AGENTS.has(a.agent ?? ''))
    const localAttempts = mine.filter((a) => LOCAL_AGENTS.has(a.agent ?? ''))
    const jobs = input.jobs.filter((j) => j.project_id === p.id)
    const serverTimes = [...jobs.map((j) => j.created_at), ...serverAttempts.map((a) => a.created_at)].sort()
    const dispatches24h = jobs.filter((j) => within(j.created_at, 24 * HOUR)).length
    const dispatches48h = jobs.filter((j) => within(j.created_at, 48 * HOUR)).length
    const server = { agentKeys, offKeys: keys.length - agentKeys, dispatches24h, dispatches48h, lastAt: serverTimes[serverTimes.length - 1] ?? null }
    const localTimes = localAttempts.map((a) => a.created_at).sort()
    const local = {
      runs24h: localAttempts.filter((a) => within(a.created_at, 24 * HOUR)).length,
      running: localAttempts.filter((a) => a.status === 'running' || a.status === 'pending').length,
      lastAt: localTimes[localTimes.length - 1] ?? null,
    }
    const byServer = serverAttempts.length > 0 || jobs.length > 0
    const byLocal = localAttempts.length > 0
    const autofixOn = input.autofixOn.has(p.id)
    let problem: string | null = null
    if (autofixOn && agentKeys === 0) {
      problem = `Auto-fix is on but has no agent key${keys.length ? ` (${keys.length} Cursor key${keys.length === 1 ? '' : 's'} off or spend-down off)` : ''}; ${dispatches48h} dispatches in 48h`
    } else if (autofixOn && dispatches48h === 0) {
      problem = 'Auto-fix has an agent key but dispatched nothing in 48h'
    }
    return {
      projectId: p.id,
      name: p.name,
      autofixOn,
      opener: byServer && byLocal ? 'both' : byServer ? 'server' : byLocal ? 'local' : 'nobody',
      server,
      local,
      problem,
    }
  })
}

/** The "Fix PR" stage's stuck group for apps whose auto-fix cannot or does not dispatch. */
export function dispatcherGroup(dispatchers: DispatcherStatus[], now: Date): PipelineGroup | null {
  const bad = dispatchers.filter((d) => d.problem)
  if (bad.length === 0) return null
  const noKey = bad.every((d) => d.server.agentKeys === 0)
  const items: PipelineItem[] = bad.map((d) => ({
    id: d.projectId,
    projectId: d.projectId,
    reportId: null,
    title: d.name,
    repo: null,
    prNumber: null,
    prUrl: null,
    queueId: null,
    since: d.server.lastAt ?? new Date(now.getTime() - 48 * HOUR).toISOString(),
    lastError: d.problem,
    lastEventAt: d.server.lastAt,
    lastEventLabel: d.server.lastAt ? 'last server dispatch' : null,
    failingChecks: [],
    review: null,
    queueDetail: d.local.lastAt ? `Local mushi work lanes opened ${d.local.runs24h} in 24h (${d.local.running} running).` : 'No local lane either: nobody opens fixes.',
  }))
  items.sort((a, b) => a.since.localeCompare(b.since))
  return {
    id: 'autofix_no_agent',
    stage: 'pr',
    tone: 'stuck',
    label: `${plural(bad.length, 'app')}: ${noKey ? 'auto-fix is on but has no agent key' : 'auto-fix dispatches nothing'}; ${bad.reduce((n, d) => n + d.server.dispatches48h, 0)} dispatches in 48h`,
    count: bad.length,
    oldestAt: items[0]?.since ?? null,
    actions: [],
    settings: DISPATCH_SETTING,
    items,
  }
}

/** Put an extra group (dispatcher, intake rejects) first in its stage and count it as stuck. */
export function withDispatcherGroup(stages: PipelineStage[], group: PipelineGroup | null): PipelineStage[] {
  if (!group) return stages
  return stages.map((s) => {
    if (s.id !== group.stage) return s
    const groups = [group, ...s.groups]
    const oldest = [s.oldestAt, group.oldestAt].filter((x): x is string => !!x).sort()[0] ?? null
    return { ...s, groups, count: s.count + group.count, stuck: s.stuck + group.count, oldestAt: oldest }
  })
}

// ── Intake rejects ──────────────────────────────────────────────────────────

/** A `report_ingest_rejections` row: one app, UTC day, stage, reason and SDK package. */
export interface RejectionRow {
  project_id: string
  day: string
  stage: string
  reason: string
  sdk_package: string
  count: number
  last_at: string
}

export interface IntakeApp {
  projectId: string
  rejected: number
  byReason: Array<{ reason: string; count: number }>
  /** The SDK packages the rejected payloads named ('' left out). */
  sdkPackages: string[]
  lastAt: string | null
}

export interface IntakeSummary {
  /** The first day the window covers: 7 days ago, or the first day anything was counted. */
  since: string
  apps: IntakeApp[]
}

/**
 * The last 7 days of rejected ingests per app. null when nothing was ever
 * counted (the counter is new): "not recorded yet", never 0.
 */
export function summarizeIntake(rows: RejectionRow[], projectIds: string[], firstDay: string | null, now: Date): IntakeSummary | null {
  if (!firstDay) return null
  const weekAgo = new Date(now.getTime() - 6 * 24 * HOUR).toISOString().slice(0, 10)
  const since = firstDay > weekAgo ? firstDay : weekAgo
  const apps = projectIds.map((projectId) => {
    const mine = rows.filter((r) => r.project_id === projectId && r.day >= since)
    const byReason = new Map<string, number>()
    for (const r of mine) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.count)
    return {
      projectId,
      rejected: mine.reduce((n, r) => n + r.count, 0),
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
      sdkPackages: [...new Set(mine.map((r) => r.sdk_package).filter(Boolean))].sort(),
      lastAt: mine.map((r) => r.last_at).sort().pop() ?? null,
    }
  })
  return { since, apps }
}

export const SDK_HEALTH_LINK = { label: 'SDK health', to: '/connect#connect-sdk-health' }

/** The Reported stage's red group: reports the API refused, per app, with the top reasons. */
export function intakeGroup(summary: IntakeSummary | null, names: Map<string, string>): PipelineGroup | null {
  const hit = (summary?.apps ?? []).filter((a) => a.rejected > 0)
  if (hit.length === 0) return null
  const total = hit.reduce((n, a) => n + a.rejected, 0)
  const items: PipelineItem[] = hit
    .sort((a, b) => b.rejected - a.rejected)
    .map((a) => ({
      id: `intake:${a.projectId}`,
      projectId: a.projectId,
      reportId: null,
      title: `${names.get(a.projectId) ?? 'App'}: ${plural(a.rejected, 'report')} rejected`,
      repo: null,
      prNumber: null,
      prUrl: null,
      queueId: null,
      since: a.lastAt ?? summary!.since,
      lastError: a.byReason.slice(0, 4).map((r) => `${r.reason} ×${r.count}`).join(', '),
      lastEventAt: a.lastAt,
      lastEventLabel: a.lastAt ? 'last rejected' : null,
      failingChecks: [],
      review: null,
      queueDetail: a.sdkPackages.length ? `Sent by ${a.sdkPackages.join(', ')}.` : null,
    }))
  return {
    id: 'intake_rejected',
    stage: 'reported',
    tone: 'stuck',
    label: `${plural(total, 'report')}: rejected at intake (400) in 7 days`,
    count: total,
    // Counts, not waiting items: no age to report for the stage.
    oldestAt: null,
    actions: [],
    settings: SDK_HEALTH_LINK,
    items,
  }
}

// ── Release trains ──────────────────────────────────────────────────────────

export interface TrainRow {
  id: string
  project_id: string
  repo: string
  pr_number: number | null
  state: string
  members: unknown
  attempt: number | null
  detail: string | null
  created_at: string
  merged_at: string | null
}

export interface TrainSummary {
  repo: string
  projectId: string
  merged: number
  failed: number
  active: number
  /** The checks that failed most often across this repo's red trains. */
  topFailures: Array<{ check: string; count: number }>
  trains: Array<{ id: string; state: string; prNumber: number | null; members: number; attempt: number; detail: string | null; createdAt: string }>
}

/** Trains per repo, newest first, with the checks that keep failing them. */
export function summarizeTrains(rows: TrainRow[], perRepo = 60): TrainSummary[] {
  const byRepo = new Map<string, TrainRow[]>()
  for (const t of rows) byRepo.set(t.repo, [...(byRepo.get(t.repo) ?? []), t])
  return [...byRepo.entries()]
    .map(([repo, list]) => {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at))
      const tally = new Map<string, number>()
      for (const t of list) if (t.state === 'failed') for (const c of failedChecksFromDetail(t.detail)) tally.set(c, (tally.get(c) ?? 0) + 1)
      return {
        repo,
        projectId: list[0].project_id,
        merged: list.filter((t) => t.state === 'merged').length,
        failed: list.filter((t) => t.state === 'failed').length,
        active: list.filter((t) => t.state === 'building' || t.state === 'testing').length,
        topFailures: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([check, count]) => ({ check, count })),
        trains: list.slice(0, perRepo).map((t) => ({
          id: t.id,
          state: t.state,
          prNumber: t.pr_number,
          members: Array.isArray(t.members) ? t.members.length : 0,
          attempt: t.attempt ?? 1,
          detail: clip(t.detail, 400),
          createdAt: t.created_at,
        })),
      }
    })
    .sort((a, b) => b.failed - a.failed || a.repo.localeCompare(b.repo))
}
