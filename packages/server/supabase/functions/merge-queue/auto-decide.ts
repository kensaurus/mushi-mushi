/**
 * FILE: packages/server/supabase/functions/merge-queue/auto-decide.ts
 * PURPOSE: "Decide for me" (ADR 0055) on each merge-queue tick: for apps that
 *          turned it on, read a batch of open agent fix PRs from GitHub, decide
 *          with `_shared/auto-decide.ts`, and act: queue an approved PR (the
 *          release train merges it), ask Opus about a new head, or close a PR
 *          with a comment and hand its report back to the fix lanes.
 *
 * `dryRun` decides without acting and returns every decision, so a person can
 * check the policy against GitHub before turning it on.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import type { GithubRepoRef, PullRequestDetails } from '../_shared/github.ts'
import type { ChecksView } from '../_shared/merge-queue.ts'
import type { requeueReviewForNewHead } from '../_shared/fix-review-db.ts'
import {
  closeComment,
  decideFix,
  MAX_PR_ATTEMPTS_PER_REPORT,
  ownCi,
  pickKeeper,
  prRepoRef,
  PRS_PER_TICK,
  RECHECK_MS,
  type Decision,
  type ReviewStatus,
  type Verdict,
} from '../_shared/auto-decide.ts'

const log = rootLog.child('auto-decide')

const CLOSED_REPORT = new Set(['fixed', 'dismissed', 'resolved', 'verified'])
const ACTIVE_QUEUE = ['queued', 'waiting', 'resolving', 'blocked', 'merged', 'removed']
const ACTIVE_REPAIR = ['queued', 'dispatched', 'running']

export interface AutoDecideDeps {
  now?: () => Date
  token: (db: SupabaseClient, attempt: AttemptRow) => Promise<string | null>
  pull: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  checks: (token: string, ref: GithubRepoRef, sha: string) => Promise<ChecksView>
  closePr: (token: string, ref: GithubRepoRef, n: number, comment: string) => Promise<void>
  requeueReview: typeof requeueReviewForNewHead
}

export interface AttemptRow {
  id: string
  project_id: string
  report_id: string | null
  agent: string | null
  branch: string | null
  commit_sha: string | null
  pr_url: string | null
  pr_number: number | null
  repo_id: string | null
  summary: string | null
  created_at: string
}

export interface DecisionLine {
  fixAttemptId: string
  projectId: string
  pr: string
  decision: Decision['do']
  reason: string
}

const ATTEMPT_COLUMNS = 'id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, repo_id, summary, created_at'

async function fixEvent(db: SupabaseClient, a: AttemptRow, kind: 'merge_queue' | 'pr_state_changed', label: string, detail: string, decision: string) {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: a.id,
    project_id: a.project_id,
    kind,
    status: 'ok',
    label,
    detail: detail.slice(0, 500),
    at: new Date().toISOString(),
    dedupe_key: `auto-decide:${a.id}:${decision}`,
    payload: { autoDecide: decision, pr: a.pr_url },
  })
  if (error && (error as { code?: string }).code !== '23505') log.warn('auto-decide event not written', { fixAttemptId: a.id, err: error.message })
}

/** The report goes back to the fix lanes, or waits for a person, once it has no live PR. */
async function handBack(db: SupabaseClient, a: AttemptRow, park: boolean) {
  if (!a.report_id) return
  const { count } = await db
    .from('fix_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', a.report_id)
    .neq('id', a.id)
    .is('merged_at', null)
    .or('status.in.(queued,running),pr_state.in.(open,draft)')
  if ((count ?? 0) > 0) return
  // Compare-and-set on the status: only a report still "fixing" moves.
  await db
    .from('reports')
    .update({ status: park ? 'triaged' : 'classified', updated_at: new Date().toISOString() })
    .eq('id', a.report_id)
    .eq('project_id', a.project_id)
    .eq('status', 'fixing')
}

