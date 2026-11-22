# November 2026 launch plan: four weeks, about 20 owner hours a week

Written 2026-11-11. It follows ADR 0056 ("find out what is broken in your live
app and get it fixed, in plain words"; the free Production Check is the front
door).

Changes from the research note of the same day (§5):
- **Concierge is dropped.** The 6–8 owner hours a week it held go to
  distribution and to testing the product as a new user.
- **"10 paid by 11-30" is retired.** See the header of
  `docs/plan-gtm-november-2026.md`.

## The numbers we judge by

Read the daily numbers with `GET /v1/admin/growth/daily?days=14`. Read the
weekly ones with `GET /v1/admin/growth/funnel`.

| Metric | What it means | Baseline 2026-11-11 |
|---|---|---|
| **`sdk_seen_live`** (leading indicator) | an outside project's SDK first checked in from a live site or a store app (not localhost, a private network or `cli://`), once per project | **0 ever** (outside projects) |
| **Activated** (north star) | an outside project's first real end-user report, diagnosed | **0 real ever** (the 1 `activated` row, 2026-11-10, is the setup wizard's own test report) |
| Production Checks by `src` | `select src, count(*) from production_checks group by 1` | 4 ever, all by the owner or agents |
| Tagged landing views | `by_src` in the daily scorecard | 4 of 321 views tagged (10-28..11-11) |

`sdk_seen_live` is the metric for every play. A new install can wait weeks for
its first real report, because users rarely report. So two weeks is enough to
judge "did it go live", and not enough to judge "did it activate".

## Gates before anything links to `/check`

These come from ADR 0056 §5. Another lane owns `_shared/production-check*.ts`.
No post that links the check goes out until both hold on the live site:

1. An unreachable URL shows as a **failed** check ("we could not reach your
   site"), never an empty pass.
2. Breakage a visitor would see comes first (broken links and images, pages
   that 404, placeholder titles, errors on load); security headers come after.

**How to check:** open `https://kensaur.us/mushi-mushi/docs/check`, try
`https://does-not-exist.invalid` and one Lovable app. 5 minutes.

Also before week 2: the measurement batch must be **deployed**. That is this
lane's migration `20261111090000`, the spam filter on the beacon and the
self-project visit events, and the other lane's wizard-test-report fix. Until
then, spam and the wizard still skew the daily numbers.

## Who does what

| Owner (5–10 minutes each: paste, submit, check) | Automated or done by agents |
|---|---|
| Paste each post from its `*.paste.md` | Landing counter, spam filter, `src` attribution, `sdk_seen_live` emit and the daily scorecard (code in this batch) |
| Submit each directory packet in `submissions/` | Drafting posts, packets and the weekly held-PR candidates (the query is in `posts/02-held-pr-weekly.notes.md`) |
| Merge the patches listed for other lanes (skills, cursor rule, docs Bolt section) | Re-running the numbers before each post (the `gtm-weekly` skill) |
| Test the Lovable and Bolt paths in a fresh account; film one 60-second capture | Registry republish on each `@mushi-mushi/mcp` release (`release.yml`) |
| Answer Reddit threads in your own words, 20 minutes a day on posting days | Writing the weekly scorecard row |
| Read the scorecard; keep or kill each play | |

## Calendar

Owner hours are estimates. Each week stays under 20.

### Week 1 (11-11 → 11-17): measure honestly, get listed

| Day | Owner item | Time | File |
|---|---|---|---|
| Wed 11-11 | Review and merge the measurement batch; deploy it (migration `20261111090000`, `api-ext`, `api`) | 60 min review | this branch |
| Thu 11-12 | Post the r/vibecoding tool-approval request in the X community | 5 min | `posts/07b-x-vibecoding-community-approval.paste.md` |
| Thu 11-12 | Send the Cursor Marketplace follow-up email | 3 min | `submissions/05-cursor-marketplace-followup.paste.md` |
| Fri 11-13 | Create the small plugin repo, then submit to the Claude plugin directory | 25 min | `submissions/01-claude-plugin-directory.md` |
| Fri 11-13 | Create the reviewer test account; submit to the Claude connectors directory | 25 min | `submissions/02-claude-connectors-directory.md` |
| Sat 11-14 | Supabase partner form (owner decision on the legal-draft question first) | 5 min | `submissions/07-supabase-partner.md` |
| Sun 11-15 | MCP directory hygiene: registry check, Glama rebuild, mcp.so decision | 10 min | `submissions/08-mcp-directories-refresh.md` |
| Any day | Test the Lovable custom-MCP path in a fresh workspace; test Bolt | 60 min | `submissions/06-lovable-bolt-custom-mcp.notes.md` |
| Any day | Walk the whole new-user path yourself on a fresh account, Lovable first: sign up → script tag → publish → test report → copy fix prompt. Write down every stop. | 90 min | (feeds the other lanes) |

**How to deploy the measurement batch:**
- Deploy from `master` after the merge, never from a working tree. The lane
  worktree also holds other lanes' uncommitted `_shared` edits (the production
  check, the site audit, the health checks), and an `api-ext` deploy from there
  would ship their unfinished work.
