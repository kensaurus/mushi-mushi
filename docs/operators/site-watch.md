# Live-site watch: operator notes

The live-site watch ([ADR 0024](../adr/0024-live-site-watch-files-broken-pages-as-reports.md))
loads an app's public pages once a day through a Firecrawl monitor on the
project's own Firecrawl key, and files each newly broken page as a report.
Users turn it on from **Inventory → Discovery → Watch your live site**; the
user-facing description is in
[`apps/docs/content/admin/inventory.mdx`](../../apps/docs/content/admin/inventory.mdx).

## The page list (ADR 0059)

Since 2026-11-13 the monitor is not a crawl. It is scrape targets over an
explicit page list, and every URL carries `mushi_monitor=watch`
([ADR 0059](../adr/0059-site-watch-loads-a-marked-page-list-not-a-crawl.md)).
A crawl marked only its seed URL, so about 500 page loads a day reached the
apps unmarked.

- **Building the list** (`selectWatchUrls`). The list holds at most
  `page_limit` pages, base first. It takes:
  1. the pages already watched;
  2. the newest check's pages (on the switch, the crawl's link-found pages);
  3. `/v2/map` pages, shallow first.

  Sitemaps, feeds and files are left out. When a page appears with and
  without a trailing slash, the slash form wins.
- **When a page leaves:** only when the map no longer lists it, it answered
  404/410, and its finding has already filed. A 404 waiting to file stays,
  so link-found 404s still reach a report. A dead URL the map lists is
  loaded, and its 404 files.
- **Refresh** (`refreshWatchPages`). The list refreshes once a day, after the
  poll reads the scheduled check (1 map credit), and on a stale shape (the old
  crawl, a missing UA or marker). The console's Save builds it the same way.
- **Every PATCH resets every page's history**, even with an unchanged list
  (verified 2026-11-13: the next check reports all pages `new`). So the poll
  PATCHes only when the page set changes or the shape is stale.
  - A failed or thin map (under 2 pages, or under half the watched ones)
    cannot shrink the list.
- **Closed on PATCH:** open findings of pages outside the new list
  (`resolvePagesOutside`).
- **Limits:** 100 URLs per scrape target (Firecrawl accepted 100 on
  2026-11-13; its docs name no limit), up to 50 targets per monitor. With
  `page_limit` ≤ 100, one target holds a watch.
- **Budget:** unchanged. The cap is 800 page loads a day over 8 watches, about
  511 expected, plus 8 map credits a day.

**First poll after the deploy:** each crawl monitor is switched to a page
list. The next check reports every page `new`, so open judged-break findings
resolve once and the judge starts over for one check.

## A broken page files only when it is seen failing twice

[ADR 0029](../adr/0029-site-watch-files-a-page-only-after-a-second-failure.md)
amends 0024's filing rule. A page a check finds broken is a *suspect*:
`site_watch_pages.confirmed_at` and `report_id` are both null. A row that
the pre-0029 poll filed has `report_id` set and counts as filed.
`site-watch-poll` files a suspect when:

