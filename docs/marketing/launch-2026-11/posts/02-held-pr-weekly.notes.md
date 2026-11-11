# Notes: weekly "the reviewer that says no" post (never paste this file)

Template: `02-held-pr-weekly.template.paste.md`.
- Copy it to `02-held-pr-<yyyymmdd>.paste.md`.
- Fill every `⟨…⟩`, then paste.
- Line 1 is the title (LinkedIn and dev.to). On X or Bluesky, use the second
  paragraph as post 1 and the rest as replies.

## Pick this week's PR (about 5 minutes)

It must be **public**. Your own apps' repos may be private: only use a PR whose
repo and review comment anyone can open. `kensaurus/mushi-mushi` is public.

```sql
-- held reviews in the last 7 days, newest first (read-only)
select fr.reviewed_at, fr.repo, fr.pr_number, fr.pr_url, fr.risk, fr.summary, fr.comment_url
  from fix_reviews fr
 where fr.verdict = 'hold'
   and fr.reviewed_at >= now() - interval '7 days'
 order by fr.reviewed_at desc
 limit 20;
```

Baseline on 2026-11-11, last 7 days: 66 `hold`, 80 `fix_first` and 99 `merge`
verdicts, across 3 to 5 repos.

**Pick a PR whose reason a non-coder understands.** Good reasons:
- the fix removes behaviour (`removes_behavior` is set);
- it hides the error instead of fixing it;
- it changes more than the bug (`scope_creep`).

Skip reasons that need code to explain.

## Numbers for the template

```sql
select (public_scoreboard(60)->>'reviews') reviews, (public_scoreboard(60)->>'reviews_hold') reviews_hold;
```

On 2026-11-11 these were 1,745 and 576.

- **`reviews_hold` counts only `verdict = 'hold'`**
  (`20261029100000_public_scoreboard_honest_counts.sql`). Do not add
  `fix_first` to it.

## Gate

- [ ] Every `⟨` is gone:
  `grep -n '⟨' 02-held-pr-<yyyymmdd>.paste.md` must print nothing.
- [ ] Usual grep gate: no `Title (set`, `READY`, `Source notes`,
  `Questions for the owner`, and no code fences.
- [ ] The PR link opens while logged out.
- [ ] **Add the tag row** to `links.md` (`x.heldpr-<yyyymmdd>` and so on)
  before posting.
- [ ] **Production Check gate** (`01-data-story.notes.md`), because the last
  line links `/check`.

## Precedent

`docs/launch/2026-11/log/media/ai-review-hold-pr864.png` is the 2026-10-29
example (PR #864). Its numbers are old, so do not reuse the image's text.

## Success metric and kill switch

- **Metric:** tagged views per post (`by_src` in `GET /v1/admin/growth/daily`).
- **Kill switch:** 3 posts in a row under 30 tagged views each. Stop the
  format (research note play 5).
