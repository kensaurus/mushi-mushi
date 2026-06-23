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
import { dispatchPluginEvent } from './plugins.ts';
import { notifyReportStatusTransition } from './report-status-notify.ts';
import { resolveExternalIssue } from './integrations.ts';

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

  if (report && report.status !== 'fixed' && report.status !== 'dismissed') {
    const { error } = await db
      .from('reports')
      .update({ status: 'fixed', fixed_at: now, updated_at: now })
      .eq('id', attempt.report_id)
      .eq('project_id', attempt.project_id);
    if (!error) {
      reportStatus = 'fixed';
      resolveExternalIssue(attempt.report_id, attempt.project_id, db).catch((e: unknown) =>
        log.warn('resolveExternalIssue failed', { reportId: attempt.report_id, err: String(e) }),
      );
    }
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
      void dispatchPluginEvent(db, attempt.project_id, 'report.status_changed', {
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
    void dispatchPluginEvent(db, attempt.project_id, 'fix.applied', {
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

export function parsePrRepoRef(prUrl: string | null | undefined): GithubRepoRef | null {
  if (!prUrl) return null;
  const base = prUrl.split('/pull/')[0];
  return parseGithubRepoUrl(base);
}
