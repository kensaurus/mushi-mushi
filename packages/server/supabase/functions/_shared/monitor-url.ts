/**
 * FILE: monitor-url.ts
 * PURPOSE: The one place that marks a request Mushi sends to Firecrawl to
 *          load a page of a customer's app (live-site watch, site audit,
 *          production check, QA stories, story mapping, inventory renders,
 *          Home thumbnails), so the app can tell Mushi's traffic from people.
 *
 * Why (2026-11-13): Firecrawl's browser loads every page with
 * `document.referrer = https://www.google.com/` and a stock Linux Chrome
 * User-Agent, so each scheduled Mushi job showed up in the apps' analytics
 * as a Google visitor, about 5× the real traffic.
 *
 * What a tagged URL carries, appended after any query it already has (the
 * fragment stays last and untouched, and a param already present is never
 * added twice):
 *   - `mushi_monitor=<kind>`: the marker that reaches the app. Firecrawl
 *     strips `utm_*` (and `gclid`) from the URL before its browser navigates,
 *     checked live on 2026-11-13 against httpbin.org/anything: the server
 *     and `location.href` saw `mushi_monitor` but no `utm_*`. Filter on this.
 *   - `utm_source=mushi-monitor&utm_medium=<kind>`: for any crawler that
 *     keeps them. Firecrawl drops them, so never rely on them there.
 *
 * Request bodies also get the Mushi User-Agent header (`headers`), unless
 * the caller set its own. The page's own JavaScript still sees Firecrawl's
 * stock `navigator.userAgent` (checked 2026-11-13).
 *
 * Every Firecrawl call that loads a customer page builds its URL here;
 * `monitor-url-guard.test.ts` fails when a new Firecrawl call site is not
 * classified. Map calls (`/v2/map`) are not tagged: they discover URLs and
 * render no page, and a query on the map input could narrow its link set.
 */

/** The kind of job loading the page: the value of the marker and of `utm_medium`. */
export type MonitorJobKind = 'watch' | 'audit' | 'qa';

export const MONITOR_JOB_KINDS: readonly MonitorJobKind[] = ['watch', 'audit', 'qa'];

/** The query param that survives Firecrawl's URL cleaning. */
export const MONITOR_MARKER_PARAM = 'mushi_monitor';

export const MONITOR_UTM_SOURCE = 'mushi-monitor';

/**
 * The User-Agent every Mushi page load sends, so a host app can drop the
 * crawler from its error monitoring and analytics (match "MushiSiteWatch").
 * A normal Chrome UA comes first so sites that sniff for a browser still
 * serve the real page.
 */
export const MONITOR_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 ' +
  'MushiSiteWatch/1.0 (+https://kensaur.us/mushi-mushi)';

interface UrlParts {
  /** Everything before `?` (or before `#` when there is no query). */
  head: string;
  /** The query without its `?`; null when the URL has no `?`. */
  query: string | null;
  /** `#…` including the `#`, or ''. */
  hash: string;
}

/** Split by string, not `new URL()`: that would re-encode the query and add a trailing slash. */
function splitUrl(url: string): UrlParts {
  const h = url.indexOf('#');
  const beforeHash = h < 0 ? url : url.slice(0, h);
  const hash = h < 0 ? '' : url.slice(h);
  const q = beforeHash.indexOf('?');
  return q < 0
    ? { head: beforeHash, query: null, hash }
    : { head: beforeHash.slice(0, q), query: beforeHash.slice(q + 1), hash };
}

function paramName(pair: string): string {
  const raw = pair.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** The pairs `tagMonitorUrl` appends, in order, for `kind`. */
function monitorPairs(kind: MonitorJobKind): Array<[string, string]> {
  return [
    [MONITOR_MARKER_PARAM, kind],
    ['utm_source', MONITOR_UTM_SOURCE],
    ['utm_medium', kind],
  ];
}

/**
 * `url` with Mushi's marker and UTM params appended (see the file header).
 * A non-http(s) string is returned as it is.
 */
export function tagMonitorUrl(url: string, kind: MonitorJobKind): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const { head, query, hash } = splitUrl(url);
  const have = new Set((query ?? '').split('&').filter(Boolean).map(paramName));
  const add = monitorPairs(kind)
    .filter(([k]) => !have.has(k))
    .map(([k, v]) => `${k}=${v}`);
  if (add.length === 0) return url;
  const joined = query ? `${query}&${add.join('&')}` : add.join('&');
  return `${head}?${joined}${hash}`;
}

const OUR_PAIR = new RegExp(
  `^(?:${MONITOR_MARKER_PARAM}=(?:${MONITOR_JOB_KINDS.join('|')})|utm_source=${MONITOR_UTM_SOURCE}|utm_medium=(?:${MONITOR_JOB_KINDS.join('|')}))$`,
);

/**
 * `url` without the params `tagMonitorUrl` appended, for every URL that
 * comes back from Firecrawl and is stored or shown (page keys, report
 * titles, landed URLs). Only a trailing run of Mushi's own pairs is removed,
 * and only when it holds the marker or Mushi's utm_source, so a customer's
 * own `utm_medium=watch` is kept. Firecrawl answers with the `utm_*` pairs
 * already dropped (`metadata.url`) or kept (`metadata.sourceURL`); both untag.
 */
export function untagMonitorUrl(url: string): string {
  const { head, query, hash } = splitUrl(url);
  if (!query) return url;
  const parts = query.split('&');
  let cut = parts.length;
  while (cut > 0 && OUR_PAIR.test(parts[cut - 1])) cut--;
  const trailing = parts.slice(cut);
  const ours = trailing.some((p) => p.startsWith(`${MONITOR_MARKER_PARAM}=`) || p === `utm_source=${MONITOR_UTM_SOURCE}`);
  if (!ours) return url;
  const kept = parts.slice(0, cut);
  return kept.length > 0 ? `${head}?${kept.join('&')}${hash}` : `${head}${hash}`;
}

/** True when `url` carries Mushi's marker for `kind` (any kind when omitted). */
export function hasMonitorTag(url: string | null | undefined, kind?: MonitorJobKind): boolean {
  if (typeof url !== 'string') return false;
  const { query } = splitUrl(url);
  if (!query) return false;
  return query
    .split('&')
    .some((p) => (kind ? p === `${MONITOR_MARKER_PARAM}=${kind}` : OUR_PAIR.test(p) && p.startsWith(`${MONITOR_MARKER_PARAM}=`)));
}

/**
 * A Firecrawl scrape or batch-scrape body for a customer page load: `url`
 * and every string in `urls` tagged, and the Mushi User-Agent added to
 * `headers` unless the caller set one. Returns a copy; `body` is not changed.
 */
export function monitorScrapeBody<T extends Record<string, unknown>>(kind: MonitorJobKind, body: T): T {
  const out: Record<string, unknown> = { ...body };
  if (typeof out.url === 'string') out.url = tagMonitorUrl(out.url, kind);
  if (Array.isArray(out.urls)) {
    out.urls = out.urls.map((u) => (typeof u === 'string' ? tagMonitorUrl(u, kind) : u));
  }
  const given = out.headers && typeof out.headers === 'object' ? (out.headers as Record<string, string>) : {};
  const hasUa = Object.keys(given).some((k) => k.toLowerCase() === 'user-agent');
  out.headers = hasUa ? { ...given } : { 'User-Agent': MONITOR_USER_AGENT, ...given };
  return out as T;
}
