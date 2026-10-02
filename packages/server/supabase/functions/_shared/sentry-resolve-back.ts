/**
 * FILE: sentry-resolve-back.ts
 * PURPOSE: Close the Sentry side of the loop for reports that came FROM
 *          Sentry (`report_external_issues.system = 'sentry'`).
 *
 * Two mechanisms, because either alone can miss:
 *   1. `Fixes <SHORT-ID>` in the fix commit message. Sentry's GitHub
 *      integration resolves the issue when that commit lands. It has to be
 *      in a commit, not the PR body: repos that squash-merge with
 *      COMMIT_MESSAGES only carry commit messages into the merge commit.
 *   2. On merge, `finalizeFixMerge` resolves each linked issue through the
 *      Sentry API (resolvedInNextRelease, else resolved) and comments the PR
 *      link. This also covers fixes opened by cloud agents, whose commits
 *      Mushi does not write.
 *
 * Failures are never silent: each outcome is a `fix_events` row on the fix
 * attempt (the report timeline's fix lane), and a failed resolve logs at
 * error. `resolved_at` is stamped only after Sentry answered 2xx.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import {
  commentOnSentryIssue,
  getSentryIssue,
  resolveSentryIssue,
  type FetchLike,
} from './sentry-api.ts';

const log = rootLog.child('sentry-resolve-back');

export interface SentryCredentials {
  token: string;
  orgSlug: string;
}

/** Sentry token + org for a project (project → org default → env), or null. */
export async function loadSentryCredentials(
  db: SupabaseClient,
  projectId: string,
): Promise<SentryCredentials | null> {
  const { resolveAndDereferencePlatformSettings } = await import('./integration-settings.ts');
  const { settings } = await resolveAndDereferencePlatformSettings(db, projectId);
  const token = settings.sentry_auth_token_ref ?? null;
  const orgSlug = settings.sentry_org_slug ?? null;
  return token && orgSlug ? { token, orgSlug } : null;
}

const SHORT_ID_RE = /^[A-Z0-9][A-Z0-9_-]*-[A-Z0-9]+$/i;

/** `Fixes X` lines for a commit message, one per short id. */
export function sentryFixesTrailers(shortIds: readonly string[]): string[] {
  return [...new Set(shortIds.filter((s) => SHORT_ID_RE.test(s)))].map((s) => `Fixes ${s}`);
}

interface SentryLinkRow {
  id: string;
  external_id: string;
}

