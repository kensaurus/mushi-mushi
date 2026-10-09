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
 * org. Imports are confined to the Mushi project's configured Sentry projects
 * (`sentry_project_slug` plus `sentry_extra_project_slugs`); an issue from any
 * other Sentry project is refused.
 *
 * Backlog import: `sinceDays` narrows a search to issues seen in the last N
 * days, and `cursor` walks the result 10 at a time (the response carries
 * `nextCursor` until the last page). Re-running is safe: an issue already
 * linked to a report answers `linked` and creates nothing.
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
export const SENTRY_IMPORT_MAX_DAYS = 90;

/** Pages of SENTRY_IMPORT_MAX one auto-import run reads per Sentry project. */
export const SENTRY_AUTO_IMPORT_MAX_PAGES = 3;

/**
 * The search for an auto-import run (project_settings.sentry_auto_import):
 * unresolved issues first seen since the last run, plus a 15-minute overlap
 * so a slow run cannot open a gap. Re-importing is a no-op ("linked"), so the
 * overlap costs nothing. The first run, or one after a long stall, looks
 * back 24 hours; older issues are the console's "Import existing" job.
 */
export function sentryAutoImportQuery(lastRunAt: string | null, now: Date): string {
  const DAY_MIN = 24 * 60;
  const last = lastRunAt ? Date.parse(lastRunAt) : NaN;
  const minutes = Number.isFinite(last)
    ? Math.min(DAY_MIN, Math.max(15, Math.ceil((now.getTime() - last) / 60_000) + 15))
    : DAY_MIN;
  return `${SENTRY_IMPORT_DEFAULT_QUERY} firstSeen:-${minutes}m`;
}

export interface SentryImportRequest {
  issueIds?: string[];
  query?: string;
  limit?: number;
  /** Only issues seen in the last N days (1-90). Search mode only. */
  sinceDays?: number;
  /** `nextCursor` from the previous page. Search mode only. */
  cursor?: string;
  /** Which configured Sentry project to search (default: the primary). */
  sentryProject?: string;
}

export type SentryImportRequestError = { code: 'BAD_REQUEST'; message: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const CURSOR_RE = /^[0-9][0-9.:-]{0,63}$/;

/** Primary slug first, then the extras; trimmed, valid, deduped. */
export function allowedSentryProjectSlugs(primary: string | null | undefined, extra: unknown): string[] {
  const all = [primary, ...(Array.isArray(extra) ? extra : [])]
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => SLUG_RE.test(s));
  return [...new Set(all)];
}

/** The Sentry search a request runs: which project, with which query. */
export function resolveSentrySearch(
  request: Pick<SentryImportRequest, 'query' | 'sinceDays' | 'sentryProject'>,
  allowedSlugs: string[],
): { ok: true; projectSlug: string; query: string } | { ok: false; error: SentryImportRequestError } {
  const projectSlug = request.sentryProject ?? allowedSlugs[0];
  if (!projectSlug || !allowedSlugs.includes(projectSlug)) {
    return {
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: `sentryProject must be one of this project's Sentry projects: ${allowedSlugs.join(', ') || 'none configured'}.`,
      },
    };
  }
  const base = request.query ?? SENTRY_IMPORT_DEFAULT_QUERY;
  const query = request.sinceDays ? `${base} lastSeen:-${request.sinceDays}d` : base;
  return { ok: true, projectSlug, query };
}

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
  let sinceDays: number | undefined;
  if (b.sinceDays !== undefined) {
    const n = Number(b.sinceDays);
    if (!Number.isInteger(n) || n < 1 || n > SENTRY_IMPORT_MAX_DAYS) {
      return bad(`sinceDays must be an integer from 1 to ${SENTRY_IMPORT_MAX_DAYS}.`);
    }
    sinceDays = n;
  }
  let cursor: string | undefined;
  if (b.cursor !== undefined && b.cursor !== null) {
    if (typeof b.cursor !== 'string' || !CURSOR_RE.test(b.cursor)) return bad('cursor must be the nextCursor from a previous import.');
    cursor = b.cursor;
  }
  let sentryProject: string | undefined;
  if (b.sentryProject !== undefined) {
    if (typeof b.sentryProject !== 'string' || !SLUG_RE.test(b.sentryProject.trim())) {
      return bad('sentryProject must be a Sentry project slug.');
    }
    sentryProject = b.sentryProject.trim();
  }
  if (issueIds?.length && query) return bad('Pass issueIds or query, not both.');
  if (issueIds?.length && (sinceDays || cursor || sentryProject)) {
    return bad('sinceDays, cursor and sentryProject apply to a search, not to issueIds.');
  }
  return {
    ok: true,
    value: { issueIds: issueIds?.length ? issueIds : undefined, query, limit, sinceDays, cursor, sentryProject },
  };
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
  /** The Sentry project a search ran in (null for an issueIds import). */
  sentryProject: string | null;
  /** Pass back as `cursor` to import the next page; null when done. */
  nextCursor: string | null;
}

export async function importSentryIssues(
  db: SupabaseClient,
  input: {
    projectId: string;
    request: SentryImportRequest & { limit: number };
    /** `projectSlugs` from allowedSentryProjectSlugs: primary first. */
    sentry: { token: string; orgSlug: string; projectSlugs: string[] };
    triggerClassification: (reportId: string, projectId: string) => void;
    fetchImpl?: FetchLike;
  },
): Promise<SentryImportResult> {
  const { projectId, request, sentry, fetchImpl } = input;
  const items: SentryImportItem[] = [];
  const framePaths = new Set<string>();
  const allowed = new Set(sentry.projectSlugs);
  let searchedProject: string | null = null;
  let nextCursor: string | null = null;

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
    const search = resolveSentrySearch(request, sentry.projectSlugs);
    if (!search.ok) throw new Error(search.error.message);
    searchedProject = search.projectSlug;
    const page = await searchSentryIssues(
      sentry.token,
      sentry.orgSlug,
      search.projectSlug,
      { query: search.query, limit: request.limit, cursor: request.cursor },
      fetchImpl,
    );
    nextCursor = page.nextCursor;
    for (const issue of page.issues.slice(0, request.limit)) candidates.push({ input: issue.shortId ?? issue.id, issue });
  }

  const seen = new Set<string>();
  for (const { input: raw, issue } of candidates) {
    const issueId = String(issue.id);
    if (seen.has(issueId)) continue;
    seen.add(issueId);
    const shortId = issue.shortId ?? null;

    const issueProject = issue.project?.slug ?? null;
    if (!issueProject || !allowed.has(issueProject)) {
      items.push({
        input: raw,
        issueId,
        shortId,
        outcome: 'error',
        reportId: null,
        error: `Issue belongs to Sentry project "${issueProject ?? 'unknown'}", not ${sentry.projectSlugs.map((s) => `"${s}"`).join(' or ')}.`,
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

  return { items, framePaths: [...framePaths].slice(0, 25), sentryProject: searchedProject, nextCursor };
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
