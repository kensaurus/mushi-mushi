/**
 * Console-initiated and webhook-confirmed PR merge finalization.
 * Keeps fix_attempts, reports, reporter notifications, and billing in sync
 * when a Mushi draft PR lands on the default branch.
 */

import type { getServiceClient } from './db.ts';
import {
  fetchPullRequest,
  markPullRequestReady,
  parseGithubRepoUrl,
  type GithubRepoRef,
} from './github.ts';
import { log } from './logger.ts';
import { dispatchPluginEventDetached } from './plugins.ts';
import { notifyTeamFixEvent } from './team-notify.ts';
import { notifyReportStatusTransition } from './report-status-notify.ts';
import { resolveExternalIssue } from './integrations.ts';
import { emitProductEvent } from './product-events.ts';
import {
  decideFixingReport,
  FIXING_GRACE_MS,
  PR_CLOSED_UNMERGED_LABEL,
  preFixReportStatus,
  shouldRevertReportOnPrClose,
  type FixingAttemptView,
} from './fix-loop-status.ts';
import { resolveLinkedSentryIssues } from './sentry-resolve-back.ts';
import { keepAlive } from './background.ts';
import { closeReportPipelines } from './report-pipelines-close.ts';

type Db = ReturnType<typeof getServiceClient>;

