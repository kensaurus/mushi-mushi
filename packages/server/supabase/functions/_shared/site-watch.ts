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
 * A broken page in a check is only a SUSPECT (ADR 0029). Of 23 site-watch
 * reports sent to coding agents in October 2026, 9 were pages that were
 * fine: the crawl had read a frame before the page settled (only a skip
 * link, an SPA boot card, a status line mid-request), or Firecrawl's judge
 * had failed open ("Judge response not valid JSON — defaulting to
 * meaningful"). A suspect is filed only when it is seen failing again:
 *   - a confirm scrape (`confirmScrape`) loads the page once more, gives it
 *     time to settle, and still sees it broken; or
 *   - for an HTTP error or a load failure, the next check sees it failing
 *     too (two consecutive checks), when no confirm scrape was conclusive.
 * A judged break files only through a confirm scrape: an SPA boot card with
 * a rotating tip "changes" on every check, so the judge can repeat the same
 * wrong answer. A judge that failed open never counts as an observation.
 *
 * One open finding per page: a page that stays broken does not file again;
 * a page that loads cleanly again is marked resolved (a suspect is
 * dropped), and filing again later needs a second observation again.
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

/**
 * The User-Agent every site-watch page fetch sends, so a host app can drop
 * the crawler from its error monitoring and analytics (match
 * "MushiSiteWatch"). A normal Chrome UA comes first so sites that sniff for
 * a browser still serve the real page.
 *
 * This sets the HTTP request header. Whether the page's own JavaScript sees
 * it in `navigator.userAgent` depends on Firecrawl's browser engine, so a
 * client-side filter should not assume it does until that is verified.
 */
export const SITE_WATCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 ' +
  'MushiSiteWatch/1.0 (+https://kensaur.us/mushi-mushi)';

/** Default schedule: once a day at 01:30 UTC. */
export const DEFAULT_SCHEDULE_CRON = '30 1 * * *';

/** Status codes that mean "you may not see this", not "this is broken". */
const NOT_BREAKAGE = new Set([401, 403, 407, 429]);

/**
 * Firecrawl marks a URL 'error' when it chose not to fetch it. Neither case
 * is breakage:
 * - the same page was already scraped under another address (a redirect, a
 *   UTM variant): glot.it's first check had 9 of these (2026-10-10);
 * - the site's robots.txt disallows it, as yen-yen does for /feedback on
 *   purpose (2026-10-10).
 */
const NOT_FETCHED_ON_PURPOSE = /already scraped this url|prevent duplicate scrapes|blocked by the website's robots\.txt/i;

export interface MonitorPage {
  url: string;
  status: 'same' | 'new' | 'changed' | 'removed' | 'error' | string;
  statusCode?: number | null;
  error?: string | null;
  isMeaningful?: boolean | null;
  /**
   * `MonitorPageJudgment`; confidence is high, medium or low
   * (https://docs.firecrawl.dev/api-reference/endpoint/monitor-check-get).
   */
  judgment?: { meaningful?: boolean | null; confidence?: string | null; reason?: string | null } | null;
  metadata?: { title?: string | null; contentType?: string | null } | null;
}

export interface PageProblem {
  problem: 'http_error' | 'load_error' | 'judged_broken';
  statusCode: number | null;
  detail: string;
  /** The judge could not answer and fell back to "meaningful": not evidence. */
  judgeFailOpen?: boolean;
}

/**
 * The judge's fail-open answer. When its model reply does not parse,
 * Firecrawl's change-monitor judge marks the page meaningful with the reason
 * "Judge response not valid JSON — defaulting to meaningful" (seen on false
 * site-watch reports, 2026-10). A low-confidence "meaningful" is no better.
 */
const JUDGE_FAIL_OPEN = /defaulting to meaningful|not valid json|judge (?:failed|error|unavailable|timed out)/i;

export function isJudgeFailOpen(judgment: MonitorPage['judgment']): boolean {
  if (!judgment) return false;
  if (JUDGE_FAIL_OPEN.test(judgment.reason ?? '')) return true;
  return (judgment.confidence ?? '').toLowerCase() === 'low';
}

/** An HTTP error or a load failure: something Firecrawl measured, not judged. */
export function isHardProblem(problem: PageProblem['problem']): boolean {
  return problem === 'http_error' || problem === 'load_error';
}

/** Is this page broken, and how? Null when it is fine. */
export function classifyPage(page: MonitorPage): PageProblem | null {
  if (page.status === 'removed') return null;
  const code = typeof page.statusCode === 'number' ? page.statusCode : null;
  if (page.status === 'error') {
    if (NOT_FETCHED_ON_PURPOSE.test(page.error ?? '')) return null;
    return { problem: 'load_error', statusCode: code, detail: page.error?.trim() || 'The page did not load.' };
  }
  if (code !== null && code >= 400 && !NOT_BREAKAGE.has(code)) {
    const what = code >= 500 ? ' (server error)' : code === 404 ? ' (not found)' : code === 410 ? ' (gone)' : '';
    return { problem: 'http_error', statusCode: code, detail: `The page returned HTTP ${code}${what}.` };
  }
  const meaningful = page.judgment?.meaningful ?? page.isMeaningful ?? null;
  // The judge reads pages; a sitemap or feed that changes daily is not a broken page.
  const contentType = page.metadata?.contentType ?? '';
  const isHtml = contentType === '' || /html/i.test(contentType);
  if (page.status === 'changed' && meaningful === true && isHtml) {
    if (isJudgeFailOpen(page.judgment)) {
      return {
        problem: 'judged_broken',
        statusCode: code,
        detail: "The page changed, and Firecrawl's change judge could not tell whether it is broken.",
        judgeFailOpen: true,
      };
    }
    return {
      problem: 'judged_broken',
      statusCode: code,
      detail: page.judgment?.reason?.trim() || 'The page changed in a way that looks broken.',
    };
  }
  return null;
}

// ── Confirming a suspect ─────────────────────────────────────────────────

/**
 * Extra wait, on top of Firecrawl's own smart wait, before the confirm
 * scrape reads the page. The false reports came from SPA pages read early:
 * a docs route on its loading skeleton for ~100 ms, a boot card for ~4.5 s,
 * and a home page whose h1 appeared after ~8.5 s on a cold load.
 */
export const CONFIRM_WAIT_MS = 10_000;
/** Firecrawl's own limit for the confirm scrape; past it Firecrawl answers 408. */
export const CONFIRM_TIMEOUT_MS = 45_000;
/** Confirm scrapes per poll run, over every watch (1 credit each). */
export const CONFIRM_SCRAPES_PER_RUN = 6;
/** Confirm scrapes per watch per poll run; they run in parallel. */
export const CONFIRM_SCRAPES_PER_WATCH = 3;
/** Confirm scrapes per suspect for each check that saw it failing. */
export const CONFIRM_ATTEMPTS_PER_CHECK = 3;
/** A suspect confirmed this recently is not confirmed again (overlapping polls). */
export const CONFIRM_RETRY_AFTER_MS = 10 * 60_000;
/** No new confirm scrape starts this long into a poll run. */
export const CONFIRM_RUN_DEADLINE_MS = 90_000;
/**
 * Pending suspects of one kind (hard, or judged) at which a sample stands for
 * all of them: when at least two confirm scrapes reproduce the failure and
 * none finds the page healthy, the site is down or a shared layout broke, and
 * the rest of that kind file with them in one outage report.
 */
const OUTAGE_SAMPLE_BROKEN = 2;

/** What one confirm scrape saw. */
export type ConfirmScrape =
  /** Firecrawl returned the page, with whatever status the site answered. */
  | { kind: 'loaded'; statusCode: number | null; markdown: string; title: string | null; contentType: string | null }
  /** Firecrawl answered 408: the page did not finish loading within the timeout. */
  | { kind: 'timed_out'; error: string }
  /** Firecrawl could not be asked, or failed on its side: says nothing about the page. */
  | { kind: 'unavailable'; reason: string };

/**
 * Load one page again through Firecrawl's scrape endpoint, billed to the
 * project key the watch's monitor uses, and give it time to settle.
 *
 * Parameters, all from https://docs.firecrawl.dev/api-reference/endpoint/scrape
 * (checked 2026-10-21):
 *   - `formats: ['markdown']`, `onlyMainContent: true`: the defaults, and
 *     what the monitor's own scrape reads;
 *   - `waitFor`: ms to wait on top of Firecrawl's smart wait (max 60000);
 *   - `timeout`: ms before Firecrawl gives up on the page (min 1000);
 *   - `maxAge: 0`: always a fresh fetch, never Firecrawl's 2-day cache;
 *   - `headers`: the site-watch User-Agent, so the host can filter it.
 * The scrape endpoint has no viewport option (a viewport exists only for
 * the screenshot format), so none is set and none is put on the report.
 *
 * Responses: a page that answered with an error status is still a document,
 * with the site's status in `data.metadata.statusCode`, and costs 1 credit
 * (https://docs.firecrawl.dev/billing). 408 means the page took longer than
 * `timeout` to load; 402, 429 and 5xx are Firecrawl's side
 * (https://docs.firecrawl.dev/api-reference/errors) and cost nothing, since
 * no document came back.
 */
export async function confirmScrape(key: string, url: string): Promise<ConfirmScrape> {
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_BASE}/v2/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: CONFIRM_WAIT_MS,
        timeout: CONFIRM_TIMEOUT_MS,
        maxAge: 0,
        headers: { 'User-Agent': SITE_WATCH_USER_AGENT },
      }),
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS + 10_000),
    });
  } catch (err) {
    return { kind: 'unavailable', reason: `FIRECRAWL_UNREACHABLE: ${String(err).slice(0, 120)}` };
  }
  const text = await res.text().catch(() => '');
  if (res.status === 408) return { kind: 'timed_out', error: errorText(text) || 'Request Timeout' };
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { kind: 'unavailable', reason: 'FIRECRAWL_AUTH_FAILED' };
    if (res.status === 402) return { kind: 'unavailable', reason: 'FIRECRAWL_NO_CREDITS' };
    if (res.status === 429) return { kind: 'unavailable', reason: 'FIRECRAWL_RATE_LIMITED' };
    return { kind: 'unavailable', reason: `FIRECRAWL_HTTP_${res.status}: ${errorText(text).slice(0, 120)}` };
  }
  let json: { data?: { markdown?: unknown; metadata?: Record<string, unknown> } };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return { kind: 'unavailable', reason: 'FIRECRAWL_BAD_JSON' };
  }
  const meta = json.data?.metadata ?? {};
  const rawTitle = Array.isArray(meta.title) ? meta.title[0] : meta.title;
  return {
    kind: 'loaded',
    statusCode: typeof meta.statusCode === 'number' ? meta.statusCode : null,
    markdown: typeof json.data?.markdown === 'string' ? json.data.markdown : '',
    title: typeof rawTitle === 'string' ? rawTitle : null,
    contentType: typeof meta.contentType === 'string' ? meta.contentType : null,
  };
}

