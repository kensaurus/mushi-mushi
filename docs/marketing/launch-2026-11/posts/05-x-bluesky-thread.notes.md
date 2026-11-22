# Notes: X / Bluesky thread (never paste this file)

Paste file: `05-x-bluesky-thread.paste.md`. Each block that starts with `N/6` is
one post. Paste them as a reply chain, and keep the `N/6` prefix.

## Before you post

- [ ] **Production Check gate**, as in `01-data-story.notes.md`. Post 4 links
  to `/check`.
- [ ] Re-run `select public_scoreboard(60);` and update 34, 2,031, 523 and 2
  if they changed.
- [ ] **On Bluesky**, replace every `src=x.datastory` with
  `src=bsky.datastory`. That is 3 links.
- [ ] **Length** (measured 2026-11-11 with each link counted as 23 characters
  on X): the longest post is 204 on X and 259 on Bluesky, against limits of
  280 and 300.
- [ ] **No image.** If you add one, use
  `docs/launch/2026-11/log/media/proof-numbers-2026-10-29.png` only after
  re-shooting it. That image shows the old numbers.
- [ ] Grep gate:
  `grep -nE 'Title \(set|READY|Source notes|Questions for the owner|\`\`\`' 05-x-bluesky-thread.paste.md`
  must print nothing.

## Sources

Same queries and date as `01-data-story.notes.md`.

## Owner time

About 5 minutes: paste 6 posts, then swap the tag for Bluesky.

## Kill switch

Under 30 tagged views (`x.datastory` + `bsky.datastory`) in 7 days: stop
threads on X and Bluesky. Keep only the weekly held-PR post if it does better.
