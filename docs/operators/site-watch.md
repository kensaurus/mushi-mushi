# Live-site watch: operator notes

The live-site watch ([ADR 0024](../adr/0024-live-site-watch-files-broken-pages-as-reports.md))
crawls an app's public pages once a day through a Firecrawl monitor on the
project's own Firecrawl key, and files each newly broken page as a report.
Users turn it on from **Inventory → Discovery → Watch your live site**; the
user-facing description is in
[`apps/docs/content/admin/inventory.mdx`](../../apps/docs/content/admin/inventory.mdx).

## Filter the crawler out of your monitoring and analytics

Every page fetch the watch makes sends this `User-Agent` header (a normal
Chrome UA with a Mushi token appended):

```
Mozilla/5.0 (…) Chrome/141.0.0.0 Safari/537.36 MushiSiteWatch/1.0 (+https://kensaur.us/mushi-mushi)
```

Filter on the substring `MushiSiteWatch` so the daily crawl does not show up
as visitors, sessions or errors:

- **Sentry:** drop the event in `beforeSend` when the request's `User-Agent`
  header contains `MushiSiteWatch`, or add an inbound filter on that string.
- **Analytics** (PostHog, GA4, Plausible, …): exclude requests or sessions
  whose user agent contains `MushiSiteWatch`.
- **Server logs and rate limits:** match the same substring.

The header is set on the HTTP request. Whether the page's JavaScript sees it in
`navigator.userAgent` depends on Firecrawl's browser engine and has not been
verified yet, so prefer a server-side or request-header filter.

The constant is `SITE_WATCH_USER_AGENT` in
`packages/server/supabase/functions/_shared/site-watch.ts`. Only the watch
sends it; known-issue search, site maps and other Firecrawl calls do not.

## Monitors created before the header existed

The header is part of the monitor's crawl target, so a monitor created before
it was added does not send it until its target is saved again. Turning the
watch off and on, or saving it again from the console, sends the full target
to Firecrawl.

Firecrawl does not cache a scrape sent with custom headers, so each check is a
live fetch. Credit use is unchanged.
