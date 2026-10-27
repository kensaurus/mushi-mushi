// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * skill-runs — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Skill runs (ADR 0042). Every 10 minutes (pg_cron `mushi-skill-runs`) and
 * right after a person starts one, for each active run:
 *   - no round yet, or the last round merged → file the next round as a
 *     classified report (source 'skill_run') with the task, the measurement
 *     and the skill's text from the synced catalog; spend-down sends it to
 *     the app's own Cursor key, or, for a run on a local worker lane
 *     (`lane_id`, ADR 0042 amendment), it goes into that lane's queue, which
 *     spend-down leaves alone;
 *   - the round's PR has an Opus "merge" verdict and the run merges when
 *     ready → hand it to the merge queue (ADR 0041), whose gates decide;
 *   - the agent found nothing left → done; it needs a person, the code is in
 *     another repo, the round was dismissed or its PR closed → stopped;
 *   - a local worker holds the round's report (ADR 0048) → wait for it.
 *
 * Auth: `requireServiceRoleAuth`. `POST { runId }` runs that run now.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { parsePrRepoRef } from '../_shared/fix-merge.ts'
import { nextSkillRunStep, skillRunReport, skillRunSkill, type RoundHistory } from '../_shared/skill-runs.ts'
import { enqueueReports, reportHasActiveWorkClaim } from '../_shared/work-claims.ts'

const log = rootLog.child('skill-runs')
const LEASE_MS = 4 * 60_000
const RUNS_PER_TICK = 40

interface RunRow {
  id: string
  project_id: string
  skill_slug: string
  scope: string
  rounds_max: number
  round: number
  auto_merge: boolean
  current_report_id: string | null
  history: RoundHistory[] | null
  created_by: string | null
  /** A local worker lane runs the rounds (ADR 0042 amendment); null = the cloud. */
  lane_id: string | null
}

interface RoundAttempt {
  id: string
  status: string | null
  failure_category: string | null
  pr_state: string | null
  merged_at: string | null
  pr_url: string | null
  pr_number: number | null
}

async function fileRound(db: SupabaseClient, run: RunRow, history: RoundHistory[]): Promise<string> {
  const skill = skillRunSkill(run.skill_slug)
  if (!skill) throw new Error(`${run.skill_slug} is not a skill-run skill`)
  const [{ data: catalog }, { data: project }] = await Promise.all([
    db.from('agent_skills').select('title, body_md, source_id').eq('slug', run.skill_slug).eq('is_active', true).limit(1).maybeSingle(),
    db.from('projects').select('name').eq('id', run.project_id).maybeSingle(),
  ])
  const c = catalog as { title?: string | null; body_md?: string | null; source_id?: string | null } | null
  let skillUrl: string | null = null
  if (c?.source_id) {
    const { data: src } = await db.from('skill_sources').select('repo_slug, ref').eq('id', c.source_id).maybeSingle()
    const s = src as { repo_slug?: string | null; ref?: string | null } | null
    if (s?.repo_slug) skillUrl = `https://github.com/${s.repo_slug}/blob/${s.ref || 'main'}/skills/${run.skill_slug}/SKILL.md`
  }
  const round = run.round + 1
  const r = skillRunReport({
    skill,
    skillTitle: c?.title ?? null,
    skillBody: c?.body_md ?? null,
    skillUrl,
    scope: run.scope,
    appName: (project as { name?: string } | null)?.name ?? 'this app',
    round,
    roundsMax: run.rounds_max,
    history,
  })
  const { data: report, error } = await db.from('reports').insert({
    project_id: run.project_id,
    source: 'skill_run',
    category: 'other',
    summary: r.summary,
    description: r.description,
    component: r.component,
    severity: 'medium',
    status: 'classified',
    confidence: 1,
    tags: ['skill_run', run.skill_slug],
    reporter_token_hash: 'cron:skill-runs',
    environment: { skillRun: { id: run.id, skill: run.skill_slug, round, roundsMax: run.rounds_max } },
  }).select('id').maybeSingle()
  if (error || !report) throw new Error(`round ${round} not filed: ${(error?.message ?? 'no row').slice(0, 160)}`)
  const reportId = (report as { id: string }).id
  if (run.lane_id) {
    // Into the lane's queue before anything else sees the round. When that
    // fails the round is taken back and filed again next tick: a local run
    // never falls through to a cloud agent.
    const { data: lane } = await db.from('work_lanes').select('id, project_id, host_id').eq('id', run.lane_id).maybeSingle()
    const l = lane as { id: string; project_id: string; host_id: string } | null
    const q = l ? await enqueueReports(db, { id: l.id, projectId: l.project_id, hostId: l.host_id }, [reportId], { source: 'skill_run' }) : { error: 'the lane is gone' }
    if ('error' in q) {
      await db.from('reports').delete().eq('id', reportId)
      throw new Error(`round ${round} not queued for its local lane: ${q.error.slice(0, 160)}`)
    }
  }
  await db.from('skill_runs').update({ round, current_report_id: reportId, updated_at: new Date().toISOString(), claimed_until: null }).eq('id', run.id)
  return reportId
}

