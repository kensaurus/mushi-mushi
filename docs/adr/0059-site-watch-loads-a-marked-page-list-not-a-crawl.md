# 0059. The live-site watch loads a marked page list, not a crawl

Status: Accepted 2026-11-13 (owner-delegated: "the owner allows superseding
ADRs when we can do better"). Supersedes the monitor shape of
[ADR 0024](0024-live-site-watch-files-broken-pages-as-reports.md) (a crawl
target). ADR 0024's filing rules and
[ADR 0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) stand.
Date: 2026-11-13

Related: `_shared/monitor-url.ts`, `_shared/site-watch.ts`
(`monitorBody`, `selectWatchUrls`, `nextWatchUrls`, `refreshWatchPages`),
`site-watch-poll/index.ts`, `api/routes/site-watch.ts`,
`src/__tests__/monitor-url-guard.test.ts`, `docs/operators/site-watch.md`.

## Context

Mushi's own Firecrawl jobs were the "Google-referrer bot" that inflated every
KENSAURUS app's analytics about 5×. Firecrawl's browser loads each page with
`document.referrer = https://www.google.com/` and a stock Linux Chrome
`navigator.userAgent`, so an app cannot tell it from a person.

The fix marks each page load Mushi sends: a `mushi_monitor=<watch|audit|qa>`
query param (`_shared/monitor-url.ts`). Firecrawl strips `utm_*` before its
browser navigates; `mushi_monitor` reaches the server and `location.href`
(both checked live on 2026-11-13 against httpbin.org).

The live-site watch was a Firecrawl **crawl** target: one seed URL, then the
pages Firecrawl found by following the site's links. A query param on the seed
reaches only the seed; Firecrawl loads every discovered page by its bare link.
On 2026-11-13 the 8 watches were capped at 100 pages each and their last
checks loaded 509 pages, so about 500 page loads a day stayed unmarked.

Measured on 2026-11-13 with throwaway monitors (since deleted):

- A **scrape** target takes an explicit `urls` list and keeps each URL as
  sent, query string included. Every check page carries the HTTP status; a
  404 page comes back with `statusCode: 404`, not as `error`.
- One scrape target accepted 100 URLs. Firecrawl's docs give no per-target
  limit; a monitor takes 1–50 targets.
- Page history (`same` / `changed`, and so the judge) is kept per target id.
  **Any PATCH that sends `targets` makes new target ids, even with an
  unchanged list**, and the next check reports every page `new`.
- `/v2/map` on the 8 watched sites, filtered to pages under each base URL,
  found 10–241 pages per site. A map reads the
  sitemap and Firecrawl's index; it does not follow links, and it renders no
  page.

## Decision

The watch's monitor is **scrape targets over an explicit page list**. Every
URL is marked `mushi_monitor=watch` and sent with the `MushiSiteWatch`
User-Agent. Nothing starts a crawl: `monitor-url-guard.test.ts` fails on a
`/v2/crawl` call or a `type: 'crawl'` target.

- **The page list** (`selectWatchUrls`) holds bare URLs, base first, at most
  `page_limit` (unchanged: 1–100, default 25). Only same-site pages under the
  base path are listed, never sitemaps, feeds or files. Pages are taken in this
  order while there is room:
  1. the base URL;
  2. every page already watched, unless it **left the site**. A page left
     the site when the map no longer lists it, its last answer was 404 or
     410, and it holds no open finding (a suspect, or filed with its report
     still open);
  3. the newest check's pages, by the same rule. On the switch from a crawl,
     these are the pages the crawl reached by following links, broken links
     included;
  4. mapped pages, shallow paths first.
- **404s still alert.** Every listed page is loaded and its status recorded,
  so a page that answers 404 files through ADR 0029. A dead URL the map
  lists is loaded like any other. A 404 page stays listed while it holds an
  open finding: a suspect, or a filed one whose report is still open. It
  leaves only after a person closes the report (`fixed`, `resolved`,
  `verified` or `dismissed`) and the map no longer lists it. So a broken link
  that the sitemap also dropped keeps its finding open, and the Home "site up"
  light stays honest.
- **Each new page goes out in the site's own spelling**
  (`resolveSameSiteRedirects`). A HEAD with the Mushi User-Agent and no
  redirect following runs no page script, so it never reaches analytics. When
  the site answers with a redirect to the same page (a trailing slash added or
  removed), the target is listed instead. kensaur.us answers `/glot-it` with a
  301 to `/glot-it/` and drops the query string, and with it the marker.
  `/glot-it/` and `/glot-it/press` keep it (measured 2026-11-13). Without the
  resolver, the home page of every path-hosted app would stay unmarked.
  Watched pages keep the spelling they were resolved to.
- **The list refreshes once a day**, after `site-watch-poll` reads each new
  scheduled check: a `/v2/map` call (1 credit) plus that check's pages
  (`refreshWatchPages`). It also refreshes when the live monitor has a stale
  shape: a crawl from before this ADR, a missing User-Agent or an unmarked
  URL. The console's Save builds the first list the same way.
- **PATCH only on a real change.** A PATCH resets every page's history, so it
  is sent only when the page set changed (`sameUrlSet`) or the shape is
  stale.
  - A map that failed, found fewer than 2 pages, or found fewer than half the
    watched pages is not used, so a flaky map cannot shrink the list.
  - A crawl is never switched to a one-page watch from nothing; the switch
    waits for the next poll.
- **Findings of pages that leave the list are closed** (`resolvePagesOutside`):
  no check reads them again. That includes a crawl's pages that did not make
  the first list.
- **Chunking:** `MONITOR_URLS_PER_TARGET = 100` URLs per target, at most 50
  targets. One target holds a watch today, because `page_limit` ≤ 100.

## Page budget

The cap is unchanged at 1 page load per listed page per daily check, at most
`page_limit` per watch.

| | Before (crawl) | After (page list) |
|---|---|---|
| Page loads a day, cap | 800 (8 watches × 100) | 800 (unchanged) |
| Page loads a day, measured / computed | 509 (last checks, 2026-11-13) | 529 (crawl ∪ map per site, capped at 100; computed from the same checks and maps) |
| Map calls | 0 | 1 per watch per day (8 credits, no page render) |
| Unmarked page loads a day | ≈ 500 (every page but each seed) | 0 |

Per site, after the switch:

| Site | Crawl loaded | Map (in scope) | List |
|---|---|---|---|
| mushi-mushi | 100 | 241 | 100 |
| talk | 54 | 53 | 53 |
| yen-yen | 20 | 14 | 19 |
| tsumagoi | 79 | 98 | 100 |
| solo-boss | 100 | 127 | 100 |
| the-wanting-mind | 101 | 228 | 100 |
| help-her-take-photo | 11 | 10 | 10 |
| glot-it | 44 | 36 | 47 |

The cap is unchanged. Actual page loads rise by 20 a day (+4%), almost all
of it tsumagoi: its crawl stopped at depth 3 with 79 pages, and the map lists
98. Lowering a watch's `page_limit` lowers its list (the poll rebuilds it at
the next refresh). The other change is +8 map credits a day.

