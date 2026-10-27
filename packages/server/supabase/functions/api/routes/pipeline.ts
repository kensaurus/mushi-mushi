/**
 * FILE: packages/server/supabase/functions/api/routes/pipeline.ts
 * PURPOSE: The console's pipeline view (/pipeline), served by `api-ext`
 *          (deploy size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/pipeline          ?projectId= one app, or every app the caller can open
 *   GET  /v1/admin/pipeline/fix/:id  one fix's group, actions and refused actions (report page)
 *   POST /v1/admin/pipeline/actions  { action, fixIds?, projectId?, reason? } one-click fixes
 *
 * The read returns every stage with its stuck groups (_shared/pipeline-view.ts),
 * the release trains of the last 7 days per repo, and intake rejects. The
 * actions change only GitHub PRs and merge-queue rows the caller can write;
 * the merge queue's own logic (train.ts, worker.ts) is never changed here:
 *
 *   ci_repair       a CI-repair follow-up (ADR 0032): Mushi's cloud agent when
 *                   follow-ups can run there, else handed to the local
 *                   `mushi work --followups` lanes (a request row they read)
 *   followup        the same for an Opus "fix first": cloud, else local lanes
 *   update_branch   GitHub "Update branch", pinned to the head Mushi saw
 *   conflict_agent  hand a conflicted queue row back to the worker for a new
 *                   conflict agent (≤ 2 per PR, ADR 0041); with no cloud agent
 *                   possible it says a person resolves it on GitHub (the local
 *                   lanes push only commits that change files, not merges)
 *   mark_ready      take a draft PR out of draft so CI runs
 *   remove          take the PR out of the merge queue, with a reason
 *   close           close the PR without merging, with a reason
 *   train_retry     run the merge queue for the app now
 *   requeue         put a report a local worker's machine stopped (ADR 0048)
 *                   back at the front of its lane; `claimIds`, not fixIds
 *
 * Every item carries `blocked`: the group's actions this file would refuse
 * for it, with the same words (readActionFacts → pipeline-view
 * blockedActions), so the console disables them instead of failing on click.
 *
 * A reason is kept as a team note on the report (postTeamNote), so it is read
 * where the console's other triage decisions are. Re-review, CI re-run and
 * "queue to merge" use their existing routes from the console.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { fetchWithTimeout } from '../../_shared/http.ts';
import { runInBackground } from '../../_shared/background.ts';
import {
  fetchPullRequest,
  installationIdForAttempt,
  markPullRequestReady,
  parseGithubRepoUrl,
  prNumberFromUrl,
  resolveProjectGithubToken,
  updatePullRequestBranch,
  type GithubRepoRef,
} from '../../_shared/github.ts';
import { ciJobsForHeads, enqueueReviewFollowup, followupsEnabledForProject } from '../../_shared/review-followup-db.ts';
import { localCiRepairRequestDedupe, localHandoff, type LocalFollowupKind } from '../../_shared/local-followup.ts';
import { roundHeadsFor } from './local-followups.ts';
import { ciHeadState, FOLLOWUP_REASONS, type CiJobForRepair, type PriorFollowup } from '../../_shared/review-followup.ts';
import { postTeamNote } from '../../_shared/reporter-comms.ts';
import { RERUN_REFUSED_DEDUPE_PREFIX } from '../../_shared/ci-jobs.ts';
import { closeFixPullRequest, closePullRequest } from '../../_shared/fix-close.ts';
import {
  buildDispatchers,
  buildPipeline,
  CONFLICT_AGENT_CAP,
  dispatcherGroup,
  intakeGroup,
  keyServes,
  localInfraGroup,
  type InfraClaimRow,
  summarizeIntake,
  withDispatcherGroup,
  type ActionFacts,
  type AgentKeyRow,
  type PipelineGroup,
  type PipelineItem,
  type PipelineStage,
  summarizeTrains,
  type AttemptRow,
  type DeployRow,
  type EventRow,
  type FollowupRow,
  type QueueRow,
  type ReportRow,
  type RejectionRow,
  type ReviewRow,
  type TrainRow,
} from '../../_shared/pipeline-view.ts';
import { dbError, enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';
import { activeWorkClaims, enqueueReports } from '../../_shared/work-claims.ts';
import { hostOnline } from '../../_shared/work-lanes.ts';

const plog = log.child('pipeline-routes');

type Ctx = Context<{ Variables: Variables }>;
type Db = ReturnType<typeof getServiceClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IN_CHUNK = 100;
const DAY = 24 * 3600_000;
/** Per request: each item may make two or three GitHub calls, and the request passes through `api`. */
export const MAX_ACTION_ITEMS = 10;
/** How long "Run merge queue now" waits for the worker before answering; the run goes on either way. */
const TRAIN_RETRY_WAIT_MS = 20_000;

export const PIPELINE_ACTIONS = ['ci_repair', 'followup', 'update_branch', 'conflict_agent', 'mark_ready', 'remove', 'close', 'train_retry', 'requeue'] as const;
export type PipelineActionId = (typeof PIPELINE_ACTIONS)[number];

const ATTEMPT_COLUMNS =
  'id, project_id, report_id, status, agent, branch, branch_name, pr_url, pr_number, pr_state, commit_sha, check_run_conclusion, error, summary, created_at, completed_at, merged_at, repo_id, failure_category';

export interface PipelineRouteDeps {
  token: (db: Db, attempt: { project_id: string; repo_id?: string | null; pr_url?: string | null }) => Promise<string | null>;
  pullHead: (token: string, ref: GithubRepoRef, n: number) => Promise<{ headSha: string | null; draft: boolean; state: string; merged: boolean } | null>;
  updateBranch: (token: string, ref: GithubRepoRef, n: number, head: string | null) => Promise<boolean>;
  markReady: (token: string, ref: GithubRepoRef, n: number) => Promise<{ ok: boolean; alreadyReady: boolean; message?: string }>;
  closePull: (token: string, ref: GithubRepoRef, n: number) => Promise<boolean>;
  runQueue: (projectId: string) => Promise<boolean>;
  now: () => Date;
}

