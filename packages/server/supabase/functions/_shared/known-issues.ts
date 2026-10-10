/**
 * FILE: known-issues.ts
 * PURPOSE: "Has anyone hit this?" — when a report carries a real error
 *          message, search GitHub and Stack Overflow for it once and attach
 *          the top results to the report, so the diagnosis can say "this is
 *          a known issue in X, fixed in Y" instead of starting from zero.
 *
 * Opt-in per project, default off (project_settings.known_issues_search_enabled,
 * Settings → Web tools): the scrubbed error message goes to Firecrawl, a
 * third-party processor. Runs only when that is on and the project has a
 * Firecrawl key (BYOK or env), once per report, after classification. Results land in the existing research
 * tables: an automatic session (created_by null) whose snippets are attached
 * to the report (attached_by null), so the Research page lists them too.
 * One search, 3 results: about 5 Firecrawl credits per error report.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import { firecrawlSearch, resolveFirecrawl } from './firecrawl.ts';

const log = rootLog.child('known-issues');

/** Where people post "I hit this error too", with answers. */
const KNOWN_ISSUE_DOMAINS: readonly string[] = ['github.com', 'stackoverflow.com'];
const MAX_RESULTS = 3;
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
 * The project's opt-in. A missing row, a missing column (migration not yet
 * applied) or a failed read all count as off: fail closed, since "on" sends
 * report text to a third party.
 */
async function searchEnabled(db: SupabaseClient, projectId: string): Promise<boolean> {
  const { data, error } = await db
    .from('project_settings')
    .select('known_issues_search_enabled')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) {
    log.warn('known-issue opt-in unreadable; treating as off', { projectId, err: error.message });
    return false;
  }
  return (data as { known_issues_search_enabled?: unknown } | null)?.known_issues_search_enabled === true;
}

/**
 * Search once and attach the results to the report. Never throws: the
 * lookup is best effort and must not fail classification.
 */
export async function lookupKnownIssues(
  db: SupabaseClient,
  input: { projectId: string; reportId: string } & KnownIssueSource,
): Promise<{
  attached: number;
  skipped?: 'no_query' | 'disabled' | 'no_key' | 'already_attached' | 'error';
}> {
  const query = knownIssueQuery(input);
  if (!query) return { attached: 0, skipped: 'no_query' };
  try {
    // Nothing leaves Mushi unless the project turned the search on.
    if (!(await searchEnabled(db, input.projectId))) return { attached: 0, skipped: 'disabled' };
    if (!(await resolveFirecrawl(db, input.projectId))) return { attached: 0, skipped: 'no_key' };

    const { count } = await db
      .from('research_snippets')
      .select('id', { count: 'exact', head: true })
      .eq('attached_to_report_id', input.reportId);
    if ((count ?? 0) > 0) return { attached: 0, skipped: 'already_attached' };

    const results = await firecrawlSearch(db, input.projectId, query, {
      limit: MAX_RESULTS,
      domains: [...KNOWN_ISSUE_DOMAINS],
    });

    const { data: session, error: sErr } = await db
      .from('research_sessions')
      .insert({
        project_id: input.projectId,
        query,
        mode: 'search',
        domains: [...KNOWN_ISSUE_DOMAINS],
        result_count: results.length,
        created_by: null,
      })
      .select('id')
      .single();
    if (sErr || !session) throw new Error(sErr?.message ?? 'research session insert failed');
    if (results.length === 0) return { attached: 0 };

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
    return { attached: results.length };
  } catch (err) {
    log.warn('known-issue lookup failed (non-fatal)', {
      projectId: input.projectId,
      reportId: input.reportId,
      err: String(err).slice(0, 200),
    });
    return { attached: 0, skipped: 'error' };
  }
}
