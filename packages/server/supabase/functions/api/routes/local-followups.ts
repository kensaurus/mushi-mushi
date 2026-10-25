/**
 * FILE: packages/server/supabase/functions/api/routes/local-followups.ts
 * PURPOSE: Review follow-ups for pull requests a local agent opened through
 *          `mushi work` (ADR 0032 amendment 2026-10-24), served by `api-ext`
 *          (deploy size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/projects/:id/local-followups   local fixes whose latest Opus review says "fix first" on their head
 *   POST /v1/admin/fixes/:id/local-followup       claim one round: live checks, then the screened prompt
 *   POST /v1/admin/fixes/:id/local-followup/done  { headBefore, headAfter?, note? } record the outcome; a push re-queues the review
 *
 * The rules are the cloud follow-up's (_shared/local-followup.ts): the PR's
 * live head is the reviewed one, at most 2 rounds per PR, once per head, no
 * forks, and only findings that pass screenFindings reach the agent. A round
 * is claimed with a deduped fix_events row, so two CLIs cannot both run it.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { sanitizeForLLM } from '../../_shared/sanitize.ts';
import { readFixCiInfra } from '../../_shared/ci-infra.ts';
import { loadFixReviewRow, enqueueFixReview } from '../../_shared/fix-review-db.ts';
import { parsePullRequestUrl } from '../../_shared/pr-substance.ts';
import {
  fetchPullRequestDetails,
  fetchPullRequestFiles,
  installationIdForAttempt,
  resolveProjectGithubToken,
} from '../../_shared/github.ts';
import { buildFollowupPrompt, screenFindings, type FollowupFinding } from '../../_shared/review-followup.ts';
import { CLOUD_FIX_AGENTS, LOCAL_FIX_AGENT, localFollowupAllowedFor, localFollowupDedupe, localFollowupGate } from '../../_shared/local-followup.ts';
import { dbError, callerCanAccessProject, parseUuidParam } from '../shared.ts';

const llog = log.child('local-followups');

type Ctx = Context<{ Variables: Variables }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;
const ATTEMPT_COLUMNS = 'id, project_id, report_id, agent, pr_url, pr_number, pr_state, merged_at, repo_id, commit_sha, ci_infra';
/** Local PRs older than this are not offered for a follow-up. */
const LIST_WINDOW_DAYS = 30;

interface AttemptRow {
  id: string;
  project_id: string;
  report_id: string | null;
  agent: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
  merged_at: string | null;
  repo_id: string | null;
  commit_sha: string | null;
  ci_infra: unknown;
}

function asFindings(raw: unknown): FollowupFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: String(f.severity ?? 'minor'),
      file: String(f.file ?? '(general)'),
      line: typeof f.line === 'number' ? f.line : null,
      issue: String(f.issue ?? ''),
      suggested_fix: String(f.suggested_fix ?? ''),
    }))
    .filter((f) => f.issue.trim() !== '');
}

/**
 * Heads a follow-up round already ran for, per fix: local rounds (claimed
 * events) and cloud rounds whose agent started, so one PR gets at most
 * FOLLOWUP_MAX_PER_PR rounds whichever worker ran them.
 */
async function roundHeadsFor(db: ReturnType<typeof getServiceClient>, fixIds: string[]): Promise<Map<string, string[]> | { error: string }> {
  const out = new Map<string, string[]>();
  if (fixIds.length === 0) return out;
  const add = (fixId: string, head: string | null | undefined) => {
    if (!head) return;
    const heads = out.get(fixId) ?? [];
    if (!heads.includes(head)) out.set(fixId, [...heads, head]);
  };
  const [local, cloud] = await Promise.all([
    db.from('fix_events').select('fix_attempt_id, dedupe_key').in('fix_attempt_id', fixIds).eq('kind', 'followup').like('dedupe_key', 'local-followup:%'),
    db.from('fix_review_followups').select('fix_attempt_id, head_sha_before').in('fix_attempt_id', fixIds).not('cursor_agent_id', 'is', null),
  ]);
  if (local.error) return { error: local.error.message };
  if (cloud.error) return { error: cloud.error.message };
  for (const row of (local.data ?? []) as Array<{ fix_attempt_id: string; dedupe_key: string }>) add(row.fix_attempt_id, row.dedupe_key.split(':')[2]);
  for (const row of (cloud.data ?? []) as Array<{ fix_attempt_id: string; head_sha_before: string | null }>) add(row.fix_attempt_id, row.head_sha_before);
  return out;
}