- a **confirm scrape** (`POST /v2/scrape`, `waitFor` 10 s, `maxAge: 0`, the
  project's own Firecrawl key, same User-Agent) still sees it broken. The
  ADR's table gives the exact rule per kind of suspect. In short:
  - an error status again;
  - an unreachable site (DNS/connection/TLS), for 5xx/4xx and load failures;
  - a 408, for load failures;
  - a settled page that is still blank, only a skip link, a loading screen
    or an error screen;
- for a 5xx/4xx or a load failure only, **two checks in a row** saw it, when
  no confirm scrape was conclusive;
- at low severity, as **unconfirmed**: a confident judged break after 2
  checks in which all 3 of that check's confirm attempts came back
  inconclusive (`inconclusive_checks`; one 429 does not count a check). A
  fail-open judgment (`judge_fail_open`) never files this way;
- at low severity, as **intermittent**: a 5xx that confirms found healthy
  3 times in 7 days (`flap_dismissals`).

A confirm scrape that finds the page healthy drops the suspect. A judged
break shown unchanged (`same`) stays open. Reports no longer carry a
viewport.

**Apps on the platform key.** An app with no Firecrawl key of its own runs
its watch on the platform `FIRECRAWL_API_KEY` and never gets a confirm
scrape. Its suspects file this way:
- a confident judged break files as unconfirmed (low severity) after 2 checks
  that still show it;
- 5xx/4xx and load failures file on the second check in a row, so a down site
  takes until the next daily check;
- fail-open judgments never file.

Add a Firecrawl key in Settings → AI keys to get confirms and same-hour
outage reports.

Cost:
- at most 6 confirm scrapes per poll run, shared across watches (oldest
  pending suspect first, one per watch before any gets a second; watches with
  only fail-open judgments pending come last);
- at most 3 per watch, run in parallel, and 3 per page per check;
- none within 10 minutes of that page's last confirm;
- none on the platform `FIRECRAWL_API_KEY` fallback;
- none that could not finish within 120 s of the run's start.

Each confirm is 1 credit when Firecrawl returns the page, and 0 when it fails
on its side. If our 55 s abort fires first, Firecrawl may still charge.
`site_watch_pages.last_confirm` keeps the last verdict. The poll's response
lists `confirmScrapes` and `dismissed` per watch.

## Filter the crawler out of your monitoring and analytics

Firecrawl's browser loads every page with `document.referrer` set to
`https://www.google.com/` and a stock Linux Chrome `navigator.userAgent`. In
your analytics, Mushi's scheduled jobs therefore look like Google visitors.
Before 2026-11-13 that was about 5× the real traffic of each KENSAURUS app.

Since 2026-11-13, every Mushi job that loads a page of your app through
Firecrawl marks the request in two ways (`_shared/monitor-url.ts`).

**The URL** gets these params, after any query the URL already has. The
fragment stays last, and a param that is already there is not added again:

```
?mushi_monitor=<watch|audit|qa>&utm_source=mushi-monitor&utm_medium=<watch|audit|qa>
```

- Firecrawl strips `utm_*` (and `gclid`) before its browser navigates, so
  filter on **`mushi_monitor`**. It reaches the server and `location.href`
  (verified 2026-11-13).
- The UTM pair is there for crawlers that keep it.

| `mushi_monitor` | Job |
| --- | --- |
| `watch` | Live-site watch: every listed page and the confirm scrapes, and the Home card screenshot |
| `audit` | Site audit batch, Production Check, inventory renders |
| `qa` | QA stories (`firecrawl_actions`), story-mapper page scrapes |

**The `User-Agent` request header** is a normal Chrome UA with a Mushi token
appended:

```
Mozilla/5.0 (…) Chrome/141.0.0.0 Safari/537.36 MushiSiteWatch/1.0 (+https://kensaur.us/mushi-mushi)
```

Filters to set:

- **Analytics** (PostHog, GA4, Plausible, …): exclude page views whose URL
  contains `mushi_monitor=`.
- **Sentry:** drop the event in `beforeSend` when the page URL contains
  `mushi_monitor=` or the request's `User-Agent` contains `MushiSiteWatch`.
- **Server logs and rate limits:** match either string.

Known limits:

- **A redirect can drop the marker.** A host redirect that drops the query
  string, such as kensaur.us's slash redirect, removes it. The page list
  prefers the trailing-slash form for that reason.
- **The User-Agent header is unverified at the HTTP level.** Mushi sends it on
  every page load, but there was no Firecrawl key to check what Firecrawl's
  browser actually sends.
- **The page's JavaScript can't see the header.** It reads Firecrawl's stock
  `navigator.userAgent` (verified 2026-11-13), so a client-side filter has to
  match the URL marker.
- **Map calls are not marked.** They discover URLs and render no page.
- **Non-customer Firecrawl calls are not marked:** known-issue search,
  research, changelogs.

`monitor-url-guard.test.ts` fails when a new Firecrawl call site is neither
marked nor classified as loading no customer page. It also fails when anything
starts a crawl or builds a crawl monitor target.

## Monitors created before ADR 0059

The poll switches a stale monitor itself (`monitorNeedsReconcile`). Stale
means a crawl target, a target without the current User-Agent, or an unmarked
URL. Nobody needs to re-save a watch.

Firecrawl does not cache a scrape sent with custom headers, so each check is a
live fetch. Credit use is unchanged.