export const defaultPipelineDeps: PipelineRouteDeps = {
  token: async (db, attempt) => resolveProjectGithubToken(db, attempt.project_id, await installationIdForAttempt(db, attempt)),
  pullHead: async (token, ref, n) => {
    const p = await fetchPullRequest(token, ref, n);
    return p ? { headSha: p.headSha ?? null, draft: !!p.draft, state: p.state, merged: !!p.merged } : null;
  },
  updateBranch: updatePullRequestBranch,
  markReady: markPullRequestReady,
  closePull: closePullRequest,
  runQueue: async (projectId) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return false;
    const res = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/merge-queue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ projectId }),
      },
      120_000,
    ).catch(() => null);
    return res?.ok === true;
  },
  now: () => new Date(),
};

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<{ data: unknown; error: { message: string } | null }>, size = IN_CHUNK): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await read(ids.slice(i, i + size));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function scopedProjectIds(c: Ctx, db: Db, userId: string, requested: string | undefined): Promise<{ ids: string[] } | { denied: Response }> {
  if (requested) {
    if (!UUID_RE.test(requested)) return { denied: c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is not a uuid.' } }, 400) };
    const access = await userCanAccessProject(db, userId, requested);
    if (!access.allowed) return { denied: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) };
    return { ids: [requested] };
  }
  return { ids: await enumerateAccessibleProjectIds(c, db, userId) };
}