export async function runAutoDecide(
  db: SupabaseClient,
  deps: AutoDecideDeps,
  opts: { projectId?: string; dryRun?: boolean; limit?: number } = {},
): Promise<{ tally: Record<string, number>; decisions: DecisionLine[] }> {
  const now = (deps.now ?? (() => new Date()))()
  const tally: Record<string, number> = {}
  const decisions: DecisionLine[] = []

  let sq = db.from('project_settings').select('project_id').eq('auto_decide_enabled', true)
  if (opts.projectId) sq = sq.eq('project_id', opts.projectId)
  const { data: on, error: onErr } = await sq
  if (onErr) throw new Error(`auto-decide settings read failed: ${onErr.message}`)
  // A dry run may look at an app that has not turned it on yet.
  const projectIds = opts.dryRun && opts.projectId ? [opts.projectId] : ((on ?? []) as Array<{ project_id: string }>).map((r) => r.project_id)
  if (projectIds.length === 0) return { tally, decisions }

  const stale = new Date(now.getTime() - RECHECK_MS).toISOString()
  const { data: rows, error } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .in('project_id', projectIds)
    .not('pr_url', 'is', null)
    .is('merged_at', null)
    .or('pr_state.is.null,pr_state.in.(open,draft)')
    .or(`auto_decide_checked_at.is.null,auto_decide_checked_at.lt.${stale}`)
    .order('auto_decide_checked_at', { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? PRS_PER_TICK)
  if (error) throw new Error(`auto-decide attempts read failed: ${error.message}`)
  const attempts = (rows ?? []) as AttemptRow[]
  if (attempts.length === 0) return { tally, decisions }
  const ids = attempts.map((a) => a.id)
  const reportIds = [...new Set(attempts.map((a) => a.report_id).filter((x): x is string => !!x))]

  const [queueRes, reviewRes, repairRes, reportRes, siblingRes] = await Promise.all([
    db.from('fix_merge_queue').select('fix_attempt_id, state').in('fix_attempt_id', ids).in('state', ACTIVE_QUEUE),
    db.from('fix_reviews').select('id, fix_attempt_id, status, verdict, head_sha, fixes_report, skip_reason, completed_at, comment_url, created_at').in('fix_attempt_id', ids).order('created_at', { ascending: false }),
    db.from('fix_review_followups').select('fix_attempt_id').in('fix_attempt_id', ids).in('status', ACTIVE_REPAIR),
    reportIds.length ? db.from('reports').select('id, status').in('id', reportIds) : Promise.resolve({ data: [], error: null }),
    reportIds.length
      ? db.from('fix_attempts').select('id, report_id, pr_url, pr_state, merged_at, created_at').in('report_id', reportIds).not('pr_url', 'is', null)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [queueRes, reviewRes, repairRes, reportRes, siblingRes]) if (r.error) throw new Error(`auto-decide read failed: ${r.error.message}`)

  // A PR the queue knows (queued, merged, or taken out by a person) is not ours to decide.
  const queued = new Set(((queueRes.data ?? []) as Array<{ fix_attempt_id: string }>).map((r) => r.fix_attempt_id))
  const latestReview = new Map<string, Record<string, unknown>>()
  for (const r of (reviewRes.data ?? []) as Array<Record<string, unknown>>) {
    if (!latestReview.has(r.fix_attempt_id as string)) latestReview.set(r.fix_attempt_id as string, r)
  }
  const repairing = new Set(((repairRes.data ?? []) as Array<{ fix_attempt_id: string }>).map((r) => r.fix_attempt_id))
  const reportStatus = new Map(((reportRes.data ?? []) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
  const siblings = new Map<string, Array<{ id: string; pr_state: string | null; merged_at: string | null; created_at: string }>>()
  for (const s of (siblingRes.data ?? []) as Array<{ id: string; report_id: string; pr_state: string | null; merged_at: string | null; created_at: string }>) {
    siblings.set(s.report_id, [...(siblings.get(s.report_id) ?? []), s])
  }
  // Verdicts of the open siblings, for "is another PR further along".
  const openSiblingIds = [...siblings.values()].flat().filter((s) => !s.merged_at && (s.pr_state === null || s.pr_state === 'open' || s.pr_state === 'draft')).map((s) => s.id)
  const siblingVerdict = new Map<string, Verdict | null>()
  if (openSiblingIds.length) {
    const { data: sv } = await db.from('fix_reviews').select('fix_attempt_id, verdict, status, created_at').in('fix_attempt_id', openSiblingIds).order('created_at', { ascending: false })
    for (const r of (sv ?? []) as Array<{ fix_attempt_id: string; verdict: Verdict | null; status: string }>) {
      if (!siblingVerdict.has(r.fix_attempt_id)) siblingVerdict.set(r.fix_attempt_id, r.status === 'completed' ? r.verdict : null)
    }
  }

  for (const a of attempts) {
    const ref = prRepoRef(a.pr_url)
    const line = (d: Decision) => {
      decisions.push({ fixAttemptId: a.id, projectId: a.project_id, pr: a.pr_url ?? '', decision: d.do, reason: d.reason })
      tally[d.do] = (tally[d.do] ?? 0) + 1
    }
    const touch = () => (opts.dryRun ? Promise.resolve() : db.from('fix_attempts').update({ auto_decide_checked_at: now.toISOString() }).eq('id', a.id).then(() => undefined))
    if (queued.has(a.id)) {
      await touch()
      continue
    }
    if (!ref || !a.pr_number) {
      line({ do: 'wait', reason: 'No pull request number.' })
      await touch()
      continue
    }
    let decision: Decision
    let token: string | null = null
    let headSha: string | null = null
    try {
      token = await deps.token(db, a)
      if (!token) {
        line({ do: 'wait', reason: 'No GitHub token for this repo.' })
        await touch()
        continue
      }
      const pr = await deps.pull(token, ref, a.pr_number)
      if (!pr) {
        line({ do: 'wait', reason: 'GitHub did not return the pull request.' })
        await touch()
        continue
      }
      headSha = pr.headSha
      const open = pr.state === 'open'
      const rv = latestReview.get(a.id) ?? null
      const sibs = (a.report_id ? siblings.get(a.report_id) ?? [] : []).filter((s) => !s.merged_at && (s.pr_state === null || s.pr_state === 'open' || s.pr_state === 'draft'))
      const keeper = pickKeeper(sibs.map((s) => ({ id: s.id, verdict: siblingVerdict.get(s.id) ?? null, createdAt: s.created_at })))
      const checks = open && !pr.merged && headSha ? await deps.checks(token, ref, headSha) : { pending: 0, failed: [] }
      decision = decideFix({
        pr: { open, merged: pr.merged, headSha },
        report: { closed: CLOSED_REPORT.has(reportStatus.get(a.report_id ?? '') ?? '') },
        superseded: sibs.length > 1 && keeper !== null && keeper.id !== a.id,
        review: rv
          ? {
              status: rv.status as ReviewStatus,
              verdict: (rv.verdict as Verdict | null) ?? null,
              headSha: (rv.head_sha as string | null) ?? null,
              fixesReport: (rv.fixes_report as boolean | null) ?? null,
              skipReason: (rv.skip_reason as string | null) ?? null,
              completedAt: (rv.completed_at as string | null) ?? null,
            }
          : null,
        ci: ownCi(checks),
        repairActive: repairing.has(a.id),
        prAttempts: a.report_id ? (siblings.get(a.report_id) ?? []).length : 1,
        now,
      })
      line(decision)
      if (opts.dryRun) continue

      if (decision.do === 'synced') {
        await db.from('fix_attempts').update({ pr_state: pr.merged ? 'merged' : 'closed', auto_decide_checked_at: now.toISOString() }).eq('id', a.id)
        if (!pr.merged) await handBack(db, a, (siblings.get(a.report_id ?? '') ?? []).length >= MAX_PR_ATTEMPTS_PER_REPORT)
        continue
      }
      if (decision.do === 'rereview') {
        await deps.requeueReview(db, { fixAttemptId: a.id, projectId: a.project_id, reportId: a.report_id, prUrl: a.pr_url }, headSha, now)
      } else if (decision.do === 'queue') {
        const repo = `${ref.owner}/${ref.repo}`.toLowerCase()
        // ignoreDuplicates: a row a person took out stays out.
        const { error: qErr } = await db.from('fix_merge_queue').upsert(
          {
            fix_attempt_id: a.id,
            project_id: a.project_id,
            repo,
            pr_number: a.pr_number,
            state: 'queued',
            detail: 'Queued by "Decide for me": Opus says merge.',
            queued_by: null,
            queued_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          { onConflict: 'fix_attempt_id', ignoreDuplicates: true },
        )
        if (qErr) throw new Error(`queue insert failed: ${qErr.message}`)
        await fixEvent(db, a, 'merge_queue', 'Queued to merge on its own', decision.reason, 'queue')
      } else if (decision.do === 'close_superseded' || decision.do === 'close_redo' || decision.do === 'close_park') {
        const rv = latestReview.get(a.id)
        await deps.closePr(token, ref, a.pr_number, closeComment(decision, (rv?.comment_url as string | null) ?? null))
        await db.from('fix_attempts').update({ pr_state: 'closed', auto_decide_checked_at: now.toISOString() }).eq('id', a.id)
        await fixEvent(
          db,
          a,
          'pr_state_changed',
          decision.do === 'close_superseded' ? 'Closed: superseded' : decision.do === 'close_park' ? 'Closed: waits for a person' : 'Closed: a new fix starts',
          decision.reason,
          decision.do,
        )
        if (decision.do !== 'close_superseded') await handBack(db, a, decision.do === 'close_park')
        continue
      }
      await touch()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('auto-decide PR failed', { fixAttemptId: a.id, err: message.slice(0, 200) })
      line({ do: 'wait', reason: `Will retry: ${message.slice(0, 160)}` })
      await touch()
    }
  }
  return { tally, decisions }
}
