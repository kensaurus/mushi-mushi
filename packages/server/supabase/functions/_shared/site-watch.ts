/**
 * FILE: site-watch.ts
 * PURPOSE: Live-site watch (ADR 0024). A Firecrawl monitor crawls an app's
 *          live site on a schedule, billed to the project's own Firecrawl
 *          key. Mushi polls the monitor's finished checks (no webhook: those
 *          are signed with a secret only the Firecrawl dashboard shows) and
 *          files each newly broken page as a report with source
 *          'site_watch', before a user hits it.
 *
 * A page is broken when it:
 *   - returns a 5xx, or a 4xx other than 401/403/407/429 (auth walls and
 *     rate limits are not breakage); a crawl only reaches pages the app links
 *     to, so a 404 there is a broken link;
 *   - fails to load (monitor status 'error');
 *   - changed and the monitor's judge says the change matches the goal
 *     below (error screen, blank page, lost main content).
 * A page that disappears from the crawl ('removed') is usually intentional
 * and is not reported.
 *
 * One open finding per page: a page that stays broken does not file again;
 * a page that loads cleanly again is marked resolved, and breaking again
 * later reopens it with a new report.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';

const log = rootLog.child('site-watch');

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';

/** What the monitor's judge looks for on a changed page. */
export const SITE_WATCH_GOAL =
  "Alert only when a page is broken: it shows an error message (such as 'Application error', " +
  "'Something went wrong', 'Internal Server Error', '500' or '404 Not Found'), renders blank or " +
  'nearly empty, or loses its main content. Ignore normal wording, pricing, layout, date and ' +
  'content edits.';

/** Default schedule: once a day at 01:30 UTC. */
export const DEFAULT_SCHEDULE_CRON = '30 1 * * *';

/** Status codes that mean "you may not see this", not "this is broken". */
const NOT_BREAKAGE = new Set([401, 403, 407, 429]);

/**
 * Firecrawl marks a URL 'error' when it skipped it because the same page
 * was already scraped under another address (a redirect, a UTM variant).
 * glot.it's first check had 9 of these (2026-10-10); none was broken.
 */
const DUPLICATE_SKIP = /already scraped this url|prevent duplicate scrapes/i;

export interface MonitorPage {
  url: string;
  status: 'same' | 'new' | 'changed' | 'removed' | 'error' | string;
  statusCode?: number | null;
  error?: string | null;
  isMeaningful?: boolean | null;
  judgment?: { meaningful?: boolean | null; reason?: string | null } | null;
  metadata?: { title?: string | null; contentType?: string | null } | null;
}

export interface PageProblem {
  problem: 'http_error' | 'load_error' | 'judged_broken';
  statusCode: number | null;
  detail: string;
}

/** Is this page broken, and how? Null when it is fine. */
export function classifyPage(page: MonitorPage): PageProblem | null {
  if (page.status === 'removed') return null;
  const code = typeof page.statusCode === 'number' ? page.statusCode : null;
  if (page.status === 'error') {
    if (DUPLICATE_SKIP.test(page.error ?? '')) return null;
    return { problem: 'load_error', statusCode: code, detail: page.error?.trim() || 'The page did not load.' };
  }
  if (code !== null && code >= 400 && !NOT_BREAKAGE.has(code)) {
    const what = code >= 500 ? ' (server error)' : code === 404 ? ' (not found)' : code === 410 ? ' (gone)' : '';
    return { problem: 'http_error', statusCode: code, detail: `The page returned HTTP ${code}${what}.` };
  }
  const meaningful = page.judgment?.meaningful ?? page.isMeaningful ?? null;
  if (page.status === 'changed' && meaningful === true) {
    return {
      problem: 'judged_broken',
      statusCode: code,
      detail: page.judgment?.reason?.trim() || 'The page changed in a way that looks broken.',
    };
  }
  return null;
}

/** A page the watch can say loaded cleanly. */
function loadedCleanly(page: MonitorPage): boolean {
  if (page.status === 'removed' || page.status === 'error') return false;
  const code = typeof page.statusCode === 'number' ? page.statusCode : null;
  return code !== null && code < 400 && classifyPage(page) === null;
}

// ── Firecrawl monitor API ────────────────────────────────────────────────

