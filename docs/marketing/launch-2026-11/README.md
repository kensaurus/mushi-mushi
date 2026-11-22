# November–December 2026 launch kit: six products, one a week

Drafts for the owner to post personally. No agent posts, messages or
publishes anything. Written 2026-11-14 from the growth audits of that day and
live checks (store listings, subreddit rules, the Mushi Mushi scoreboard).

**The six weeks:** Mushi Mushi → glot.it → yen-yen → help-her-take-photo →
lets-talk → the-wanting-mind. The full schedule, with a check for each slot,
is in [`calendar.md`](./calendar.md).

## What's here

| Path                                                                                                     | What                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`calendar.md`](./calendar.md)                                                                           | the six weeks, day by day, each slot with its "check it worked" step                                                                         |
| [`rating-asks.md`](./rating-asks.md)                                                                     | the no-incentive rule (Play and Apple policy, quoted), who to ask, every direct review link                                                  |
| [`mushi-mushi/`](./mushi-mushi/README.md)                                                                | week 1. Show HN gates and reply guide; r/cursor, r/indiehackers. Fits into [`PLAN.md`](./PLAN.md)                                            |
| [`glot-it/`](./glot-it/README.md)                                                                        | week 2. r/learnthai, X, optional Product Hunt; rating asks in EN and TH                                                                      |
| [`yen-yen/`](./yen-yen/README.md)                                                                        | week 3. note, X (JA), r/povertyfinance; the free kakeibo template; rating asks in JA and EN                                                  |
| [`help-her-take-photo/`](./help-her-take-photo/README.md)                                                | week 4. the two-phone clip, short video, X, Product Hunt, r/SideProject                                                                      |
| [`lets-talk/`](./lets-talk/README.md)                                                                    | week 5. Product Hunt, LinkedIn, X, r/ClaudeAI                                                                                                |
| [`the-wanting-mind/`](./the-wanting-mind/README.md)                                                      | week 6. Product Hunt, X and Bluesky, r/FreeEBOOKS (after mod approval)                                                                       |
| [`PLAN.md`](./PLAN.md), [`posts/`](./posts/), [`submissions/`](./submissions/), [`links.md`](./links.md) | the Mushi Mushi four-week plan from 2026-11-11. `posts/08` (Show HN) and `posts/09` (Product Hunt) were rewritten on 2026-11-14 for ADR 0058 |

**Each product folder has the same parts:**

