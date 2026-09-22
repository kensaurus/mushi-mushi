# post-mortems — one file per launch, written the Sunday after

Private notes for the maintainer. They are the input for the next journey
post and the next `scorecard.md` row, so they use real numbers or the word
"unmeasured". Never a rounded or remembered figure.

File name: `launch-<release>-<YYYY-MM-DD>.md` (for example
`launch-r1-show-hn-2026-10-07.md`). Quarterly reviews go in
`quarterly-<YYYY>-Q<n>.md` per `measurement.md`.

## Template

```markdown
# <Release> — <channel> — <date posted>

## The numbers (source in brackets)

- Activated external projects this week: N (`company_funnel_weekly` / plan-gtm §8 SQL)
- Signups this week, by `signup_source`: hn N · ph N · reddit N · other N (`auth.users`)
- Projects created → keys minted → `sdk_first_heartbeat` → first real report: N → N → N → N
- Visits, lower bound: N (`landing_view` in `product_events`; GitHub uniques as a fallback)
- Top 5 referrers: … (`gh api repos/kensaurus/mushi-mushi/traffic/referrers`)
- Channel stats: HN points / comments / peak rank · PH upvotes / rank · thread views
- Loop (R3 onward): `loop_impression` N · `loop_click` N · `loop_signup` N

## What happened, hour by hour

Three to six lines. When it went up, when it peaked, when it fell off, what
you were doing at each point.

## What worked

One thing, with the number that says so.

## What did not

One thing, with the number that says so.

## What surprised me

One data point you would not have predicted.

## One decision I would change

## One channel I would double down on

## What the next post is

Title and the number it is built around. This becomes the journey post.

## Row appended to scorecard.md

Yes / no, and the ISO week.
```

## Rules

- Write it within 72 hours while the referrer data is still in the 14-day
  GitHub window.
- No adjectives in the numbers section.
- If a number is not measured, write `unmeasured` and add the instrumentation
  gap to `docs/plan-gtm.md` findings before the next release.
