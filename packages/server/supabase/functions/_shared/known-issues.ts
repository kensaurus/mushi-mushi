/**
 * FILE: known-issues.ts
 * PURPOSE: "Has anyone hit this?" — when a report carries a real error
 *          message, search for it once and attach the top results to the
 *          report, so the diagnosis can say "this is a known issue in X,
 *          fixed in Y" instead of starting from zero.
 *
 * Firecrawl's developer index (GitHub issues, merged PRs, READMEs, docs)
 * goes first: for the solo-boss "Request was aborted" report it found the
 * merged PR that fixed that exact error, where a GitHub/Stack Overflow web
 * search found generic Lambda timeout pages (2026-10-10). The web search
 * only fills the remaining slots.
 *
 * Runs for a project with a Firecrawl key (BYOK, shared or env): once per
 * report after classification, and again when someone presses "Search
 * again" on the report (force). Results land in the existing research
 * tables: an automatic session (created_by null for the pipeline) whose
 * snippets are attached to the report, so the Research page lists them too.
 * About 2–5 Firecrawl credits per lookup.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import { firecrawlSearch, resolveFirecrawl } from './firecrawl.ts';

const log = rootLog.child('known-issues');

/** Where people post "I hit this error too", with answers. */
const KNOWN_ISSUE_DOMAINS: readonly string[] = ['github.com', 'stackoverflow.com'];
const MAX_RESULTS = 3;
/** "Search again" twice on the same error within this window runs once. */
const REPEAT_WINDOW_MS = 10 * 60_000;
/** "Error:", "TypeError", "FunctionsHttpError", "CppException", "APIUserAbortError"… */
const EXCEPTION_NAME = /\b(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b/;
const MAX_QUERY_CHARS = 150;

interface KnownIssueSource {
  description: string | null;
  customMetadata: Record<string, unknown> | null;
  consoleLogs: unknown;
}

/** The error message without the parts that differ per occurrence. */
function normalizeErrorText(text: string): string {
  // Mark each volatile token, then drop it with the separators glued to it
  // ("captures-camera-<uuid>" → "captures-camera"), leaving real punctuation
  // such as "TypeError:" alone.
  const GONE = '\u0000';
  return text
    .replace(/https?:\/\/\S+/g, GONE)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, GONE)
    .replace(/\b[0-9a-f]{12,}\b/gi, GONE)
    .replace(/\b\d{4,}\b/g, GONE)
    .replace(new RegExp(`[-_:./]*${GONE}`, 'g'), ' ')
    .replace(/[`"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first error-level console line, if the SDK captured one. */
function firstConsoleError(consoleLogs: unknown): string | null {
  if (!Array.isArray(consoleLogs)) return null;
  for (const entry of consoleLogs) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { level?: unknown; message?: unknown };
    if (e.level === 'error' && typeof e.message === 'string' && e.message.trim()) return e.message;
  }
  return null;
}

/**
 * The search for a report, or null when it has no error message worth
 * searching (feature requests, UX feedback, a one-word error).
 */
function knownIssueQuery(source: KnownIssueSource): string | null {
  let raw: string | null = null;
  const meta = source.customMetadata ?? {};
  if (meta.source === 'sentry_webhook' && source.description) {
    // "<Error>: <message> in <culprit> (captured by Sentry …)": keep the error.
    let line = source.description.split('\n')[0] ?? '';
    line = line.replace(/\s*\(captured by Sentry[^)]*\)\s*$/, '');
    const culprit = typeof meta.culprit === 'string' ? meta.culprit : null;
    if (culprit && line.endsWith(` in ${culprit}`)) line = line.slice(0, -(culprit.length + 4));
    raw = line;
  } else {
    raw = firstConsoleError(source.consoleLogs);
  }
  if (!raw) return null;
  // Only an exception is worth a web search. Apps also send Sentry messages
  // and console errors for their own telemetry ("Poor TTFB: 2467.2 on
  // /account", "Rage click: 3x on …", "sync_timeout"); searching those spends
  // credits on results about nothing.
  if (!EXCEPTION_NAME.test(raw)) return null;
  const text = normalizeErrorText(raw);
  if (text.length < 12 || text.split(' ').length < 3) return null;
  if (text.length <= MAX_QUERY_CHARS) return text;
  const cut = text.slice(0, MAX_QUERY_CHARS);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : MAX_QUERY_CHARS);
}

/**
 * Search once and attach the results to the report. Never throws: the
 * lookup is best effort and must not fail classification.
 */
export type KnownIssueSkip = 'no_query' | 'no_key' | 'already_attached' | 'recent' | 'error';

export async function lookupKnownIssues(
  db: SupabaseClient,
  input: {
    projectId: string;
    reportId: string;
    /** "Search again": run even when results are attached; add only new ones. */
    force?: boolean;
    /** The person who pressed "Search again"; null for the pipeline. */
    requestedBy?: string | null;
  } & KnownIssueSource,
): Promise<{ attached: number; query?: string; skipped?: KnownIssueSkip }> {
  const query = knownIssueQuery(input);
  if (!query) return { attached: 0, skipped: 'no_query' };
  try {
    if (!(await resolveFirecrawl(db, input.projectId))) return { attached: 0, query, skipped: 'no_key' };

    const { data: attachedRows } = await db
      .from('research_snippets')
      .select('url')
      .eq('attached_to_report_id', input.reportId);
    const alreadyAttached = new Set(((attachedRows ?? []) as Array<{ url: string }>).map((r) => r.url));
    if (!input.force && alreadyAttached.size > 0) return { attached: 0, query, skipped: 'already_attached' };

    if (input.force) {
      const since = new Date(Date.now() - REPEAT_WINDOW_MS).toISOString();
      const { count: recent } = await db
        .from('research_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', input.projectId)
        .eq('query', query)
        .gte('created_at', since);
      if ((recent ?? 0) > 0) return { attached: 0, query, skipped: 'recent' };
    }

    // Developer index first (no page fetch: its excerpts already carry the
    // matched passage), then the web search for whatever slots are left.
    const developer = await firecrawlSearch(db, input.projectId, query, {
      limit: MAX_RESULTS,
      category: 'developer',
      scrape: false,
      bypassCache: input.force,
    }).catch((err) => {
      log.warn('developer-index search failed; using web results only', { err: String(err).slice(0, 200) });
      return [];
    });
    let results = developer;
    if (results.length < MAX_RESULTS) {
      const web = await firecrawlSearch(db, input.projectId, query, {
        limit: MAX_RESULTS,
        domains: [...KNOWN_ISSUE_DOMAINS],
        bypassCache: input.force,
      });
      results = [...results, ...web];
    }
    const seen = new Set(alreadyAttached);
    results = results
      .filter((r) => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .slice(0, MAX_RESULTS);

    const { data: session, error: sErr } = await db
      .from('research_sessions')
      .insert({
        project_id: input.projectId,
        query,
        mode: 'search',
        domains: ['developer', ...KNOWN_ISSUE_DOMAINS],
        result_count: results.length,
        created_by: input.requestedBy ?? null,
      })
      .select('id')
      .single();
    if (sErr || !session) throw new Error(sErr?.message ?? 'research session insert failed');
    if (results.length === 0) return { attached: 0, query };

    const now = new Date().toISOString();
    const { error: snErr } = await db.from('research_snippets').insert(
      results.map((r) => ({
        session_id: session.id,
        project_id: input.projectId,
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        markdown: r.markdown ?? null,
        attached_to_report_id: input.reportId,
        attached_at: now,
        attached_by: null,
      })),
    );
    if (snErr) throw new Error(snErr.message);
    return { attached: results.length, query };
  } catch (err) {
    log.warn('known-issue lookup failed (non-fatal)', {
      projectId: input.projectId,
      reportId: input.reportId,
      err: String(err).slice(0, 200),
    });
    return { attached: 0, query, skipped: 'error' };
  }
}
