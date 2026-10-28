# 0040. Site audit: deterministic live-site checks, one report per failing rule

Status: Accepted Date: 2026-10-23

Related: ADR [0024](0024-live-site-watch-files-broken-pages-as-reports.md) (live-site watch), ADR
[0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) (confirm before filing),
ADR [0028](0028-spend-down-expiring-agent-credits.md) (spend-down), ADR
[0039](0039-better-models-make-mushi-better.md) (facts deterministic,
judgement to models), `_shared/site-audit.ts`, `site-audit/index.ts`.

## Context

On 2026-10-23 spend-down had dispatched every open report of every dogfood
app within its 7-day cooldown, so both Cursor keys sat idle five days before
their credits expired, and 65,500 Firecrawl credits were about to lapse. The
site watch (ADR 0024) only catches pages that error, 404 or go blank, on up
to 100 pages a day.

A one-off sweep that day mapped 689 pages across 8 live sites, batch-scraped
them rendered (about 1,350 credits) and ran deterministic checks. Verified
by hand, it found 11 bugs no user had reported: dead docs links, an
og:image 404, "Edit this page" links into a private repo, Japanese titles,
navigation and body text on Thai and Chinese pages, links that dropped the
visitor's locale, a Japanese panel on an English home page, unlabeled
controls. Spend-down sent them to Cursor and draft PRs opened within the
hour. A second pass that asked Firecrawl's JSON extraction (its model, 5
credits a page) to judge content returned 287 claims for about 1,760
credits; 2 were real, the rest misread dates ("Nov 7 is in the past") and
style.

## Decision

- **A site audit per app**, off by default (`site_audits`), billed to the
  app's Firecrawl key like the site watch. Every `cadence_days` (default 7)
  the `site-audit` worker maps the live site under `base_url`, batch-scrapes
  up to `page_limit` pages fresh (html, links, markdown; 1 credit a page),
  and reads the batch on a later tick.
- **Rules are deterministic** (`_shared/site-audit.ts`): dead internal and
  external links and images (only 404, 410, 5xx or unreachable, tested
  again before counting; 401/403/405/429 and social or calendar hosts are
  bot walls, never findings), missing title, description or html lang,
  localized metadata in another script, another locale's text in the body,
  links on a localized page that drop the locale when the localized page
  exists, images without alt. Each finding quotes its evidence.
- **One report per failing rule per app** (`source = 'site_audit'`), listing
  up to 25 pages with evidence, the expected behaviour and how to check it
  is fixed. A rule whose report is still open only refreshes its finding; a
  dismissed one is not filed again; a fixed one that fails again files a new
  report. Rules that pass are marked resolved (`site_audit_findings`).
- Settings and "Run now" (3 an hour per app) live on `/credits` (Spend
  credits), next to the site watch of the same app. While the audit is on,
  that row sets the cadence (daily, every 3 days, or weekly; any other saved
  cadence stays shown) and the page limit, and shows the credits a run
  (one per page).

## Rejected

- **Model-judged content checks on Firecrawl's extraction.** 2 real out of
  287 at 5x the credits; a report queue full of misread dates costs the
  agent run and the review that follow each one. A content check, if it
  comes back, sends Firecrawl's 1-credit markdown to the app's own model
  setting (ADR 0039), so it improves when that model does.
- **Raising the site watch's page limit instead.** The watch's monitor only
  says a page broke; it does not return the page, so none of these rules can
  run on it.
- **One report per page.** The sweep's locale leak touched 10 Thai pages; one
  report per rule lets one agent fix the shared cause (the nav, the i18n
  fallback) once.
- **Running it in the host's CI.** Every app would need a workflow and a
  secret, and it could not be turned on from the console.

## Consequences

- An app with the audit on spends about `page_limit + 1` credits per run;
  /credits counts it in the pace line.
- A crawl loads the host's Mushi SDK on every page and so opens SDK
  sessions; the audit sends the site watch's user agent so those can be told
  apart.
- Visual and interaction defects (overlapping layout, a dead button) stay
  out of scope: they need a browser, not a crawl.
