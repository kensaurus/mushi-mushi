# 0029. The live-site watch files a page only after a second failure

Status: Accepted (owner-delegated, 2026-10-21) Date: 2026-10-21

Amends: ADR 0024 ("What counts as broken" and "One report per broken page").
Related: migration `20261020152752_site_watch_confirm_before_filing.sql`,
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
  it is seen failing a second time:
  - a **confirm scrape** (`POST /v2/scrape` with `waitFor` 10 s on top of
    Firecrawl's smart wait, `maxAge: 0`, markdown, main content, the site-watch
    User-Agent, same project key) still sees it broken: the same kind of error
    status, a 408 (did not load within 45 s), or a settled page that is still
    blank, only a skip link, a loading screen or an error screen. A page with
    more than 200 characters of other text is never a loading or error screen.
    A healthy confirm drops the suspect.
  - **or two checks in a row**, but only for measured failures (an HTTP error
    or a load failure) and only when no confirm scrape was conclusive.
    A judged break files only through a confirm scrape: a boot card with a
    rotating tip "changes" on every check, so the judge can repeat itself.
- **The judge's fail-open is never evidence.** "Defaulting to meaningful",
  and any `confidence: low` judgment, makes a suspect that only a confirm
  scrape can file.
- **Five or more suspects of one kind** (measured, or judged) with at least two
  sampled and still broken, and none sampled healthy, file together as one
  outage report, so a site-wide outage does not wait for one confirm per page.
- **Spend is capped.** 6 confirm scrapes per poll run across every watch (3 per
  watch, in parallel), 3 per page per check that saw it, none within 10
  minutes of the last for that page, none started after 90 s of the run.
- **Settling runs every hourly poll**, whether or not a new check finished, so
  a suspect left unconfirmed is retried within the hour.
- **Self-heal is unchanged in spirit.** A page that is fine in a later check
  closes its finding (or drops its suspect); to file again it must fail
  twice again.
- **No viewport on site-watch reports.** The scrape endpoint has no viewport
  option (a viewport exists only for the screenshot format), so none is known.

## Rejected

- **A larger `waitFor` alone.** It fixes slow loads but not the judge's
  fail-open, and needs a scrape per suspect anyway.
- **Filtering judge reasons only.** Leaves the mid-load captures, which had
  confident judgments.
- **Two checks for every kind.** A judged boot-card shell would still file on
  day two; and a daily schedule makes every real outage wait a day.
- **Setting a viewport through a screenshot format or actions.** Not
  documented to change how the page renders for markdown; costs more.

## Consequences

- Up to 6 more credits per poll run; in practice about 1 per suspect per day.
  A confirm that Firecrawl fails on its side costs nothing.
- A real 5xx usually files within the hour of the check that saw it (the
  confirm reproduces it). If Firecrawl cannot confirm, it files on the next
  check.
- A page that flaps (broken in the crawl, fine 10 seconds later) is not filed.
- "Broken right now" in the console lists filed findings only; suspects are
  internal (`site_watch_pages.confirmed_at is null`).