/** Whether the project's team runs cloud review follow-ups (then cloud-agent PRs are theirs, not a local agent's). */
async function cloudFollowupsOn(db: ReturnType<typeof getServiceClient>, projectId: string): Promise<boolean | { error: string }> {
  const { data, error } = await db.from('projects').select('organizations(review_followup_enabled)').eq('id', projectId).maybeSingle();
  if (error) return { error: error.message };
  const org = (data as { organizations?: { review_followup_enabled?: boolean | null } | null } | null)?.organizations;
  return org?.review_followup_enabled === true;
}

/** The fix, if the caller may change it (members; viewers only read). */
async function writableFix(c: Ctx, db: ReturnType<typeof getServiceClient>): Promise<{ attempt: AttemptRow } | { response: Response }> {
  const fixId = c.req.param('id') ?? '';
  if (!UUID_RE.test(fixId)) return { response: c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'The fix id is not a uuid.' } }, 400) };
  const { data, error } = await db.from('fix_attempts').select(ATTEMPT_COLUMNS).eq('id', fixId).maybeSingle();
  if (error) return { response: dbError(c, error) };
  const attempt = data as AttemptRow | null;
  if (!attempt) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found.' } }, 404) };
  const access = await callerCanAccessProject(c, db, c.get('userId') as string, attempt.project_id);
  if (!access.allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found.' } }, 404) };
  if (access.role === 'viewer') {
    return { response: c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot run follow-ups. Ask an app admin for member access.' } }, 403) };
  }
  return { attempt };
}

export function registerLocalFollowupRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/local-followups', adminOrApiKey({ scope: 'mcp:read' }), async (c: Ctx) => {
    const parsed = parseUuidParam(c);
    if (!parsed.ok) return parsed.error;
    const projectId = parsed.value;
    const db = getServiceClient();
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404);

    const since = new Date(Date.now() - LIST_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: attempts, error } = await db
      .from('fix_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('project_id', projectId)
      .in('agent', [LOCAL_FIX_AGENT, ...CLOUD_FIX_AGENTS])
      .not('pr_url', 'is', null)
      .is('merged_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return dbError(c, error);
    const cloudOn = await cloudFollowupsOn(db, projectId);
    if (typeof cloudOn !== 'boolean') return c.json({ ok: false, error: { code: 'DB_ERROR', message: cloudOn.error } }, 500);
    const open = ((attempts ?? []) as AttemptRow[]).filter(
      (a) => a.pr_state !== 'merged' && a.pr_state !== 'closed' && localFollowupAllowedFor(a.agent, cloudOn),
    );
    if (open.length === 0) return c.json({ ok: true, data: { fixes: [] } });

    const ids = open.map((a) => a.id);
    const [{ data: reviews, error: reviewErr }, heads] = await Promise.all([
      db.from('fix_reviews').select('fix_attempt_id, status, verdict, head_sha, findings').in('fix_attempt_id', ids),
      roundHeadsFor(db, ids),
    ]);
    if (reviewErr) return dbError(c, reviewErr);
    if ('error' in heads) return c.json({ ok: false, error: { code: 'DB_ERROR', message: heads.error } }, 500);
    const byFix = new Map(((reviews ?? []) as Array<{ fix_attempt_id: string; status: string; verdict: string | null; head_sha: string | null; findings: unknown }>).map((r) => [r.fix_attempt_id, r]));

    const fixes = [];
    for (const a of open) {
      const r = byFix.get(a.id);
      if (!r || r.status !== 'completed' || r.verdict !== 'fix_first' || !r.head_sha) continue;
      // commit_sha follows pushes (pull_request.synchronize); the claim re-reads the head live.
      if (a.commit_sha && a.commit_sha !== r.head_sha) continue;
      const done = heads.get(a.id) ?? [];
      if (done.includes(r.head_sha) || done.length >= 2) continue;
      // A "fix first" with no findings gives the agent nothing to do; the claim refuses it (NO_FINDINGS).
      const findings = asFindings(r.findings).length;
      if (findings === 0) continue;
      fixes.push({
        fixId: a.id,
        reportId: a.report_id,
        prUrl: a.pr_url,
        prNumber: a.pr_number,
        headSha: r.head_sha,
        findings,
        round: done.length + 1,
      });
    }
    return c.json({ ok: true, data: { fixes } });
  });

  app.post('/v1/admin/fixes/:id/local-followup', adminOrApiKey({ scope: 'mcp:write' }), async (c: Ctx) => {
    const db = getServiceClient();
    const found = await writableFix(c, db);
    if ('response' in found) return found.response;
    const { attempt } = found;

    const review = await loadFixReviewRow(db, attempt.id);
    if (review.error) return c.json({ ok: false, error: { code: 'REVIEW_UNAVAILABLE', message: 'Could not read the review. Try again in a minute.' } }, 503);
    const heads = await roundHeadsFor(db, [attempt.id]);
    if ('error' in heads) return c.json({ ok: false, error: { code: 'DB_ERROR', message: heads.error } }, 500);

    const ref = attempt.pr_url ? parsePullRequestUrl(attempt.pr_url) : null;
    let token: string | null = null;
    let livePr: Parameters<typeof localFollowupGate>[0]['livePr'] = null;
    if (ref) {
      try {
        token = await resolveProjectGithubToken(db, attempt.project_id, await installationIdForAttempt(db, attempt));
        const pr = token ? await fetchPullRequestDetails(token, { owner: ref.owner, repo: ref.repo }, ref.number) : null;
        if (pr) {
          livePr = {
            open: pr.state === 'open' && !pr.merged,
            headSha: pr.headSha ?? null,
            headRef: pr.headRef ?? null,
            headRepoId: pr.headRepoId ?? null,
            baseRepoId: pr.baseRepoId ?? null,
          };
        }
      } catch (err) {
        llog.warn('PR read failed', { fixId: attempt.id, err: err instanceof Error ? err.message : String(err) });
      }
    }

    const cloudOn = await cloudFollowupsOn(db, attempt.project_id);
    if (typeof cloudOn !== 'boolean') return c.json({ ok: false, error: { code: 'DB_ERROR', message: cloudOn.error } }, 500);
    const gate = localFollowupGate({ attempt, review: review.row, livePr, roundHeads: heads.get(attempt.id) ?? [], cloudFollowupsOn: cloudOn });
    if (!gate.ok) return c.json({ ok: false, error: { code: gate.code, message: gate.message } }, gate.status);

    // Only findings about files this PR changed, with no URL, command or
    // instruction in them, reach the agent (the cloud follow-up's screen).
    const listed = token && ref ? await fetchPullRequestFiles(token, { owner: ref.owner, repo: ref.repo }, ref.number).catch(() => null) : null;
    if (!listed) return c.json({ ok: false, error: { code: 'PR_UNREADABLE', message: "The pull request's changed files could not be read; try again in a minute." } }, 503);
    const all = asFindings(review.row?.findings);
    if (all.length === 0) return c.json({ ok: false, error: { code: 'NO_FINDINGS', message: 'The "fix first" review lists no findings to fix.' } }, 409);
    const screened = screenFindings(
      all,
      {
        files: listed.files.map((f) => ({ filename: f.filename, previousFilename: f.previousFilename ?? null })),
        complete: listed.complete,
        patches: listed.files.map((f) => f.patch ?? ''),
      },
      { ciInfra: readFixCiInfra(attempt.ci_infra)?.infra === true },
    );
    const d = screened.dropped;
    const droppedCount = d.url + d.command + d.injection + d.ciConfig + d.notInPr + d.ciInfra;
    if (screened.kept.length === 0) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_USABLE_FINDINGS',
            message: `All ${droppedCount} findings were left out by the safety screen: ${d.injection} reading as instructions, ${d.ciConfig} about CI or deploy config, ${d.command} with a command or a leak, ${d.url} with a foreign URL, ${d.notInPr} about files outside the PR, ${d.ciInfra} only saying CI stopped on the test machine. A person decides this one.`,
          },
        },
        409,
      );
    }

    let report: Record<string, unknown> | null = null;
    if (attempt.report_id) {
      const { data } = await db.from('reports').select('summary, component, stage2_analysis').eq('id', attempt.report_id).maybeSingle();
      report = (data as Record<string, unknown> | null) ?? null;
    }
    const s2 = ((report?.stage2_analysis ?? null) as Record<string, unknown> | null) ?? {};
    const prompt = buildFollowupPrompt({
      report: {
        id: attempt.report_id,
        summary: (report?.summary as string | null) ?? null,
        component: (report?.component as string | null) ?? null,
        rootCause: typeof s2.rootCause === 'string' ? s2.rootCause : null,
        suggestedFix: typeof s2.suggestedFix === 'string' ? s2.suggestedFix : null,
      },
      prUrl: attempt.pr_url!,
      branch: gate.branch,
      headSha: gate.headSha,
      findings: screened.kept,
      scrub: (t) => sanitizeForLLM(t).text,
      local: true,
    });

    // The claim: one fix_events row per (fix, head); a second CLI gets 409.
    const { error: claimErr } = await db.from('fix_events').insert({
      fix_attempt_id: attempt.id,
      project_id: attempt.project_id,
      kind: 'followup',
      status: 'pending',
      label: 'Local follow-up started',
      detail: `${prompt.findingsSent} Opus finding(s) sent to a local agent (mushi work), round ${gate.round}${droppedCount > 0 ? `; ${droppedCount} left out by the safety screen` : ''}.`,
      at: new Date().toISOString(),
      dedupe_key: localFollowupDedupe(attempt.id, gate.headSha),
      payload: { local: true, headSha: gate.headSha, round: gate.round, findings: prompt.findingsSent, dropped: droppedCount },
    });
    if (claimErr) {
      if (claimErr.code === '23505') {
        return c.json({ ok: false, error: { code: 'ALREADY_FOLLOWED_UP', message: `A follow-up already ran for ${gate.headSha.slice(0, 7)}.` } }, 409);
      }
      return dbError(c, claimErr);
    }
    llog.info('local-followup.claimed', { fixId: attempt.id, projectId: attempt.project_id, round: gate.round, findings: prompt.findingsSent, dropped: droppedCount });
    return c.json({
      ok: true,
      data: {
        fixId: attempt.id,
        prUrl: attempt.pr_url,
        branch: gate.branch,
        headSha: gate.headSha,
        round: gate.round,
        findingsSent: prompt.findingsSent,
        findingsDropped: droppedCount,
        prompt: prompt.text,
      },
    });
  });

  app.post('/v1/admin/fixes/:id/local-followup/done', adminOrApiKey({ scope: 'mcp:write' }), async (c: Ctx) => {
    const db = getServiceClient();
    const found = await writableFix(c, db);
    if ('response' in found) return found.response;
    const { attempt } = found;
    const body = (await c.req.json().catch(() => null)) as { headBefore?: unknown; headAfter?: unknown; note?: unknown } | null;
    const headBefore = typeof body?.headBefore === 'string' && SHA_RE.test(body.headBefore) ? body.headBefore : null;
    const headAfter = typeof body?.headAfter === 'string' && SHA_RE.test(body.headAfter) ? body.headAfter : null;
    if (!headBefore) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'headBefore must be the 40-character commit the round started from.' } }, 400);
    const heads = await roundHeadsFor(db, [attempt.id]);
    if ('error' in heads) return c.json({ ok: false, error: { code: 'DB_ERROR', message: heads.error } }, 500);
    if (!(heads.get(attempt.id) ?? []).includes(headBefore)) {
      return c.json({ ok: false, error: { code: 'NO_ROUND', message: `No local follow-up was started for ${headBefore.slice(0, 7)}.` } }, 409);
    }
    const note = typeof body?.note === 'string' ? sanitizeForLLM(body.note).text.slice(0, 300) : '';
    const pushed = !!headAfter && headAfter !== headBefore;
    const { error } = await db.from('fix_events').insert({
      fix_attempt_id: attempt.id,
      project_id: attempt.project_id,
      kind: 'followup',
      status: pushed ? 'ok' : 'fail',
      label: pushed ? 'Local follow-up pushed' : 'Local follow-up made no change',
      detail: pushed
        ? `New commit ${headAfter!.slice(0, 7)} on the pull request; Opus reviews it again.`
        : note ? `The local agent pushed nothing: ${note}` : 'The local agent pushed nothing.',
      at: new Date().toISOString(),
      dedupe_key: `local-followup-done:${attempt.id}:${headBefore}`,
      payload: { local: true, headBefore, headAfter },
    });
    if (error && error.code !== '23505') return dbError(c, error);
    let review: 'queued' | 'not_queued' | 'not_pushed' = 'not_pushed';
    if (pushed) {
      // The pull_request.synchronize webhook re-queues the review too, but it
      // may be missing on the repo: queue it here as well.
      const res = await enqueueFixReview(db, { fixAttemptId: attempt.id, projectId: attempt.project_id, reportId: attempt.report_id, prUrl: attempt.pr_url }, { force: true });
      review = res.queued ? 'queued' : 'not_queued';
    }
    return c.json({ ok: true, data: { pushed, review } });
  });
}
