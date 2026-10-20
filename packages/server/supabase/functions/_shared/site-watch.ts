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
 * A judged break files through a confirm scrape: an SPA boot card with a
 * rotating tip "changes" on every check, so the judge can repeat the same
 * wrong answer. A judge that failed open never counts as an observation.
 * Two low-severity fallbacks keep real breakage from going unfiled: a
 * confident judged break whose confirms stayed inconclusive in two checks
 * files marked unconfirmed, and a 5xx that a confirm finds healthy three
 * times in seven days files as intermittent. See `judgeConfirmation` for
 * what a confirm scrape counts as broken.
 *
 * One open finding per page: a page that stays broken does not file again;
 * a page that loads cleanly again is marked resolved (a suspect is
 * dropped), and filing again later needs a second observation again. A
 * judged break shown unchanged (`same`) is still broken, not recovered.
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
/** The longest one confirm scrape can take: Firecrawl's timeout plus our abort margin. */
export const CONFIRM_WORST_CASE_MS = CONFIRM_TIMEOUT_MS + 10_000;
/**
 * Every confirm scrape must be able to finish within this long of the poll
 * run's start, so a run stays inside the 150 s edge-function wall clock of
 * Supabase's smallest plan: a confirm starts only while
 * now + CONFIRM_WORST_CASE_MS is within the deadline.
 */
export const CONFIRM_RUN_DEADLINE_MS = 120_000;
/**
 * Pending suspects of one kind (hard, or judged) at which a sample stands for
 * all of them: when at least two confirm scrapes reproduce the failure and
 * none finds the page healthy, the site is down or a shared layout broke, and
 * the rest of that kind file with them in one outage report.
 */
const OUTAGE_SAMPLE_BROKEN = 2;
/**
 * A confident judged break whose confirm scrapes stayed inconclusive in this
 * many checks files anyway, at low severity, marked unconfirmed. Never for a
 * judge that failed open.
 */
export const UNCONFIRMED_AFTER_CHECKS = 2;
/** A 5xx that a confirm scrape found healthy this many times ... */
export const FLAP_DISMISSALS = 3;
/** ... within this window files at low severity as intermittent. */
export const FLAP_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Firecrawl error codes that mean the site itself could not be reached: DNS
 * did not resolve, the browser's connection failed (connection refused or
 * reset, and the like), or the TLS handshake failed. The v2 scrape endpoint
 * answers the DNS case with HTTP 200 and `success: false`, the others with
 * HTTP 500, each with this `code` in the body. Not in docs.firecrawl.dev;
 * read from Firecrawl's source (2026-10-21):
 * https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/scraper/scrapeURL/error.ts
 * and apps/api/src/controllers/v2/scrape.ts. SCRAPE_ALL_ENGINES_FAILED is
 * left out: anti-bot walls end there too.
 */
const SITE_UNREACHABLE_CODES = new Set(['SCRAPE_DNS_RESOLUTION_ERROR', 'SCRAPE_SITE_ERROR', 'SCRAPE_SSL_ERROR']);

