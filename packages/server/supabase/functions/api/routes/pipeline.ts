/**
 * FILE: packages/server/supabase/functions/api/routes/pipeline.ts
 * PURPOSE: The console's pipeline view (/pipeline), served by `api-ext`
 *          (deploy size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/pipeline          ?projectId= one app, or every app the caller can open
 *   POST /v1/admin/pipeline/actions  { action, fixIds?, projectId?, reason? } one-click fixes
 *
 * The read returns every stage with its stuck groups (_shared/pipeline-view.ts),
 * the release trains of the last 7 days per repo, and intake rejects. The
 * actions change only GitHub PRs and merge-queue rows the caller can write;
 * the merge queue's own logic (train.ts, worker.ts) is never changed here:
 *
 *   ci_repair       queue one CI-repair follow-up (ADR 0032), under its caps
 *   update_branch   GitHub "Update branch", pinned to the head Mushi saw
 *   conflict_agent  hand a conflicted queue row back to the worker for a new
 *                   conflict agent (≤ 2 per PR, ADR 0041)
 *   mark_ready      take a draft PR out of draft so CI runs
 *   remove          take the PR out of the merge queue, with a reason
 *   close           close the PR without merging, with a reason
 *   train_retry     run the merge queue for the app now
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
import { ciHeadState, FOLLOWUP_REASONS, type CiJobForRepair } from '../../_shared/review-followup.ts';
import { postTeamNote } from '../../_shared/reporter-comms.ts';
import { finalizeFixClosedUnmerged } from '../../_shared/fix-merge.ts';
import {
  buildDispatchers,
  buildPipeline,
  CONFLICT_AGENT_CAP,
  dispatcherGroup,
  withDispatcherGroup,
  type AgentKeyRow,
  summarizeTrains,
  type AttemptRow,
  type DeployRow,
  type EventRow,
  type FollowupRow,
  type QueueRow,
  type ReportRow,
  type ReviewRow,
  type TrainRow,
} from '../../_shared/pipeline-view.ts';
import { dbError, enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

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

export const PIPELINE_ACTIONS = ['ci_repair', 'update_branch', 'conflict_agent', 'mark_ready', 'remove', 'close', 'train_retry'] as const;
export type PipelineActionId = (typeof PIPELINE_ACTIONS)[number];

const ATTEMPT_COLUMNS =
  'id, project_id, report_id, status, agent, branch, branch_name, pr_url, pr_number, pr_state, commit_sha, check_run_conclusion, error, summary, created_at, completed_at, merged_at, repo_id';

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
  closePull: async (token, ref, n) => {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${n}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    }).catch(() => null);
    return res?.ok === true;
  },
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
      db.from('fix_reviews').select('fix_attempt_id, status, verdict, summary, findings, error, completed_at, created_at').in('fix_attempt_id', ids) as never,
    ),
    inChunks<FollowupRow>(attemptIds, (ids) =>
      db.from('fix_review_followups').select('fix_attempt_id, status, kind').in('fix_attempt_id', ids).in('status', ['queued', 'dispatched', 'running']) as never,
    ),
    // The latest event per attempt: small chunks, since CI writes many events per PR.
    inChunks<EventRow>(attemptIds, (ids) => db.from('fix_events').select('fix_attempt_id, at, label').in('fix_attempt_id', ids).gte('at', since3).order('at', { ascending: false }).limit(1000) as never, 20).catch(
      (err) => {
        plog.warn('fix events read failed', { err: err instanceof Error ? err.message : String(err) });
        return [] as EventRow[];
      },
    ),
  ]);
  const heads = attempts.filter((a) => a.pr_state === 'open' || a.pr_state === 'draft').map((a) => a.commit_sha ?? '');
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
  const stages = buildPipeline({
    now,
    reports: [...reports, ...fixReports],
    attempts,
    reviews,
    queue: (queueRes.data ?? []) as QueueRow[],
    followups,
    ciJobs,
    deploys: deploysRes.error ? [] : ((deploysRes.data ?? []) as DeployRow[]),
    events,
    followupsOn,
  });
  const withDispatch = dispatchers ? withDispatcherGroup(stages, dispatcherGroup(dispatchers, now)) : stages;
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
    // Rejected ingests go to the edge logs only (`report rejected`, fix/autofix-pipeline), not a table:
    // null means "not counted here", never 0.
    intake: null as null | { rejected: number; byReason: Array<{ reason: string; count: number }> },
    ciReadable,
  };
}

type DispatcherProject = { id: string; name: string; organization_id: string | null; owner_id: string | null };

/**
 * Who opens fixes per app: the server's dispatcher (spend-down on an active
 * Cursor key, ADR 0028) and its last 48 h, and local `mushi work` lanes.
 * Counts only; no key material is read.
 */