export interface FixAttemptMergeRow {
  id: string;
  project_id: string;
  report_id: string;
  agent: string | null;
  branch: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  pr_number: number | null;
  merged_at?: string | null;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export async function mergeGithubPullRequest(
  token: string,
  ref: GithubRepoRef,
  pullNumber: number,
  opts?: { mergeMethod?: MergeMethod; commitTitle?: string; commitMessage?: string },
): Promise<{ merged: boolean; alreadyMerged: boolean; sha?: string; message?: string; mergedAt?: string | null }> {
  const pr = await fetchPullRequest(token, ref, pullNumber);
  if (pr?.draft) {
    const ready = await markPullRequestReady(token, ref, pullNumber);
    if (!ready.ok) {
      return {
        merged: false,
        alreadyMerged: false,
        message: ready.message ?? 'Pull request is still a draft',
      };
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}/merge`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merge_method: opts?.mergeMethod ?? 'squash',
        commit_title: opts?.commitTitle,
        commit_message: opts?.commitMessage,
      }),
    },
  );

  if (res.status === 405 || res.status === 422) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    const msg = body.message ?? `GitHub merge rejected (${res.status})`;
    // "not mergeable" is also GitHub's answer for conflicts and blocked or
    // failing required checks, so the message cannot say the PR merged. Ask
    // the PR itself: only `merged === true` lets the caller finalize the fix
    // (mark the report Fixed, meter fixes_succeeded).
    const after = await fetchPullRequest(token, ref, pullNumber).catch(() => undefined);
    const alreadyMerged = after === undefined
      ? /already been merged/i.test(msg)
      : after?.merged === true;
    if (alreadyMerged) {
      // When GitHub actually merged it earlier, keep that time (finalizeFixMerge).
      return { merged: true, alreadyMerged: true, message: msg, mergedAt: after?.mergedAt ?? pr?.mergedAt ?? null };
    }
    return { merged: false, alreadyMerged: false, message: msg };
  }

  if (res.status === 409) {
    return {
      merged: false,
      alreadyMerged: false,
      message: 'Merge conflict — resolve on GitHub first',
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `GitHub merge failed: ${res.status}`);
  }

  const body = await res.json() as { merged?: boolean; sha?: string; message?: string };
  return {
    merged: body.merged !== false,
    alreadyMerged: false,
    sha: body.sha,
    message: body.message,
  };
}

/**
 * When the PR merged: GitHub's `merged_at` when the caller has it and it is
 * a real past time, else `now` (the moment Mushi noticed). Without the GitHub
 * App, a merge is noticed by the ci-sync poll minutes later, and
 * report-deploy-live places deploy runs before or after `fix_attempts.merged_at`,
 * so the noticed-at time would misplace a run taken inside that lag.
 */
export function resolveMergedAt(githubMergedAt: string | null | undefined, now: Date): string {
  const t = githubMergedAt ? Date.parse(githubMergedAt) : NaN;
  if (Number.isNaN(t) || t > now.getTime()) return now.toISOString();
  return new Date(t).toISOString();
}

/** Idempotent post-merge bookkeeping shared by console merge + GitHub webhooks. */
export async function finalizeFixMerge(
  db: Db,
  attempt: FixAttemptMergeRow,
  meta: {
    prUrl: string;
    prNumber?: number | null;
    repository?: string | null;
    actorUserId?: string | null;
    /** GitHub's `merged_at` for the PR, when the caller read it. */
    mergedAt?: string | null;
  },
): Promise<{ justMerged: boolean; reportStatus: string | null }> {
  const nowDate = new Date();
  const now = nowDate.toISOString();

  const { data: mergedRow } = await db
    .from('fix_attempts')
    .update({ merged_at: resolveMergedAt(meta.mergedAt, nowDate), pr_state: 'merged' })
    .eq('id', attempt.id)
    .is('merged_at', null)
    .select('id')
    .maybeSingle();
  const justMerged = !!mergedRow;

  if (!justMerged && attempt.merged_at) {
    await db.from('fix_attempts').update({ pr_state: 'merged' }).eq('id', attempt.id);
  }

  // A cloud agent's PR attached while the agent was still working leaves its
  // attempt open (agent-adapters attachPendingPr) until the agent finishes.
  // Merged first, the attempt is done: close it, or agent-status-poll keeps
  // polling it and its 24 h expiry reports a merged fix as failed.
  const { error: openCloseErr } = await db
    .from('fix_attempts')
    .update({ status: 'completed', completed_at: now })
    .eq('id', attempt.id)
    .in('status', ['running', 'queued', 'dispatched', 'pending']);
  if (openCloseErr) {
    log.error('closing the still-open attempt of a merged PR failed', { fixAttemptId: attempt.id, err: openCloseErr.message });
  } else {
    await db
      .from('fix_dispatch_jobs')
      .update({ status: 'completed', pr_url: meta.prUrl, finished_at: now })
      .eq('fix_attempt_id', attempt.id)
      .in('status', ['queued', 'running']);
  }

  const { data: report } = await db
    .from('reports')
    .select('id, status, reporter_token_hash')
    .eq('id', attempt.report_id)
    .eq('project_id', attempt.project_id)
    .maybeSingle();

  let reportStatus: string | null = report?.status ?? null;
  const previousStatus = report?.status ?? null;

  let resolveExternal = false;
  if (report && report.status !== 'fixed' && report.status !== 'dismissed') {
    const { error } = await db
      .from('reports')
      .update({ status: 'fixed', fixed_at: now, updated_at: now })
      .eq('id', attempt.report_id)
      .eq('project_id', attempt.project_id);
    if (!error) {
      reportStatus = 'fixed';
      resolveExternal = true;
    }
  }

  // External trackers, in the background so a GitHub merge webhook still
  // answers inside its 10s budget. Sentry links go first, through the Sentry
  // API: a link is only marked resolved once Sentry accepted it, and the
  // outcome lands as a fix_event (sentry-resolve-back.ts). resolveExternalIssue
  // runs after it so it never stamps a Sentry link the API pass still owns.
  if (report) {
    void keepAlive(
      (async () => {
        try {
          await resolveLinkedSentryIssues(db as never, {
            projectId: attempt.project_id,
            reportId: attempt.report_id,
            fixAttemptId: attempt.id,
            prUrl: meta.prUrl,
          });
        } catch (e) {
          log.error('Sentry resolve-back crashed', { reportId: attempt.report_id, err: String(e) });
        }
        if (resolveExternal) {
          await resolveExternalIssue(attempt.report_id, attempt.project_id, db).catch((e: unknown) =>
            log.warn('resolveExternalIssue failed', { reportId: attempt.report_id, err: String(e) }),
          );
        }
      })(),
    );
  }

  // Handoff pipelines on the report end with it (they stayed "pending" after a merge).
  if (reportStatus === 'fixed' && previousStatus !== 'fixed') {
    closeReportPipelines(db as never, {
      reportId: attempt.report_id,
      projectId: attempt.project_id,
      reportStatus: 'fixed',
    }).catch((e: unknown) => log.warn('Closing the report pipelines failed', { reportId: attempt.report_id, err: String(e) }));
  }

  if (reportStatus === 'fixed' && previousStatus !== 'fixed' && report?.reporter_token_hash) {
    notifyReportStatusTransition(db, {
      projectId: attempt.project_id,
      reportId: attempt.report_id,
      reporterTokenHash: report.reporter_token_hash,
      previousStatus,
      newStatus: 'fixed',
    }).catch((e) => log.warn('Notification failed', { type: 'fixed', err: String(e) }));
  }

  if (reportStatus === 'fixed' && previousStatus !== 'fixed') {
    try {
      dispatchPluginEventDetached(db, attempt.project_id, 'report.status_changed', {
        report: { id: attempt.report_id, status: 'fixed' },
        previousStatus,
        actor: meta.actorUserId ? { kind: 'admin', userId: meta.actorUserId } : { kind: 'system' },
      }).catch((e) =>
        log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }),
      );
    } catch (e) {
      log.warn('Plugin dispatch failed (sync)', { event: 'report.status_changed', err: String(e) });
    }
  }

  if (justMerged) {
    // Company funnel (mushi-self): fire-and-forget, deduped per fix attempt.
    void emitProductEvent(db, {
      eventName: 'fix_merged',
      surface: 'server',
      properties: {
        project_id: attempt.project_id,
        report_id: attempt.report_id,
        pr_number: meta.prNumber ?? attempt.pr_number ?? null,
      },
      dedupKey: `fix_merged:${attempt.id}`,
    });

    dispatchPluginEventDetached(db, attempt.project_id, 'fix.applied', {
      report: { id: attempt.report_id },
      fix: {
        id: attempt.id,
        agent: attempt.agent,
        branch: attempt.branch,
        prUrl: meta.prUrl,
        prNumber: meta.prNumber ?? attempt.pr_number,
        commitSha: attempt.commit_sha,
        repository: meta.repository,
      },
    }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.applied', err: String(e) }));

    void notifyTeamFixEvent(db, attempt.project_id, attempt.report_id, 'fix_merged', {
      prUrl: meta.prUrl,
      prNumber: meta.prNumber ?? attempt.pr_number,
      branch: attempt.branch,
    }).catch((e) => log.warn('Team fix notification failed', { event: 'fix_merged', err: String(e) }));

    const { data: existing } = await db
      .from('usage_events')
      .select('id')
      .eq('project_id', attempt.project_id)
      .eq('event_name', 'fixes_succeeded')
      .contains('metadata', { fix_attempt_id: attempt.id })
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const { error: usageErr } = await db.from('usage_events').insert({
        project_id: attempt.project_id,
        event_name: 'fixes_succeeded',
        quantity: 1,
        metadata: {
          fix_attempt_id: attempt.id,
          pr_url: meta.prUrl,
          pr_number: meta.prNumber ?? attempt.pr_number,
          repository: meta.repository,
          source: 'console_merge',
        },
      });
      if (usageErr) {
        log.warn('usage_events fixes_succeeded insert failed (non-fatal)', {
          err: usageErr.message,
          fixAttemptId: attempt.id,
        });
      }
    }
  }

  return { justMerged, reportStatus };
}

/**
 * Idempotent bookkeeping for a fix PR that GitHub reports closed WITHOUT a
 * merge. Shared by ci-sync (poll / refresh-ci) and the pull_request.closed
 * webhook so the loop closes even when one of them never fires:
 *   - fix_attempts.pr_state → 'closed' (merged rows are never touched)
 *   - one `pr_state_changed` fix_event "PR closed without merge", which the
 *     report's unified timeline reads
 *   - the report leaves 'fixing' for its pre-fix status, unless a human moved
 *     it already or another attempt is still live
 */
export async function finalizeFixClosedUnmerged(
  db: Db,
  attempt: FixAttemptMergeRow,
  meta: { prNumber?: number | null; closedAt?: string | null; source: 'ci_sync' | 'webhook' },
): Promise<{ justClosed: boolean; reportStatus: string | null }> {
  const { data: closedRow, error: closeErr } = await db
    .from('fix_attempts')
    .update({ pr_state: 'closed', updated_at: new Date().toISOString() })
    .eq('id', attempt.id)
    .is('merged_at', null)
    .or('pr_state.is.null,pr_state.neq.closed')
    .select('id')
    .maybeSingle();
  if (closeErr) {
    log.error('fix_attempts pr_state=closed update failed', { fixAttemptId: attempt.id, err: closeErr.message });
  }
  const justClosed = !!closedRow;

  if (justClosed) {
    const prNumber = meta.prNumber ?? attempt.pr_number;
    const { error: eventErr } = await db.from('fix_events').insert({
      fix_attempt_id: attempt.id,
      project_id: attempt.project_id,
      kind: 'pr_state_changed',
      status: 'fail',
      label: PR_CLOSED_UNMERGED_LABEL,
      detail: prNumber ? `#${prNumber}` : null,
      at: meta.closedAt ?? new Date().toISOString(),
      dedupe_key: `pr_closed_unmerged:${attempt.id}:${meta.closedAt ?? 'unknown'}`,
      payload: { state: 'closed', merged: false, source: meta.source },
    });
    if (eventErr && eventErr.code !== '23505') {
      log.error('fix_events insert failed for closed PR', { fixAttemptId: attempt.id, err: eventErr.message });
    }
  }

  const { data: report } = await db
    .from('reports')
    .select('id, status, category, severity, stage1_classification, fix_pr_url')
    .eq('id', attempt.report_id)
    .eq('project_id', attempt.project_id)
    .maybeSingle();
  if (!report) return { justClosed, reportStatus: null };

  const { count: otherOpenAttempts } = await db
    .from('fix_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', attempt.report_id)
    .neq('id', attempt.id)
    .is('merged_at', null)
    .or('status.in.(queued,running),pr_state.in.(open,draft),and(pr_url.not.is.null,pr_state.is.null)');

  if (!shouldRevertReportOnPrClose({ reportStatus: report.status, otherOpenAttempts: otherOpenAttempts ?? 0 })) {
    return { justClosed, reportStatus: report.status };
  }

  const nextStatus = preFixReportStatus(report);
  const now = new Date().toISOString();
  const { data: reverted, error: revertErr } = await db
    .from('reports')
    .update({
      status: nextStatus,
      updated_at: now,
      ...(report.fix_pr_url && report.fix_pr_url === attempt.pr_url ? { fix_pr_url: null, fix_branch: null } : {}),
    })
    .eq('id', attempt.report_id)
    .eq('project_id', attempt.project_id)
    .eq('status', 'fixing')
    .select('id')
    .maybeSingle();
  if (revertErr) {
    log.error('report revert after closed PR failed', { reportId: attempt.report_id, err: revertErr.message });
    return { justClosed, reportStatus: report.status };
  }
  if (!reverted) return { justClosed, reportStatus: report.status };

  dispatchPluginEventDetached(db, attempt.project_id, 'report.status_changed', {
    report: { id: attempt.report_id, status: nextStatus },
    previousStatus: 'fixing',
    actor: { kind: 'system' },
  }).catch((e) => log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }));

  return { justClosed, reportStatus: nextStatus };
}

