# Packet: skills.sh (`npx skills add` / `npx skills find`)

**Status:** already listed. Nothing to submit. The work is making the skills
show up for the words a builder types.
**Owner time:** about 5 minutes to review and merge the patch below. Then one
`npx skills add` from a clean machine.
**Tag:** `skills.sh`

## How skills.sh works

Researched 2026-11-11 through Firecrawl; sources were cached 11-10 and 11-11.

- **No submit form.** "The skills leaderboard ranks skills based on anonymous
  telemetry data collected from the skills CLI. When users install skills…"
  (https://skills.sh/docs).
  - Telemetry sends repo and skill ids only for repos GitHub confirms are
    public.
- **Mushi Mushi is listed today:** https://skills.sh/kensaurus/mushi-mushi
  (HTTP 200 on 2026-11-11).
  - It shows "5 skills, 5 total installs": mushi-debug, mushi-health,
    mushi-mushi, mushi-setup and mushi-integration, 1 install each.
  - The install command is `npx skills add kensaurus/mushi-mushi`.
- **What it reads:** SKILL.md front matter `name` (lowercase, hyphens allowed)
  and `description`. Both are required; `metadata.internal: true` hides a
  skill.
- **Where it looks:**
  - `skills/` up to 3 levels deep;
  - `.claude/skills/`;
  - skills declared in `.claude-plugin/marketplace.json`;
  - custom paths listed in `skills.sh.json`.
- **Search:** `npx skills find <query>` is free text, ranked by installs.
  - `[unverified, from vercel-labs/skills issue #1825]` It calls
    `GET https://skills.sh/api/search`, which returns `{id, source, skillId, name, installs}`.
  - Tags are not searchable.
- **Agents search on their own.** Vercel's `find-skills` skill makes an agent
  run `npx skills find` mid-task
  (https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md).
  That is why the description words matter more than the listing page.

## The gap

Every current description starts from Mushi Mushi's own words: "bug mediator",
"MCP server", "SDK keys". A builder whose app broke types "my app is broken",
"users say it doesn't work", "lovable bug" or "check my live site". None of the
five skills says those words.

## Patch (outside this lane: `skills/` is not in the GTM lane's files)

1. **`skills/mushi-mushi/SKILL.md`**, `description:` line. The old text uses
   the retired "bug mediator" category (ADR 0056 §3).

   ```yaml
   description: "Find out what is broken in your live app and get it fixed, in plain words, with Mushi Mushi. Use when a user says the app is broken or a button does nothing, when you want to check a live Lovable, Bolt, Cursor or Claude Code app for broken pages, or to install the Mushi Mushi report button, MCP server or keys."
   ```

2. **New skill `skills/mushi-check-live-app/SKILL.md`.** It is the one an
   agent should reach for when someone says "it's broken":

   ```markdown
   ---
   name: mushi-check-live-app
   description: "Check a live web app for what visitors hit but never report: broken links and images, pages that don't load, placeholder titles like 'Lovable App', errors on load. Free, no sign-up. Use when the user says their app is broken, users are leaving, or before sharing a Lovable, Bolt or Vite app."
   ---

   # Check a live app for silent breakage

   Most people who hit a bug leave without telling anyone. Before you change
   any code, find out what a visitor actually sees.

   1. Ask the user for the live URL (the published site, not localhost).
   2. Send them to the free Production Check, with the URL to paste:
      https://kensaur.us/mushi-mushi/docs/check?src=skills.sh
      It needs no account. It reads public pages only.
   3. When they paste the result back, fix the findings in this repo in the
      order the check lists them: what a visitor sees first, security
      headers last.
   4. So the next bug reaches them: offer the Mushi Mushi report button. In
      Lovable or Bolt it is one prompt
      (https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt?src=skills.sh).
      In a code repo, run `npx mushi-mushi`.

   Do not claim the site is fine if the check says it could not reach the
   site. That is a failed check, not a pass.
   ```

   Step 3 depends on the Production Check gate (ADR 0056 §5). Merge this skill
   in the same batch as the check's failed state and breakage-first order, or
   after it.

3. **`README.md`** (also outside this lane): add the badge next to the others.

   ```markdown
   [![skills.sh](https://skills.sh/b/kensaurus/mushi-mushi)](https://skills.sh/kensaurus/mushi-mushi)
   ```

## Owner step after the patch merges

From any folder:

```bash
npx skills add kensaurus/mushi-mushi
npx skills find "app is broken"
npx skills find "lovable bug"
```

Done when `mushi-check-live-app` appears in both searches. With 1 install per
skill it may rank low at first: ranking is by installs.

## Success metric and kill switch

- **Metric:** Production Checks with `src=skills.sh`
  (`select count(*) from production_checks where src = 'skills.sh'`), and
  installs on https://skills.sh/kensaurus/mushi-mushi.
- **Kill switch:** fewer than 3 checks from `skills.sh` in 4 weeks. Leave the
  skills as they are and spend no more time here.
