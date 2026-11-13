# Live-site watch: operator notes

The live-site watch ([ADR 0024](../adr/0024-live-site-watch-files-broken-pages-as-reports.md))
crawls an app's public pages once a day through a Firecrawl monitor on the
project's own Firecrawl key, and files each newly broken page as a report.
Users turn it on from **Inventory → Discovery → Watch your live site**; the
user-facing description is in
[`apps/docs/content/admin/inventory.mdx`](../../apps/docs/content/admin/inventory.mdx).

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
| `watch` | Live-site watch: crawl seed and confirm scrapes, and the Home card screenshot |
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

- **Discovered pages carry no marker.** The watch's crawl target carries the
  marker only on its seed URL. Firecrawl loads the pages it discovers by their
  bare links, so for those only the `User-Agent` header identifies Mushi.
- **The page's JavaScript can't see the header.** It reads Firecrawl's stock
  `navigator.userAgent` (verified 2026-11-13), so a client-side filter has to
  match the URL marker.
- **Map calls are not marked.** They discover URLs and render no page.
- **Non-customer Firecrawl calls are not marked:** known-issue search,
  research, changelogs.

`monitor-url-guard.test.ts` fails when a new Firecrawl call site is neither
marked nor classified as loading no customer page. The live-site watch's poll
patches each existing monitor to the marked target URL once
(`monitorNeedsReconcile`).

## Monitors created before the header existed

The header is part of the monitor's crawl target, so a monitor created before
it was added does not send it until its target is saved again. Turning the
watch off and on, or saving it again from the console, sends the full target
to Firecrawl.

Firecrawl does not cache a scrape sent with custom headers, so each check is a
live fetch. Credit use is unchanged.