function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown };
    return typeof j.error === 'string' ? j.error : '';
  } catch {
    return body.slice(0, 200);
  }
}

/** "Skip to content" and its kin: an accessibility link, not content. */
const SKIP_LINK =
  /skip(?: to)?(?: the)? (?:main )?(?:content|navigation|nav)|(?:メインコンテンツ|本文|コンテンツ)(?:へ|に)(?:スキップ|移動)/gi;
/** A page still booting, or waiting on a request. */
const LOADING_SHELL =
  /\b(?:loading|please wait|initiali[sz]ing|connecting)\b|読み込み中|ロード中|接続確認中|接続中|お待ちください|cargando|chargement|carregando|加载中|載入中/i;
/** A page showing an error screen instead of its content. */
const ERROR_SHELL =
  /application error|something went wrong|internal server error|this page could not be found|page not found|an? (?:unexpected )?error (?:has )?occurred|\b(?:404|500|502|503)\b[^\n]{0,40}(?:error|not found)|エラーが発生しました|問題が発生しました|ページが見つかりません/i;
/**
 * Visible text longer than this is a page with content, whatever else it
 * says. The shop page that filed falsely keeps an empty role="alert" error
 * panel in its shell beside a full catalog; only a page with little else on
 * it is an error or loading screen.
 */