async function readDispatchers(db: Db, projectIds: string[], projects: DispatcherProject[], now: Date) {
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
    });
  } catch (err) {
    plog.warn('dispatcher read failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
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

async function ciRepair(db: Db, a: AttemptForAction, now: Date): Promise<ActionResult> {
  const { data: rv, error } = await db
    .from('fix_reviews')
    .select('id, fix_attempt_id, project_id, report_id, status, verdict, head_sha, created_at')
    .eq('fix_attempt_id', a.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { id: a.id, ok: false, message: 'Could not read the review.' };
  if (!rv) return { id: a.id, ok: false, message: 'This PR has no review yet; re-run the review first.' };
  const review = rv as { id: string; fix_attempt_id: string; project_id: string; report_id: string | null; status: string; verdict: string | null; head_sha: string | null };
  let ci = null;
  if (review.head_sha) {
    try {
      ci = ciHeadState((await ciJobsForHeads(db, [a.project_id], [review.head_sha])).get(review.head_sha) ?? []);
    } catch {
      return { id: a.id, ok: false, message: 'Could not read CI for the reviewed commit. Try again in a minute.' };
    }
  }
  const res = await enqueueReviewFollowup(db, { review, attempt: a, requireEnabled: true, ci }, now);
  if (res.queued) return { id: a.id, ok: true, message: 'Queued a CI-repair agent; it starts within 10 minutes.' };
  if (res.error) return { id: a.id, ok: false, message: `Not queued: ${res.error}` };
  const why = res.reason ? FOLLOWUP_REASONS[res.reason] : 'The follow-up rules did not allow it.';
  return { id: a.id, ok: false, message: `Not queued. ${why}` };
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
        results.push(await runAction(db, deps, action, a, reason, author, now));
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

async function runAction(db: Db, deps: PipelineRouteDeps, action: PipelineActionId, a: AttemptForAction, reason: string, author: string, now: Date): Promise<ActionResult> {
  const pr = prRef(a);
  const url = a.pr_url;
  if (a.merged_at || a.pr_state === 'merged') return { id: a.id, ok: false, message: 'Already merged.', url };

  if (action === 'ci_repair') return { ...(await ciRepair(db, a, now)), url };

  if (action === 'remove' || action === 'conflict_agent') {
    const { data: row, error } = await db
      .from('fix_merge_queue')
      .select('id, state, conflict_agents, detail')
      .eq('fix_attempt_id', a.id)
      .in('state', ['queued', 'waiting', 'resolving', 'blocked'])
      .maybeSingle();
    if (error) return { id: a.id, ok: false, message: 'Could not read the merge queue.', url };
    if (!row) return { id: a.id, ok: false, message: 'Not in the merge queue.', url };
    const q = row as { id: string; state: string; conflict_agents: number | null; detail: string | null };
    if (action === 'remove') {
      const { error: upErr } = await db
        .from('fix_merge_queue')
        .update({ state: 'removed', detail: `Taken out of the queue: ${reason}`.slice(0, 500), updated_at: now.toISOString(), claimed_until: null })
        .eq('id', q.id);
      if (upErr) return { id: a.id, ok: false, message: 'Could not take it out of the queue.', url };
      const noteErr = await note(db, a, `Removed from the merge queue: ${reason}`, author);
      return { id: a.id, ok: true, message: noteErr ? `Taken out of the queue. ${noteErr}` : 'Taken out of the queue; the reason is a note on the report.', url };
    }
    if ((q.conflict_agents ?? 0) >= CONFLICT_AGENT_CAP) {
      return { id: a.id, ok: false, message: `Both conflict agents (${CONFLICT_AGENT_CAP} of ${CONFLICT_AGENT_CAP}) were used on this PR. Update the branch, or resolve it on GitHub.`, url };
    }
    if (q.state !== 'resolving' && q.state !== 'blocked') return { id: a.id, ok: false, message: 'Only a conflicted PR gets a conflict agent.', url };
    // The worker starts a new agent for a `resolving` row with no agent when the PR still conflicts.
    const { error: upErr } = await db
      .from('fix_merge_queue')
      .update({ state: 'resolving', cursor_agent_id: null, agent_head_sha: null, claimed_until: null, detail: 'Sent to a conflict agent again from the console.', updated_at: now.toISOString() })
      .eq('id', q.id);
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
  // close
  const closed = await deps.closePull(token, pr.ref, pr.n);
  if (!closed) return { id: a.id, ok: false, message: 'GitHub did not close the pull request.', url };
  await db
    .from('fix_merge_queue')
    .update({ state: 'removed', detail: `Closed from the console: ${reason}`.slice(0, 500), updated_at: now.toISOString(), claimed_until: null })
    .eq('fix_attempt_id', a.id)
    .in('state', ['queued', 'waiting', 'resolving', 'blocked']);
  if (a.report_id) {
    await finalizeFixClosedUnmerged(
      db,
      { id: a.id, project_id: a.project_id, report_id: a.report_id, agent: a.agent, branch: a.branch, commit_sha: a.commit_sha, pr_url: a.pr_url, pr_number: a.pr_number },
      { prNumber: pr.n, closedAt: now.toISOString(), source: 'console' },
    ).catch((err) => plog.warn('finalize after a console close failed', { fixId: a.id, err: String(err).slice(0, 200) }));
  }
  const noteErr = await note(db, a, `Pull request #${pr.n} closed without merging: ${reason}`, author);
  return { id: a.id, ok: true, message: noteErr ? `Closed. ${noteErr}` : 'Closed; the reason is a note on the report.', url };
}