export interface FixingReconcileSummary {
  scanned: number;
  finalized: number;
  reverted: number;
  flagged: number;
}

const RECONCILE_PAGE = 50;
const RECONCILE_MAX_PAGES = 20;

/**
 * Second phase of the ci-sync sweep: no report stays in 'fixing' once
 * nothing behind it is alive (see decideFixingReport). Covers what the PR
 * lifecycle sync cannot see: a merge whose bookkeeping crashed, an attempt
 * that failed after an earlier PR was closed, a PR Mushi can never read.
 *
 * Pages through every past-grace 'fixing' report (up to 1,000 per tick). A
 * report it keeps (PR open, attempt live) does not change, so a single
 * oldest-first batch would re-read the same kept rows every tick and never
 * reach a stuck one behind them. Rows it acts on leave the result set, so the
 * next page starts after the rows kept so far.
 */
export async function reconcileStuckFixingReports(
  db: Db,
  now: Date = new Date(),
): Promise<FixingReconcileSummary> {
  const summary: FixingReconcileSummary = { scanned: 0, finalized: 0, reverted: 0, flagged: 0 };
  const cutoff = new Date(now.getTime() - FIXING_GRACE_MS).toISOString();
  let offset = 0;
  for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
    const { data: reports, error } = await db
      .from('reports')
      .select('id, project_id, status, updated_at, processing_error, category, severity, stage1_classification, fix_pr_url')
      .eq('status', 'fixing')
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RECONCILE_PAGE - 1);
    if (error) {
      log.warn('fixing-report scan failed', { err: error.message });
      break;
    }
    if (!reports?.length) break;
    const acted = await reconcileFixingPage(db, reports, now, summary);
    offset += reports.length - acted;
    if (reports.length < RECONCILE_PAGE) break;
  }
  return summary;
}

