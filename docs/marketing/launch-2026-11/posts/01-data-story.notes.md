# Notes: data story "Users don't report bugs" (never paste this file)

Paste file: `01-data-story.paste.md`. Line 1 is the title, and the rest is the body.

## Gate before posting

- [ ] **Production Check gate (ADR 0056 §5).** The check must:
  - report "we could not reach your site" as a failed check;
  - lead with breakage a visitor would see before security headers.

  Another lane owns `_shared/production-check*.ts`. Open
  `https://kensaur.us/mushi-mushi/docs/check` and check an unreachable URL,
  such as `https://does-not-exist.invalid`, and one Lovable app. Post only once
  both behave as above. The body promises "broken links and images, pages that
  don't load, placeholder titles, errors when the page opens".
- [ ] Re-run the numbers on the day you post (query below). If any number
  changed, update the paste file and the date in its third paragraph.
- [ ] Swap the `src` tag for the channel you paste into:
  - `devto.datastory` is in the file;
  - use `linkedin.datastory` only if you paste this long version on LinkedIn
    (there is a short one in `06-linkedin.paste.md`).
- [ ] Grep gate:
  `grep -nE 'Title \(set|READY|Source notes|Questions for the owner|deslop|\`\`\`' 01-data-story.paste.md`
  must print nothing.

## Where it goes

- **dev.to** (optional). Set the canonical URL if the docs blog gets the same
  post; the blog is not in this lane (`apps/docs/content/**`). Tags: `webdev`,
  `ai`, `buildinpublic`, `opensource`.
- **The thread and the LinkedIn post** are the short versions of this post
  (`05-x-bluesky-thread`, `06-linkedin`).

## Numbers: source and date

Queried 2026-11-11 03:11 UTC on project `dxptnwrhwsqckaftyymj` (read-only):

```sql
select now(), public_scoreboard(60);
```

| Copy | Field | Value |
|---|---|---|
| nine apps | `apps` | 9 |
| tapped 34 times | `user_reports` | 34 |
| 18 different people | `reporters` | 18 (distinct reporter tokens) |
| 2,031 other reports | `other_reports` | 2,031 |
| 523 fixes merged | `fixes_merged` | 523 |
| 2 from a person's report | `merged_from_users` | 2 |
| (not used here) | `reviews` / `reviews_hold` | 1,745 / 576 |
| (not used here) | `median_hours_to_merged_fix` | 68.9 |

### What "user report" means

Migration `20261029100000_public_scoreboard_honest_counts.sql` defines it as:

- an in-app widget report from a real device;
- the owner's own testing included;
- not filed by Mushi Mushi, its agents, an importer, a sweep or a headless
  browser.

The body says "my own testing is counted in it" for that reason.

### What the 2,031 are

Source split, complimentary orgs, 60 days, same day:

```sql
select r.source, count(*) from reports r
  join projects p on p.id = r.project_id
  join organizations o on o.id = p.organization_id
 where o.billing_mode = 'complimentary'
   and r.created_at >= now() - interval '60 days'
 group by 1 order by 2 desc;
```

| Source | Reports | How the body describes it |
|---|---|---|
| `code_audit` | 881 | automatic code reviews |
| `widget` | 678 | 34 people, and the rest are test browsers or sweeps through the widget |
| `api` | 186 | bugs I filed by hand (all 186 carry `custom_metadata.source = admin_file`, checked 2026-11-11) |
| `sentry` | 172 | Sentry errors |
| `security_advisory` | 47 | security advisories |
| `site_watch` | 30 | a check of each live site |
| `skill_run` | 25 | (folded into "automatic") |
| `library_modernizer` | 23 | (folded into "automatic") |
| `site_audit` | 23 | a check of each live site |
| `fresh_eyes` | 7 | test browsers |

These sources sum to 2,072. The scoreboard leaves the demo project out
(2,065 = 34 + 2,031). The 7-row gap is the demo project's reports, checked
the same day: `p.name ~* 'demo'` gives 7 rows, and the rest give 2,065.

**The title is not "found by checks".** Not all 2,031 are automatic: some are
the owner's own filings. That is why the body lists the sources instead of
calling them all checks.

### The four examples

They come from the owner's 104-lead research (`mushi-credits-handoff/gtm-leads/REPORT.md`).
Each was a verified finding on another builder's live app, seen on public
pages only. No app or person is named, and keep it that way.

## ADR 0056 fit

- Only free, keyless things are promised as free:
  - the widget and the diagnosis (Mushi Mushi pays for the model);
  - the one-time check;
  - the known-holes scan once GitHub is connected.
- The hourly watch and the code reviews are named as "not on day one", with
  what each one needs. That is the "say it only next to what it needs" rule.
- "Bug mediator" does not appear. The name is always "Mushi Mushi".

## Kill switch

Under 30 tagged views across all channels within 7 days: do not write a second
data story. Move the hours to the held-PR format or to answering Reddit threads.
