# 0029. The live-site watch files a page only after a second failure

Status: Accepted (owner-delegated, 2026-10-21) Date: 2026-10-21

Amends: ADR 0024 ("What counts as broken" and "One report per broken page").
Related: migrations `20261020152752_site_watch_confirm_before_filing.sql` and
`20261021100000_site_watch_unconfirmed_and_flapping.sql`,
`_shared/site-watch.ts` (`confirmScrape`, `judgeConfirmation`,
`processCheck`, `settleSuspects`), `site-watch-poll/index.ts`.

## Context

Under ADR 0024, one check that saw a page broken filed a report. Of the last
23 site-watch reports sent to coding agents (measured 2026-10-20), 9 were
pages that were fine. The agents loaded each page in headless Chrome:

- a shop page rendered its catalog; its shell always holds an empty
  `role="alert"` error panel, so the judge may have matched that copy;
- a docs route showed only a skip link for about 100 ms (its loading
  skeleton); by about 500 ms the article was in the DOM;
- an SPA sat on its `読み込み中` boot card for about 4.5 s on a cold load, and
  `/` took about 8.5 s before its h1 appeared;
- a public demo showed `「接続確認中…」` while one API request was in flight;
- the judge's reason was "Judge response not valid JSON — defaulting to
  meaningful": Firecrawl's change judge fails open.

Every report also carried a 0×0 viewport, which nothing had measured.

## Decision

- **A broken page in a check is a suspect, not a report.** It files only when
  it is seen failing a second time.
- **Confirm scrape.** `POST /v2/scrape` with `waitFor` 10 s on top of
  Firecrawl's smart wait, `timeout` 45 s, `maxAge: 0`, markdown, main content,
  the site-watch User-Agent, on the project's own key. What it counts
  (`judgeConfirmation`), for a suspect of each kind:

  | Confirm saw | HTTP error | Load failure | Judged break |
  | --- | --- | --- | --- |
  | 5xx, or 4xx other than 401/403/407/429 | broken | broken | broken |
  | 401/403/407/429 | inconclusive | inconclusive | inconclusive |
  | site unreachable (`SCRAPE_DNS_RESOLUTION_ERROR`, `SCRAPE_SITE_ERROR`, `SCRAPE_SSL_ERROR`) | broken | broken | inconclusive |
  | 408 `SCRAPE_TIMEOUT` (did not load in 45 s) | inconclusive | broken | inconclusive |
  | Firecrawl's side (401, 402, 429, 5xx, `CONCURRENCY_QUEUE_TIMEOUT`, 403 `UNSUPPORTED_SITE`, `SCRAPE_ALL_ENGINES_FAILED`) | inconclusive | inconclusive | inconclusive |
  | no status and no content | inconclusive | inconclusive | inconclusive |
  | a non-HTML page that loaded | healthy | healthy | healthy |
  | settled HTML: blank, only a skip link, or ≤ 200 characters (besides skip links) showing an error or loading screen | broken | broken | broken |
  | any other settled HTML | healthy | healthy | healthy |

  Broken files. Healthy drops the suspect. Inconclusive leaves it for the
  rules below or a later poll.

  The unreachable codes are not in docs.firecrawl.dev; they come from
  Firecrawl's source (`scrapeURL/error.ts`, `controllers/v2/scrape.ts`), which
  answers DNS failures with HTTP 200 and `success: false`.
- **Two checks in a row**, for HTTP errors and load failures only, when no
  confirm was conclusive.
- **A judged break that the next check shows unchanged (`same`) stays open.**
  The judge only runs on changed pages, so `same` is not recovery. It closes on
  a change the judge does not call broken, on a healthy confirm, or when the
  page is removed. Each later check that still shows it gets fresh confirm
  attempts.
- **Unconfirmed.** A confident judged break whose confirms stayed inconclusive
  in 2 checks files at low severity, titled "(unconfirmed)".
- **The judge's fail-open is never evidence.** A suspect named only by
  "Defaulting to meaningful" or a `confidence: low` judgment
  (`judge_fail_open`) files only through a confirm that reproduces the break,
  never as unconfirmed.
- **Intermittent.** A 5xx that a confirm finds healthy for the 3rd time in
  7 days files at low severity, titled "(intermittent)". The count
  (`flap_dismissals`) survives reopening the row and restarts when it files.
- **Outages.** Five or more suspects of one kind (measured, or judged) with at
  least two sampled and still broken, and none sampled healthy, file together
  as one outage report. For a site that is down, the sample comes back
  unreachable, so the outage files within the hour.
- **Rows the poll filed before this ADR** (`report_id` set, `confirmed_at`
  null) are filed, never suspects. This holds everywhere, the console
  included.
- **Spend and wall clock are capped.**
  - 6 confirm scrapes per poll run, shared across watches: oldest pending
    suspect first, and each watch gets one before any gets a second.
  - 3 per watch, run in parallel; 3 per page per check; none within 10 minutes
    of that page's last one.
  - No confirm runs on the platform's `FIRECRAWL_API_KEY` fallback, only on
    the project's own key, own or shared.
  - All watches settle in parallel. A confirm starts only if its worst case
    (55 s) still finishes within 120 s of the run's start, which is under the
    150 s edge-function limit.
- **Settling runs every hourly poll**, whether or not a new check finished, so
  a suspect left unconfirmed is retried within the hour.
- **Self-heal.** A page that is fine in a later check closes its finding (or
  drops its suspect). To file again it must fail twice again.
- **No viewport on site-watch reports.** The scrape endpoint has no viewport
  option (a viewport exists only for the screenshot format), so none is known.

## Rejected

- **A larger `waitFor` alone.** It fixes slow loads but not the judge's
  fail-open, and needs a scrape per suspect anyway.
- **Filtering judge reasons only.** Leaves the mid-load captures, which had
  confident judgments.
- **Two checks for every kind.** A judged boot-card shell would still file on
  day two, and a daily schedule makes every real outage wait a day.
- **Counting `SCRAPE_ALL_ENGINES_FAILED` as unreachable.** Anti-bot walls end
  there too.
- **Setting a viewport through a screenshot format or actions.** Not
  documented to change how the page renders for markdown, and it costs more.

## Consequences

- **Credits.** Up to 6 more per poll run; in practice about 1 per suspect per
  day. A confirm Firecrawl fails on its side costs nothing. When our own
  abort (55 s) fires before Firecrawl answers, Firecrawl may still finish the
  scrape and charge the credit.
- **Speed.**
  - A real 5xx usually files within the hour of the check that saw it, because
    the confirm reproduces it. If Firecrawl cannot confirm, it files on the
    next check.
  - A site that is down files within the hour, as one outage.
- **Flapping.** A page that flaps (broken in the crawl, fine 10 seconds later)
  files only as intermittent, after 3 times in 7 days.
- **Console.** "Broken right now" lists filed findings only (`confirmed_at` or
  `report_id` set); suspects are internal.
