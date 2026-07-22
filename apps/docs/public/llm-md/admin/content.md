# Content quality

Source: https://kensaur.us/mushi-mushi/docs/admin/content

---
title: Content quality
---

# Content quality

**Route:** `/content`

> **Scenario:** AI-generated copy, release notes, or knowledge snippets scored
> poorly or got user flags — you need a queue of fixable assets.

The Content Quality Debug Station lists assets that need review:

| Reason | Meaning |
|--------|---------|
| `low_judge_score` | Judge scored the asset below threshold |
| `user_flag` | End users flagged the content |
| `low_star_rating` | Aggregate star rating is low |
| `high_downvote_ratio` | Downvotes dominate |

Open a row (`/content/:id`) to inspect scores and trigger regeneration. Stats
strip and readout follow the standard PagePosture chrome.

## Related pages

- [Judge dashboard](/admin/judge) — quality grades that feed this queue
- [Releases](/admin/releases) — changelog / release-note surfaces
