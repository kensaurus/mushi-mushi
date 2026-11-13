# HELD: Product Hunt. Do not launch until every gate below is true

> PLAN.md "Stop doing" #9 rules out Product Hunt before live installs exist.
> A Product Hunt launch is one-shot, so it waits for the same gates as Show HN
> (`08-show-hn.notes.md`):
>
> 1. **Live outside installs:** at least 3 outside projects with
>    `sdk_seen_live`, and at least 1 real activation. Baseline 2026-11-11:
>    **0 and 0**.
> 2. **The Production Check gate** (ADR 0056 §5) holds on the live site.
> 3. **The numbers are re-queried on launch day** (below).
> 4. **Organic only.** No paid boost, no upvote requests, no launch-day
>    "support" groups (owner, 2026-11-13: no ads).

Paste file: `09-product-hunt.HELD.paste.md`. Each `Field:` line maps to the
Product Hunt form. The first comment goes in as the maker comment right after
launch.

## Field limits (checked 2026-11-13)

| Field | Limit | Draft |
|---|---|---|
| Tagline | 60 characters | 54 |
| Description | 260 characters | 226 |
| Gallery | 1270×760 recommended | below |
| Thumbnail | 240×240 | `img/ph-thumb-field-kenji.png` |

Re-measure the lengths after any edit.

## Facts behind the copy

All re-queried 2026-11-13. Re-run each one on launch day.

- **36, about 2,040, nine apps:** `select public_scoreboard(60);` on project
  `dxptnwrhwsqckaftyymj` returned `user_reports` 36, `other_reports` 2,042 and
  `apps` 9.
- **Free plan, one app and 100 diagnoses a month; "I pay for the model":**
  the live sample-diagnosis page ("Get this for your own app") and ADR 0056.
- **"Home page and three pages it links to", "Lovable App", public pages
  only:** the live `/docs/check` page text, 2026-11-13.
- **Field Kenji guides sign-in, setup and first diagnosis:** commit 73ee22ef6
  (#1091). His poses are live in the admin bundle and the docs (checked
  2026-11-13).
- **Not cited on purpose** (PLAN.md "Stop doing" #3): npm downloads, repo
  views (414 of 502 in 14 days came from aocr.org), GitHub stars, and any
  MCP tool count. The counts differ by surface (2026-11-13 pre-commit
  catalog check: 138 in the canonical catalog, 130 on the hosted server,
  while `glama.json` still lists a stale 92), so a single number would
  mislead.

## Gallery (in order)

| # | File | What it shows |
|---|---|---|
| 1 | `img/ph-gallery-1-field-kenji.jpg` | Field Kenji, four shipped admin poses (magnify, found, laptop, all clear) from `apps/admin/src/assets/mascot/` |
| 2 | `img/ph-gallery-2-diagnosis.png` | The sample diagnosis card: plain-English cause, why it broke, where, the fix, how to reproduce (`/docs/demo/diagnosis`) |
| 3 | `img/ph-gallery-3-check.png` | The free Production Check form (`/docs/check`) |
| 4 | `apps/docs/public/walkthroughs/bug-to-fix.jpg` | Report, diagnosis, fix prompt, pull request (the How it works walkthrough) |

Re-shoot 2 and 3 on launch day if the pages changed. All four are 1270 wide
or will be letterboxed to 1270×760 on upload.

## After launching (if it ever goes)

- Stay on the page for the first 3 hours and answer every comment.
- Do not ask anyone to upvote.
- Tag: `ph.launch` (`links.md`).
