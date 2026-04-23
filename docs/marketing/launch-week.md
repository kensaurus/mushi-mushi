# launch-week.md — the 5-day coordinated runbook

Research is crystal clear (AFFiNE, PostHog, Tabularis — see plan citations): a
**concentrated 48-hour multi-channel launch** beats a two-week drip by roughly
5×. The GitHub Trending algorithm responds to velocity, and once you're on
Trending, organic discovery does your marketing for you.

Pick any **Tuesday / Wednesday pair** in a week where you don't have other
commitments — not the week of a major holiday, US-election day, or a Google
I/O / WWDC / RSA. HN traffic peaks Tuesday–Thursday, 9am PT.

**Pre-flight check** — [STOREFRONTS.md](./STOREFRONTS.md) every box ticked,
every file in [snippets.md](./snippets.md) read through once end-to-end. You
should not be writing fresh copy during launch week — only lightly editing.

---

## The shape

```
Mon ── prep + final dress rehearsal
Tue 9am PT ── Show HN + r/opensource
Tue 2pm PT ── Bluesky + X + LinkedIn thread
Wed 9am PT ── Product Hunt + r/webdev + r/reactjs
Wed 2pm PT ── dev.to longform + Hashnode + personal blog cross-post
Thu ── presence + 1:1 triage + awesome-list PRs
Fri ── retrospective post + transparency numbers
```

---

## Monday — dress rehearsal (no outbound posts)

