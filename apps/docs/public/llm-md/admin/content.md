# Content checks

Source: https://kensaur.us/mushi-mushi/docs/admin/content

---
title: Content checks
description: The Content checks page in the Mushi Mushi console queues low-scoring or flagged AI-generated copy, release notes and knowledge snippets so you can fix them.
---

# Content checks

**Route:** `/content` (sidebar: **Content checks**, under Verify)

With nothing open and no filter from a link, the page is its empty state with
**Show past issues**; the filter row appears once there is something to filter.

> **Scenario:** AI-generated copy, release notes, or knowledge snippets scored
> poorly or got user flags, and you need a queue of fixable assets.

Your own app sends these items to Mushi Mushi (`POST /v1/content-quality` with your
project API key). Content checks lists the ones that need review:

| Reason | Meaning |
|--------|---------|
| `low_judge_score` | The score the source app sent (`judge_score`) is below its threshold. A source may send a vote score here rather than an AI judge grade, so the console calls it "Low score" |
| `user_flag` | End users flagged the content |
| `low_star_rating` | Aggregate star rating is low |
| `high_downvote_ratio` | Downvotes dominate |

Open a row (`/content/:id`) to inspect scores and click **Regenerate & push**. Your app
judges the new candidate and promotes it only if the score improves.

To clear noise in bulk, tick rows or filter the list (status, reason, content
type, source, score band), then choose **Dismiss selected** or **Dismiss all
matching**. The dialog states the exact number of rows and needs a reason,
which goes to the audit log. One run dismisses at most 10,000 rows. A
dismissed row stays dismissed when the source re-sends the same item; only new
flags, new downvotes or a clearly lower score reopen it.

## Related pages

- [Triage grading](/admin/judge) — Mushi's own grading of its triage (not the scores your app sends here)
- [Releases](/admin/releases) — changelog / release-note surfaces