export class FirecrawlMonitorError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function fc<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${FIRECRAWL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new FirecrawlMonitorError(res.status, 'FIRECRAWL_AUTH_FAILED');
    if (res.status === 402) throw new FirecrawlMonitorError(res.status, 'FIRECRAWL_NO_CREDITS');
    if (res.status === 404) throw new FirecrawlMonitorError(res.status, 'FIRECRAWL_MONITOR_NOT_FOUND');
    if (res.status === 429) throw new FirecrawlMonitorError(res.status, 'FIRECRAWL_RATE_LIMITED');
    throw new FirecrawlMonitorError(res.status, `FIRECRAWL_HTTP_${res.status}: ${text.slice(0, 200)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface MonitorSpec {
  name: string;
  baseUrl: string;
  pageLimit: number;
  scheduleCron: string;
}

function monitorBody(spec: MonitorSpec): Record<string, unknown> {
  return {
    name: spec.name.slice(0, 120),
    schedule: { cron: spec.scheduleCron, timezone: 'UTC' },
    goal: SITE_WATCH_GOAL,
    targets: [
      {
        type: 'crawl',
        url: spec.baseUrl,
        // ignoreQueryParameters: "?utm_source=…" links are the same page;
        // without it they used crawl slots and came back as duplicate skips.
        crawlOptions: { limit: spec.pageLimit, maxDiscoveryDepth: 3, ignoreQueryParameters: true },
      },
    ],
  };
}

export async function createMonitor(
  key: string,
  spec: MonitorSpec,
): Promise<{ id: string; estimatedCreditsPerMonth: number | null }> {
  const res = await fc<{ data?: { id?: string; estimatedCreditsPerMonth?: number } }>(key, 'POST', '/v2/monitor', monitorBody(spec));
  if (!res.data?.id) throw new FirecrawlMonitorError(500, 'FIRECRAWL_MONITOR_CREATE_NO_ID');
  return { id: res.data.id, estimatedCreditsPerMonth: res.data.estimatedCreditsPerMonth ?? null };
}

export async function updateMonitor(
  key: string,
  monitorId: string,
  patch: Partial<MonitorSpec> & { status?: 'active' | 'paused' },
): Promise<{ estimatedCreditsPerMonth: number | null }> {
  const body: Record<string, unknown> = {};
  if (patch.status) body.status = patch.status;
  if (patch.baseUrl && patch.pageLimit && patch.scheduleCron && patch.name) {
    Object.assign(body, monitorBody(patch as MonitorSpec));
  }
  const res = await fc<{ data?: { estimatedCreditsPerMonth?: number } }>(
    key,
    'PATCH',
    `/v2/monitor/${encodeURIComponent(monitorId)}`,
    body,
  );
  return { estimatedCreditsPerMonth: res.data?.estimatedCreditsPerMonth ?? null };
}

export async function deleteMonitor(key: string, monitorId: string): Promise<void> {
  try {
    await fc(key, 'DELETE', `/v2/monitor/${encodeURIComponent(monitorId)}`);
  } catch (err) {
    // Already gone is what we wanted.
    if (err instanceof FirecrawlMonitorError && err.status === 404) return;
    throw err;
  }
}

export async function runMonitor(key: string, monitorId: string): Promise<{ checkId: string | null }> {
  const res = await fc<{ data?: { id?: string } }>(key, 'POST', `/v2/monitor/${encodeURIComponent(monitorId)}/run`);
  return { checkId: res.data?.id ?? null };
}

export interface MonitorCheck {
  id: string;
  status: string;
  trigger?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  actualCredits?: number | null;
  summary?: Record<string, number> | null;
  error?: string | null;
}

/** Newest first. */
export async function listChecks(key: string, monitorId: string, limit = 10): Promise<MonitorCheck[]> {
  const res = await fc<{ data?: MonitorCheck[] }>(
    key,
    'GET',
    `/v2/monitor/${encodeURIComponent(monitorId)}/checks?limit=${limit}`,
  );
  return Array.isArray(res.data) ? res.data : [];
}

/** Every page of a check (follows `next`), at most `maxPages` rows. */
export async function checkPages(
  key: string,
  monitorId: string,
  checkId: string,
  maxPages = 500,
): Promise<MonitorPage[]> {
  const pages: MonitorPage[] = [];
  let url: string | null =
    `/v2/monitor/${encodeURIComponent(monitorId)}/checks/${encodeURIComponent(checkId)}?limit=100`;
  while (url && pages.length < maxPages) {
    const res: { data?: { pages?: MonitorPage[]; next?: string | null }; next?: string | null } = await fc(key, 'GET', url);
    pages.push(...(res.data?.pages ?? []));
    const next = res.next ?? res.data?.next ?? null;
    // Only follow Firecrawl's own pagination links.
    url = next && next.startsWith(`${FIRECRAWL_BASE}/`) ? next : null;
  }
  return pages.slice(0, maxPages);
}

// ── Processing a finished check ──────────────────────────────────────────

export interface SiteWatchRow {
  id: string;
  project_id: string;
  base_url: string;
}

export interface ProcessDeps {
  now: () => Date;
  classify: (db: SupabaseClient, reportId: string, projectId: string) => Promise<void>;
}

/** The report a newly broken page becomes. */
export function buildSiteWatchReport(
  projectId: string,
  url: string,
  problem: PageProblem,
  title: string | null,
  now: Date,
): Record<string, unknown> {
  const nowIso = now.toISOString();
  let path = url;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}` || '/';
  } catch {
    /* keep the raw url */
  }
  const headline =
    problem.problem === 'http_error'
      ? `${path} returns HTTP ${problem.statusCode}`
      : problem.problem === 'load_error'
        ? `${path} does not load`
        : `${path} looks broken`;
  const severity =
    problem.problem === 'load_error' || (problem.statusCode !== null && problem.statusCode >= 500) ? 'high' : 'medium';
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `Live site: ${headline}`.slice(0, 200),
    description:
      `${problem.detail}\n\nPage: ${url}${title ? `\nTitle: ${title}` : ''}\n\n` +
      'Found by the live-site watch, which crawls your live site on a schedule. ' +
      'No user reported this yet.',
    category: 'bug',
    severity,
    status: 'new',
    source: 'site_watch',
    reporter_token_hash: 'site-watch',
    environment: {
      userAgent: 'site-watch',
      platform: 'web',
      language: '',
      viewport: { width: 0, height: 0 },
      url,
      referrer: '',
      timestamp: nowIso,
      timezone: 'UTC',
    },
    custom_metadata: {
      source: 'site_watch',
      url,
      problem: problem.problem,
      statusCode: problem.statusCode,
    },
    synced_at: nowIso,
    created_at: nowIso,
  };
}