const SHELL_MAX_CHARS = 200;

/** Markdown down to its visible words. */
function visibleText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`|~=-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Why a settled page is still broken (blank, only a skip link, still on a
 * loading screen, or on an error screen), or null when it shows content.
 */
export function settledPageProblem(markdown: string): string | null {
  const text = visibleText(markdown);
  const rest = text.replace(SKIP_LINK, ' ').replace(/\s+/g, ' ').trim();
  if (rest === '') return text === '' ? 'the page is still blank.' : 'the page still shows only a skip link.';
  if (rest.length > SHELL_MAX_CHARS) return null;
  if (ERROR_SHELL.test(rest)) return `the page still shows an error screen ("${rest.slice(0, 120)}").`;
  if (LOADING_SHELL.test(rest)) return `the page is still on a loading screen ("${rest.slice(0, 120)}").`;
  return null;
}

export interface ConfirmVerdict {
  outcome: 'broken' | 'healthy' | 'inconclusive';
  detail: string;
  /** The status the confirm scrape saw, when it loaded the page. */
  statusCode: number | null;
}

/** Does a confirm scrape reproduce the suspect's failure? */
export function judgeConfirmation(scrape: ConfirmScrape): ConfirmVerdict {
  if (scrape.kind === 'unavailable') {
    return { outcome: 'inconclusive', detail: `The confirm scrape could not run (${scrape.reason}).`, statusCode: null };
  }
  if (scrape.kind === 'timed_out') {
    return {
      outcome: 'broken',
      detail: `Loaded again, the page still did not finish loading within ${CONFIRM_TIMEOUT_MS / 1000} seconds.`,
      statusCode: null,
    };
  }
  const code = scrape.statusCode;
  if (code !== null && code >= 400) {
    // An auth wall or a rate limit now says nothing about the earlier failure.
    if (NOT_BREAKAGE.has(code)) {
      return { outcome: 'inconclusive', detail: `Loaded again, the page answered HTTP ${code}.`, statusCode: code };
    }
    return { outcome: 'broken', detail: `Loaded again, the page still returned HTTP ${code}.`, statusCode: code };
  }
  if (code === null && scrape.markdown.trim() === '') {
    return { outcome: 'inconclusive', detail: 'Loaded again, Firecrawl returned neither a status nor content.', statusCode: null };
  }
  const contentType = scrape.contentType ?? '';
  if (contentType !== '' && !/html/i.test(contentType)) {
    return { outcome: 'healthy', detail: `Loaded again, the page answered HTTP ${code ?? 'OK'} (${contentType}).`, statusCode: code };
  }
  const settled = `Loaded again and given ${CONFIRM_WAIT_MS / 1000} seconds to settle`;
  const shell = settledPageProblem(scrape.markdown);
  if (shell) return { outcome: 'broken', detail: `${settled}, ${shell}`, statusCode: code };
  return {
    outcome: 'healthy',
    detail: `${settled}, the page rendered its content${code !== null ? ` (HTTP ${code})` : ''}.`,
    statusCode: code,
  };
}

/** "www.example.com" and "example.com" are one site. */
function sameSite(url: string, baseUrl: string): boolean {
  try {
    const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
    const host = bare(new URL(url).hostname);
    const base = bare(new URL(baseUrl).hostname);
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
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
        // Only the header: other scrape options keep Firecrawl's monitor
        // defaults. Firecrawl does not cache a scrape sent with custom headers.
        scrapeOptions: { headers: { 'User-Agent': SITE_WATCH_USER_AGENT } },
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

/** The parts of a live monitor that `monitorNeedsReconcile` reads. */
export interface LiveMonitor {
  name?: string;
  targets?: Array<{ scrapeOptions?: { headers?: Record<string, string> } }>;
}

export async function getMonitor(key: string, monitorId: string): Promise<LiveMonitor> {
  const res = await fc<{ data?: LiveMonitor }>(key, 'GET', `/v2/monitor/${encodeURIComponent(monitorId)}`);
  return res.data ?? {};
}

/**
 * True when a live monitor no longer matches `monitorBody`: its crawl target
 * lacks the current site-watch User-Agent. Monitors created before the header
 * shipped kept `scrapeOptions: {}` until someone re-saved them, so every crawl
 * reached host apps unmarked and their error monitoring counted it as users.
 */
export function monitorNeedsReconcile(monitor: LiveMonitor): boolean {
  const headers = monitor.targets?.[0]?.scrapeOptions?.headers ?? {};
  return headers['User-Agent'] !== SITE_WATCH_USER_AGENT;
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

/** The confirm scrapes one poll run may still start, over every watch. */
export interface ConfirmBudget {
  remaining: number;
  /** Epoch ms after which no new confirm scrape starts. */
  deadline: number;
}

export interface SettleDeps extends ProcessDeps {
  /** One confirm scrape, on the watch's own Firecrawl key. */
  confirm: (url: string) => Promise<ConfirmScrape>;
  budget: ConfirmBudget;
}

/** How a filed page was seen failing a second time. */
export interface FilingEvidence {
  basis: 'confirm_scrape' | 'two_checks' | 'outage_sample';
  detail: string;
  statusCode: number | null;
}

/**
 * The page's environment on a site-watch report. No viewport: the crawl and
 * the confirm scrape do not report the one they rendered at, and a stamped
 * 0×0 sent agents chasing a layout that never existed.
 */
function siteWatchEnvironment(url: string, nowIso: string): Record<string, unknown> {
  return { userAgent: 'site-watch', platform: 'web', language: '', url, referrer: '', timestamp: nowIso, timezone: 'UTC' };
}

function evidenceMetadata(evidence: FilingEvidence | undefined): Record<string, unknown> | null {
  if (!evidence) return null;
  return {
    basis: evidence.basis,
    detail: evidence.detail,
    statusCode: evidence.statusCode,
    ...(evidence.basis === 'confirm_scrape' ? { waitForMs: CONFIRM_WAIT_MS } : {}),
  };
}

/** The report a newly broken page becomes. */
export function buildSiteWatchReport(
  projectId: string,
  url: string,
  problem: PageProblem,
  title: string | null,
  now: Date,
  evidence?: FilingEvidence,
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
  // A 5xx is the site failing; a load error can be Firecrawl's side (a
  // timeout, an anti-bot wall), so it files at medium until the diagnosis
  // says otherwise.
  const severity = problem.statusCode !== null && problem.statusCode >= 500 ? 'high' : 'medium';
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `Live site: ${headline}`.slice(0, 200),
    description:
      `${problem.detail}\n\n` +
      (evidence ? `Seen again: ${evidence.detail}\n\n` : '') +
      `Page: ${url}${title ? `\nTitle: ${title}` : ''}\n\n` +
      'Found by the live-site watch, which crawls your live site on a schedule. ' +
      'No user reported this yet.',
    category: 'bug',
    severity,
    status: 'new',
    source: 'site_watch',
    reporter_token_hash: 'site-watch',
    environment: siteWatchEnvironment(url, nowIso),
    custom_metadata: {
      source: 'site_watch',
      url,
      problem: problem.problem,
      statusCode: problem.statusCode,
      confirmation: evidenceMetadata(evidence),
    },
    synced_at: nowIso,
    created_at: nowIso,
  };
}

/**
 * A burst of newly broken pages (the site is down, a deploy broke a layout)
 * becomes ONE report listing them, not one report and one diagnosis per
 * page: a 60-page outage would otherwise file 60.
 */
export const OUTAGE_PAGE_THRESHOLD = 5;
const OUTAGE_LIST_MAX = 25;

/** The single report for a burst of newly broken pages. */
export function buildSiteOutageReport(
  projectId: string,
  baseUrl: string,
  broken: Array<{ url: string; problem: PageProblem; evidence?: FilingEvidence }>,
  now: Date,
): Record<string, unknown> {
  const nowIso = now.toISOString();
  const serverErrors = broken.filter(
    (b) => b.problem.problem === 'load_error' || (b.problem.statusCode !== null && b.problem.statusCode >= 500),
  ).length;
  const reloaded = broken.filter((b) => b.evidence?.basis === 'confirm_scrape').length;
  const lines = broken.slice(0, OUTAGE_LIST_MAX).map((b) => `- ${b.url}: ${b.problem.detail}`);
  if (broken.length > OUTAGE_LIST_MAX) lines.push(`- …and ${broken.length - OUTAGE_LIST_MAX} more`);
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `Live site: ${broken.length} pages broke at once`.slice(0, 200),
    description:
      `${broken.length} pages of ${baseUrl} broke at the same time, which usually means ` +
      'one cause (the site or an API is down, or a deploy broke a shared layout).\n\n' +
      (reloaded > 0
        ? `Seen again: ${reloaded} of them were loaded again and were still broken; ` +
          'the rest failed in two checks in a row or broke with them.\n\n'
        : broken.some((b) => b.evidence)
          ? 'Seen again: each failed in two checks in a row.\n\n'
          : '') +
      `${lines.join('\n')}\n\n` +
      'Found by the live-site watch, which crawls your live site on a schedule. No user reported this yet.',
    category: 'bug',
    severity: serverErrors > 0 ? 'critical' : 'high',
    status: 'new',
    source: 'site_watch',
    reporter_token_hash: 'site-watch',
    environment: siteWatchEnvironment(baseUrl, nowIso),
    custom_metadata: {
      source: 'site_watch',
      outage: true,
      url: baseUrl,
      pages: broken.slice(0, OUTAGE_LIST_MAX).map((b) => ({
        url: b.url,
        problem: b.problem.problem,
        statusCode: b.problem.statusCode,
        confirmation: b.evidence?.basis ?? null,
      })),
      pageCount: broken.length,
    },
    synced_at: nowIso,
    created_at: nowIso,
  };
}

export interface ProcessResult {
  /** Pages this check saw broken. */
  broken: number;
  /** Of those, pages not filed yet: new suspects and suspects seen again. */
  suspects: number;
  /** Filed findings that loaded cleanly again. */
  resolved: number;
}

interface FindingRow {
  id: string;
  url: string;
  resolved_at: string | null;
  report_id: string | null;
  /** Null while the page is a suspect; set when its report is filed. */
  confirmed_at: string | null;
  fail_streak: number | null;
  last_failed_check_id: string | null;
}

/**
 * Record what a finished check saw. Nothing is filed here: a newly broken
 * page becomes a suspect, and `settleSuspects` decides whether it files.
 *
 * - A page that is fine again resolves its row: a filed finding is closed,
 *   a suspect is dropped. Either way, filing again needs a second
 *   observation again.
 * - A suspect seen failing again by a later check counts that check once
 *   (two polls can read the same check; `last_failed_check_id` keeps it to
 *   one), and only an HTTP error or a load failure adds to `fail_streak`.
 * - A newly broken page is CLAIMED as a suspect row (unique per watch and
 *   url, or a conditional reopen of a resolved row), so overlapping polls
 *   record it once.
 */
export async function processCheck(
  db: SupabaseClient,
  watch: SiteWatchRow,
  pages: MonitorPage[],
  deps: ProcessDeps,
  checkId: string,
): Promise<ProcessResult> {
  const nowIso = deps.now().toISOString();
  const result: ProcessResult = { broken: 0, suspects: 0, resolved: 0 };

  const { data: existingRows, error: readErr } = await db
    .from('site_watch_pages')
    .select('id, url, resolved_at, report_id, confirmed_at, fail_streak, last_failed_check_id')
    .eq('watch_id', watch.id);
  if (readErr) throw new Error(`site_watch_pages read failed: ${readErr.message}`);
  const existing = new Map(((existingRows ?? []) as FindingRow[]).map((r) => [r.url, r]));

  for (const page of pages) {
    const problem = classifyPage(page);
    const row = existing.get(page.url);
    if (!problem) {
      // No longer broken: it loads, it was removed from the site, or
      // Firecrawl now skips it on purpose.
      if (row && !row.resolved_at) {
        await db
          .from('site_watch_pages')
          .update({ resolved_at: nowIso, fail_streak: 0, confirm_attempts: 0 })
          .eq('id', row.id)
          .is('resolved_at', null);
        if (row.confirmed_at) result.resolved++;
      }
      continue;
    }
    result.broken++;
    const hard = isHardProblem(problem.problem);

    if (row && !row.resolved_at) {
      const patch: Record<string, unknown> = {
        last_seen_at: nowIso,
        status_code: problem.statusCode,
        detail: problem.detail,
        problem: problem.problem,
      };
      if (!row.confirmed_at) {
        result.suspects++;
        if (row.last_failed_check_id !== checkId) {
          patch.last_failed_check_id = checkId;
          // A new check that saw it failing earns new confirm attempts.
          patch.confirm_attempts = 0;
          // Only a measured failure counts toward two checks in a row; a
          // judgment (above all a fail-open one) neither adds nor resets.
          patch.fail_streak = (row.fail_streak ?? 0) + (hard ? 1 : 0);
        }
      }
      await db.from('site_watch_pages').update(patch).eq('id', row.id);
      continue;
    }

    const suspect = {
      problem: problem.problem,
      status_code: problem.statusCode,
      detail: problem.detail,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      resolved_at: null,
      report_id: null,
      confirmed_at: null,
      fail_streak: hard ? 1 : 0,
      last_failed_check_id: checkId,
      confirm_attempts: 0,
      last_confirm_at: null,
      last_confirm: null,
    };
    if (row) {
      const { data, error } = await db
        .from('site_watch_pages')
        .update(suspect)
        .eq('id', row.id)
        .not('resolved_at', 'is', null)
        .select('id');
      if (error) {
        log.warn('site_watch_pages reopen failed', { watchId: watch.id, url: page.url, err: error.message });
        continue;
      }
      if (!data || (data as unknown[]).length === 0) continue;
    } else {
      const { error } = await db
        .from('site_watch_pages')
        .insert({ watch_id: watch.id, project_id: watch.project_id, url: page.url, ...suspect })
        .select('id')
        .single();
      if (error) {
        if (error.code !== '23505') {
          log.warn('site_watch_pages claim failed', { watchId: watch.id, url: page.url, err: error.message });
        }
        continue;
      }
    }
    result.suspects++;
  }
  return result;
}

export interface SettleResult {
  /** Confirm scrapes sent (1 credit each when Firecrawl returned the page). */
  scrapes: number;
  /** Suspects a confirm scrape found healthy, dropped without a report. */
  dismissed: number;
  /** Suspects seen failing a second time and filed. */
  confirmed: number;
  /** Reports filed (an outage files one for many pages). */
  filed: number;
}

interface SuspectRow {
  id: string;
  url: string;
  problem: PageProblem['problem'];
  status_code: number | null;
  detail: string | null;
  fail_streak: number | null;
  confirm_attempts: number | null;
  last_confirm_at: string | null;
}

function suspectProblem(s: SuspectRow, statusCode?: number | null): PageProblem {
  return {
    problem: s.problem,
    statusCode: statusCode ?? s.status_code,
    detail: s.detail?.trim() || 'The page looked broken in the last check.',
  };
}

/**
 * File the suspects that were seen failing a second time; drop the ones a
 * confirm scrape finds healthy.
 *
 * 1. Up to CONFIRM_SCRAPES_PER_WATCH suspects (and what is left of the run's
 *    budget) get a confirm scrape: measured failures first. Each is claimed
 *    first (`confirm_attempts` compare-and-set) so overlapping polls do not
 *    scrape the same page twice.
 * 2. A confirm scrape decides when it is conclusive: still broken files,
 *    healthy drops the suspect. Inconclusive (Firecrawl failed, an auth wall)
 *    leaves it for the rule below or a later poll.
 * 3. An HTTP error or load failure seen in two checks in a row files without
 *    a conclusive confirm scrape. A judged break never does.
 * 4. Five or more suspects of one kind, with at least two sampled and still
 *    broken and none sampled healthy, file together as one outage.
 *
 * Filing claims each row (`confirmed_at` set where still null), so a page
 * files once; a failed report insert gives the claim back.
 */
export async function settleSuspects(db: SupabaseClient, watch: SiteWatchRow, deps: SettleDeps): Promise<SettleResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const result: SettleResult = { scrapes: 0, dismissed: 0, confirmed: 0, filed: 0 };

  const { data: rows, error: readErr } = await db
    .from('site_watch_pages')
    .select('id, url, problem, status_code, detail, fail_streak, confirm_attempts, last_confirm_at')
    .eq('watch_id', watch.id)
    .is('resolved_at', null)
    .is('confirmed_at', null);
  if (readErr) throw new Error(`site_watch_pages suspects read failed: ${readErr.message}`);
  const suspects = ((rows ?? []) as SuspectRow[])
    .slice()
    .sort(
      (a, b) =>
        Number(isHardProblem(b.problem)) - Number(isHardProblem(a.problem)) || (b.fail_streak ?? 0) - (a.fail_streak ?? 0),
    );
  if (suspects.length === 0) return result;

  // 1. Pick and claim the suspects to confirm.
  const sampled: SuspectRow[] = [];
  for (const s of suspects) {
    if (sampled.length >= CONFIRM_SCRAPES_PER_WATCH) break;
    if (deps.budget.remaining <= 0 || now.getTime() > deps.budget.deadline) break;
    const attempts = s.confirm_attempts ?? 0;
    if (attempts >= CONFIRM_ATTEMPTS_PER_CHECK) continue;
    if (s.last_confirm_at && now.getTime() - Date.parse(s.last_confirm_at) < CONFIRM_RETRY_AFTER_MS) continue;
    if (!sameSite(s.url, watch.base_url)) continue;
    const { data: won, error: claimErr } = await db
      .from('site_watch_pages')
      .update({ confirm_attempts: attempts + 1, last_confirm_at: nowIso })
      .eq('id', s.id)
      .eq('confirm_attempts', attempts)
      .is('confirmed_at', null)
      .is('resolved_at', null)
      .select('id');
    if (claimErr || !won || (won as unknown[]).length === 0) continue;
    deps.budget.remaining--;
    sampled.push(s);
  }

  // 2. Confirm in parallel; a confirm that throws says nothing about the page.
  const verdicts = await Promise.all(
    sampled.map(async (s) => {
      const scrape = await deps
        .confirm(s.url)
        .catch((err): ConfirmScrape => ({ kind: 'unavailable', reason: String(err).slice(0, 120) }));
      return { s, scrape, verdict: judgeConfirmation(scrape) };
    }),
  );
  result.scrapes = verdicts.length;

  const toFile = new Map<string, { s: SuspectRow; problem: PageProblem; title: string | null; evidence: FilingEvidence }>();
  const healthy = new Set<string>();
  for (const { s, scrape, verdict } of verdicts) {
    const lastConfirm = { outcome: verdict.outcome, detail: verdict.detail, statusCode: verdict.statusCode, at: nowIso };
    if (verdict.outcome === 'healthy') {
      healthy.add(s.id);
      await db
        .from('site_watch_pages')
        .update({ resolved_at: nowIso, fail_streak: 0, confirm_attempts: 0, last_confirm: lastConfirm })
        .eq('id', s.id)
        .is('confirmed_at', null)
        .is('resolved_at', null);
      result.dismissed++;
      continue;
    }
    await db.from('site_watch_pages').update({ last_confirm: lastConfirm }).eq('id', s.id);
    if (verdict.outcome === 'broken') {
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s, isHardProblem(s.problem) ? verdict.statusCode : undefined),
        title: scrape.kind === 'loaded' ? scrape.title : null,
        evidence: { basis: 'confirm_scrape', detail: verdict.detail, statusCode: verdict.statusCode },
      });
    }
  }

  // 3. Two checks in a row, for measured failures only.
  for (const s of suspects) {
    if (toFile.has(s.id) || healthy.has(s.id)) continue;
    if (isHardProblem(s.problem) && (s.fail_streak ?? 0) >= 2) {
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s),
        title: null,
        evidence: { basis: 'two_checks', detail: 'The page failed in two checks in a row.', statusCode: s.status_code },
      });
    }
  }

  // 4. A sample stands for a burst of one kind.
  for (const hard of [true, false]) {
    const kind = suspects.filter((s) => isHardProblem(s.problem) === hard && !healthy.has(s.id));
    if (kind.length < OUTAGE_PAGE_THRESHOLD) continue;
    const ofKind = verdicts.filter((v) => isHardProblem(v.s.problem) === hard);
    const stillBroken = ofKind.filter((v) => v.verdict.outcome === 'broken').length;
    if (stillBroken < OUTAGE_SAMPLE_BROKEN || ofKind.some((v) => v.verdict.outcome === 'healthy')) continue;
    for (const s of kind) {
      if (toFile.has(s.id)) continue;
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s),
        title: null,
        evidence: {
          basis: 'outage_sample',
          detail: `It broke with ${kind.length - 1} other pages; ${stillBroken} of those were loaded again and were still broken.`,
          statusCode: s.status_code,
        },
      });
    }
  }
  if (toFile.size === 0) return result;

  // Claim each page for filing; a concurrent poll that already did skips it.
  const claimed: Array<{ s: SuspectRow; problem: PageProblem; title: string | null; evidence: FilingEvidence }> = [];
  for (const f of toFile.values()) {
    const { data, error } = await db
      .from('site_watch_pages')
      .update({ confirmed_at: nowIso })
      .eq('id', f.s.id)
      .is('confirmed_at', null)
      .is('resolved_at', null)
      .select('id');
    if (error) {
      log.warn('site_watch_pages filing claim failed', { watchId: watch.id, url: f.s.url, err: error.message });
      continue;
    }
    if (!data || (data as unknown[]).length === 0) continue;
    claimed.push(f);
  }
  result.confirmed = claimed.length;
  if (claimed.length === 0) return result;

  const groups =
    claimed.length >= OUTAGE_PAGE_THRESHOLD
      ? [
          {
            report: buildSiteOutageReport(
              watch.project_id,
              watch.base_url,
              claimed.map((c) => ({ url: c.s.url, problem: c.problem, evidence: c.evidence })),
              now,
            ),
            members: claimed,
          },
        ]
      : claimed.map((c) => ({
          report: buildSiteWatchReport(watch.project_id, c.s.url, c.problem, c.title, now, c.evidence),
          members: [c],
        }));

  for (const g of groups) {
    const { error: insErr } = await db.from('reports').insert(g.report);
    if (insErr) {
      log.warn('site-watch report insert failed', { watchId: watch.id, err: insErr.message });
      // Give the claims back so the next poll files them.
      for (const m of g.members) {
        await db.from('site_watch_pages').update({ confirmed_at: null }).eq('id', m.s.id);
      }
      result.confirmed -= g.members.length;
      continue;
    }
    for (const m of g.members) {
      await db.from('site_watch_pages').update({ report_id: g.report.id }).eq('id', m.s.id);
    }
    result.filed++;
    await deps.classify(db, g.report.id as string, watch.project_id);
  }
  return result;
}

/**
 * Checks newer than the last one read, oldest first; only finished ones.
 * When the last one read is no longer among `checks` (many manual runs, or
 * days without a key), only the newest finished check is read: replaying
 * older ones would file pages that may have been fixed since.
 */
export function checksToProcess(checks: MonitorCheck[], lastCheckId: string | null): MonitorCheck[] {
  const finished = (c: MonitorCheck) => c.status === 'completed' || c.status === 'partial';
  if (lastCheckId && !checks.some((c) => c.id === lastCheckId)) {
    const newest = checks.find(finished);
    return newest ? [newest] : [];
  }
  const out: MonitorCheck[] = [];
  for (const c of checks) {
    if (c.id === lastCheckId) break;
    if (finished(c)) out.push(c);
  }
  return out.reverse();
}