/** What one confirm scrape saw. */
export type ConfirmScrape =
  /** Firecrawl returned the page, with whatever status the site answered. */
  | { kind: 'loaded'; statusCode: number | null; markdown: string; title: string | null; contentType: string | null }
  /** Firecrawl answered 408 SCRAPE_TIMEOUT: the page did not finish loading within the timeout. */
  | { kind: 'timed_out'; error: string }
  /** Firecrawl could not reach the site at all (DNS, connection, TLS). */
  | { kind: 'unreachable'; code: string; error: string }
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
 * `timeout` to load (code SCRAPE_TIMEOUT; CONCURRENCY_QUEUE_TIMEOUT is
 * Firecrawl's own queue); 402, 429 and 5xx are Firecrawl's side
 * (https://docs.firecrawl.dev/api-reference/errors) and cost nothing, since
 * no document came back, except the site-unreachable codes above. 403
 * UNSUPPORTED_SITE is a site Firecrawl will not scrape, not a bad key.
 * When our own abort fires first, Firecrawl may still finish and charge the
 * credit.
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
      signal: AbortSignal.timeout(CONFIRM_WORST_CASE_MS),
    });
  } catch (err) {
    return { kind: 'unavailable', reason: `FIRECRAWL_UNREACHABLE: ${String(err).slice(0, 120)}` };
  }
  const text = await res.text().catch(() => '');
  let json: { success?: unknown; code?: unknown; error?: unknown; data?: { markdown?: unknown; metadata?: Record<string, unknown> } } | null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  const code = typeof json?.code === 'string' ? json.code : '';
  const error = typeof json?.error === 'string' ? json.error : text.slice(0, 200);
  if (SITE_UNREACHABLE_CODES.has(code)) return { kind: 'unreachable', code, error: error.slice(0, 300) };
  if (res.status === 408) {
    if (code === 'CONCURRENCY_QUEUE_TIMEOUT') return { kind: 'unavailable', reason: 'FIRECRAWL_QUEUE_TIMEOUT' };
    return { kind: 'timed_out', error: error || 'Request Timeout' };
  }
  if (!res.ok) {
    if (res.status === 401) return { kind: 'unavailable', reason: 'FIRECRAWL_AUTH_FAILED' };
    if (res.status === 403) {
      if (code === 'UNSUPPORTED_SITE') return { kind: 'unavailable', reason: 'FIRECRAWL_UNSUPPORTED_SITE' };
      return { kind: 'unavailable', reason: code ? `FIRECRAWL_403_${code}` : 'FIRECRAWL_AUTH_FAILED' };
    }
    if (res.status === 402) return { kind: 'unavailable', reason: 'FIRECRAWL_NO_CREDITS' };
    if (res.status === 429) return { kind: 'unavailable', reason: 'FIRECRAWL_RATE_LIMITED' };
    return { kind: 'unavailable', reason: `FIRECRAWL_HTTP_${res.status}${code ? ` ${code}` : ''}: ${error.slice(0, 120)}` };
  }
  if (!json) return { kind: 'unavailable', reason: 'FIRECRAWL_BAD_JSON' };
  if (json.success === false) return { kind: 'unavailable', reason: `FIRECRAWL_${code || 'FAILED'}: ${error.slice(0, 120)}` };
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

/**
 * Does a confirm scrape reproduce the suspect's failure? The rule, for a
 * suspect of kind `problem`:
 *   - Firecrawl could not run it (402, 429, 5xx, queue timeout, bad key):
 *     inconclusive;
 *   - the site could not be reached (DNS, connection, TLS): broken for an
 *     HTTP error or load failure, inconclusive for a judged break;
 *   - 408, the page did not load in time: broken for a load failure only,
 *     inconclusive otherwise (a slow page is not an error screen or a 5xx);
 *   - the page answered 5xx or a 4xx other than 401/403/407/429: broken,
 *     whatever the suspect's kind; 401/403/407/429: inconclusive;
 *   - no status and no content: inconclusive;
 *   - a non-HTML page that loaded: healthy;
 *   - otherwise the settled markdown decides: blank, only a skip link, or a
 *     short page (≤ 200 characters besides skip links) showing an error or
 *     loading screen is broken; anything else is healthy.
 */