- Run `pnpm check:migration-ledger` before `supabase db push`.
- Order doesn't matter. The beacon route drops spam before it calls the RPC,
  and the route reads `spam_views_excluded` as 0 until the migration is
  applied. So the code and the migration can land in either order.

**Week 1 total: about 5 hours.** The slack is for reviewing the other lanes'
check and onboarding changes (play 2 and play 3 in the research note), which
the whole plan depends on.

**Gate at the end of week 1:**
- 0 false activations in the new rows;
- the spam host gone from new page views;
- the `/check` gates hold.

### Week 2 (11-18 → 11-24): the data story

| Day | Owner item | Time | File |
|---|---|---|---|
| Tue 11-18 | Re-run the numbers; post the X thread, then the same on Bluesky (swap the tag) | 10 min | `posts/05-x-bluesky-thread.paste.md` |
| Wed 11-19 | LinkedIn post | 5 min | `posts/06-linkedin.paste.md` |
| Thu 11-20 | dev.to long version (optional) | 10 min | `posts/01-data-story.paste.md` |
| Thu 11-20 | Merge the skills.sh and cursor.directory patches; re-submit the repo on cursor.directory; `npx skills find` check | 15 min | `submissions/03-skills-sh.md`, `04-cursor-directory.md` |
| Sat 11-22 | r/vibecoding contribution post (no link) | 10 min, plus replies | `posts/07-reddit-vibecoding.paste.md` |
| Daily | Reddit: answer 1–2 "my Lovable/Cursor app broke" threads, in your own words, no link unless asked | 20 min/day | |

**Week 2 total: about 4 hours,** plus review of other lanes.

**Gate at the end of week 2:**
- 15 or more outside Production Checks with a `src`;
- at least 1 `sdk_seen_live`.

### Week 3 (11-25 → 12-01): Japan, the Lovable how-to, the first held PR

| Day | Owner item | Time | File |
|---|---|---|---|
| Tue 11-25 | Qiita how-to | 10 min | `posts/04-qiita-lovable-check.paste.md` |
| Wed 11-26 | Publish the Lovable/Bolt custom-MCP how-to (dev.to or docs) | 10 min | `submissions/06-lovable-bolt-custom-mcp.paste.md` |
| Thu 11-27 | First weekly held-PR post | 15 min (pick the PR, fill the template) | `posts/02-held-pr-weekly.template.paste.md` |
| Fri 11-28 | Zenn how-to (at least 24 h after any other Zenn post) | 10 min | `posts/03-zenn-lovable-check.paste.md` |
| Any day | Film one 60-second Lovable capture: live site → report → plain-English cause → fix in Lovable | 2 h | (attach to the how-to and the next post) |
| Daily | Reddit answers | 20 min/day | |

**Week 3 total: about 5 hours.**

**Gate at the end of week 3:**
- at least 1 real activation;
- 5% or more of check visitors go on to an install (`sdk_seen_live` over
  checks, same `src`).

### Week 4 (12-02 → 12-08): keep or kill, then the next format

| Day | Owner item | Time | File |
|---|---|---|---|
| Tue 12-02 | Second held-PR post | 15 min | template |
| Wed 12-03 | Keep or kill review (below); write the scorecard row | 60 min | `../scorecard.md` |
| Thu 12-04 | If week 3 data shows check visitors stall before installing: build the starter template | 30 min | `starter-template/PLAN.md` |
| Fri 12-05 | If an outside project activated: ask the builder, by email, whether you may share their diagnosis (no names without a yes) | 10 min | |
| Daily | Reddit answers | 20 min/day | |

**Week 4 total: about 3 hours.** Show HN stays held: see
`posts/08-show-hn.notes.md`.

## Each play: metric and kill switch

