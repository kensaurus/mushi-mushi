# HELD: Show HN. Do not post until every gate below is true

Rewritten 2026-11-14 for [ADR 0058](../../../adr/0058-one-stop-platform-to-enhance-vibe-coded-apps.md)
("One place to improve AI-built apps"; bug fixing is one pillar). The
2026-11-13 version led with bugs only. The day-of reply guide is
[`../mushi-mushi/show-hn-replies.md`](../mushi-mushi/show-hn-replies.md).

## Gates

Check each one on the day.

1. **The account can post a Show HN. Hard gate.**
   - HN restricted Show HNs from new accounts in about March 2026 (dang:
     https://news.ycombinator.com/item?id=47300772). The owner's account hit
     "showlim" on 2026-10-29.
   - **No workaround:** no borrowed account, and no plain submission dressed
     as a Show HN (PLAN.md "Stop doing" #9).
   - How to check: open https://news.ycombinator.com/submit signed in and see
     whether the showlim notice appears for a "Show HN:" title. Don't submit
     to test it.
   - What lifts the limit is HN's call, not a number we know. Spend the weeks
     before commenting thoughtfully on threads you care about.
2. **The Production Check gate** (ADR 0056 §5) is live:
   - an unreachable site shows as a **failed** check;
   - breakage a visitor would see comes first.

   Test with `https://does-not-exist.invalid` and one Lovable app, 5 minutes.
   The post's URL is the check, so this gate decides the URL too (below).

3. **The numbers are re-queried that day:** `select public_scoreboard(60);` or
   `GET https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/public/scoreboard`.
4. **Owner decision: the outside-install gate.**
   - The 2026-11-11 version also required 3 outside projects with
     `sdk_seen_live` and 1 real activation. Both were 0 on 2026-11-11.
   - The 2026-11-14 brief asks for the Show HN early, so the two conflict.
   - **Keep it:** the Show HN waits, maybe past December.
   - **Drop it:** the post goes out as soon as gates 1–3 hold. "I'm still most
     of its users" stays in the text, so the post claims no traction.
   - Only the owner decides. The recommendation is to drop it: the text is
     honest about traction, and HN feedback is most useful before an outside
     install exists, not after.

## Paste file

`08-show-hn.HELD.paste.md`:

- Line 1 is the HN title. The limit is 80 characters; this one is 73.
- The rest goes in the text box. HN shows URLs as plain text, so keep them on
  their own lines.

**HN removes generated text.** The guidelines say "Please don't put generated
text in HN posts. Write your text yourself" and "Don't post generated text or
AI-edited text" (https://news.ycombinator.com/newsguidelines.html, read
2026-11-14). An agent drafted this file. **Retype it in your own words.** Use
it for the order and the facts:

1. who you are, and why you built it;
2. the three things it does;
3. what can be tried without signing up;
4. the 60-day numbers, with the user/automatic split;
5. the limits;
6. the license;
7. three links;
8. one question.

## Title

Show HN rules (https://news.ycombinator.com/showhn.html, read 2026-11-14):

- "Show HN is for something you've made that other people can play with";
- "Please make it easy for users to try your thing out, ideally without
  barriers such as signups";
- "Don't post landing pages or fundraisers".

The general guidelines ask for no uppercase, no exclamation marks and no
"gratuitous number".

| Option                                                                        | Characters | Why                                                                       |
| ----------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| **Show HN: Mushi Mushi – find what's broken or confusing in an AI-built app** | 73         | Plain. "Confusing" covers the journeys pillar without the word "journeys" |
| Show HN: Mushi Mushi – open-source checks and fixes for AI-built apps         | 68         | Says "open source", but "fixes" can read as bug-only                      |
| Show HN: Mushi Mushi – an open-source tool to improve apps built with AI      | 72         | The ADR 0058 category word for word, but vague for HN                     |

## URL: the free check, not the repo

**Use `https://kensaur.us/mushi-mushi/docs/check?src=hn.show`.**

- Show HN is for things people can try. The check runs with no sign-up and no
  install, which is the barrier the rules ask you to remove. The repo needs a
  clone or `npx mushi-mushi` plus a project before anything happens.
- The check records `src=hn.show`. GitHub drops query strings, so a repo link
  can't be attributed (`links.md`).
- The repo is the open-source signal HN cares about. It's in the text box, one
  click away.

**Fall back to the repo URL** if gate 2 fails on the day. A check that passes an
unreachable site would sink the thread.

## When

**Thursday, 00:00–01:00 UTC (09:00–10:00 JST; Wednesday 16:00–17:00 PST).**

Syften studied 216,816 HN posts
(https://syften.com/blog/best-time-to-post-on-hacker-news/). It measures
**average replies**:

- Show HN posts at 00:00–01:00 UTC averaged 4.27 replies, against 3.82 for
  the best afternoon hour (16:00–17:00 UTC);
- by day, Show HN averaged 3.41 replies on Thursday, 3.40 on Sunday and 2.66
  on Tuesday.

Replies matter more than points here: the brief wants feedback, and a thread
with replies keeps the post alive.

Another study measures something else. Myriade
(https://www.myriade.ai/blogs/when-is-it-the-best-time-to-post-on-show-hn)
looks at **breakout rate**, the share that reaches the front page, and finds a
peak at 12:00 UTC. That's 21:00 JST, and the first 3 hours would run past
midnight in Japan.

The 00:00 UTC slot is also 9 am in Japan, so the owner can stay in the thread
for 3 hours in daylight.

## Facts behind the copy

Re-run every number on the day.

- **35, about 2,050, 526, 1,803 and 596:** the public scoreboard at
  2026-11-14 02:04 UTC returned `days` 60, `apps` 9, `userReports` 35,
  `reporters` 19, `otherReports` 2,049, `fixesMerged` 526, `mergedFromUsers` 2,
  `reviews` 1,803 and `reviewsHold` 596.
- **"Made 1,803 reviews"**, not "reviewed every fix": 44 of the 523 merged
  fixes in the window had no `fix_reviews` row (2026-11-11).
- **"I pay for the model", 100 diagnoses, one app:** the live pricing page
  (https://kensaur.us/mushi-mushi/docs/pricing, 2026-11-14): Free is "$0", one
  app, "Up to 100 bugs explained a month", "No card, no AI key".
- **The keyed features** (hourly site watch, code audits) match ADR 0056 §1,
  which 0058 keeps. The text makes no other free promise.
- **The journeys pillar** is in the console for builders (`/journeys` is in
  `BUILDER_CORE_NAV_PATHS`, `apps/admin/src/lib/navRegistry.ts`). The text
  doesn't call it free. It needs sign-up, and the map needs the SDK for real
  visits.
- **Vulnerable dependencies:** ADR 0056 lists the dependency scan as free once
  GitHub is connected. The text names it under the code pillar and doesn't
  call it free.
- **License:** the root `LICENSE` says the repo is open core:
  `packages/server/ee/` is source-available, the server is AGPLv3 and the
  SDKs are MIT.
- **"I'm still most of its users":** true on 2026-11-11 (0 outside activations).
  If an outside activation has happened by then, change it to what is true.

## Submitting: URL plus text, and the first comment

HN's submit form takes a URL and optional text. With a URL, the text may not
show as the post body. Right after submitting, open the item page:

- if your text shows at the top, you're done;
- if it doesn't, post the same text at once as the **first comment**, as the
  founder. That's the usual Show HN shape, and the brief wants a first comment
  either way.

## After posting

- Stay in the thread for 3 hours and answer every comment
  (`../mushi-mushi/show-hn-replies.md`).
- Never ask anyone to upvote or comment, on any channel. HN: "Please don't ask
  friends to upvote or comment."
- Don't post the same day as a Reddit post.
- Tag: `hn.show`.