## Consequences

- Every scheduled watch page load carries `mushi_monitor=watch`, so apps can
  drop it from analytics with one URL filter.
- **Link discovery after the switch is limited to the map.** Pages the crawl
  found carry over. A page that only becomes reachable by a new link, and is
  in neither the sitemap nor Firecrawl's index, is not watched until the map
  finds it. The site audit (ADR 0040) still checks every link target on the
  pages it scrapes.
- **One history reset at deploy.** The first poll after the deploy PATCHes
  each crawl monitor into a page list. The next check reports every page
  `new`, so open judged-break findings resolve once and the judge starts over
  for one check. After that, a PATCH happens only when a site's page set
  changes.
- **Map credits:** about 240 a month for 8 watches (1 a day each). The map is
  never marked, because it renders no page.
- **Firecrawl dependency.** The URL-count limit and the PATCH behaviour were
  measured on 2026-11-13, not read from a spec. If Firecrawl starts rejecting
  100 URLs in one target, lower `MONITOR_URLS_PER_TARGET`; the monitor takes
  up to 50 targets.

## Rejected

- **Keep the crawl and mark only the seed.** About 500 unmarked page loads a
  day keep inflating every app's analytics, which is the whole problem.
- **`utm_*` params only.** Firecrawl strips them before its browser
  navigates.
- **One monitor per page, or a fresh monitor per refresh.** That means more
  objects to clean up on Firecrawl's side, and history is lost all the same.
- **PATCH the list on every poll.** Each PATCH resets every page's history and
  would blind the judge permanently.
- **Drop a page as soon as the map misses it.** The map does not follow
  links, so this would silently stop watching linked pages, and a 404 could
  leave the list before it files.