export function judgeConfirmation(scrape: ConfirmScrape, problem: PageProblem['problem']): ConfirmVerdict {
  if (scrape.kind === 'unavailable') {
    return { outcome: 'inconclusive', detail: `The confirm scrape could not run (${scrape.reason}).`, statusCode: null };
  }
  if (scrape.kind === 'unreachable') {
    const detail = `Loaded again, the site could not be reached (${scrape.code}: ${scrape.error.slice(0, 160)}).`;
    return { outcome: isHardProblem(problem) ? 'broken' : 'inconclusive', detail, statusCode: null };
  }
  if (scrape.kind === 'timed_out') {
    const detail = `Loaded again, the page did not finish loading within ${CONFIRM_TIMEOUT_MS / 1000} seconds.`;
    return { outcome: problem === 'load_error' ? 'broken' : 'inconclusive', detail, statusCode: null };
  }
  const code = scrape.statusCode;
  if (code !== null && code >= 400) {
    // An auth wall or a rate limit now says nothing about the earlier failure.
    if (NOT_BREAKAGE.has(code)) {
      return { outcome: 'inconclusive', detail: `Loaded again, the page answered HTTP ${code}.`, statusCode: code };
    }
    return { outcome: 'broken', detail: `Loaded again, the page returned HTTP ${code}.`, statusCode: code };
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

/** The confirm scrapes one watch may still start in this poll run. */
export interface ConfirmBudget {
  remaining: number;
  /**
   * Epoch ms by which every confirm scrape must be able to finish: one starts
   * only while now + CONFIRM_WORST_CASE_MS is at or before it.
   */
  deadline: number;
}

export interface SettleDeps extends ProcessDeps {
  /** One confirm scrape, on the watch's own Firecrawl key. */
  confirm: (url: string) => Promise<ConfirmScrape>;
  budget: ConfirmBudget;
}

/** How a filed page was seen failing a second time. */
export interface FilingEvidence {
  /**
   * `unconfirmed` (a confident judgment whose confirms stayed inconclusive)
   * and `flapping` (a 5xx found healthy again and again) file at low severity.
   */
  basis: 'confirm_scrape' | 'two_checks' | 'outage_sample' | 'unconfirmed' | 'flapping';
  detail: string;
  statusCode: number | null;
}

/** Evidence weak enough to file at low severity, and never into an outage report. */
function isWeakEvidence(evidence: FilingEvidence | undefined): boolean {
  return evidence?.basis === 'unconfirmed' || evidence?.basis === 'flapping';
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
  // says otherwise. Weak evidence files at low.
  const severity = isWeakEvidence(evidence)
    ? 'low'
    : problem.statusCode !== null && problem.statusCode >= 500
      ? 'high'
      : 'medium';
  const mark = evidence?.basis === 'unconfirmed' ? ' (unconfirmed)' : evidence?.basis === 'flapping' ? ' (intermittent)' : '';
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `Live site: ${headline}${mark}`.slice(0, 200),
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
  problem: PageProblem['problem'] | null;
  resolved_at: string | null;
  report_id: string | null;
  /** Null while the page is a suspect; set when its report is filed. */
  confirmed_at: string | null;
  fail_streak: number | null;
  last_failed_check_id: string | null;
  judge_fail_open: boolean | null;
}

/**
 * Filed, not a suspect. The poll deployed before ADR 0029 files rows with
 * `report_id` set and `confirmed_at` null; those are filed too.
 */
export function isFiled(row: { confirmed_at?: string | null; report_id?: string | null }): boolean {
  return Boolean(row.confirmed_at || row.report_id);
}

/**
 * An open judged break the next check shows unchanged. The judge runs only
 * on a page that changed, so `same` means the page still shows what the
 * judge called broken: not a sign it recovered.
 */
function stillShowsJudgedBreak(row: FindingRow, page: MonitorPage): boolean {
  if (row.problem !== 'judged_broken' || page.status !== 'same') return false;
  return typeof page.statusCode !== 'number' || page.statusCode < 400;
}

/**
 * Record what a finished check saw. Nothing is filed here: a newly broken
 * page becomes a suspect, and `settleSuspects` decides whether it files.
 *
 * - A page that is fine again resolves its row: a filed finding is closed,
 *   a suspect is dropped. Either way, filing again needs a second
 *   observation again. An open judged break stays open on `same` (see
 *   `stillShowsJudgedBreak`); it closes on a change the judge does not call
 *   broken, on a healthy confirm scrape, or when the page is removed.
 * - A suspect seen failing again by a later check counts that check once
 *   (two polls can read the same check; `last_failed_check_id` keeps it to
 *   one), and earns fresh confirm attempts. Only an HTTP error or a load
 *   failure adds to `fail_streak`.
 * - A newly broken page is CLAIMED as a suspect row (unique per watch and
 *   url, or a conditional reopen of a resolved row), so overlapping polls
 *   record it once. A reopen keeps `flap_dismissals`.
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
    .select('id, url, problem, resolved_at, report_id, confirmed_at, fail_streak, last_failed_check_id, judge_fail_open')
    .eq('watch_id', watch.id);
  if (readErr) throw new Error(`site_watch_pages read failed: ${readErr.message}`);
  const existing = new Map(((existingRows ?? []) as FindingRow[]).map((r) => [r.url, r]));

  for (const page of pages) {
    const problem = classifyPage(page);
    const row = existing.get(page.url);
    if (!problem) {
      if (row && !row.resolved_at && stillShowsJudgedBreak(row, page)) {
        result.broken++;
        const patch: Record<string, unknown> = { last_seen_at: nowIso };
        if (!isFiled(row)) {
          result.suspects++;
          if (row.last_failed_check_id !== checkId) {
            patch.last_failed_check_id = checkId;
            patch.confirm_attempts = 0;
          }
        }
        await db.from('site_watch_pages').update(patch).eq('id', row.id);
        continue;
      }
      // No longer broken: it loads, it was removed from the site, it changed
      // in a way the judge does not call broken, or Firecrawl now skips it
      // on purpose.
      if (row && !row.resolved_at) {
        await db
          .from('site_watch_pages')
          .update({ resolved_at: nowIso, fail_streak: 0, confirm_attempts: 0 })
          .eq('id', row.id)
          .is('resolved_at', null);
        if (isFiled(row)) result.resolved++;
      }
      continue;
    }
    result.broken++;
    const hard = isHardProblem(problem.problem);
    const failOpen = Boolean(problem.judgeFailOpen);

    if (row && !row.resolved_at) {
      const patch: Record<string, unknown> = {
        last_seen_at: nowIso,
        status_code: problem.statusCode,
        detail: problem.detail,
        problem: problem.problem,
        // A suspect a confident judgment ever named stays a confident one.
        judge_fail_open: hard ? false : Boolean(row.judge_fail_open) && failOpen,
      };
      if (!isFiled(row)) {
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
      judge_fail_open: failOpen,
      inconclusive_checks: 0,
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
  watch_id?: string;
  url: string;
  problem: PageProblem['problem'];
  status_code: number | null;
  detail: string | null;
  first_seen_at: string | null;
  fail_streak: number | null;
  confirm_attempts: number | null;
  last_confirm_at: string | null;
  last_confirm: { outcome?: string; checkId?: string | null } | null;
  last_failed_check_id: string | null;
  judge_fail_open: boolean | null;
  inconclusive_checks: number | null;
  flap_dismissals: string[] | null;
}

const SUSPECT_COLUMNS =
  'id, watch_id, url, problem, status_code, detail, first_seen_at, fail_streak, confirm_attempts, last_confirm_at, ' +
  'last_confirm, last_failed_check_id, judge_fail_open, inconclusive_checks, flap_dismissals';

/** May this suspect get a confirm scrape now (budget and deadline aside)? */
function confirmEligible(s: SuspectRow, now: Date, baseUrl: string): boolean {
  if ((s.confirm_attempts ?? 0) >= CONFIRM_ATTEMPTS_PER_CHECK) return false;
  if (s.last_confirm_at && now.getTime() - Date.parse(s.last_confirm_at) < CONFIRM_RETRY_AFTER_MS) return false;
  return sameSite(s.url, baseUrl);
}

/** Suspects of one watch that could take a confirm scrape now. */
export interface WatchSuspects {
  watchId: string;
  /** first_seen_at of its oldest pending suspect. */
  oldestPendingAt: string;
  eligible: number;
}

/**
 * The confirm-eligible suspects of each watch, for `allocateConfirms`. Rows
 * the old poll filed (`report_id` set) are not suspects.
 */
export async function pendingConfirmsByWatch(
  db: SupabaseClient,
  watches: SiteWatchRow[],
  now: Date,
): Promise<WatchSuspects[]> {
  if (watches.length === 0) return [];
  const { data, error } = await db
    .from('site_watch_pages')
    .select(SUSPECT_COLUMNS)
    .in(
      'watch_id',
      watches.map((w) => w.id),
    )
    .is('resolved_at', null)
    .is('confirmed_at', null)
    .is('report_id', null);
  if (error) throw new Error(`site_watch_pages pending read failed: ${error.message}`);
  const base = new Map(watches.map((w) => [w.id, w.base_url]));
  const byWatch = new Map<string, WatchSuspects>();
  for (const s of (data ?? []) as unknown as SuspectRow[]) {
    const baseUrl = s.watch_id ? base.get(s.watch_id) : undefined;
    if (!baseUrl || !confirmEligible(s, now, baseUrl)) continue;
    const seen = s.first_seen_at ?? now.toISOString();
    const w = byWatch.get(s.watch_id!) ?? { watchId: s.watch_id!, oldestPendingAt: seen, eligible: 0 };
    w.eligible++;
    if (seen < w.oldestPendingAt) w.oldestPendingAt = seen;
    byWatch.set(s.watch_id!, w);
  }
  return [...byWatch.values()];
}

/**
 * Share a run's confirm scrapes fairly: watches in order of their oldest
 * pending suspect, each gets one before any gets a second, never more than
 * `perWatch` or than it has eligible suspects.
 */
export function allocateConfirms(
  watches: WatchSuspects[],
  total: number,
  perWatch = CONFIRM_SCRAPES_PER_WATCH,
): Map<string, number> {
  const order = watches
    .slice()
    .sort((a, b) => (a.oldestPendingAt < b.oldestPendingAt ? -1 : a.oldestPendingAt > b.oldestPendingAt ? 1 : 0));
  const out = new Map<string, number>();
  let remaining = total;
  for (let round = 0; round < perWatch && remaining > 0; round++) {
    for (const w of order) {
      if (remaining <= 0) break;
      const have = out.get(w.watchId) ?? 0;
      if (have >= Math.min(perWatch, w.eligible)) continue;
      out.set(w.watchId, have + 1);
      remaining--;
    }
  }
  return out;
}

/**
 * The problem a filed suspect reports. The confirm scrape's status code
 * replaces the crawl's only when it is an error (≥ 400): a 200 from a page
 * that is still a blank shell must not title the report "returns HTTP 200".
 */
function suspectProblem(s: SuspectRow, confirmStatus?: number | null): PageProblem {
  return {
    problem: s.problem,
    statusCode: confirmStatus != null && confirmStatus >= 400 ? confirmStatus : s.status_code,
    detail: s.detail?.trim() || 'The page looked broken in the last check.',
  };
}

/** Dismissals of a 5xx inside the flapping window, oldest first. */
function recentDismissals(list: string[] | null, now: Date): string[] {
  return (Array.isArray(list) ? list : []).filter(
    (t) => typeof t === 'string' && now.getTime() - Date.parse(t) < FLAP_WINDOW_MS,
  );
}

type Filing = { s: SuspectRow; problem: PageProblem; title: string | null; evidence: FilingEvidence };

/**
 * File the suspects that were seen failing a second time; drop the ones a
 * confirm scrape finds healthy.
 *
 * 1. Up to `deps.budget.remaining` suspects (the watch's share of the run,
 *    `allocateConfirms`) get a confirm scrape: measured failures first. Each
 *    is claimed first (`confirm_attempts` compare-and-set) so overlapping
 *    polls do not scrape the same page twice. None starts when it could not
 *    finish by the run deadline.
 * 2. A confirm scrape decides when it is conclusive (`judgeConfirmation`):
 *    broken files, healthy drops the suspect, except that a 5xx found
 *    healthy FLAP_DISMISSALS times within FLAP_WINDOW_MS files at low
 *    severity as intermittent. Inconclusive leaves it for the rules below
 *    or a later poll.
 * 3. An HTTP error or load failure seen in two checks in a row files without
 *    a conclusive confirm scrape. A confident judged break whose confirms
 *    stayed inconclusive in UNCONFIRMED_AFTER_CHECKS checks files at low
 *    severity, marked unconfirmed. A fail-open judgment never files here.
 * 4. Five or more suspects of one kind, with at least two sampled and still
 *    broken and none sampled healthy, file together as one outage.
 *
 * Filing claims each row (`confirmed_at` set where it and `report_id` are
 * still null), so a page files once; a failed report insert gives the claim
 * back.
 */
export async function settleSuspects(db: SupabaseClient, watch: SiteWatchRow, deps: SettleDeps): Promise<SettleResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const result: SettleResult = { scrapes: 0, dismissed: 0, confirmed: 0, filed: 0 };

  const { data: rows, error: readErr } = await db
    .from('site_watch_pages')
    .select(SUSPECT_COLUMNS)
    .eq('watch_id', watch.id)
    .is('resolved_at', null)
    .is('confirmed_at', null)
    .is('report_id', null);
  if (readErr) throw new Error(`site_watch_pages suspects read failed: ${readErr.message}`);
  const suspects = ((rows ?? []) as unknown as SuspectRow[])
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
    if (deps.budget.remaining <= 0 || now.getTime() + CONFIRM_WORST_CASE_MS > deps.budget.deadline) break;
    if (!confirmEligible(s, now, watch.base_url)) continue;
    const attempts = s.confirm_attempts ?? 0;
    const { data: won, error: claimErr } = await db
      .from('site_watch_pages')
      .update({ confirm_attempts: attempts + 1, last_confirm_at: nowIso })
      .eq('id', s.id)
      .eq('confirm_attempts', attempts)
      .is('confirmed_at', null)
      .is('report_id', null)
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
      return { s, scrape, verdict: judgeConfirmation(scrape, s.problem) };
    }),
  );
  result.scrapes = verdicts.length;

  const toFile = new Map<string, Filing>();
  const healthy = new Set<string>();
  const inconclusiveChecks = new Map<string, number>();
  for (const { s, scrape, verdict } of verdicts) {
    const lastConfirm = {
      outcome: verdict.outcome,
      detail: verdict.detail,
      statusCode: verdict.statusCode,
      at: nowIso,
      checkId: s.last_failed_check_id,
    };
    if (verdict.outcome === 'healthy') {
      const flapping = s.problem === 'http_error' && (s.status_code ?? 0) >= 500;
      const dismissals = flapping ? [...recentDismissals(s.flap_dismissals, now), nowIso] : recentDismissals(s.flap_dismissals, now);
      if (flapping && dismissals.length >= FLAP_DISMISSALS) {
        await db.from('site_watch_pages').update({ last_confirm: lastConfirm, flap_dismissals: dismissals }).eq('id', s.id);
        toFile.set(s.id, {
          s,
          problem: suspectProblem(s),
          title: scrape.kind === 'loaded' ? scrape.title : null,
          evidence: {
            basis: 'flapping',
            detail:
              `The crawl saw HTTP ${s.status_code} on this page ${dismissals.length} times in ` +
              `${FLAP_WINDOW_MS / 86_400_000} days, and each time it loaded fine a few minutes later.`,
            statusCode: s.status_code,
          },
        });
        continue;
      }
      healthy.add(s.id);
      await db
        .from('site_watch_pages')
        .update({ resolved_at: nowIso, fail_streak: 0, confirm_attempts: 0, last_confirm: lastConfirm, flap_dismissals: dismissals })
        .eq('id', s.id)
        .is('confirmed_at', null)
        .is('report_id', null)
        .is('resolved_at', null);
      result.dismissed++;
      continue;
    }
    const patch: Record<string, unknown> = { last_confirm: lastConfirm };
    if (verdict.outcome === 'inconclusive') {
      // Count each check once, however many confirms ran for it.
      const counted = s.last_confirm?.outcome === 'inconclusive' && s.last_confirm?.checkId === s.last_failed_check_id;
      const n = (s.inconclusive_checks ?? 0) + (counted ? 0 : 1);
      inconclusiveChecks.set(s.id, n);
      patch.inconclusive_checks = n;
    }
    await db.from('site_watch_pages').update(patch).eq('id', s.id);
    if (verdict.outcome === 'broken') {
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s, verdict.statusCode),
        title: scrape.kind === 'loaded' ? scrape.title : null,
        evidence: { basis: 'confirm_scrape', detail: verdict.detail, statusCode: verdict.statusCode },
      });
    }
  }

  // 3. Two checks in a row for measured failures; unconfirmed for confident judgments.
  for (const s of suspects) {
    if (toFile.has(s.id) || healthy.has(s.id)) continue;
    if (isHardProblem(s.problem) && (s.fail_streak ?? 0) >= 2) {
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s),
        title: null,
        evidence: { basis: 'two_checks', detail: 'The page failed in two checks in a row.', statusCode: s.status_code },
      });
      continue;
    }
    const inconclusive = inconclusiveChecks.get(s.id) ?? s.inconclusive_checks ?? 0;
    if (s.problem === 'judged_broken' && !s.judge_fail_open && inconclusive >= UNCONFIRMED_AFTER_CHECKS) {
      toFile.set(s.id, {
        s,
        problem: suspectProblem(s),
        title: null,
        evidence: {
          basis: 'unconfirmed',
          detail:
            `Firecrawl's checker called the page broken, and Mushi could not load it again to confirm in ` +
            `${inconclusive} checks (the confirm scrapes failed on Firecrawl's side or were blocked).`,
          statusCode: s.status_code,
        },
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
      if (toFile.has(s.id) && !isWeakEvidence(toFile.get(s.id)!.evidence)) continue;
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
  const claimed: Filing[] = [];
  for (const f of toFile.values()) {
    const { data, error } = await db
      .from('site_watch_pages')
      .update({ confirmed_at: nowIso })
      .eq('id', f.s.id)
      .is('confirmed_at', null)
      .is('report_id', null)
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

  // Weak evidence (unconfirmed, intermittent) always files on its own, at low.
  const strong = claimed.filter((c) => !isWeakEvidence(c.evidence));
  const weak = claimed.filter((c) => isWeakEvidence(c.evidence));
  const single = (c: Filing) => ({
    report: buildSiteWatchReport(watch.project_id, c.s.url, c.problem, c.title, now, c.evidence),
    members: [c],
  });
  const groups = [
    ...(strong.length >= OUTAGE_PAGE_THRESHOLD
      ? [
          {
            report: buildSiteOutageReport(
              watch.project_id,
              watch.base_url,
              strong.map((c) => ({ url: c.s.url, problem: c.problem, evidence: c.evidence })),
              now,
            ),
            members: strong,
          },
        ]
      : strong.map(single)),
    ...weak.map(single),
  ];

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
      // A filed flap starts its count again.
      const patch: Record<string, unknown> = { report_id: g.report.id };
      if (m.evidence.basis === 'flapping') patch.flap_dismissals = [];
      await db.from('site_watch_pages').update(patch).eq('id', m.s.id);
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
