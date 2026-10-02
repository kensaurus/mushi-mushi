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
  PR_CLOSED_UNMERGED_LABEL,
  preFixReportStatus,
  shouldRevertReportOnPrClose,
} from './fix-loop-status.ts';
import { resolveLinkedSentryIssues } from './sentry-resolve-back.ts';
import { keepAlive } from './background.ts';

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
  opts?: { mergeMethod?: MergeMethod; commitTitle?: string },
): Promise<{ merged: boolean; alreadyMerged: boolean; sha?: string; message?: string }> {
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
      }),
    },
  );

  if (res.status === 405 || res.status === 422) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    const msg = body.message ?? `GitHub merge rejected (${res.status})`;
    if (/already been merged|not mergeable/i.test(msg)) {
      return { merged: true, alreadyMerged: true, message: msg };
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

/** Idempotent post-merge bookkeeping shared by console merge + GitHub webhooks. */
export async function finalizeFixMerge(
  db: Db,
  attempt: FixAttemptMergeRow,
  meta: {
    prUrl: string;
    prNumber?: number | null;
    repository?: string | null;
    actorUserId?: string | null;
  },
): Promise<{ justMerged: boolean; reportStatus: string | null }> {
  const now = new Date().toISOString();

  const { data: mergedRow } = await db
    .from('fix_attempts')
    .update({ merged_at: now, pr_state: 'merged' })
    .eq('id', attempt.id)
    .is('merged_at', null)
    .select('id')
    .maybeSingle();
  const justMerged = !!mergedRow;

  if (!justMerged && attempt.merged_at) {
    await db.from('fix_attempts').update({ pr_state: 'merged' }).eq('id', attempt.id);
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

export function parsePrRepoRef(prUrl: string | null | undefined): GithubRepoRef | null {
  if (!prUrl) return null;
  const base = prUrl.split('/pull/')[0];
  return parseGithubRepoUrl(base);
}
