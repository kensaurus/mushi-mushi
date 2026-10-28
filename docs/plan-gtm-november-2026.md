# GTM plan — 10 paying customers by 2026-11-30

_Plan-gtm output. Nothing is posted, sent or changed on a public surface until
the owner approves each phase. Written 2026-10-28; numbers queried that day._

## 1. Where we start (measured)

| | Number | Source |
|---|---|---|
| Paying customers | 0 | billing_subscriptions |
| Outside sign-ups ever / last 30 days | ~10 / 1 | auth.users minus operator accounts |
| Outside apps that ever sent a real report | 0 | reports |
| Launches ever (HN, PH, Reddit) | 0 | critical audit 2026-10-27 |
| Landing visits measured | 0 (tracker waits for consent) | product_events |
| **Proof on the owner's 9 live apps, last 60 days** | **676 user bug reports from 314 people; 231 fixes merged; median 26 h from report to merged fix; 738 AI reviews, 265 of them "do not merge"** | reports, fix_attempts, fix_reviews |
| Price | Free (1 app, 100 diagnoses) / Builder $29 (3 apps, 1,000) / Studio $79 (10 apps, 3,000) / Enterprise from $499, live 2026-10-28 | pricing_plans, Stripe |

## 1b. Does it pay for itself? (unit economics, measured 2026-10-28)

| Input | Value | Source |
|---|---|---|
| Cost of one diagnosis on Mushi's own AI key | $0.017 (triage) to $0.022 (with quality grading) | llm_invocations, 30 days |
| Mushi's platform-key AI spend today | $6.25 / 30 days | llm_invocations key_source = env |
| Stripe fees (Japanese account) | 3.6% per card payment + 0.7% Billing = 4.3% | stripe.com/jp/pricing |
| Firecrawl | $99 / month (Standard) | firecrawl.dev/pricing |
| Supabase | Pro organization, $25 / month base + compute, shared by 6 projects | Supabase org plan "pro"; compute share not measured |
| Hosting, domain, email | not measured | owner to confirm |

| Plan | Net after fees | AI cost, typical (100 diagnoses) | AI cost, worst case (all included used) | Margin, worst case |
|---|---|---|---|---|
| Builder $29 | $27.75 | $2.20 | 1,000 × $0.022 = $22.00 | **+$5.75** |
| Studio $79 | $75.60 | $2.20 | 3,000 × $0.022 = $66.00 | **+$9.60** |
| Overage, per diagnosis | $0.0287 | — | $0.022 | **+$0.0067** |

A customer who brings their own AI key costs Mushi almost nothing in AI. Studio
was cut from 5,000 to 3,000 included diagnoses and its overage raised from
$0.02 to $0.03 on 2026-10-28, because the old numbers lost money at full use
and on every extra diagnosis.

**Break-even:** known fixed costs are about $124 a month (Firecrawl + Supabase
base). At typical use a Builder customer contributes about $25, so **5
paying customers cover the known fixed costs**, and 10 cover them about twice
over. Supabase compute and hosting are the unmeasured part.

Ten paying customers in 33 days from zero is a **sales** goal, not a
self-serve goal. Self-serve funnels at this size convert visitors to paid at
well under 1% [unverified, industry rule of thumb], so 10 paid self-serve would
need several thousand activated visitors we do not have. The plan below gets
the first 10 by hand and builds the funnel that sells the next 100.

## 2. What the market told us (sources read 2026-10-28)

- **People pay for this job — to humans, at rescue prices.** Rescue shops
  quote $3,500 for an exposed Stripe key, $5,000–15,000 for auth or payment
  webhook fixes, $25k–50k for a full rescue, and win clients with a **free
  30-minute "rescue diagnostic"** (justinmckelvey.com/blog/vibe-coding-cost,
  afterbuildlabs.com/resources/state-of-vibe-coding-2026, relux.works).
- **The pain is the regression loop and the silent failures**: "fix one thing,
  break another", disabled database security, unverified payment webhooks,
  exposed keys (same sources; Reeve's 30,998-app scan via vibe-eval.com).
- **Distribution is "inside the tool"**: Lovable now speaks MCP to Claude
  Code, Cursor and ChatGPT (moneyflock.com, Lovable MCP article); a builder's
  day happens inside Claude Code / Cursor / Lovable, not in a new console
  (critical audit 2026-10-27).
- **The tooling itself is commoditising** (PostHog "Fix with AI", Sentry Seer
  $40/contributor, Replit monitoring agent). Our edge is not "AI fixes bugs";
  it is **the whole loop on a live app, with a reviewer that says no**, proven
  on 9 real apps.

## 3. Positioning (the first-principles version)

Investor / Musk / Altman lens: one bold, true, checkable claim; show the work
in public; make the first experience magical; let usage spread itself.

- **The claim:** *Mushi is the on-call engineer for your AI-built app. Your
  users find the bug; Mushi explains it, writes the fix, and a second AI
  refuses to merge it unless it's safe.*
- **The anchor:** a rescue developer costs $3,500 per fix; Mushi Builder is
  $29 a month.
- **The proof:** "It runs 9 of my own apps: 676 user reports, 231 merged
  fixes, and the reviewer blocked 265 bad ones." (public, live numbers — see
  Phase 3 scoreboard).
- **The trust line (secure, robust):** your keys, your repo, your code;
  nothing merges without a passing review; open source (MIT SDKs, AGPL
  server); self-host in one command.