export async function readPipeline(db: Db, projectIds: string[], now: Date) {
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const since14 = new Date(now.getTime() - 14 * DAY).toISOString();
  const [projectsRes, reportsRes, attemptsRes, failedRes, queueRes, trainsRes, deploysRes] = await Promise.all([
    db.from('projects').select('id, name, organization_id, owner_id').in('id', projectIds),
    db
      .from('reports')
      .select('id, project_id, status, title, summary, description, created_at, processing_error')
      .in('project_id', projectIds)
      .in('status', ['new', 'queued', 'pending', 'classified'])
      .order('created_at', { ascending: true })
      .limit(2000),
    db
      .from('fix_attempts')
      .select(ATTEMPT_COLUMNS)
      .in('project_id', projectIds)
      .or(`pr_state.in.(open,draft),status.in.(running,pending),merged_at.gte.${since7}`)
      .order('created_at', { ascending: true })
      .limit(2000),
    // Agents that failed without a PR this week.
    db
      .from('fix_attempts')
      .select(ATTEMPT_COLUMNS)
      .in('project_id', projectIds)
      .eq('status', 'failed')
      .gte('created_at', since7)
      .limit(500),
    db
      .from('fix_merge_queue')
      .select('id, fix_attempt_id, project_id, repo, pr_number, state, detail, queued_at, agent_started_at, conflict_agents')
      .in('project_id', projectIds)
      .in('state', ['queued', 'waiting', 'resolving', 'blocked'])
      .limit(2000),
    db
      .from('release_trains')
      .select('id, project_id, repo, pr_number, state, members, attempt, detail, created_at, merged_at')
      .in('project_id', projectIds)
      .gte('created_at', since7)
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('deploy_observations').select('project_id, observed_version, ok, observed_at').in('project_id', projectIds).gte('observed_at', since14).limit(500),
  ]);
  for (const r of [projectsRes, reportsRes, attemptsRes, failedRes, queueRes, trainsRes]) if (r.error) throw new Error(r.error.message);

  const seen = new Set<string>();
  const attempts = ([...(attemptsRes.data ?? []), ...(failedRes.data ?? [])] as Array<AttemptRow & { repo_id: string | null }>).filter((a) =>
    seen.has(a.id) ? false : (seen.add(a.id), true),
  );
  const attemptIds = attempts.map((a) => a.id);
  const reports = (reportsRes.data ?? []) as ReportRow[];
  // Titles for the reports behind fix attempts (those are `fixing`, not loaded above).
  const known = new Set(reports.map((r) => r.id));
  const missing = [...new Set(attempts.map((a) => a.report_id).filter((id): id is string => !!id && !known.has(id)))];
  const since3 = new Date(now.getTime() - 3 * DAY).toISOString();
  const [fixReports, reviews, followups, events] = await Promise.all([
    inChunks<ReportRow>(missing, (ids) => db.from('reports').select('id, project_id, status, title, summary, description, created_at, processing_error').in('id', ids) as never),
    inChunks<ReviewRow>(attemptIds, (ids) =>
      db.from('fix_reviews').select('fix_attempt_id, status, verdict, summary, findings, error, completed_at, created_at, queued_at, head_sha').in('fix_attempt_id', ids) as never,
    ),
    // Every follow-up row: the active ones move a PR, all of them are the cloud trigger's history.
    inChunks<FollowupRow>(attemptIds, (ids) =>
      db.from('fix_review_followups').select('id, fix_attempt_id, status, kind, head_sha_before, cursor_agent_id').in('fix_attempt_id', ids) as never,
    ),
    // The latest event per attempt: small chunks, since CI writes many events per PR.
    inChunks<EventRow>(attemptIds, (ids) => db.from('fix_events').select('fix_attempt_id, at, label').in('fix_attempt_id', ids).gte('at', since3).order('at', { ascending: false }).limit(1000) as never, 20).catch(
      (err) => {
        plog.warn('fix events read failed', { err: err instanceof Error ? err.message : String(err) });
        return [] as EventRow[];
      },
    ),
  ]);
  // Reviewed heads too: a CI repair is judged on the commit Opus reviewed.
  const heads = [
    ...attempts.filter((a) => a.pr_state === 'open' || a.pr_state === 'draft').map((a) => a.commit_sha ?? ''),
    ...reviews.map((r) => r.head_sha ?? ''),
  ];
  let ciJobs = new Map<string, CiJobForRepair[]>();
  let ciReadable = true;
  try {
    ciJobs = await ciJobsForHeads(db, projectIds, heads);
  } catch (err) {
    // The PR's own check summary (check_run_conclusion) still reads red or green.
    ciReadable = false;
    plog.warn('ci jobs read failed', { err: err instanceof Error ? err.message : String(err) });
  }

  const followupsOn = new Set<string>();
  await Promise.all(
    projectIds.map(async (id) => {
      if ((await followupsEnabledForProject(db, id)).enabled) followupsOn.add(id);
    }),
  );
  const dispatchers = await readDispatchers(db, projectIds, (projectsRes.data ?? []) as DispatcherProject[], now);
  const actionFacts = await readActionFacts(db, projectIds, attempts, followups, now);
  const stages = buildPipeline({
    now,
    reports: [...reports, ...fixReports],
    attempts,
    reviews,
    queue: (queueRes.data ?? []) as QueueRow[],
    followups: followups.filter((f) => ACTIVE_FOLLOWUP_STATUSES.has(f.status)),
    ciJobs,
    deploys: deploysRes.error ? [] : ((deploysRes.data ?? []) as DeployRow[]),
    events,
    followupsOn,
    ciReadable,
    actionFacts: actionFacts ?? undefined,
  });
  const intake = await readIntake(db, projectIds, now);
  const names = new Map(((projectsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  const withDispatch = withDispatcherGroup(
    withDispatcherGroup(
      dispatchers ? withDispatcherGroup(stages, dispatcherGroup(dispatchers, now)) : stages,
      intakeGroup(intake, names),
    ),
    await readLocalInfra(db, projectIds, now),
  );
  const deploys = (deploysRes.data ?? []) as DeployRow[];
  return {
    generatedAt: now.toISOString(),
    projects: ((projectsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => {
      const last = deploys.filter((d) => d.project_id === p.id).sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
      return { id: p.id, name: p.name, lastDeploy: last ? { at: last.observed_at, version: last.observed_version, ok: last.ok !== false } : null };
    }),
    stages: withDispatch,
    // null: the dispatcher reads failed; the stage still shows its PRs.
    dispatchers,
    trains: summarizeTrains((trainsRes.data ?? []) as TrainRow[]),
    // null: nothing counted yet (or the table is not there): "not recorded yet", never 0.
    intake,
    ciReadable,
  };
}

const ACTIVE_FOLLOWUP_STATUSES = new Set(['queued', 'dispatched', 'running']);

/** A remembered refusal stops counting after this, in case the token changed somewhere Mushi does not see. */
const RERUN_REFUSED_TTL_MS = 7 * DAY;

/**
 * What the action routes check before they act (pipeline-view ActionFacts),
 * read once: cloud follow-up readiness per app, earlier follow-up rounds per
 * PR, and apps whose GitHub token GitHub refused a re-run since the app's
 * settings last changed. null when any read fails: then every action stays
 * offered, as before.
 */
async function readActionFacts(db: Db, projectIds: string[], attempts: AttemptRow[], followups: FollowupRow[], now: Date): Promise<ActionFacts | null> {
  try {
    const prIds = attempts.filter((a) => a.pr_url && (a.pr_state === 'open' || a.pr_state === 'draft')).map((a) => a.id);
    const prProjects = [...new Set(attempts.filter((a) => prIds.includes(a.id)).map((a) => a.project_id))];
    const cache: CloudReadyCache = new Map();
    const since = new Date(now.getTime() - RERUN_REFUSED_TTL_MS).toISOString();
    const [cloudRows, heads, refusals, settings] = await Promise.all([
      Promise.all(prProjects.map(async (id) => [id, await cloudReady(db, id, cache)] as const)),
      roundHeadsFor(db, prIds),
      db
        .from('fix_events')
        .select('project_id, at')
        .in('project_id', projectIds)
        .eq('kind', 'ci_started')
        .eq('status', 'fail')
        .like('dedupe_key', `${RERUN_REFUSED_DEDUPE_PREFIX}%`)
        .gte('at', since)
        .limit(500),
      db.from('project_settings').select('project_id, updated_at').in('project_id', projectIds),
    ]);
    if ('error' in heads) throw new Error(heads.error);
    if (refusals.error) throw new Error(refusals.error.message);
    if (settings.error) throw new Error(settings.error.message);
    const changedAt = new Map(((settings.data ?? []) as Array<{ project_id: string; updated_at: string | null }>).map((r) => [r.project_id, r.updated_at ?? '']));
    const rerunRefused = new Set<string>();
    for (const r of (refusals.data ?? []) as Array<{ project_id: string; at: string }>) {
      if (Date.parse(r.at) > Date.parse(changedAt.get(r.project_id) || '1970-01-01T00:00:00Z')) rerunRefused.add(r.project_id);
    }
    const prior = new Map<string, PriorFollowup[]>();
    for (const f of followups) {
      if (!f.head_sha_before) continue;
      prior.set(f.fix_attempt_id, [...(prior.get(f.fix_attempt_id) ?? []), { id: f.id, head_sha_before: f.head_sha_before, status: f.status, cursor_agent_id: f.cursor_agent_id ?? null }]);
    }
    return {
      cloud: new Map(cloudRows.map(([id, c]) => [id, { ready: c.ready, enabled: c.enabled, why: c.why }])),
      prior,
      roundHeads: heads,
      rerunRefused,
    };
  } catch (err) {
    plog.warn('action facts read failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Local worker runs the machine stopped (ADR 0048) that were not put back on
 * their own, whose report no worker took again since and is not queued. Never
 * fails the pipeline: an unreadable (or not yet created) table shows nothing.
 */
async function readLocalInfra(db: Db, projectIds: string[], now: Date) {
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  try {
    const claims = await inChunks<InfraClaimRow & { auto_requeued: boolean }>(projectIds, (ids) =>
      db
        .from('work_claims')
        .select('id, project_id, report_id, lane_id, outcome, detail, claimed_at, finished_at, auto_requeued')
        .in('project_id', ids)
        // Conflict and audit runs (P3) hold no report: nothing to requeue.
        .not('report_id', 'is', null)
        .eq('failure_kind', 'infra')
        .in('status', ['done', 'expired'])
        .gte('claimed_at', since7)
        .order('claimed_at', { ascending: false })
        .limit(500) as never,
    );
    if (claims.length === 0) return null;
    const reportIds = [...new Set(claims.map((x) => x.report_id))];
    const [later, queued, reports, lanes] = await Promise.all([
      inChunks<{ report_id: string; claimed_at: string }>(reportIds, (ids) => db.from('work_claims').select('report_id, claimed_at').in('report_id', ids).gte('claimed_at', since7) as never),
      inChunks<{ report_id: string }>(reportIds, (ids) => db.from('work_queue').select('report_id').in('report_id', ids) as never),
      inChunks<{ id: string; summary: string | null; title: string | null; status: string }>(reportIds, (ids) => db.from('reports').select('id, summary, title, status').in('id', ids) as never),
      inChunks<{ id: string; name: string }>([...new Set(claims.map((x) => x.lane_id))], (ids) => db.from('work_lanes').select('id, name').in('id', ids) as never),
    ]);
    const queuedIds = new Set(queued.map((q) => q.report_id));
    const open = new Map(reports.filter((r) => !['fixed', 'verified', 'dismissed'].includes(r.status)).map((r) => [r.id, r.summary ?? r.title ?? `Report ${r.id.slice(0, 8)}`]));
    // The newest claim per report only, and only when nothing took the report after it.
    const newest = new Map<string, string>();
    for (const l of later) if ((newest.get(l.report_id) ?? '') < l.claimed_at) newest.set(l.report_id, l.claimed_at);
    const seen = new Set<string>();
    const stuck = claims.filter((x) => {
      if (seen.has(x.report_id)) return false;
      seen.add(x.report_id);
      return !x.auto_requeued && open.has(x.report_id) && !queuedIds.has(x.report_id) && newest.get(x.report_id) === x.claimed_at;
    });
    return localInfraGroup(stuck, open, new Map(lanes.map((l) => [l.id, l.name])));
  } catch (err) {
    plog.warn('local worker runs read failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Rejected ingests of the last 7 days per app (`report_ingest_rejections`,
 * written by the api's fire-and-forget counter). null when nothing was ever
 * counted or the table cannot be read.
 */
async function readIntake(db: Db, projectIds: string[], now: Date) {
  const since = new Date(now.getTime() - 6 * DAY).toISOString().slice(0, 10);
  const [rowsRes, firstRes] = await Promise.all([
    db
      .from('report_ingest_rejections')
      .select('project_id, day, stage, reason, sdk_package, count, last_at')
      .in('project_id', projectIds)
      .gte('day', since)
      .limit(2000),
    // When counting began: one row, the earliest day of any app (a date, nothing else).
    db.from('report_ingest_rejections').select('day').order('day', { ascending: true }).limit(1),
  ]);
  if (rowsRes.error || firstRes.error) {
    plog.warn('intake rejections read failed', { err: (rowsRes.error ?? firstRes.error)?.message });
    return null;
  }
  const first = ((firstRes.data ?? []) as Array<{ day: string }>)[0]?.day ?? null;
  return summarizeIntake((rowsRes.data ?? []) as RejectionRow[], projectIds, first, now);
}

export type DispatcherProject = { id: string; name: string; organization_id: string | null; owner_id: string | null };

/**
 * Who opens fixes per app: the server's dispatcher (spend-down on an active
 * Cursor key, ADR 0028) and its last 48 h, and local `mushi work` lanes.
 * Counts only; no key material is read.
 */
export async function readDispatchers(db: Db, projectIds: string[], projects: DispatcherProject[], now: Date) {
  const since48 = new Date(now.getTime() - 2 * DAY).toISOString();
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((x): x is string => !!x))];
  try {
    const [settingsRes, keysRes, ownersRes, jobsRes, attemptsRes] = await Promise.all([
      db.from('project_settings').select('project_id, autofix_enabled').in('project_id', projectIds),
      db.from('byok_keys').select('project_id, organization_id, owner_user_id, status, spend_down_enabled, exhausted_until').eq('provider_slug', 'cursor').limit(500),
      orgIds.length
        ? db.from('organization_members').select('organization_id, user_id').in('organization_id', orgIds).eq('role', 'owner')
        : Promise.resolve({ data: [], error: null }),
      db.from('fix_dispatch_jobs').select('project_id, created_at').in('project_id', projectIds).gte('created_at', since48).limit(5000),
      db.from('fix_attempts').select('project_id, agent, status, created_at').in('project_id', projectIds).gte('created_at', since7).limit(5000),
    ]);
    for (const r of [settingsRes, keysRes, ownersRes, jobsRes, attemptsRes]) if (r.error) throw new Error(r.error.message);
    const lanes = await readRegisteredLanes(db, projectIds, now);
    const orgOwners = new Map<string, Set<string>>();
    for (const m of (ownersRes.data ?? []) as Array<{ organization_id: string; user_id: string }>) {
      orgOwners.set(m.organization_id, (orgOwners.get(m.organization_id) ?? new Set()).add(m.user_id));
    }
    return buildDispatchers({
      now,
      projects,
      orgOwners,
      autofixOn: new Set(((settingsRes.data ?? []) as Array<{ project_id: string; autofix_enabled: boolean | null }>).filter((r) => r.autofix_enabled).map((r) => r.project_id)),
      cursorKeys: (keysRes.data ?? []) as AgentKeyRow[],
      jobs: (jobsRes.data ?? []) as Array<{ project_id: string; created_at: string }>,
      attempts: (attemptsRes.data ?? []) as Array<{ project_id: string; agent: string | null; status: string; created_at: string }>,
      lanes,
    });
  } catch (err) {
    plog.warn('dispatcher read failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Where one fix sits: null fields when it is in no group (merged long ago, or not in the 7-day window). */
function findPipelineFix(stages: PipelineStage[], fixId: string): {
  stage: PipelineStage['id'] | null;
  groupId: string | null;
  groupLabel: string | null;
  tone: PipelineGroup['tone'] | null;
  actions: PipelineGroup['actions'];
  item: PipelineItem | null;
} {
  for (const s of stages) {
    for (const g of s.groups) {
      const item = g.items.find((i) => i.id === fixId);
      if (item) return { stage: s.id, groupId: g.id, groupLabel: g.label, tone: g.tone, actions: g.actions, item };
    }
  }
  return { stage: null, groupId: null, groupLabel: null, tone: null, actions: [], item: null };
}

/** Registered local worker lanes (ADR 0048) and whether their machine is online. Empty when none or unreadable. */
async function readRegisteredLanes(db: Db, projectIds: string[], now: Date) {
  try {
    const lanes = await inChunks<{ project_id: string; host_id: string; paused: boolean; drain: boolean; stop_at: string | null; mode: string; model: string | null }>(projectIds, (ids) =>
      db.from('work_lanes').select('project_id, host_id, paused, drain, stop_at, mode, model').in('project_id', ids) as never,
    );
    if (lanes.length === 0) return [];
    const hosts = await inChunks<{ id: string; last_heartbeat_at: string; revoked_at: string | null }>([...new Set(lanes.map((l) => l.host_id))], (ids) =>
      db.from('work_hosts').select('id, last_heartbeat_at, revoked_at').in('id', ids) as never,
    );
    const online = new Set(hosts.filter((h) => !h.revoked_at && hostOnline(h.last_heartbeat_at, now)).map((h) => h.id));
    return lanes.map((l) => ({ project_id: l.project_id, online: online.has(l.host_id), paused: l.paused, drain: l.drain, stop_at: l.stop_at, mode: l.mode, model: l.model }));
  } catch (err) {
    plog.warn('local worker lanes read failed', { err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

interface ActionResult {
  id: string;
  ok: boolean;
  message: string;
  url?: string | null;
}

type AttemptForAction = {
  id: string;
  project_id: string;
  report_id: string | null;
  agent: string | null;
  branch: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
  commit_sha: string | null;
  merged_at: string | null;
  repo_id: string | null;
};

function prRef(a: Pick<AttemptForAction, 'pr_url' | 'pr_number'>): { ref: GithubRepoRef; n: number } | null {
  if (!a.pr_url) return null;
  const ref = parseGithubRepoUrl(a.pr_url.split('/pull/')[0]);
  const n = a.pr_number ?? prNumberFromUrl(a.pr_url);
  return ref && n ? { ref, n } : null;
}

async function note(db: Db, a: AttemptForAction, body: string, author: string): Promise<string | null> {
  if (!a.report_id) return 'No report to keep the note on.';
  const res = await postTeamNote(db, { projectId: a.project_id, reportId: a.report_id, body, authorName: author });
  return res.ok ? null : `The note was not saved: ${res.error}`;
}

interface CloudReady {
  /** Cloud follow-ups can start an agent for this app now. */
  ready: boolean;
  /** The organization's review follow-ups setting. */
  enabled: boolean;
  /** Why not, in plain words; null when ready. */
  why: string | null;
  name: string;
}

/** Per request: whether cloud follow-ups can run for an app (setting on, and a Cursor key serves it). */
export type CloudReadyCache = Map<string, Promise<CloudReady>>;

async function cloudReady(db: Db, projectId: string, cache: CloudReadyCache): Promise<CloudReady> {
  let p = cache.get(projectId);
  if (!p) {
    p = (async () => {
      const { data: project } = await db.from('projects').select('id, name, organization_id, owner_id').eq('id', projectId).maybeSingle();
      const proj = (project ?? { id: projectId, name: 'this app', organization_id: null, owner_id: null }) as {
        id: string
        name: string
        organization_id: string | null
        owner_id: string | null
      };
      const { enabled } = await followupsEnabledForProject(db, projectId);
      if (!enabled) return { ready: false, enabled, why: 'Review follow-ups are off for this team', name: proj.name };
      const [{ data: keys }, { data: owners }] = await Promise.all([
        db.from('byok_keys').select('project_id, organization_id, owner_user_id, status, spend_down_enabled, exhausted_until').eq('provider_slug', 'cursor').limit(500),
        proj.organization_id
          ? db.from('organization_members').select('user_id').eq('organization_id', proj.organization_id).eq('role', 'owner')
          : Promise.resolve({ data: [] as Array<{ user_id: string }> }),
      ]);
      const orgOwners = new Map<string, Set<string>>();
      if (proj.organization_id) orgOwners.set(proj.organization_id, new Set(((owners ?? []) as Array<{ user_id: string }>).map((o) => o.user_id)));
      const now = Date.now();
      const usable = ((keys ?? []) as AgentKeyRow[]).some(
        (k) => k.status === 'active' && !(k.exhausted_until && Date.parse(k.exhausted_until) > now) && keyServes(k, proj, orgOwners),
      );
      return usable
        ? { ready: true, enabled, why: null, name: proj.name }
        : { ready: false, enabled, why: 'No Cursor key can run cloud agents for this app', name: proj.name };
    })();
    cache.set(projectId, p);
  }
  return p;
}

/**
 * A follow-up on one PR: a CI repair (Opus said merge, CI fails on the code)
 * or the Opus "fix first" findings. Mushi's cloud agent when follow-ups can
 * run for the app; otherwise the local `mushi work --followups` lanes, which
 * read the request row (CI repair) or the review itself (findings).
 */
async function sendFollowup(db: Db, a: AttemptForAction, kind: LocalFollowupKind, cache: CloudReadyCache, by: string, now: Date): Promise<ActionResult> {
  const { data: rv, error } = await db
    .from('fix_reviews')
    .select('id, fix_attempt_id, project_id, report_id, status, verdict, head_sha, findings, created_at')
    .eq('fix_attempt_id', a.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { id: a.id, ok: false, message: 'Could not read the review.' };
  if (!rv) return { id: a.id, ok: false, message: 'This PR has no review yet; re-run the review first.' };
  const review = rv as { id: string; fix_attempt_id: string; project_id: string; report_id: string | null; status: string; verdict: string | null; head_sha: string | null; findings: unknown };
  let ci = null;
  if (kind === 'ci_repair' && review.head_sha) {
    try {
      ci = ciHeadState((await ciJobsForHeads(db, [a.project_id], [review.head_sha])).get(review.head_sha) ?? []);
    } catch {
      return { id: a.id, ok: false, message: 'Could not read CI for the reviewed commit. Try again in a minute.' };
    }
  }
  const cloud = await cloudReady(db, a.project_id, cache);
  if (cloud.ready) {
    const res = await enqueueReviewFollowup(db, { review, attempt: a, requireEnabled: true, ci }, now);
    if (res.queued) return { id: a.id, ok: true, message: kind === 'ci_repair' ? 'Queued a cloud CI-repair agent; it starts within 10 minutes.' : 'Queued a cloud follow-up agent; it starts within 10 minutes.' };
    if (res.error) return { id: a.id, ok: false, message: `Not queued: ${res.error}` };
    return { id: a.id, ok: false, message: `Not queued. ${res.reason ? FOLLOWUP_REASONS[res.reason] : 'The follow-up rules did not allow it.'}` };
  }

  // No cloud agent can run: the local lanes, by the same rules their claim checks.
  const heads = await roundHeadsFor(db, [a.id]);
  if ('error' in heads) return { id: a.id, ok: false, message: 'Could not read earlier follow-up rounds.' };
  const handoff = localHandoff({
    kind,
    attempt: a,
    review: { status: review.status, verdict: review.verdict, head_sha: review.head_sha, findings: Array.isArray(review.findings) ? review.findings.length : 0 },
    roundHeads: heads.get(a.id) ?? [],
    cloudFollowupsOn: cloud.enabled,
    ciCodeRed: kind === 'ci_repair' ? ci?.state === 'code_failure' : undefined,
  });
  if (!handoff.ok) return { id: a.id, ok: false, message: `${cloud.why}, and the local mushi work lanes cannot take it: ${handoff.message}` };
  const { error: insErr } = await db.from('fix_events').insert({
    fix_attempt_id: a.id,
    project_id: a.project_id,
    kind: 'followup',
    status: 'pending',
    label: kind === 'ci_repair' ? 'CI repair handed to the local lanes' : 'Follow-up handed to the local lanes',
    detail: `${by} handed ${handoff.headSha.slice(0, 7)} to the local mushi work lanes (${(cloud.why ?? 'no cloud agent').toLowerCase()}); mushi work --followups takes it on its next run.`,
    at: now.toISOString(),
    dedupe_key: kind === 'ci_repair' ? localCiRepairRequestDedupe(a.id, handoff.headSha) : `local-followup-request:${a.id}:${handoff.headSha}`,
    payload: { local: true, kind: `${kind}_request`, headSha: handoff.headSha },
  });
  if (insErr && insErr.code !== '23505') return { id: a.id, ok: false, message: 'Could not hand it to the local lanes.' };
  return {
    id: a.id,
    ok: true,
    message: `Queued for the local mushi work lanes (${cloud.name}): mushi work --followups takes it on its next run. ${cloud.why}.`,
  };
}

export function registerPipelineRoutes(app: Hono<{ Variables: Variables }>, deps: PipelineRouteDeps = defaultPipelineDeps): void {
  app.get('/v1/admin/pipeline', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const scope = await scopedProjectIds(c, db, userId, c.req.query('projectId'));
    if ('denied' in scope) return scope.denied;
    if (scope.ids.length === 0) return c.json({ ok: true, data: { generatedAt: deps.now().toISOString(), projects: [], stages: [], dispatchers: [], trains: [], intake: null, ciReadable: true } });
    try {
      return c.json({ ok: true, data: await readPipeline(db, scope.ids, deps.now()) });
    } catch (err) {
      return dbError(c, { message: err instanceof Error ? err.message : String(err) });
    }
  });

  // One fix's place in the pipeline: its group, the group's actions and the
  // ones the server would refuse (with why), and its failing checks, so the
  // report page offers what /pipeline offers (9e2ec6f0, 69fcafcb).
  app.get('/v1/admin/pipeline/fix/:id', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const fixId = c.req.param('id') ?? '';
    if (!UUID_RE.test(fixId)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'id must be a uuid.' } }, 400);
    const db = getServiceClient();
    const { data: attempt, error } = await db.from('fix_attempts').select('id, project_id').eq('id', fixId).maybeSingle();
    if (error) return dbError(c, error);
    if (!attempt) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);
    const projectId = (attempt as { project_id: string }).project_id;
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);
    try {
      const view = await readPipeline(db, [projectId], deps.now());
      return c.json({ ok: true, data: { generatedAt: view.generatedAt, ...findPipelineFix(view.stages, fixId) } });
    } catch (err) {
      return dbError(c, { message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/v1/admin/pipeline/actions', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; fixIds?: unknown; projectId?: unknown; reason?: unknown };
    const action = PIPELINE_ACTIONS.find((x) => x === body.action);
    if (!action) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `action is one of ${PIPELINE_ACTIONS.join(', ')}.` } }, 400);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
    if ((action === 'close' || action === 'remove') && reason.length < 3) {
      return c.json({ ok: false, error: { code: 'REASON_REQUIRED', message: 'Say why, in a few words. It is kept as a note on the report.' } }, 400);
    }
    const db = getServiceClient();
    const now = deps.now();

    if (action === 'train_retry') {
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!UUID_RE.test(projectId)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is required.' } }, 400);
      const access = await userCanAccessProject(db, userId, projectId);
      if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      const denied = denyViewerWrite(c, access.role, 'run the merge queue');
      if (denied) return denied;
      // Kept alive in the background: the answer waits at most 20 s, the run does not stop then.
      const run = deps.runQueue(projectId);
      runInBackground(run, 'pipeline-train-retry');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ran = await Promise.race([run, new Promise<null>((r) => (timer = setTimeout(() => r(null), TRAIN_RETRY_WAIT_MS)))]);
      clearTimeout(timer);
      await logAudit(db, projectId, userId, 'settings.updated', 'release_train', undefined, { action: 'train_retry' }).catch(() => {});
      const { data: trains } = await db
        .from('release_trains')
        .select('repo, pr_number, state, detail, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20);
      const rows = (trains ?? []) as Array<{ repo: string; pr_number: number | null; state: string; detail: string | null; created_at: string }>;
      const started = rows.filter((t) => (t.state === 'building' || t.state === 'testing') && Date.parse(t.created_at) >= now.getTime() - 60_000);
      const { data: settings } = await db.from('project_settings').select('train_interval_minutes').eq('project_id', projectId).maybeSingle();
      const interval = (settings as { train_interval_minutes?: number | null } | null)?.train_interval_minutes ?? 360;
      const repos = [...new Set(rows.map((t) => t.repo))];
      const results: ActionResult[] = repos.map((repo) => {
        const mine = rows.filter((t) => t.repo === repo);
        const moving = mine.find((t) => t.state === 'building' || t.state === 'testing');
        const latest = mine[0];
        if (started.some((t) => t.repo === repo)) return { id: repo, ok: true, message: `A new train left${moving?.pr_number ? ` (#${moving.pr_number})` : ''}.`, url: moving?.pr_number ? `https://github.com/${repo}/pull/${moving.pr_number}` : null };
        if (moving) return { id: repo, ok: true, message: `A train is already on the way${moving.pr_number ? ` (#${moving.pr_number})` : ''}: ${moving.detail ?? 'CI running'}`, url: moving.pr_number ? `https://github.com/${repo}/pull/${moving.pr_number}` : null };
        if (latest?.state === 'failed' && /is red too/i.test(latest.detail ?? '')) return { id: repo, ok: false, message: `The base branch is red too, so trains wait for it to pass. ${latest.detail}` };
        const leaves = new Date(Date.parse(latest.created_at) + interval * 60_000);
        if (leaves.getTime() > now.getTime()) return { id: repo, ok: false, message: `No train left: the next one may leave at ${leaves.toISOString().slice(11, 16)} UTC (one train every ${interval} min).` };
        return { id: repo, ok: false, message: 'No train left: no approved PR is ready to ride (each needs a merge verdict and its own CI green).' };
      });
      if (ran === null) results.unshift({ id: projectId, ok: true, message: 'The merge queue is still running; refresh in a minute to see whether a train left.' });
      else if (!ran) results.unshift({ id: projectId, ok: false, message: 'The merge queue did not start. Try again in a minute.' });
      return c.json({ ok: true, data: { results } });
    }

    if (action === 'requeue') return requeueClaims(c, db, userId, (body as { claimIds?: unknown }).claimIds, now);

    const fixIds = Array.isArray(body.fixIds) ? [...new Set(body.fixIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
    if (fixIds.length === 0 || fixIds.length > MAX_ACTION_ITEMS) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Send 1 to ${MAX_ACTION_ITEMS} fix ids.` } }, 400);
    }
    const { data: attempts, error } = await db
      .from('fix_attempts')
      .select('id, project_id, report_id, agent, branch, branch_name, pr_url, pr_number, pr_state, commit_sha, merged_at, repo_id')
      .in('id', fixIds);
    if (error) return dbError(c, error);
    const roles = new Map<string, string | null>();
    const cloudCache: CloudReadyCache = new Map();
    const results: ActionResult[] = [];
    const author = 'Mushi console';
    for (const id of fixIds) {
      const a = ((attempts ?? []) as AttemptForAction[]).find((x) => x.id === id);
      if (!a) {
        results.push({ id, ok: false, message: 'Fix not found.' });
        continue;
      }
      if (!roles.has(a.project_id)) {
        const access = await userCanAccessProject(db, userId, a.project_id);
        roles.set(a.project_id, access.allowed ? access.role ?? 'member' : null);
      }
      const role = roles.get(a.project_id);
      if (!role) {
        results.push({ id, ok: false, message: 'Not a member of this app.' });
        continue;
      }
      if (role === 'viewer') {
        results.push({ id, ok: false, message: 'Viewers cannot change fixes.' });
        continue;
      }
      try {
        results.push(await runAction(db, deps, action, a, reason, author, now, cloudCache));
      } catch (err) {
        plog.warn('pipeline action failed', { action, fixId: id, err: err instanceof Error ? err.message : String(err) });
        results.push({ id, ok: false, message: 'Something failed on the way; nothing may have changed. Try again.' });
      }
    }
    for (const p of [...new Set(((attempts ?? []) as AttemptForAction[]).map((a) => a.project_id))]) {
      if (roles.get(p) && roles.get(p) !== 'viewer') {
        await logAudit(db, p, userId, 'settings.updated', 'pipeline_action', undefined, { action, fixes: results.filter((r) => r.ok).length, reason: reason || undefined }).catch(() => {});
      }
    }
    return c.json({ ok: true, data: { results } });
  });
}

/**
 * "Requeue" (ADR 0048): put each report a local worker's machine stopped back
 * at the front of the lane that ran it. A person's call, so it is not limited
 * to once as the automatic requeue is, and it never counts against the report.
 */
async function requeueClaims(c: Ctx, db: Db, userId: string, raw: unknown, now: Date): Promise<Response> {
  const claimIds = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
  if (claimIds.length === 0 || claimIds.length > MAX_ACTION_ITEMS) {
    return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Send 1 to ${MAX_ACTION_ITEMS} claim ids.` } }, 400);
  }
  const { data, error } = await db.from('work_claims').select('id, project_id, report_id, lane_id, host_id, status').in('id', claimIds).not('report_id', 'is', null);
  if (error) return dbError(c, error);
  const rows = (data ?? []) as Array<{ id: string; project_id: string; report_id: string; lane_id: string; host_id: string; status: string }>;
  const held = await activeWorkClaims(db, rows.map((r) => r.report_id), now);
  const roles = new Map<string, string | null>();
  const results: ActionResult[] = [];
  for (const id of claimIds) {
    const cl = rows.find((r) => r.id === id);
    if (!cl) {
      results.push({ id, ok: false, message: 'Run not found.' });
      continue;
    }
    if (!roles.has(cl.project_id)) {
      const access = await userCanAccessProject(db, userId, cl.project_id);
      roles.set(cl.project_id, access.allowed ? access.role ?? 'member' : null);
    }
    const role = roles.get(cl.project_id);
    if (!role) {
      results.push({ id, ok: false, message: 'Not a member of this app.' });
      continue;
    }
    if (role === 'viewer') {
      results.push({ id, ok: false, message: "Viewers cannot change a lane's queue." });
      continue;
    }
    if ('error' in held) {
      results.push({ id, ok: false, message: 'Could not read the local workers; try again in a minute.' });
      continue;
    }
    if (held.ids.has(cl.report_id)) {
      results.push({ id, ok: false, message: 'A worker already has this report again.' });
      continue;
    }
    const q = await enqueueReports(db, { id: cl.lane_id, projectId: cl.project_id, hostId: cl.host_id }, [cl.report_id], { source: 'requeue', addedBy: userId, front: true, now });
    if ('error' in q) {
      results.push({ id, ok: false, message: 'Could not put it back in the lane.' });
      continue;
    }
    results.push({ id, ok: true, message: q.queued ? 'Back at the front of its lane; the worker takes it next.' : "It was already in the lane's queue." });
  }
  for (const p of [...new Set(rows.map((r) => r.project_id))]) {
    if (roles.get(p) && roles.get(p) !== 'viewer') {
      await logAudit(db, p, userId, 'settings.updated', 'pipeline_action', undefined, { action: 'requeue', claims: results.filter((r) => r.ok).length }).catch(() => {});
    }
  }
  return c.json({ ok: true, data: { results } });
}

async function runAction(
  db: Db,
  deps: PipelineRouteDeps,
  action: PipelineActionId,
  a: AttemptForAction,
  reason: string,
  author: string,
  now: Date,
  cloudCache: CloudReadyCache = new Map(),
): Promise<ActionResult> {
  const pr = prRef(a);
  const url = a.pr_url;
  if (a.merged_at || a.pr_state === 'merged') return { id: a.id, ok: false, message: 'Already merged.', url };

  if (action === 'ci_repair' || action === 'followup') {
    return { ...(await sendFollowup(db, a, action === 'ci_repair' ? 'ci_repair' : 'findings', cloudCache, author, now)), url };
  }

  if (action === 'remove' || action === 'conflict_agent') {
    const { data: row, error } = await db
      .from('fix_merge_queue')
      .select('id, state, conflict_agents, detail, local_claim_id')
      .eq('fix_attempt_id', a.id)
      .in('state', ['queued', 'waiting', 'resolving', 'blocked'])
      .maybeSingle();
    if (error) return { id: a.id, ok: false, message: 'Could not read the merge queue.', url };
    if (!row) return { id: a.id, ok: false, message: 'Not in the merge queue.', url };
    const q = row as { id: string; state: string; conflict_agents: number | null; detail: string | null; local_claim_id?: string | null };
    if (action === 'remove') {
      const { error: upErr } = await db
        .from('fix_merge_queue')
        // A local lane's claim on the row ends with it: its push or failure no longer moves the row (ADR 0049).
        .update({ state: 'removed', detail: `Taken out of the queue: ${reason}`.slice(0, 500), updated_at: now.toISOString(), claimed_until: null, local_claim_id: null })
        .eq('id', q.id);
      if (upErr) return { id: a.id, ok: false, message: 'Could not take it out of the queue.', url };
      const noteErr = await note(db, a, `Removed from the merge queue: ${reason}`, author);
      return { id: a.id, ok: true, message: noteErr ? `Taken out of the queue. ${noteErr}` : 'Taken out of the queue; the reason is a note on the report.', url };
    }
    if ((q.conflict_agents ?? 0) >= CONFLICT_AGENT_CAP) {
      return { id: a.id, ok: false, message: `Both conflict agents (${CONFLICT_AGENT_CAP} of ${CONFLICT_AGENT_CAP}) were used on this PR. Update the branch, or resolve it on GitHub.`, url };
    }
    if (q.state !== 'resolving' && q.state !== 'blocked') return { id: a.id, ok: false, message: 'Only a conflicted PR gets a conflict agent.', url };
    if (q.local_claim_id) return { id: a.id, ok: false, message: 'A local worker is resolving this conflict right now.', url };
    const cloud = await cloudReady(db, a.project_id, cloudCache);
    if (!cloud.ready) {
      // No cloud agent can run; a local worker lane in conflicts mode (ADR 0049) can.
      const { data: lanes } = await db.from('work_lanes').select('id').eq('project_id', a.project_id).eq('mode', 'conflicts').eq('paused', false).limit(1);
      if (((lanes ?? []) as unknown[]).length > 0) {
        const { error: upErr } = await db
          .from('fix_merge_queue')
          .update({ state: 'blocked', cursor_agent_id: null, claimed_until: null, detail: 'Merge conflict: waits for a local worker lane in conflicts mode.', updated_at: now.toISOString() })
          .eq('id', q.id)
          .is('local_claim_id', null);
        if (upErr) return { id: a.id, ok: false, message: 'Could not hand it back to the merge queue.', url };
        return { id: a.id, ok: true, message: 'A local worker lane in conflicts mode takes it at its next claim.', url };
      }
      return { id: a.id, ok: false, message: `Needs a person: resolve the conflict on GitHub (${url ?? 'the pull request'}). ${cloud.why}, so no conflict agent can run.`, url };
    }
    // The worker starts a new agent for a `resolving` row with no agent when the PR still conflicts.
    const { error: upErr } = await db
      .from('fix_merge_queue')
      .update({ state: 'resolving', cursor_agent_id: null, agent_head_sha: null, claimed_until: null, detail: 'Sent to a conflict agent again from the console.', updated_at: now.toISOString() })
      .eq('id', q.id)
      .is('local_claim_id', null);
    if (upErr) return { id: a.id, ok: false, message: 'Could not hand it back to the merge queue.', url };
    runInBackground(deps.runQueue(a.project_id), 'pipeline-conflict-agent');
    return { id: a.id, ok: true, message: 'Handed back to the merge queue; it starts a conflict agent if the PR still conflicts (it needs review follow-ups on).', url };
  }

  if (!pr) return { id: a.id, ok: false, message: 'This fix has no pull request.', url };
  const token = await deps.token(db, a);
  if (!token) return { id: a.id, ok: false, message: 'Connect GitHub for this app first.', url };
  const pull = await deps.pullHead(token, pr.ref, pr.n).catch(() => null);
  if (!pull) return { id: a.id, ok: false, message: 'GitHub did not find the pull request.', url };
  if (pull.merged) return { id: a.id, ok: false, message: 'Already merged on GitHub.', url };
  if (pull.state === 'closed') return { id: a.id, ok: false, message: 'The pull request is closed on GitHub.', url };

  if (action === 'update_branch') {
    const ok = await deps.updateBranch(token, pr.ref, pr.n, pull.headSha);
    return ok
      ? { id: a.id, ok: true, message: 'GitHub is merging the base branch into it; CI runs again on the new commit.', url }
      : { id: a.id, ok: false, message: 'GitHub refused to update the branch (most often a merge conflict). Send it to a conflict agent or resolve it on GitHub.', url };
  }
  if (action === 'mark_ready') {
    const res = await deps.markReady(token, pr.ref, pr.n);
    if (!res.ok) return { id: a.id, ok: false, message: res.message ?? 'GitHub did not take it out of draft.', url };
    return { id: a.id, ok: true, message: res.alreadyReady ? 'It was already ready for review.' : 'Ready for review; CI runs now.', url };
  }
  // close (the repo clean-up's close_prs runs the same helper, ADR 0051)
  const closed = await closeFixPullRequest(db, { fix: a, prNumber: pr.n, reason, author, now, source: 'console' }, () => deps.closePull(token, pr.ref, pr.n));
  return { id: a.id, ...closed, url };
}
