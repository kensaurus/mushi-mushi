# Launch calendar: one product a week, 2026-11-16 to 2026-12-27

One product per week, so the owner can stay in the comments for each one. All
times are given in JST first, because that's where the owner is.

**Each week runs the same way:**

1. **Monday:** send the rating asks.
2. **Tuesday to Thursday:** the main posts. Never two posts in one community on
   the same day.
3. **Friday or the weekend:** answer the remaining comments.
4. **The following Monday:** the week's checks.

Mushi Mushi goes first, because its Show HN slot is early and PLAN.md's
week 2 posts are already scheduled for these dates.

**PLAN.md day names:** from its week 2 on, the weekday labels are one day off.
"Tue 11-18" is a Wednesday, and "Sat 11-22" is a Sunday. Go by the **dates**.
This calendar uses the dates, with correct weekdays.

## Week 1 · Mon 11-16 → Sun 11-22 · Mushi Mushi

| Date (JST)             | Item                                                                                                                                                                                                        | File                                         | Check it worked                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| **Gate, by Sun 11-15** | Production Check gate holds (an unreachable URL shows as failed); the measurement batch is deployed                                                                                                         | `PLAN.md`                                    | try `https://does-not-exist.invalid` on `/docs/check`                        |
| Mon 11-16 → Sun 11-22  | **Reddit warm-up:** ordinary comments in r/cursor, r/learnthai and r/indiehackers, no links. The account's only history is the filtered 10-29 post, and r/cursor wants self-promotion under 10% of activity | none                                         | a few comments that stayed up                                                |
| Wed 11-18              | X thread, then Bluesky (PLAN's "Tue 11-18")                                                                                                                                                                 | `posts/05-x-bluesky-thread`                  | `by_src` for `x.datastory` and `bsky.datastory`                              |
| **Thu 11-19, 09:30**   | **Show HN**, if the gates in `posts/08-show-hn.notes.md` hold. Stay in the thread until 12:30                                                                                                               | `posts/08`, `mushi-mushi/show-hn-replies.md` | the post is on `/shownew`; checks with `src=hn.show`; every comment answered |
| Thu 11-19 (fallback)   | If Show HN is blocked: one comment in r/ClaudeCode's weekly showcase thread                                                                                                                                 | `mushi-mushi/README.md`                      | checks with `src=reddit.claudecode`                                          |
| Thu 11-19              | LinkedIn (PLAN's "Wed 11-19")                                                                                                                                                                               | `posts/06-linkedin`                          | `by_src` for `linkedin.datastory`                                            |
| Fri 11-20              | dev.to long version (optional; PLAN's "Thu 11-20")                                                                                                                                                          | `posts/01-data-story`                        | `devto.datastory`                                                            |
| Sun 11-22              | r/vibecoding contribution post, only if the mods approved the tool                                                                                                                                          | `posts/07-reddit-vibecoding`                 | signed out at `/r/vibecoding/new/`                                           |

## Week 2 · Mon 11-23 → Sun 11-29 · glot.it

| Date (JST)       | Item                                                                                                                                                                                     | File                                 | Check it worked                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Gate             | Store badges on `kensaur.us/glot-it` not covered by the sticky bar at 390×844 (growth-glot lane)                                                                                         | `glot-it/README.md`                  | open on a phone                                                                      |
| Mon 11-23        | Rating asks (EN, TH)                                                                                                                                                                     | `glot-it/rating-ask.*`               | new ratings in both consoles by Mon 11-30                                            |
| Mon 11-23, 23:00 | r/cursor value post (Mushi Mushi; moved here after the warm-up week)                                                                                                                     | `mushi-mushi/01-reddit-cursor`       | signed out at `/r/cursor/new/` after 1 h; Production Checks with `src=reddit.cursor` |
| Tue 11-24, 22:00 | r/learnthai post                                                                                                                                                                         | `glot-it/01-reddit-learnthai`        | signed out at `/r/learnthai/new/`; Play acquisition `launch-2611-learnthai`          |
| Wed 11-25, 09:30 | X thread with the tone-drill clip                                                                                                                                                        | `glot-it/02-x-thread`                | link clicks; `launch-2611-x`                                                         |
| Wed 11-25        | Qiita how-to (Mushi Mushi, PLAN's "Tue 11-25")                                                                                                                                           | `posts/04-qiita-lovable-check`       | `qiita.lovable-check`                                                                |
| Thu 11-26        | Lovable/Bolt custom-MCP how-to (Mushi Mushi, PLAN's "Wed 11-26")                                                                                                                         | `submissions/06`                     |                                                                                      |
| Thu 11-26, 23:00 | r/indiehackers: Mushi Mushi's one self-promotion post. Two days after r/learnthai: one Reddit post per account per day at most, because several posts in a day trip Reddit's spam filter | `mushi-mushi/02-reddit-indiehackers` | `/r/indiehackers/new/`; `src=reddit.indiehackers`                                    |
| Fri 11-27        | First weekly held-PR post (Mushi Mushi, PLAN)                                                                                                                                            | `posts/02` template                  | `x.heldpr-*`                                                                         |
| Sat 11-28        | Zenn how-to (Mushi Mushi, PLAN's "Fri 11-28"; at least 24 h after any other Zenn post)                                                                                                   | `posts/03`                           | `zenn.lovable-check`                                                                 |
| Optional         | glot.it Product Hunt, only with 5+ ratings                                                                                                                                               | `glot-it/03-product-hunt`            |                                                                                      |

**Owner time this week:** glot.it about 3 hours, plus PLAN's Mushi Mushi items.
If that's too much, move the Qiita and Zenn posts a week; they aren't tied to a
day.

## Week 3 · Mon 11-30 → Sun 12-06 · yen-yen

| Date (JST)       | Item                                                                                                              | File                               | Check it worked                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Gate             | One-tap store badges on the yen-yen landing; no JS interstitial (growth-yy-hhtp lane)                             | `yen-yen/README.md`                | tap through on a phone                                     |
| Mon 11-30        | Rating asks (JA, EN)                                                                                              | `yen-yen/rating-ask.*`             | ratings by Mon 12-07                                       |
| Tue 12-01, 20:00 | note article: the free four-category template                                                                     | `yen-yen/01-note`                  | note views; `template_download` events (`lang: ja`)        |
| Tue 12-01, 21:00 | X (Japanese)                                                                                                      | `yen-yen/02-x-ja`                  | link clicks                                                |
| Wed 12-02        | Mushi Mushi: second held-PR post (PLAN's "Tue 12-02")                                                             | template                           |                                                            |
| Thu 12-03        | Mushi Mushi: keep-or-kill review and scorecard row (PLAN's "Wed 12-03")                                           | `../scorecard.md`                  |                                                            |
| Thu 12-03, 23:00 | r/povertyfinance: the free template (EN), disclosed                                                               | `yen-yen/03-reddit-povertyfinance` | `/r/povertyfinance/new/`; `template_download` (`lang: en`) |
| **Tue 12-08**    | **Mushi Mushi kill switch** (PLAN): fewer than 3 outside `sdk_seen_live` and 0 activations means stop acquisition | `PLAN.md`                          |                                                            |

## Week 4 · Mon 12-07 → Sun 12-13 · help-her-take-photo

| Date (JST)          | Item                                                                                            | File                                        | Check it worked                          |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| **Before the week** | **Record the 15–30 s two-phone clip** (shot list in the README). Without it, swap weeks 4 and 5 | `help-her-take-photo/README.md`             | the clip exists                          |
| Mon 12-07           | Rating asks (EN, JA)                                                                            | `help-her-take-photo/rating-ask.*`          | ratings by Mon 12-14                     |
| Tue 12-08, 19:00    | Short video on TikTok and Reels; then Shorts at 09:00 Wed                                       | `help-her-take-photo/01-short-video`        | completion rate, profile taps after 24 h |
| Wed 12-09, 08:30    | X thread with the clip                                                                          | `help-her-take-photo/02-x-thread`           | link clicks                              |
| Wed 12-09, 17:01    | **Product Hunt** goes live (00:01 PT). Be there until 20:00                                     | `help-her-take-photo/03-product-hunt`       | comments answered; `launch-2611-ph`      |
| Thu 12-10, 23:00    | r/SideProject build post                                                                        | `help-her-take-photo/04-reddit-sideproject` | `/r/SideProject/new/`                    |

The measure for this week is **pairings**, not installs.

## Week 5 · Mon 12-14 → Sun 12-20 · lets-talk

| Date (JST)       | Item                                                                           | File                           | Check it worked                   |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------ | --------------------------------- |
| Gate             | One guest Advise request works in a private window; link previews aren't blank | `lets-talk/README.md`          | try it                            |
| Mon 12-14        | Rating asks (EN, JA)                                                           | `lets-talk/rating-ask.*`       | ratings by Mon 12-21              |
| Tue 12-15, 17:01 | **Product Hunt** goes live. Be there until 20:00                               | `lets-talk/01-product-hunt`    | activations from `launch-2611-ph` |
| Wed 12-16, 08:00 | LinkedIn                                                                       | `lets-talk/02-linkedin`        | `launch-2611-linkedin`            |
| Thu 12-17, 08:30 | X thread (Wed 23:30 UTC)                                                       | `lets-talk/03-x-thread`        | link clicks                       |
| Fri 12-18, 23:00 | r/ClaudeAI showcase                                                            | `lets-talk/04-reddit-claudeai` | `/r/ClaudeAI/new/`                |

## Week 6 · Mon 12-21 → Sun 12-27 · the-wanting-mind

| Date (JST)          | Item                                                                                 | File                                        | Check it worked      |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------- |
| **Before the week** | **Owner decision:** how you describe who wrote the text. Record the concept-map clip | `the-wanting-mind/README.md`                | decided              |
| Mon 12-21           | Rating asks (EN, JA); modmail to r/FreeEBOOKS                                        | `the-wanting-mind/rating-ask.*`, `03` notes |                      |
| Tue 12-22, 17:01    | **Product Hunt** goes live                                                           | `the-wanting-mind/01-product-hunt`          | `launch-2611-ph`     |
| Wed 12-23, 09:30    | X, then Bluesky                                                                      | `the-wanting-mind/02-x-bluesky-thread`      | link clicks          |
| Sat 12-26, 23:00    | r/FreeEBOOKS, **only if the mods said yes**                                          | `the-wanting-mind/03-reddit-freeebooks`     | `/r/FreeEBOOKS/new/` |

## After the six weeks

- **Mon 12-28:** fill the results table in `README.md` for every product.
- **Next kit:** January 2027. Re-try Show HN if it was blocked. Launch glot.it
  on Product Hunt if it has 5+ ratings. Re-check Reddit rules before reusing
  any verdict here; rules change.

## The visibility check, every time

Reddit: 1 hour after posting, open the sub's `/new/` page in a private window.
If your post isn't there, or shows "removed by Reddit's filters", send the
mods one polite message. Never repost (see the r/SideProject removal of
2026-10-29).

Everywhere else: open the post's own URL signed out, and read the link
preview. note and Zenn: read it back through the public URL and check the OG
description reads like the post.
