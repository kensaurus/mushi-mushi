# 0024. The live-site watch files broken pages as reports

Status: Accepted (owner, 2026-10-10) Date: 2026-10-10

Related: migration `20261010190000_site_watch.sql`,
`_shared/site-watch.ts`, `site-watch-poll/index.ts`,
`api/routes/site-watch.ts`,
`apps/admin/src/components/inventory/SiteWatchCard.tsx`;
ADR 0017 (a hole found before a user hits it counts),
ADR 0023 (AI keys shared by every app).

## Context

The owner holds a Firecrawl plan with about 92,000 unused credits until
2026-11-03. Every Firecrawl use Mushi had (known-issue search, research,
live-site maps, changelog reads) costs a few credits per action, so the
credits went unused.

Broken pages on the live sites (a 500 after a deploy, a link to a removed
page, a blank screen) reached Mushi only when a user reported them, or never.

Firecrawl monitors (`/v2/monitor`) crawl a site on a schedule and record, per
page, its HTTP status and whether it is `same`, `new`, `changed`, `removed`
or `error`. A monitor can also take a plain-language goal: a judge decides
whether a changed page matches it.

A real check of kensaur.us/help-her-take-photo on 2026-10-10 confirmed two
things. Each page carries `statusCode`. A 404 does not show as `error`; it is
a normal page with status 404.

## Decision

- **Turned on per app** from Inventory → Discovery, "Watch your live site".
  - The watch is one Firecrawl crawl monitor: the app's live URL, up to N
    pages (default 25), daily at 01:30 UTC.
  - It runs and bills on the project's own Firecrawl key, own or shared
    (ADR 0023). The console shows Firecrawl's own estimate of credits per
    month.
- **Mushi polls the results; it does not take webhooks.**
  - Monitor webhooks are signed with a secret that only the key owner's
    Firecrawl dashboard shows. Accepting them would mean asking every user
    to paste it.
  - `site-watch-poll` reads each monitor's newly finished checks with the
    key Mushi already holds: hourly at :14 (pg_cron), and about 60 and 140
    seconds after "Check now". No public endpoint is added.
- **What counts as broken** (`classifyPage`):
  - a 5xx;
  - a 4xx other than 401/403/407/429. A crawl reaches only pages the app
    links to, so a 404 there is a broken link; auth walls and rate limits
    are not breakage;
  - a page that failed to load;
  - a changed page the judge calls broken under a fixed goal (error message,
    blank page, lost main content; normal edits ignored).
  - A page removed from the crawl is not reported.
- **One report per broken page.**
  - Each newly broken page becomes a report with `source = 'site_watch'`,
    queued for diagnosis like store reviews (the user opted in by turning on
    the watch).
  - `site_watch_pages` keeps one row per page. A page that stays broken does
    not file again. A page that loads cleanly again is resolved. If it
    breaks later, it files again.
- **Turning the watch off deletes the Firecrawl monitor.** Reports already
  filed stay.

## Consequences

- Six apps at 25 pages a day is about 4,500 credits a month, plus one per
  changed page the judge checks.
- Breakage on a public page can become a report before any user reports it.
  This passes ADR 0017's drift test: a hole found before a user hits it.
- Only public pages are crawled. Pages behind sign-in are not checked; the
  QA story runner covers those flows.
- Firecrawl's monitor API is a dependency. A monitor deleted on Firecrawl's
  side marks the watch `error`, and turning it on again creates a new one.
