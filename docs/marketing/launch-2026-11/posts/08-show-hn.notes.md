# HELD: Show HN. Do not post until every gate below is true

> **Gate (owner decision, research note §4: "Show HN: owner decision, set aside").**
> Post this only when **all** of these hold, each checked on the day:
>
> 1. **Live outside installs exist:** at least 3 outside projects with
>    `sdk_seen_live` in `company_funnel_weekly` (or `by_src` in
>    `GET /v1/admin/growth/daily`), and at least 1 real activation.
>    Baseline on 2026-11-11: **0 and 0**.
> 2. **The account can post a Show HN.** HN restricted Show HNs from new
>    accounts in about March 2026 (dang:
>    https://news.ycombinator.com/item?id=47300772). The owner's account hit
>    "showlim" on 2026-10-29. **No workaround:** no borrowed account, and no
>    plain submission dressed as a Show HN.
> 3. **The Production Check gate** (ADR 0056 §5) is live: an unreachable site
>    shows as a failed check, and visitor-facing breakage comes first.
> 4. The numbers in the body are re-queried that day.
>
> If gate 1 or 2 is false, this file stays as it is.

Paste file: `08-show-hn.HELD.paste.md`.
- Line 1 is the HN title (80 characters max; this one is 67).
- The rest goes in the text box.
- HN shows URLs as plain text: keep them on their own lines.

## Facts behind the copy

- **36, about 2,040, and 596 of 1,803:** `public_scoreboard(60)` on 2026-11-13
  (`user_reports` 36, `other_reports` 2,042, `reviews` 1,803, `reviews_hold`
  596, `apps` 9). On 2026-11-11 it was 34, 2,031 and 576 of 1,745. The split
  is in `01-data-story.notes.md`. Re-run it on the day you post.
- **"I pay for the model"**: ADR 0056 Context, "Mushi Mushi pays for the model"
  on a free project.
- **The free and keyed lists** match ADR 0056 §1. Nothing else is promised as
  free.
- **The reviewer line is about the owner's apps**, not a free-plan promise. It does not say "every": 44 of the 523 merged fixes in the window have no `fix_reviews` row (checked 2026-11-11), so "every AI-written fix" would be false.

## After posting (if it ever goes)

- Stay in the thread for 3 hours and answer every comment.
- Do not ask anyone to upvote.
- Tag: `hn.show`.
