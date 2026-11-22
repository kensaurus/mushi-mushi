# Packet: cursor.directory (MCP entry and rule)

**Status:**
- The MCP entry is already live.
- A rule needs one file in the repo (the patch below), then a re-submit.

**Owner time:** about 5 minutes to merge the rule, then 2 minutes to re-submit.
**Tag:** `cursor.directory`

## How it works now

Checked 2026-11-11 through Firecrawl.

- Rules and MCP servers are now one "Plugins" catalog:
  - https://cursor.directory/mcp redirects to the home page;
  - submitting starts at https://cursor.directory/plugins/new (it needs a
    GitHub or Google sign-in, so the form itself is `[unverified]`).
- The process, from the `cursor/community-plugins` README: "Paste a GitHub
  repo URL — we auto-detect components following the Open Plugins standard.
  Click **Submit**."
- There is no separate rule form. Components are found by path:

| Component | Path in the repo | Mushi Mushi today |
|---|---|---|
| Rules | `rules/*.mdc` | **none at the root** (the rule lives in `packages/cursor-plugin/rules/`) |
| MCP Servers | `.mcp.json` | present at the root: hosted `mushi` (kensaur.us, OAuth) and `mushi-stdio` |
| Skills | `skills/*/SKILL.md` | 5 skills |
| Agents | `agents/*.md` | none at the root |

`docs/marketing/GTM-DISTRIBUTION.md` already records that a re-submit of the
repo returns "duplicate", which confirms the listing exists.

## Patch: a root rule (outside this lane)

New file `rules/mushi-mushi.mdc`. It is the rule from the research note's
play 4c ("when a user reports a bug, pull the Mushi Mushi report and fix
context first"), written so it is safe to load always:

```markdown
---
description: When the user says the app is broken or a user reported a bug, read the Mushi Mushi report and fix context before changing code.
globs: []
alwaysApply: false
---

# Bugs from real users: read the report first

When the user says something is broken in the live app, or pastes a bug
report:

1. If the Mushi Mushi MCP server is connected, call `get_recent_reports`
   (or `search_reports` with the user's words), then `get_fix_context` for the
   matching report. Read the plain-English cause and the files it names before
   you edit anything.
2. If it is not connected, ask whether the app has the Mushi Mushi report
   button. If not, suggest the free check of the live site first:
   https://kensaur.us/mushi-mushi/docs/check?src=cursor.directory
3. Make the smallest change that fixes the reported behaviour. Do not refactor
   nearby code.
4. Never call a tool that changes anything (`transition_status`,
   `reply_to_reporter`, `file_report`) without the user's yes in the same turn.
   Mark the report fixed only after the user confirms the fix is deployed.
```

The existing `packages/cursor-plugin/rules/mushi-mcp.mdc` (`alwaysApply: true`)
is the Marketplace bundle's safety rule. Leave it there.

## Owner step after the patch merges

1. Open https://cursor.directory/plugins/new and sign in with GitHub.
2. Paste `https://github.com/kensaurus/mushi-mushi`.
3. Check that the auto-detected list shows the rule, the MCP servers and the
   skills, then click **Submit**.
4. If it says "duplicate", look for an edit or refresh option on the existing
   listing. The form is behind sign-in, so this step is `[unverified]`.

## Success metric and kill switch

- **Metric:** `src=cursor.directory` checks and views.
- **Kill switch:** none needed after the one sitting.