export async function processRun(db: SupabaseClient, run: RunRow): Promise<string> {
  const history = [...(run.history ?? [])]
  const finish = async (status: 'done' | 'stopped', reason: string) => {
    await db.from('skill_runs').update({ status, stop_reason: reason, history, updated_at: new Date().toISOString(), claimed_until: null }).eq('id', run.id)
  }

  let reportStatus: string | null = null
  let attempt: RoundAttempt | null = null
  let reviewVerdict: string | null = null
  let queued = false
  if (run.current_report_id) {
    // A local worker holds the round's report (ADR 0048): its run is not
    // finished, so its attempt says nothing yet. An unreadable lease waits too.
    if ((await reportHasActiveWorkClaim(db, run.current_report_id)) !== false) {
      await db.from('skill_runs').update({ claimed_until: null }).eq('id', run.id)
      return 'waiting_local'
    }
    const { data: rep } = await db.from('reports').select('status').eq('id', run.current_report_id).maybeSingle()
    reportStatus = (rep as { status?: string } | null)?.status ?? 'dismissed'
    const { data: att } = await db
      .from('fix_attempts')
      .select('id, status, failure_category, pr_state, merged_at, pr_url, pr_number')
      .eq('report_id', run.current_report_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    attempt = (att as RoundAttempt | null) ?? null
    if (attempt) {
      const [{ data: rev }, { data: q }] = await Promise.all([
        db.from('fix_reviews').select('verdict').eq('fix_attempt_id', attempt.id).maybeSingle(),
        db.from('fix_merge_queue').select('id').eq('fix_attempt_id', attempt.id).maybeSingle(),
      ])
      reviewVerdict = (rev as { verdict?: string | null } | null)?.verdict ?? null
      queued = Boolean(q)
    }
  }
  const merged = Boolean(attempt?.merged_at) || attempt?.pr_state === 'merged'
  const step = nextSkillRunStep(
    { round: run.round, roundsMax: run.rounds_max, autoMerge: run.auto_merge },
    {
      reportStatus,
      attempt: attempt ? { status: attempt.status, failureCategory: attempt.failure_category, prState: attempt.pr_state, merged, prUrl: attempt.pr_url } : null,
      reviewVerdict,
      queued,
    },
  )
  const record = (outcome: string) => {
    if (!run.current_report_id || history.some((h) => h.reportId === run.current_report_id)) return
    history.push({ round: run.round, reportId: run.current_report_id, outcome, prUrl: attempt?.pr_url ?? null })
  }

  switch (step.do) {
    case 'wait':
      await db.from('skill_runs').update({ claimed_until: null }).eq('id', run.id)
      return 'waiting'
    case 'queue': {
      const ref = parsePrRepoRef(attempt!.pr_url)
      if (!ref || !attempt!.pr_number) {
        await db.from('skill_runs').update({ claimed_until: null }).eq('id', run.id)
        return 'waiting'
      }
      const { error } = await db.from('fix_merge_queue').upsert({
        fix_attempt_id: attempt!.id,
        project_id: run.project_id,
        repo: `${ref.owner}/${ref.repo}`.toLowerCase(),
        pr_number: attempt!.pr_number,
        state: 'queued',
        queued_by: run.created_by,
      }, { onConflict: 'fix_attempt_id', ignoreDuplicates: true })
      if (error) log.warn('skill run: merge queue insert failed', { runId: run.id, err: error.message })
      await db.from('skill_runs').update({ updated_at: new Date().toISOString(), claimed_until: null }).eq('id', run.id)
      return 'queued'
    }
    case 'file':
      if (merged || reportStatus === 'fixed' || reportStatus === 'verified') record('merged')
      await db.from('skill_runs').update({ history }).eq('id', run.id)
      await fileRound(db, run, history)
      return 'filed'
    case 'done':
      record(step.outcome)
      await finish('done', step.reason)
      return 'done'
    case 'stop':
      record(step.outcome)
      await finish('stopped', step.reason)
      return 'stopped'
  }
}

export async function runSkillRuns(db: SupabaseClient, runId?: string): Promise<Record<string, number>> {
  const nowIso = new Date().toISOString()
  let q = db.from('skill_runs').select('id, project_id, skill_slug, scope, rounds_max, round, auto_merge, current_report_id, history, created_by, lane_id, claimed_until').eq('status', 'active')
  if (runId) q = q.eq('id', runId)
  const { data, error } = await q.order('updated_at', { ascending: true }).limit(RUNS_PER_TICK)
  if (error) throw new Error(`skill-runs read failed: ${error.message}`)
  const tally: Record<string, number> = {}
  for (const run of (data ?? []) as Array<RunRow & { claimed_until: string | null }>) {
    if (run.claimed_until && run.claimed_until >= nowIso) continue
    const { data: claimed } = await db
      .from('skill_runs')
      .update({ claimed_until: new Date(Date.now() + LEASE_MS).toISOString() })
      .eq('id', run.id)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select('id')
    if (!claimed || (claimed as unknown[]).length === 0) continue
    let outcome: string
    try {
      outcome = await processRun(db, run)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('skill run failed', { runId: run.id, err: message })
      await db.from('skill_runs').update({ claimed_until: null, stop_reason: `Will retry: ${message.slice(0, 200)}` }).eq('id', run.id)
      outcome = 'error'
    }
    tally[outcome] = (tally[outcome] ?? 0) + 1
  }
  return tally
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown }
  const tally = await runSkillRuns(getServiceClient(), typeof body.runId === 'string' ? body.runId : undefined)
  return new Response(JSON.stringify({ ok: true, data: tally }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('skill-runs', handler))
}
