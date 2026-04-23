# social-cadence.md — the weekly rhythm that doesn't feel like marketing

PostHog's big lesson, confirmed in every research source: **the opinionated
voice is the compounding asset**. Post like a person, not a brand. Three to
five posts a week, never more, never fewer.

This is not a content calendar. It's a rhythm. The rhythm is easier to keep
than a calendar.

---

## The weekly mix (Mon–Sun)

Aim for **4 posts/week** on Bluesky + X (same content, post both), and **1
post/month** on LinkedIn. Roughly:

| Post type | Frequency | Bank it from | Length |
| --- | --- | --- | --- |
| **Bug of the week** | 1×/week, every week | Real dogfood + real demo bugs | 1 post |
| **Product update** | 1–2×/week when there's something shipped | Changesets + release notes | 1 post |
| **Build-in-public dev note** | 1×/week | Today I Learned / today I broke | 1–3 posts |
| **Reply-in-the-wild** | 1–2×/week | Searches for "sentry frustration" / "user feedback tool" | 1 post (reply) |
| **Milestone / retro** | 1×/month | Stars, downloads, first contributor, first self-host in the wild | 1 thread |
| **LinkedIn post** | 1×/month | Distilled version of the monthly milestone | 1 post |

Never post more than one "Product update" in a single day. Don't post on days
you have nothing real to say.

---

## 1. Bug of the week