Tagline ladder (CI-enforced, VOICE.md): keep the hero *"Your AI wrote it. Mushi
tells you why it broke."* and add the offer as the **sub-hero**: *"…and fixes
it, with a reviewer that says no. $29 a month instead of a $3,500 rescue."*
**Owner decision D1** (changes a public surface under ADR 0052; needs the
`@mushi-mushi/brand` ladder and `check-tagline-consistency` updated).

## 4. The offer

| | |
|---|---|
| **Free Production Check** (lead magnet, like the rescue shops' free diagnostic) | Paste your live URL → in 2 minutes: broken pages, console errors, missing security headers, a first-time-user walk-through with timings, all from public pages only. Email the report to yourself. Built on what exists: site watch, site audit, first-time user test, radar. Runs on Mushi's Firecrawl key with strict caps (1 per URL per day, 3 pages deep, captcha-free rate limit per IP). |
| **Founding Builder** | $29/mo locked for life for the first 25 customers, plus a **24-hour fix promise**: if a real user's bug in your app isn't explained and a fix PR opened within 24 h, the month is free. Our own median is 26 h *to merge*; PR-open is faster [verify before publishing]. |
| **Done-with-you onboarding** | A 20-minute call where the owner installs Mushi on their live app with them. This is how the first 10 are won. |

## 5. Channels, ranked for 10 paid in 33 days

| # | Channel | Why | Target |
|---|---|---|---|
| 1 | **Founder-led outreach to live apps** (100 hand-picked: recent Product Hunt / IndieHackers / r/lovable / "made with Lovable/Bolt" launches that take payments) | Highest intent; mirrors rescue shops | 100 contacts → 25 replies → 12 calls → **6 paid** |
| 2 | **Story launch: "I let AI fix 231 bugs in my 9 live apps. A second AI blocked 265 of its fixes."** Show HN + r/vibecoding + r/lovable + r/ClaudeAI + r/cursor + X thread + LinkedIn | Story beats product; the numbers are unusual and checkable | 5k visits → 150 sign-ups → **3 paid** |
| 3 | **Inside the tools**: Claude Code plugin + MCP registries (already listed), a Lovable "connect Mushi" guide, Cursor directory | Where the builder already is; slower but compounds | **1 paid** in window, more later |
| 4 | **Free Production Check** as the CTA everywhere (posts, outreach, landing) | Value before sign-up; collects emails; feeds lifecycle email | feeds 1 and 2 |
| 5 | **Loop:** "Report a bug · by Mushi" link on the free widget + a public "Fixed this week" page per app | Each customer's users see Mushi | K measured, not targeted |

Product Hunt waits until December, after the funnel converts.

## 6. Prerequisites (days 1–4, before any launch)

1. **Measure:** cookieless page-view count on the landing (no personal data),
   `?src=` on every link, events `production_check_started/finished`,
   `signup`, `activated` (= first real end-user report from a **non-localhost**
   origin diagnosed), `paid` (Stripe webhook). Daily scorecard.
2. **First ten minutes** (critical audit): the wizard prints the env vars for
   Vercel/Netlify; one viewable sample diagnosis page; a Lovable/Bolt
   paste-this block; lifecycle emails on (sending domain checked).
3. **Free Production Check page** (docs site, one URL field) + its edge
   function with caps; never probes auth, databases or anything non-public.
4. **Public scoreboard page** with the live 60-day numbers above
   (aggregates only; no app or user detail without the owner's say-so).
5. **Founding offer** in Stripe: a "Founding Builder" coupon (price lock) and
   the 24-hour promise wording in the terms.

## 7. Calendar (to 2026-11-30)

| Week | Build | Launch / sell | Scorecard |
|---|---|---|---|
| Oct 29–Nov 1 | Prerequisites 1–5 | Build the 100-app list (Firecrawl, public pages only) | baseline row |
| Nov 2–8 | Fixes from the first 10 checks | 50 outreach messages; 5 onboarding calls; X thread | replies, calls, first paid |
| Nov 9–15 | Lovable guide, case study from customer #1 | **Show HN (Tue/Wed 8am PT) + Reddit + LinkedIn**; 50 more outreach | visits by source, sign-up→activated |
| Nov 16–22 | Fix the top drop-off | Follow-ups; second story post (the 265 "do not merge" reviews) | paid count |
| Nov 23–30 | Annual offer for founding members | Black-Friday-free week: thank-you post with real numbers | **10 paid?** go/no-go |

Kill criteria (from the critical audit, kept): under 1 paid from the first 40
outreach messages → switch the offer to the human concierge ($49–99 per fixed
bug); fewer than 3 outside apps with a first real report after the launch →
the wedge is wrong, stop building and interview.

## 8. Decisions for the owner

| # | Decision | My recommendation |
|---|---|---|
| D1 | Add the offer sub-hero to the canonical tagline ladder | Yes |
| D2 | Founding Builder: $29 locked for life + 24-hour fix promise | Yes, capped at 25 |
| D3 | Free Production Check on Mushi's own Firecrawl key, capped | Yes (≈2–5 credits per check) |
| D4 | Public scoreboard with your 9 apps' aggregate numbers | Yes, aggregates only |
| D5 | You do the outreach and calls yourself (founder-led); I draft every message | Yes — this is what wins the first 10 |
| D6 | Posts go out under your name on HN, Reddit, X, LinkedIn | Yes; drafts in `docs/launch/2026-11/` |

## 9. Ready-to-post drafts

`docs/launch/2026-11/`: `show-hn.md`, `x-thread.md`, `reddit-vibecoding.md`,
`linkedin.md`, `outreach.md` (cold email + DM + follow-up), `lovable-guide-outline.md`.
Each is a draft; nothing is posted without the owner.