export interface ProcessResult {
  broken: number;
  filed: number;
  resolved: number;
}

/**
 * Record a finished check: file a report for each newly broken page, keep
 * open findings that are still broken, resolve the ones that load again.
 */
export async function processCheck(
  db: SupabaseClient,
  watch: SiteWatchRow,
  pages: MonitorPage[],
  deps: ProcessDeps,
): Promise<ProcessResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const result: ProcessResult = { broken: 0, filed: 0, resolved: 0 };

  const { data: existingRows, error: readErr } = await db
    .from('site_watch_pages')
    .select('id, url, resolved_at, report_id')
    .eq('watch_id', watch.id);
  if (readErr) throw new Error(`site_watch_pages read failed: ${readErr.message}`);
  const existing = new Map(
    ((existingRows ?? []) as Array<{ id: string; url: string; resolved_at: string | null; report_id: string | null }>).map(
      (r) => [r.url, r],
    ),
  );

  for (const page of pages) {
    const problem = classifyPage(page);
    const row = existing.get(page.url);
    if (!problem) {
      if (row && !row.resolved_at && loadedCleanly(page)) {
        await db.from('site_watch_pages').update({ resolved_at: nowIso }).eq('id', row.id);
        result.resolved++;
      }
      continue;
    }
    result.broken++;
    if (row && !row.resolved_at) {
      await db
        .from('site_watch_pages')
        .update({ last_seen_at: nowIso, status_code: problem.statusCode, detail: problem.detail, problem: problem.problem })
        .eq('id', row.id);
      continue;
    }

    // New, or broken again after it was fixed: file a report.
    const report = buildSiteWatchReport(watch.project_id, page.url, problem, page.metadata?.title ?? null, now);
    const { error: insErr } = await db.from('reports').insert(report);
    if (insErr) {
      log.warn('site-watch report insert failed', { watchId: watch.id, url: page.url, err: insErr.message });
      continue;
    }
    const finding = {
      watch_id: watch.id,
      project_id: watch.project_id,
      url: page.url,
      problem: problem.problem,
      status_code: problem.statusCode,
      detail: problem.detail,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      resolved_at: null,
      report_id: report.id,
    };
    const { error: upErr } = row
      ? await db.from('site_watch_pages').update(finding).eq('id', row.id)
      : await db.from('site_watch_pages').insert(finding);
    if (upErr) log.warn('site_watch_pages write failed', { watchId: watch.id, url: page.url, err: upErr.message });
    result.filed++;
    await deps.classify(db, report.id as string, watch.project_id);
  }
  return result;
}

/** Checks newer than the last one read, oldest first; only finished ones. */
export function checksToProcess(checks: MonitorCheck[], lastCheckId: string | null): MonitorCheck[] {
  const finished = (c: MonitorCheck) => c.status === 'completed' || c.status === 'partial';
  const out: MonitorCheck[] = [];
  for (const c of checks) {
    if (c.id === lastCheckId) break;
    if (finished(c)) out.push(c);
  }
  return out.reverse();
}
