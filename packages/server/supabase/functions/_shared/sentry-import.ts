/**
 * FILE: sentry-import.ts
 * PURPOSE: Pull existing Sentry issues into Mushi on demand.
 *
 * The webhook only sees issues that fire after it is wired up; an issue that
 * already exists never fires again. This walks the operator's chosen issues
 * (by id / short id, or a Sentry search in the configured project), fetches
 * each issue's latest event, and hands both to `ingestSentryError` — so
 * dedupe, `report_external_issues` linking and classification behave exactly
 * as they do for a webhook delivery.
 *
 * Tenant boundary: an org-level Sentry token can read every project in the
 * org. Imports are confined to the Mushi project's configured
 * `sentry_project_slug`; an issue from any other Sentry project is refused.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ingestSentryError, type SentryIngestResult } from './sentry-ingest.ts';
import {
  getLatestSentryEvent,
  getSentryIssue,
  restEventToWebhookEvent,
  searchSentryIssues,
  SentryApiError,
  type FetchLike,
  type SentryRestEvent,
  type SentryRestIssue,
} from './sentry-api.ts';
import { extractFramePaths } from './sentry-frames.ts';

export const SENTRY_IMPORT_MAX = 10;
export const SENTRY_IMPORT_DEFAULT_QUERY = 'is:unresolved';

export interface SentryImportRequest {
  issueIds?: string[];
  query?: string;
  limit?: number;
}

export type SentryImportRequestError = { code: 'BAD_REQUEST'; message: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Validate the route body. Returns the normalized request or an error. */
export function parseSentryImportRequest(
  body: unknown,
): { ok: true; value: Required<Pick<SentryImportRequest, 'limit'>> & SentryImportRequest } | { ok: false; error: SentryImportRequestError } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const bad = (message: string) => ({ ok: false as const, error: { code: 'BAD_REQUEST' as const, message } });

  let issueIds: string[] | undefined;
  if (b.issueIds !== undefined) {
    if (!Array.isArray(b.issueIds) || b.issueIds.some((v) => typeof v !== 'string' || !ID_RE.test(v.trim()))) {
      return bad('issueIds must be an array of Sentry issue ids or short ids (e.g. "4501" or "WEB-12").');
    }
    issueIds = [...new Set((b.issueIds as string[]).map((v) => v.trim()))];
    if (issueIds.length > SENTRY_IMPORT_MAX) return bad(`At most ${SENTRY_IMPORT_MAX} issueIds per import.`);
  }
  let query: string | undefined;
  if (b.query !== undefined) {
    if (typeof b.query !== 'string' || b.query.length > 200) return bad('query must be a string of at most 200 characters.');
    query = b.query.trim() || undefined;
  }
  let limit = 5;
  if (b.limit !== undefined) {
    const n = Number(b.limit);
    if (!Number.isInteger(n) || n < 1 || n > SENTRY_IMPORT_MAX) return bad(`limit must be an integer from 1 to ${SENTRY_IMPORT_MAX}.`);
    limit = n;
  }
  if (issueIds?.length && query) return bad('Pass issueIds or query, not both.');
  return { ok: true, value: { issueIds: issueIds?.length ? issueIds : undefined, query, limit } };
}

export interface SentryImportItem {
  input: string;
  issueId: string | null;
  shortId: string | null;
  outcome: SentryIngestResult['outcome'] | 'error';
  reportId: string | null;
  error?: string;
}

export interface SentryImportResult {
  items: SentryImportItem[];
  /** Repo-relative paths from the imported stacks, for targeted indexing. */
  framePaths: string[];
}

export async function importSentryIssues(
  db: SupabaseClient,
  input: {
    projectId: string;
    request: SentryImportRequest & { limit: number };
    sentry: { token: string; orgSlug: string; projectSlug: string };
    triggerClassification: (reportId: string, projectId: string) => void;
    fetchImpl?: FetchLike;
  },
): Promise<SentryImportResult> {
  const { projectId, request, sentry, fetchImpl } = input;
  const items: SentryImportItem[] = [];
  const framePaths = new Set<string>();

  // 1. Resolve every input to an issue, then dedupe on the numeric id so two
  //    spellings of one issue (id + short id) import once.
  const candidates: Array<{ input: string; issue: SentryRestIssue }> = [];
  if (request.issueIds?.length) {
    for (const raw of request.issueIds) {
      try {
        candidates.push({ input: raw, issue: await getSentryIssue(sentry.token, sentry.orgSlug, raw, fetchImpl) });
      } catch (err) {
        items.push({ input: raw, issueId: null, shortId: null, outcome: 'error', reportId: null, error: describe(err) });
      }
    }
  } else {
    const query = request.query ?? SENTRY_IMPORT_DEFAULT_QUERY;
    const found = await searchSentryIssues(sentry.token, sentry.orgSlug, sentry.projectSlug, query, request.limit, fetchImpl);
    for (const issue of found.slice(0, request.limit)) candidates.push({ input: issue.shortId ?? issue.id, issue });
  }

  const seen = new Set<string>();
  for (const { input: raw, issue } of candidates) {
    const issueId = String(issue.id);
    if (seen.has(issueId)) continue;
    seen.add(issueId);
    const shortId = issue.shortId ?? null;

    const issueProject = issue.project?.slug ?? null;
    if (issueProject !== sentry.projectSlug) {
      items.push({
        input: raw,
        issueId,
        shortId,
        outcome: 'error',
        reportId: null,
        error: `Issue belongs to Sentry project "${issueProject ?? 'unknown'}", not "${sentry.projectSlug}".`,
      });
      continue;
    }

    // 2. Sequential on purpose: ingest links before it classifies, and two
    //    concurrent ingests of one issue could both insert a report.
    try {
      let event: SentryRestEvent | null = null;
      try {
        event = await getLatestSentryEvent(sentry.token, sentry.orgSlug, issueId, fetchImpl);
      } catch (err) {
        // An issue with no retained event still imports from its summary.
        if (!(err instanceof SentryApiError && err.status === 404)) throw err;
      }
      const webhookEvent = restEventToWebhookEvent(issue, event);
      for (const p of extractFramePaths(webhookEvent.exception?.values)) framePaths.add(p);
      const result = await ingestSentryError(db, {
        projectId,
        event: webhookEvent,
        issue: {
          id: issueId,
          shortId: shortId ?? undefined,
          title: issue.title,
          culprit: issue.culprit,
          level: issue.level,
          permalink: issue.permalink,
          platform: issue.platform,
        },
        triggerClassification: input.triggerClassification,
        intake: 'import',
      });
      items.push({ input: raw, issueId, shortId, outcome: result.outcome, reportId: result.reportId ?? null });
    } catch (err) {
      items.push({ input: raw, issueId, shortId, outcome: 'error', reportId: null, error: describe(err) });
    }
  }

  return { items, framePaths: [...framePaths].slice(0, 25) };
}

function describe(err: unknown): string {
  if (err instanceof SentryApiError) {
    if (err.status === 401 || err.status === 403) {
      return `Sentry refused the token (${err.status}). It needs event:read and project:read.`;
    }
    if (err.status === 404) return 'Sentry issue not found in this organization.';
    return err.message.slice(0, 200);
  }
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}
