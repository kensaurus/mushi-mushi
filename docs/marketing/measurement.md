# measurement.md — what to track, where to track it, and when to stop worrying

Zero-budget growth needs zero-budget measurement. Every tool below is **free**
and most are already part of the repo. No analytics SaaS to pay for. No
paid-tier to justify.

The rule: **if a number doesn't change a decision you'll make in the next two
weeks, don't track it**.

---

## The 90-day target bar

Research baselines (AFFiNE, Supabase, PostHog 0→1 retros) say a well-executed
launch + 90 days of cadence nets:

- **Good**: 500 stars, 750 weekly npm downloads
- **Great**: 1,500 stars, 2,000 weekly npm downloads
- **Astonishing**: 5,000+ stars (requires HN #1 + a post that goes viral)

Set **1,500 stars + 2,000 weekly downloads** as the 90-day *"great"* bar and
**500 stars + 750 weekly downloads** as the *"good"* floor. Anything above
500 stars is a legitimate base to build on; anything below, re-evaluate the
positioning before doubling down.

---

## The five numbers to check weekly

Every Friday afternoon, 10 minutes:

| # | Number | Source | How to check |
| --- | --- | --- | --- |
| 1 | **GitHub stars** | [star-history.com/#kensaurus/mushi-mushi](https://star-history.com/#kensaurus/mushi-mushi) | Screenshot the curve. Paste into the monthly milestone post. |
| 2 | **Weekly npm downloads** | [npmtrends.com](https://npmtrends.com/mushi-mushi-vs-@mushi-mushi/core-vs-@mushi-mushi/react-vs-@mushi-mushi/web) | Sum the top 5 packages. Track trend, not absolute. |
| 3 | **Referrer sources** | [Repo → Insights → Traffic](https://github.com/kensaurus/mushi-mushi/graphs/traffic) | Top 5 referrers of the week. |
| 4 | **Issues opened** | GitHub Issues | New issues this week; filter out dependabot. Real users = real product-market fit. |
| 5 | **Unique visitors on the live demo** | Demo host analytics (Vercel / Cloudflare / Netlify free tier) | Trend line only. |

Everything else is noise until you have 1,000 stars.

---

## What the numbers tell you

### If stars are rising but npm downloads aren't

You're a curiosity, not a tool. Rewrite the README's "Quick start" to lead
with a 10-second install, not a feature list. Make the first
command-block copy-paste-runnable (not pseudo-code).

### If npm downloads are rising but stars aren't

You're a tool, not a brand. The star CTA is missing or buried. Add it to
every quickstart section. Add it as the last line of every blog post. The
research conversion rate is 2–5%; if yours is lower, the friction is visible.

### If both are flat

The positioning isn't landing. Re-read [VOICE.md](./VOICE.md) and rewrite the
README hero sentence. If the hero doesn't say the Sentry contrast in the
first line, visitors don't know which category to file you under.

### If both are rising but issues stay at zero

Good tool, no actual users yet. Prioritise the live demo polish and the
`/repo` page in [STOREFRONTS.md](./STOREFRONTS.md) — make sure the demo
works on mobile, because a lot of the scroll-through-the-dashboard traffic
is people browsing on their phone after seeing a tweet.

---

## What the referrer tells you

From Repo → Insights → Traffic, the top referrer source tells you what to
double-down on:

| Top referrer | What it means | Do more of |
| --- | --- | --- |
| news.ycombinator.com | HN launch landed; keep feeding it transparency posts. | Friday retro post, LLM-as-Judge deep-dive, license philosophy post. |
| reddit.com | The subreddit fit is real. | A second Reddit angle, a follow-up in the subreddit that over-performed. |
| dev.to | Blog post compounding. | More posts in that format; re-use the intro hook. |
| google.com | Pure search traffic; this is the long game working. | More blog posts. Long tail search is the compounding gift. |
| producthunt.com | PH is still referring after launch week. | Re-submit the blog post as a ProductHunt resource. |
| x.com / bsky.app | Social is doing work. | Double-down on the weekly cadence. |
| github.com | Awesome-list referrers. | Open more awesome-list PRs (see [drip-channels.md](./drip-channels.md)). |

---

## Bonus tracking (only if you're enjoying it — otherwise skip)

These are fun but not decision-moving. Do them because they're interesting,
not because they're necessary.

- **Geographic spread** — GitHub Insights shows country breakdown. Fun
  evidence that Mushi-chan is a truly global bug.
- **Daily active users on the hosted tier** — via your own dashboard. Feeds
  into the monthly milestone post.
- **Langfuse daily cost** — the real proof that the LLM pipeline is cheap.
  Screenshot this for posts.
- **SOC 2 / security questionnaire requests** — count in a spreadsheet. If
  this number exceeds 5 in a month, you're ready to activate the paid-tier
  conversation, not before.

---

## What to put in the monthly milestone post

Every first Monday, copy-paste the template from
[social-cadence.md](./social-cadence.md) → "Monthly milestone posts", filled
with that month's numbers:

- Stars, month-over-month delta, total
- Weekly npm downloads (aggregate of top packages)
- Top 3 referrer sources
- New contributor count
- First self-host in the wild you're aware of (if any)
- One concrete thing you shipped; one concrete thing coming

---

## The honest numbers check

Twice per quarter, write a **private** note for yourself in
`docs/marketing/post-mortems/quarterly-YYYY-Q.md`:

- What's the stars-per-week trend this quarter vs last?
- What's the npm-downloads-per-week trend?
- Which of the 8 planned content posts actually shipped?
- What are the **two** channels driving 80% of the growth? (Pareto hits
  every time.)
- Which channel am I wasting time on that isn't moving anything? Kill it.
- What's the *one* thing, if I did it next quarter, that would most obviously
  move the needle?

If stars haven't crossed 500 at the 90-day mark, re-read the plan. The
positioning, the voice, or the storefront is off. The cadence is almost
never the problem; the message usually is.

---

## The thing I keep reminding myself

Star count is a lagging indicator. Real user-bug reports from self-hosters I
don't know personally is the leading one. If the issue tracker has three
strangers reporting real bugs in week 4, the project is working — regardless
of what star-history.com says that week.

🐛