**Template** (reuse weekly — it's the signature format):

> Bug of the week — \<one-line description\>
>
> \<screenshot / redacted admin view\>
>
> What Sentry saw: nothing / 200 OK / \<whatever\>
> What Mushi-chan heard: "\<the actual user sentence\>"
> Classified: \<severity / category / confidence\>
> Dispatched: \<PR link / not yet / too weird\>
>
> 🐛

**Example** (fictional but in-voice):

> Bug of the week — Checkout "Confirm Order" button visually pressed but
> nothing happened for 4 seconds.
>
> \<screenshot of the button mid-press, then the order confirmation 4s later\>
>
> What Sentry saw: nothing. All 200s.
> What Mushi-chan heard: "i clicked confirm three times and then it charged me twice"
> Classified: High · Checkout · 0.92 confidence.
> Dispatched: PR #147 — added a spinner + click-debounce to `<ConfirmButton />`.
>
> 🐛 turns out Sentry can't catch "my user clicked three times because there was no spinner".

**Rules:**

- Use a real (or redacted demo-seeded) bug.
- Never punch down at the user who reported it. Mushi-chan's tone is
  affectionate: *"this person was right and we were wrong"*.
- Never punch at Sentry either. The gag is *"Sentry can't see this; that's
  fine, it's not supposed to"* — never "Sentry is bad".
- Rotate categories so readers see Mushi-chan catch performance, layout,
  auth, checkout, onboarding, empty-states, mobile-only — not just one type.

---

## 2. Product updates — "changelog theater"

Every release becomes a **one-image post** with Mushi-chan reacting to the
feature. Zero extra work since changesets already exist.

**Template:**

> v\<version\>: Mushi-chan learned a new trick.
>
> \<one-sentence description — end with what the user sees, not what you built\>
>
> \<screenshot or GIF, 1 image max\>
>
> Changelog: \<link\>

**Examples:**

- *"v0.5: Mushi-chan learned to draw. When the Do stage backs up, I put a
  marching-ants ring around it so you can see the bottleneck without reading
  anything. 🐛"*
- *"v0.6: `@mushi-mushi/capacitor` is live. Your Ionic / Capacitor users can
  now shake to report. iOS and Android, offline-queued. 🐛"*
- *"v0.7: The admin now remembers where you were. Leave a report mid-triage,
  come back tomorrow, and Mushi-chan picks up the cursor where you left it. 🐛"*

**Rules:**

- One screenshot/GIF per update. Never a carousel.
- Open with *"Mushi-chan learned…"* or *"Mushi-chan now…"* — keeps the voice
  consistent.
- Never list multiple features in one post — split across two days.

---

## 3. Build-in-public dev notes

The "Today I broke…" / "Today I learned…" genre. These compound because
they're genuinely useful to other developers.

**Templates:**

- **The TIL**
  > TIL: \<specific thing\>. Learned it the way everyone does — by breaking
  > something. \<one-sentence story\>. 🐛
- **The today-I-broke**
  > Today's discovery: \<specific bug / constraint / gotcha\>. Cost: \<time
  > or $ amount\>. Fix: \<one-liner\>. Saved this one for anyone else about
  > to step on the same tile.
- **The "in case anyone else is trying"**
  > In case anyone else is wiring up \<specific thing\>: \<paste of code or
  > config\>. The thing that took me 3 hours: \<single-sentence gotcha\>.

**Examples in Mushi-chan's voice:**

- *"Today Mushi-chan learned: pg_cron will happily run every 5 minutes
  forever if you forget to add a completion check. We ran the re-classify
  job 36× before I noticed the cost chart. Fix: one row in the `job_run`
  table + a `completed_at IS NULL` guard. 🐛"*
- *"TIL: Anthropic's `response_format=json_schema` is stricter than OpenAI's
  `response_format=json_object` — it will refuse to finish if your schema
  has a `oneOf` without a discriminator. Fix was two lines. 🐛"*

**Rules:**

- Always include a real specific number, date, or config line.
- Never moralise ("this is why observability matters!"). Just tell the story.
- Don't post one of these twice a week — the density dilutes. Once is honest,
  twice is performative.

---

## 4. Replies in the wild

Search daily (save these as columns if you use TweetDeck / Raindrop):

- `"sentry" sucks OR hate OR frustrated`
- `"user feedback" tool recommendation`
- `"shake to report"`
- `"how are people capturing user bug reports"`
- `"LLM observability" recommendation`
- `"bug reporting" open source`
- `"auto-fix" PR` (careful — mostly repo bots, skip those)

**Rules for replies:**

- **Never open with "Check out Mushi Mushi!"** — instant block / downvote.
- **Always open with a genuine answer to their actual question.** Only mention
  Mushi if it's literally the right answer.
- **Always link to the live demo, not the repo.** The demo converts; the repo
  only converts for people already hunting.
- **Always end with "happy to take hate"** or similar — invites honest
  feedback.

**Template:**

> \<one sentence genuinely answering their question\>
>
> If you want to try something designed for exactly that: I've been building
> \<one-phrase description\>. \<live demo link\>. Happy to take hate. 🐛

**Example:**

> You're right that Sentry's `feedback` widget is pretty spartan — it was
> designed as a crash-companion, not a standalone feedback tool.
>
> If you want to try something purpose-built for shake-to-report + LLM
> classification + auto-fix PR: I've been building Mushi Mushi. Live demo at
> kensaur.us/mushi-mushi, no signup. Happy to take hate. 🐛

---

## 5. Monthly milestone posts

First Monday of each month, post a milestone thread. Research (PostHog,
Supabase growth) shows these **over-perform corporate updates by ~3×**
because they read as human, not PR.

**Format** (pick whichever milestone is real that month):

```
Mushi-chan turned \<N\> months old this week.

Where we are:
• \<N\> GitHub stars (was \<N\> last month)
• \<N\> weekly npm downloads
• \<N\> self-hosts in the wild I know about
• \<N\> issues closed in \<Nd\> avg
• \<N\> PRs merged from people who aren't me

What Mushi-chan is eating next:
\<one concrete thing\>

Thank you to: \<real contributor names when possible\>. You made this weird
little bug less weird. 🐛

(star history: \<link to star-history.com\>)
```

**What makes this work** (from the research):

- **Real numbers, not rounded** — 347 stars beats "~350 stars" by a mile on
  credibility.
- **Name specific people** — contributors, good-issue-openers, the person who
  self-hosted first. Usernames + real names where consented.
- **One concrete next thing** — not "lots more coming soon!". A specific
  promise, ideally with a date.

---

## 6. LinkedIn (monthly only)

LinkedIn is a different audience — engineering leaders and founders. Same
voice, slightly more context, no emoji parade.

**Template:**

> \<One-sentence story about a specific engineering challenge you solved\>.
>
> \<Three-sentence explanation of what you shipped and why\>
>
> \<One-line link to the live demo, one to the repo\>
>
> \<One-sentence invitation: "If it sounds useful, \<link\>. Happy to take
> hate."\>
>
> 🐛

**Rules for LinkedIn specifically:**

- Never hashtag-spam. Maximum 3 hashtags, at the end, never in the body.
- Don't tag Sentry / competitors (looks like a gotcha).
- Never copy-paste from Bluesky — LinkedIn readers need one more sentence of
  context each step.
- Post between 8–10am local time, Tuesday or Thursday.

---

## The "don't post" checklist

Don't post if:

- [ ] You're feeling anxious about the numbers. Walk away. Post tomorrow.
- [ ] It's a reaction to someone else's subtweet. Never a good look.
- [ ] It's a marketing post about a feature that's *almost* shipped. Wait
      until it's shipped.
- [ ] You can't name a specific user benefit in the first sentence.
- [ ] It uses any of the words in the [VOICE.md](./VOICE.md) "never say"
      list.
- [ ] It's basically an ad. Rewrite it or don't post.

Research: consistently posting *good* content 4×/week beats posting *any*
content 10×/week. The silence days are also content.

---

## Engagement rules

- **Reply to every reply within 24 hours during weekdays**, 48 on weekends.
- Like replies you agree with. Don't quote-tweet your own mentions (looks
  thirsty).
- When someone posts about a Mushi Mushi bug they hit, **fix it** — publicly,
  with a screenshot of the PR. That's the best marketing that exists.
- If someone writes a blog post mentioning Mushi Mushi, send a genuine
  thank-you DM, not a public quote-tweet. Keep the fans; don't broadcast them.

---

## Tooling

- **Posting**: just use Bluesky + X natively. Don't get fancy. Buffer /
  Typefully work but add a layer of "scheduled content" smell that Mushi-chan
  doesn't need.
- **Drafting**: keep a running `drafts/` folder in Obsidian / Apple Notes /
  Drafts — one line per idea, write full posts just before publishing so the
  voice stays fresh.
- **Searching**: save Bluesky + X searches as columns / lists. Check once
  daily. Reply-in-the-wild is most of the channel's value.
- **Link shortening**: never. Full URLs read as honest; shortened URLs read as
  tracking.