async function loadSentryLinks(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  onlyOpen: boolean,
): Promise<SentryLinkRow[]> {
  let q = db
    .from('report_external_issues')
    .select('id, external_id')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .eq('system', 'sentry');
  if (onlyOpen) q = q.is('resolved_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`report_external_issues lookup failed: ${error.message}`);
  return (data ?? []) as SentryLinkRow[];
}

/**
 * Sentry short ids for a report's linked issues, for the commit trailer.
 * Uses the stored `custom_metadata.sentryShortId`; for links without one
 * (event-alert ingests carry no short id), asks Sentry within `timeoutMs`.
 * Never throws: on any failure the PR opens without the trailer.
 */
export async function sentryShortIdsForReport(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  deps: {
    credentials?: (db: SupabaseClient, projectId: string) => Promise<SentryCredentials | null>;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<string[]> {
  try {
    const links = await loadSentryLinks(db, projectId, reportId, false);
    if (links.length === 0) return [];
    const { data: report } = await db
      .from('reports')
      .select('custom_metadata')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .maybeSingle();
    const meta = (report?.custom_metadata ?? {}) as { sentryIssueId?: unknown; sentryShortId?: unknown };
    const out: string[] = [];
    const unknownIds: string[] = [];
    for (const link of links) {
      if (typeof meta.sentryShortId === 'string' && String(meta.sentryIssueId ?? '') === link.external_id) {
        out.push(meta.sentryShortId);
      } else {
        unknownIds.push(link.external_id);
      }
    }
    if (unknownIds.length > 0) {
      const creds = await (deps.credentials ?? loadSentryCredentials)(db, projectId);
      if (creds) {
        const lookups = Promise.all(
          unknownIds.slice(0, 5).map((id) =>
            getSentryIssue(creds.token, creds.orgSlug, id, deps.fetchImpl)
              .then((issue) => issue.shortId ?? null)
              .catch(() => null),
          ),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null[]>((resolve) => {
          timer = setTimeout(() => resolve([]), deps.timeoutMs ?? 4_000);
        });
        try {
          for (const s of await Promise.race([lookups, timeout])) if (s) out.push(s);
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return [...new Set(out.filter((s) => SHORT_ID_RE.test(s)))];
  } catch (err) {
    log.warn('Sentry short-id lookup failed; opening PR without Fixes trailer', {
      reportId,
      err: String(err).slice(0, 200),
    });
    return [];
  }
}

export interface SentryResolveBackResult {
  resolved: string[];
  failed: Array<{ issueId: string; error: string }>;
  skipped?: 'no_links' | 'no_credentials';
}

async function recordFixEvent(
  db: SupabaseClient,
  row: {
    fixAttemptId: string;
    projectId: string;
    status: 'ok' | 'fail';
    label: string;
    detail: string;
    dedupeKey: string | null;
  },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fixAttemptId,
    project_id: row.projectId,
    kind: 'pr_state_changed',
    status: row.status,
    label: row.label,
    detail: row.detail,
    at: new Date().toISOString(),
    dedupe_key: row.dedupeKey,
  });
  // 23505 = this success was already recorded by an earlier finalize.
  if (error && error.code !== '23505') {
    log.error('fix_events insert failed for Sentry resolve-back', {
      fixAttemptId: row.fixAttemptId,
      err: error.message,
    });
  }
}

/**
 * Resolve every still-open Sentry issue linked to the report. Idempotent:
 * already-resolved links are skipped, and a link is only marked resolved
 * after Sentry accepted the update.
 */
export async function resolveLinkedSentryIssues(
  db: SupabaseClient,
  input: {
    projectId: string;
    reportId: string;
    fixAttemptId: string;
    prUrl: string;
  },
  deps: {
    credentials?: (db: SupabaseClient, projectId: string) => Promise<SentryCredentials | null>;
    fetchImpl?: FetchLike;
  } = {},
): Promise<SentryResolveBackResult> {
  const { projectId, reportId, fixAttemptId, prUrl } = input;
  // Only numeric Sentry issue ids (what ingest links). Any other `sentry`
  // link shape is left to resolveExternalIssue.
  const links = (await loadSentryLinks(db, projectId, reportId, true)).filter((l) =>
    /^\d+$/.test(l.external_id),
  );
  if (links.length === 0) return { resolved: [], failed: [], skipped: 'no_links' };

  const creds = await (deps.credentials ?? loadSentryCredentials)(db, projectId);
  if (!creds) {
    const detail = 'No Sentry auth token / org slug for this project. Add them in Integrations → Sentry, then resolve the issue in Sentry by hand.';
    log.warn('Sentry resolve-back skipped: no credentials', { projectId, reportId, issues: links.length });
    for (const link of links) {
      await recordFixEvent(db, {
        fixAttemptId,
        projectId,
        status: 'fail',
        label: `Sentry issue ${link.external_id} not resolved`,
        detail,
        dedupeKey: null,
      });
    }
    return {
      resolved: [],
      failed: links.map((l) => ({ issueId: l.external_id, error: 'no_credentials' })),
      skipped: 'no_credentials',
    };
  }

  const result: SentryResolveBackResult = { resolved: [], failed: [] };
  for (const link of links) {
    try {
      const { status } = await resolveSentryIssue(creds.token, creds.orgSlug, link.external_id, deps.fetchImpl);
      const { error: stampErr } = await db
        .from('report_external_issues')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', link.id);
      if (stampErr) {
        log.error('Sentry issue resolved but resolved_at stamp failed', { linkId: link.id, err: stampErr.message });
      }
      try {
        await commentOnSentryIssue(
          creds.token,
          creds.orgSlug,
          link.external_id,
          `Resolved by Mushi: the fix PR was merged — ${prUrl}`,
          deps.fetchImpl,
        );
      } catch (err) {
        log.warn('Sentry comment failed (issue is resolved)', { issueId: link.external_id, err: String(err).slice(0, 200) });
      }
      await recordFixEvent(db, {
        fixAttemptId,
        projectId,
        status: 'ok',
        label: `Sentry issue ${link.external_id} ${status === 'resolved' ? 'resolved' : 'resolved in next release'}`,
        detail: `Resolved through the Sentry API after ${prUrl} merged.`,
        dedupeKey: `sentry_resolve:${link.external_id}`,
      });
      result.resolved.push(link.external_id);
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err).slice(0, 300);
      log.error('Sentry resolve-back failed', { projectId, reportId, issueId: link.external_id, err: message });
      await recordFixEvent(db, {
        fixAttemptId,
        projectId,
        status: 'fail',
        label: `Sentry issue ${link.external_id} not resolved`,
        detail: `${message}. The token needs event:write; resolve it in Sentry by hand.`,
        dedupeKey: null,
      });
      result.failed.push({ issueId: link.external_id, error: message });
    }
  }
  return result;
}