interface FixingReportRow {
  id: string;
  project_id: string;
  status: string | null;
  updated_at: string | null;
  processing_error: string | null;
  category: string | null;
  severity: string | null;
  stage1_classification: unknown;
  fix_pr_url: string | null;
}

/** Applies each report's verdict; returns how many rows left the 'fixing' scan. */
async function reconcileFixingPage(
  db: Db,
  reports: FixingReportRow[],
  now: Date,
  summary: FixingReconcileSummary,
): Promise<number> {
  let acted = 0;
  const { data: attemptRows } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, pr_state, merged_at, status, created_at, completed_at')
    .in('report_id', reports.map((r) => r.id));
  const byReport = new Map<string, Array<FixingAttemptView & FixAttemptMergeRow>>();
  for (const a of (attemptRows ?? []) as Array<FixingAttemptView & FixAttemptMergeRow>) {
    const list = byReport.get(a.report_id) ?? [];
    list.push(a);
    byReport.set(a.report_id, list);
  }

  for (const report of reports) {
    summary.scanned++;
    const attempts = (byReport.get(report.id) ?? []).filter((a) => a.project_id === report.project_id);
    const verdict = decideFixingReport({ report, attempts, now });

    if (verdict.action === 'finalize_merged') {
      const attempt = attempts.find((a) => a.id === verdict.attemptId);
      if (!attempt?.pr_url) continue;
      await finalizeFixMerge(db, attempt, { prUrl: attempt.pr_url, prNumber: attempt.pr_number });
      summary.finalized++;
      acted++;
    } else if (verdict.action === 'flag_unreadable') {
      // The updated_at trigger moves the row past the scan cutoff.
      await db
        .from('reports')
        .update({ processing_error: verdict.processingError })
        .eq('id', report.id)
        .eq('status', 'fixing');
      summary.flagged++;
      acted++;
    } else if (verdict.action === 'revert') {
      const nextStatus = preFixReportStatus(report);
      const { data: reverted } = await db
        .from('reports')
        .update({
          status: nextStatus,
          processing_error: verdict.processingError,
          ...(report.fix_pr_url ? { fix_pr_url: null, fix_branch: null } : {}),
        })
        .eq('id', report.id)
        .eq('project_id', report.project_id)
        .eq('status', 'fixing')
        .select('id')
        .maybeSingle();
      if (!reverted) continue;
      summary.reverted++;
      acted++;
      dispatchPluginEventDetached(db, report.project_id, 'report.status_changed', {
        report: { id: report.id, status: nextStatus },
        previousStatus: 'fixing',
        actor: { kind: 'system' },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }));
    }
  }
  return acted;
}

export function parsePrRepoRef(prUrl: string | null | undefined): GithubRepoRef | null {
  if (!prUrl) return null;
  const base = prUrl.split('/pull/')[0];
  return parseGithubRepoUrl(base);
}