- `README.md`: the angle, the claims you may use, where its users are (each
  venue's rule quoted, with a verdict), the media shot list, links and checks;
- `NN-<venue>.paste.md`: the title and body only. This is what you paste;
- `NN-<venue>.notes.md`: timing, rules, what to reply and the visibility
  check. Never paste it;
- `rating-ask.<lang>.paste.md`: the short personal message.

## Before you paste anything

Run this on the file. It must print nothing:

````sh
grep -nE 'Title \(set|READY|Source notes|Questions for the owner|```' <file>.paste.md
````

This is the rule from 2026-11-03, when notes went live inside posts.

One known exception: the Zenn and Qiita how-tos (`posts/03`, `posts/04`) hold
real code blocks, so the fence pattern matches there on purpose. For those two,
check that every fence is inside the article's code, not a leftover from the
notes.

**Then rewrite it in your own words.** An agent wrote every draft here. Hacker
News removes generated or AI-edited text ("Don't post generated text or
AI-edited text"). r/cursor, r/travel, r/philosophy, r/Marriage and many other
subs ban it too. Keep the facts and the order; make the sentences yours.

## What you need to prepare

| Item                                                                                             | For                            | By                 | Status on 2026-11-14                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hacker News account** that can post a Show HN                                                  | Mushi Mushi week 1             | Thu 11-19          | blocked: "showlim" on 2026-10-29 (account created that day). Comment on threads you care about until then. No workaround                                                                               |
| **Owner decision:** keep or drop the "3 outside installs" gate on Show HN                        | Mushi Mushi                    | Thu 11-19          | open. Recommendation: drop it for Show HN, keep it for Product Hunt (`posts/08-show-hn.notes.md`, gate 4)                                                                                              |
| **Reddit account with some history** (u/sakuramoto)                                              | every Reddit post              | each post's date   | the 2026-10-29 post was filtered as a new account. Comment normally for a week before each sub's post; r/cursor wants self-promotion under 10% of your activity; r/iOSapps needs 90 days and 300 karma |
| **Product Hunt maker account**                                                                   | weeks 4–6 (and the held posts) | Wed 12-09          | not checked. Fill in your profile; launch guides recommend an account at least 30 days old                                                                                                             |
| **TikTok and YouTube accounts**                                                                  | week 4 short video             | Tue 12-08          | not checked; Instagram has a stored profile (`instagram`)                                                                                                                                              |
| **The two-phone clip** (15–30 s; shot list in `help-her-take-photo/README.md`)                   | week 4                         | Mon 12-07          | to record                                                                                                                                                                                              |
| **The glot.it tone-drill clip**, the lets-talk role-play clip, the-wanting-mind concept-map clip | weeks 2, 5, 6                  | each week's Monday | to record                                                                                                                                                                                              |
| **The yen-yen four-category card** (1280×670)                                                    | week 3                         | Mon 11-30          | to make                                                                                                                                                                                                |
| **Owner decision:** how to describe who wrote The Wanting Mind's text                            | week 6                         | Mon 12-21          | open (narration and art are AI; the text is not documented)                                                                                                                                            |
| **App Store provider token**                                                                     | every iOS link                 | done               | `128720195`, already public in the kensaur.us `/go/` redirector (`src/go/main.ts:30`). Nothing to do                                                                                                   |
| Landing fixes from the growth lanes (store badges, no interstitials)                             | weeks 2–6                      | each week's gate   | in progress in the growth-\* lanes. Each folder README says what to check                                                                                                                              |

## Checklist

Tick each line as you go.

**Week 1, Mushi Mushi (11-16 → 11-22)**

- [ ] Production Check gate holds
- [ ] A week of ordinary Reddit comments (no links)
- [ ] X and Bluesky data thread Wed 11-18 (`posts/05`)
- [ ] Show HN Thu 11-19 09:30 JST, or the r/ClaudeCode fallback
- [ ] Show HN thread answered for 3 hours
- [ ] LinkedIn Thu 11-19 (`posts/06`)
- [ ] r/vibecoding Sun 11-22 (only if approved)

**Week 2, glot.it (11-23 → 11-29)**

- [ ] Badges not covered at 390×844
- [ ] Rating asks sent (EN / TH)
- [ ] r/cursor Mon 11-23 (Mushi Mushi), visible signed out
- [ ] r/learnthai Tue 11-24, visible signed out
- [ ] X thread with the clip Wed 11-25
- [ ] r/indiehackers Thu 11-26 (Mushi Mushi)

**Week 3, yen-yen (11-30 → 12-06)**

- [ ] Badges one tap, no interstitial
- [ ] Rating asks sent (JA / EN)
- [ ] note article Tue 12-01, read back signed out
- [ ] X (JA) Tue 12-01
- [ ] r/povertyfinance Thu 12-03, visible signed out
- [ ] Tue 12-08: Mushi Mushi kill-switch review (PLAN.md)

**Week 4, help-her-take-photo (12-07 → 12-13)**

- [ ] Two-phone clip recorded
- [ ] Rating asks sent
- [ ] TikTok, Reels and Shorts Tue 12-08
- [ ] X Wed 12-09
- [ ] Product Hunt Wed 12-09 17:01 JST, comments answered
- [ ] r/SideProject Thu 12-10, visible

**Week 5, lets-talk (12-14 → 12-20)**

- [ ] Guest try works
- [ ] Link previews not blank
- [ ] Rating asks sent
- [ ] Product Hunt Tue 12-15 17:01 JST
- [ ] LinkedIn Wed 12-16
- [ ] X Thu 12-17
- [ ] r/ClaudeAI Fri 12-18, visible

**Week 6, the-wanting-mind (12-21 → 12-27)**

- [ ] Authorship wording decided
- [ ] Clip recorded
- [ ] Rating asks sent
- [ ] r/FreeEBOOKS modmail sent
- [ ] Product Hunt Tue 12-22
- [ ] X and Bluesky Wed 12-23
- [ ] r/FreeEBOOKS Sat 12-26 (only on a yes)

**Mon 12-28**

- [ ] Results table below filled in

## Results (fill in 7 days after each week)

Ratings were 0 on every store on 2026-11-14.

| Product             | Posts that stayed up | Visits (source)     | Installs or checks (campaign) | New ratings | What worked / what to drop |
| ------------------- | -------------------- | ------------------- | ----------------------------- | ----------- | -------------------------- |
| Mushi Mushi         |                      | `by_src`            | checks, `sdk_seen_live`       | n/a         |                            |
| glot.it             |                      |                     | Play / ASC `launch-2611-*`    |             |                            |
| yen-yen             |                      | `template_download` |                               |             |                            |
| help-her-take-photo |                      |                     | pairings                      |             |                            |
| lets-talk           |                      |                     | activations                   |             |                            |
| the-wanting-mind    |                      |                     |                               |             |                            |

**A limit to know about:** Mushi Mushi's `end_user_sessions` don't record the
referrer or UTM yet (audit, 2026-11-14). For the five apps, the per-post
numbers come from:

- Play Console acquisition (`referrer=`);
- App Store Connect campaigns (`ct=`, shown at 5+ installs);
- each platform's own post analytics.

Mushi Mushi's own landing records `src`.

## Rules that apply to every post

- **Honest claims only.** Each folder's claims table lists what was checked
  and when. Re-check numbers that move (the scoreboard, download counts) on
  the day.
- **"Mushi Mushi", never "Mushi".**
- **No fundraising language.** No testimonials or user counts that nobody gave
  you.
- **No vote or review incentives, no upvote asks**, on any channel.
- **Say you're the maker** in every post.
- **Store titles, metadata, icons and mascot art stay as they are** (frozen
  until about mid-January).