| Time | Do |
| --- | --- |
| AM | Cut a new release: bump launcher + SDKs to `x.y.0`, hit `pnpm release`. Fresh npm publish = fresh "updated N minutes ago" freshness on the npm page all week. |
| AM | Smoke-test the live demo end-to-end. Seed 1–2 *new* cute bugs with today's date. |
| AM | Record the 30-second README GIF one more time if any UI has changed. |
| PM | Open every URL in [snippets.md](./snippets.md) in a browser tab group. Practice the muscle memory of pasting. |
| PM | Schedule the Bluesky + X + LinkedIn thread as drafts (don't post). |
| PM | Pre-write the Product Hunt Wednesday post as a draft in PH's producer console. |
| PM | Mute every non-essential Slack / Discord / email. Tomorrow you owe attention to HN. |
| Evening | **Eat something good. 早く寝る. Mushi-chan needs you rested.** |

---

## Tuesday — Show HN + Reddit r/opensource

| Time (PT) | Channel | Action |
| --- | --- | --- |
| **8:30am** | Local | Coffee. Open `snippets.md` to the Show HN section. Open HN's submit page. Open r/opensource's submit page in a second tab. |
| **9:00am** | **Show HN** | Paste the title. Paste the URL (live demo, not repo). Submit. **Immediately** post the body as the first comment. |
| 9:05am | r/opensource | Post the r/opensource opener from snippets. |
| 9:10am | Bluesky / X | Pin a post pointing at the HN thread: *"I'm on Show HN right now if you'd like to say hi 🐛"* — not a pitch, just a signal. |
| **9:15am – 3:00pm** | HN | **Sit with it.** Answer every comment within 10 minutes. Upvote good replies others leave. Thank critics genuinely. HN rewards presence more than any other channel. |
| 2:00pm | **Bluesky + X + LinkedIn** | Post the 5-post launch thread (hook + 4 "room" replies + CTA) from [snippets.md](./snippets.md). Cross-post the LinkedIn version separately. |
| 3:00pm | HN | If you've made front page, screenshot it. Don't celebrate publicly yet — Wednesday is Product Hunt and Reddit day 2. |
| 4:00pm | Stats | Screenshot star count. Save referrer list from GitHub → Insights → Traffic. |
| Evening | Community | DM any contributors / dogfooders / friends privately: "on HN right now, no pressure" — word-of-mouth beats broadcasts. |

**If HN falls off the front page before noon:** don't re-submit; HN has an
anti-resubmit filter. Instead, double-down on Reddit and move the Wednesday
Product Hunt to Thursday.

---

## Wednesday — Product Hunt + Reddit r/webdev + r/reactjs

| Time (PT) | Channel | Action |
| --- | --- | --- |
| **12:01am** | **Product Hunt** | Submit the pre-drafted Product Hunt post (tagline + description + images). Pin a maker comment immediately. PH's clock flips at midnight PT; early submitters get the whole day. |
| 6:00am | PH | Reply to every comment from the night owls in Europe / Asia. |
| 9:00am | **Reddit r/webdev** | Paste the r/webdev opener from snippets. Different angle from Tuesday's r/opensource post. |
| 9:10am | **Reddit r/reactjs** | Paste the r/reactjs opener (the 4-line drop-in). |
| 9:30am | Bluesky / X | *"Mushi-chan is on Product Hunt today 🐛"* + live link. |
| 10am – 3pm | PH + Reddit | **Same sit-with-it discipline as Tuesday.** Every comment, within 10 minutes. |
| 2:00pm | **dev.to + Hashnode + personal blog** | Cross-post the long-form article (template in [snippets.md](./snippets.md)). Include the GIF. Tag `#showdev`, `#opensource`, `#javascript`, `#react`. |
| 4:00pm | Slack / Discord | Drop the MCP Discord post + Claude Code Discord post (templates in snippets). One per server, `#showcase` channel only. |
| Evening | Stats | Screenshot star count. Save PH rank. |

---

## Thursday — presence + slow-drip submissions

The spike is behind you. Most stars come on Wednesday. **Thursday is about
durability** — the channels that will keep trickling for weeks.

- Open **an awesome-list PR per hour** (see [drip-channels.md](./drip-channels.md)).
  Open the *issue* first in each repo: *"Would a Mushi Mushi addition fit here?
  \<one-sentence description\>"*. After an issue-level yes, then open the PR.
- Reply to every late HN / PH / Reddit comment. Late comments are the ones that
  convert onlookers into stars.
- DM 5 users who seemed genuinely interested in comments: *"Thanks for the
  question — would a 15-minute chat help? Happy to help you get it wired in."*
  This is the AFFiNE lesson: after the first launch spike, **talk to users**.
- Submit to newsletters using the template in snippets.md. Aim: Bytes.dev,
  Node Weekly, React Status, JavaScript Weekly, TLDR Web Dev, Console.dev,
  The Overflow, Hacker Newsletter. Send all 8 today.

---

## Friday — retrospective post

Transparency posts over-perform by ~3× on HN the second time around. This post
is also your excuse to re-submit (obliquely) and capture a second wave.

**Write a dev.to / personal blog post** titled something like:

> *Mushi Mushi launch week, in numbers*

Structure (short — 800 words):

1. **The counts** — stars, forks, npm downloads, visitor numbers, referrer
   breakdown. Real numbers, warts and all.
2. **What worked** — which channels over-indexed, which post got HN front page.
3. **What didn't** — one thing that tanked. (Readers trust honesty.)
4. **What surprised me** — one oddball data point. Something like "most of the
   Reddit traffic came from r/selfhosted, not r/webdev."
5. **What Mushi-chan is eating next** — a concrete next-week promise. Something
   real you're about to build.
6. **Thanks** — the strangers who sent good PRs / issues / DMs. Names, not just
   usernames when you can swing it.

Cross-post to dev.to, Hashnode, personal blog, LinkedIn. Tweet with
numbers-screenshot. **Do not resubmit to HN yourself** — HN users often do it
for you on transparency posts.

---

## Launch-week post-mortem (Sunday)

Take one hour on Sunday. Write a **private** note for yourself in
`docs/marketing/post-mortems/launch-week-YYYY-MM-DD.md`:

- Final star count + Δ from Monday morning.
- Final npm weekly downloads.
- Referrer winners (top 5).
- One decision I'd change.
- One channel I'd double-down on.
- One thing Mushi-chan should apologise for (and did / didn't).

This file is the input for the Phase 3 content engine — the data tells you
which post to write first.

---

## Hard rules for launch week

1. **Never cross-post identical text.** One angle per subreddit, one angle per
   platform. Copy is in [snippets.md](./snippets.md); use it.
2. **Never start with "We're excited to announce".** Mushi-chan doesn't do
   that. See [VOICE.md](./VOICE.md).
3. **Never pay for upvotes / stars / comments.** It breaks the data integrity
   the ten-week flywheel runs on (AFFiNE learned this the hard way).
4. **Never argue with critics.** Agree with the part they're right about,
   clarify the part they missed, move on.
5. **Never resubmit the same HN post.** One shot. If it fell off, learn and
   re-angle the Friday retro post instead.
6. **Never ghost comments.** Every question within 4h of a comment being left,
   24h at the absolute latest. Silence = "this is abandoned".
7. **Never say "book a demo".** The live demo is one click. Link to it.