| Play | Success metric | Kill switch |
|---|---|---|
| Claude plugin + connectors directory | listed (yes/no); `src=claude.directory` / `claude.connectors` setups | One sitting each. If review asks for more than 2 h of fixes, park it until there are live installs. |
| skills.sh skill in the user's words | `production_checks.src = 'skills.sh'` | Fewer than 3 in 4 weeks: stop working on it. |
| cursor.directory rule | `src=cursor.directory` | One sitting; no follow-up work. |
| Cursor Marketplace follow-up | listing (yes/no) | No reply by 12-09: stop chasing. |
| Supabase partner | accepted (yes/no) | If they ask for revenue: stop, re-apply after paying customers. |
| MCP directory hygiene | every listing points at `kensaur.us` | One sitting. Not a channel. |
| Data story (X, Bluesky, LinkedIn, dev.to) | tagged views per post ≥ 30, then 1 or more checks | Under 30 tagged views across channels in 7 days: no second data story. |
| Weekly held-PR post | tagged views per post | 3 posts in a row under 30 tagged views each: stop the format. |
| r/vibecoding contribution and approval | approval DM; `src=reddit.vibecoding` checks | Removed: ask the mods once, never repost. No approval in 3 weeks: drop the intro post. |
| Zenn and Qiita | tagged views per article | Both under 20 tagged views after 14 days: stop JP articles. |
| Lovable/Bolt how-to and capture | projects whose first live origin is `*.lovable.app` or a Bolt host (query below) | Fewer than 2 in 4 weeks: stop promoting it, and keep the page. |
| Starter template | `sdk_seen_live` after a `starter.lovable` first touch, 2 or more | Fewer than 2 in 4 weeks: stop linking it. |

**Lovable/Bolt origins query:**

```sql
select o.origin_sample, min(o.first_seen_at) first_seen, count(distinct o.project_id) projects
  from project_api_key_origins o
  join projects p on p.id = o.project_id
  left join organizations org on org.id = p.organization_id
 where o.origin_kind = 'live_web'
   and coalesce(org.billing_mode, '') <> 'complimentary'
   and org.owner_id not in (select user_id from operator_users)
   and (o.origin_sample like '%.lovable.app' or o.origin_sample like '%.lovableproject.com'
        or o.origin_sample like '%.bolt.host' or o.origin_sample like '%.netlify.app')
 group by 1 order by 2 desc;
```

The Bolt-host patterns are a guess `[unverified]`. Bolt publishes to its own
host and to Netlify; add the real host once one shows up.

## The overall kill switch

This replaces the research note's, which was tied to the dropped concierge
play.

**If, by 2026-12-08, all plays together produce fewer than 3 outside projects
with `sdk_seen_live` and 0 real activations:**
1. stop acquisition work;
2. walk the new-user path again, then interview 10 builders: "what did you do
   with the last 'it's broken' message?"
3. build nothing new until that is done.

## Stop doing (for these four weeks)

1. **Operator features.** No CI-page views, health cards, merge-queue, worker
   lane or credit work unless it unblocks an outside user (28 of 83 commits
   since 10-27 went there, against about 8 on adoption).
2. **Posting untagged.** No link goes out without a `src` from `links.md`.
3. **Citing stale or inflated numbers.**
   - Do not cite: "560 widget reports", "193 fixes", "676 from 314 people",
     npm downloads, repo clones or the aocr.org spike.
   - Only cite `public_scoreboard()`, re-run on the day.
4. **Calling every one of the 2,031 a "check".** Some are the owner's own
   filings. Say "from automatic checks and my own testing".
5. **Promising keyed features as free.** The hourly site watch, the code audits
   and the first-user test need the user's keys or a local agent. Name what
   each one needs.
6. **Mixing Mushi Mushi posts into the personal Zenn feed** (campsite,
   glot.it, livestreams).
7. **Adding more MCP directories or awesome-lists** as a "channel".
8. **Smithery.** It is gone (404; proxy shut down 2026-10-31).
9. **Any route around HN's new-account Show HN limit,** and Product Hunt
   before live installs exist.
10. **Cold email.** The concierge play is dropped: no personal outreach to the
    lead list in this plan.
11. **Chasing "10 paid by 11-30".** That target is retired.

## Files in this folder

| File | What |
|---|---|
| `links.md` | the `src` convention and every tag in use |
| `posts/*.paste.md` | the text to paste: title and body only |
| `posts/*.notes.md` | gates, sources, fields and kill switches (never paste) |
| `submissions/*.md` | directory packets with the exact fields |
| `starter-template/PLAN.md` | the starter's files and README draft |
