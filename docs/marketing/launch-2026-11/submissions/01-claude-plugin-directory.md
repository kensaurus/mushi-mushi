# Packet: Anthropic plugin directory (Claude Code, claude.ai, Cowork)

**Status:** ready, but it needs a small public repo first (step 0 below).
**Owner time:** about 15 minutes to create the repo, then about 10 minutes in the portal.
**Tag:** `claude.directory`

## Where to submit

- **URL:** https://claude.ai/directory/manage, then **Submit new**, then **Plugin bundle**.
- **Who:** a paid claude.ai account (Pro, Max, Ultra, Team or Enterprise;
  free accounts cannot submit). On a Team or Enterprise org, an Owner submits.
  GitHub must be connected on claude.ai in the same org, with push access to
  the repo.
- **Superseded routes:**
  - The old Console form (`clau.de/plugin-directory-submission`) "is no longer
    supported".
  - `anthropics/claude-plugins-official` takes partner submissions only.
  - claude.com/marketplace has no separate submission.

Sources, all accessed 2026-11-11 through Firecrawl (cache from 11-10 and 11-11):

- https://code.claude.com/docs/en/plugins/publish
- https://claude.com/docs/plugins/submit
- https://claude.com/docs/directory/publish
- https://claude.com/docs/plugins/pre-submission-checklist
- https://github.com/anthropics/claude-plugins-official

## Step 0: why a separate repo

The validator checks the whole repository, not only the plugin folder. Its
limits are:

- under 50 MiB as GitHub archives it;
- under 256 MiB unpacked;
- fewer than 10,000 files and folders.

Measured on this worktree, 2026-11-11, tracked files only:

| Measure | Value | Limit |
|---|---|---|
| Size unpacked | **705 MiB** | 256 MiB, so validation stops |
| Files | 7,418 | |
| Folders | 610 | |
| Files and folders | 8,028 | under 10,000 |

`kensaurus/mushi-mushi` cannot pass. Create a public repo, for example
`kensaurus/mushi-mushi-claude-plugin`, with only these five files. They are
copied from `plugins/mushi-debugger/` on master, plus the README and LICENSE
the checklist requires.

**`.claude-plugin/plugin.json`**

```json
{
  "name": "mushi-debugger",
  "description": "Find out what broke in your live app and fix it from Claude Code: your users' bug reports, a plain-English explanation of each, and a ready fix. Signs in with OAuth, no keys to paste.",
  "version": "1.0.3",
  "author": { "name": "kensaurus", "url": "https://github.com/kensaurus" },
  "homepage": "https://kensaur.us/mushi-mushi/docs/connect?src=claude.directory",
  "repository": "https://github.com/kensaurus/mushi-mushi-claude-plugin",
  "license": "MIT",
  "keywords": ["debugging", "bug-reports", "mcp", "lovable", "plain-english"],
  "mcpServers": "./.mcp.json"
}
```

**`.mcp.json`** (as on master; remote `http` entry with an `https://` URL, no
launcher, no secrets):

```json
{
  "mcpServers": {
    "mushi": {
      "type": "http",
      "url": "https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe"
    }
  }
}
```

The master copy has no `?features=vibe`. Adding it keeps the connection to the
12 tools the fix loop needs (see `apps/docs/content/quickstart/lovable-mcp.mdx`).

**`agents/mushi-debugger.md`:** copy it unchanged from
`plugins/mushi-debugger/agents/mushi-debugger.md` on master.

**`README.md`** (the checklist needs 40 words or more outside code blocks):

```markdown
# Mushi Mushi for Claude Code

Your AI built it. Mushi Mushi makes it better.

This plugin connects Claude Code to Mushi Mushi. When someone using your app
taps "Report a problem", Mushi Mushi explains what went wrong in plain English
and writes a fix. With this plugin, Claude Code can read those reports, pull
the fix context and apply the fix in your repo. You approve every change.

## Install

    /plugin marketplace add kensaurus/mushi-mushi-claude-plugin
    /plugin install mushi-debugger@mushi-mushi-claude-plugin

The first time Claude Code calls Mushi Mushi, a browser page asks you to sign
in and choose which apps it may see. No key to copy. Revoke it any time in the
Mushi Mushi console.

## Try

- "What did my users report this week?"
- "Get the fix context for the top report and fix it."
- "That's deployed. Mark the report fixed and tell the reporter."

No app on Mushi Mushi yet? Check your live site free first:
https://kensaur.us/mushi-mushi/docs/check?src=claude.directory

Source and docs: https://github.com/kensaurus/mushi-mushi
```

**`LICENSE`:** copy the root MIT `LICENSE` from `kensaurus/mushi-mushi`.

Also add a `.claude-plugin/marketplace.json` that lists the one plugin, so the
README's `/plugin marketplace add` works. Copy the root file on master and
change `source` to `"./"`.

## Portal fields

| Step | Field | Value |
|---|---|---|
| 1 Source | Repository | `kensaurus/mushi-mushi-claude-plugin` |
| | Plugin path (optional) | leave empty (the repo root is the plugin) |
| | Branch or tag (optional) | `main` |
| | Validate | must pass every **Blocks** check |
| 2 Listing details | read from `plugin.json` and the README | nothing to type |
| 3 Data handling | Reads or stores personal data? | **Yes.** The plugin reads bug reports from the user's own Mushi Mushi projects. Reports can include what an app's user typed, a screenshot and page details. It stores nothing itself. |
| | Sends data beyond declared connectors? | **No.** Only the declared `mushi` MCP server. |
| | How long data is kept | The plugin keeps nothing. Reports stay in Mushi Mushi under the project's retention setting (see https://kensaur.us/mushi-mushi/docs/legal/privacy). |
| | For people under 18? | **No** |
| 4 Compliance | Contact email | the address on https://kensaur.us/mushi-mushi/docs/legal/privacy |
| | Acknowledgements | read all four, then tick them |
| 5 Review and submit | How new versions reach the directory | **GitHub push webhook** |
| | Auto-publish passing versions | off, so the first versions get a manual look |
| | Submit for review | |

## Pre-check against the published checklist

Checked 2026-11-11 against the files above.

| Check | Result |
|---|---|
| `.claude-plugin/plugin.json` present, no `.DS_Store` | pass, if the repo holds only the files above |
| `name` lowercase with hyphens, 64 characters or fewer, no reserved word | pass: `mushi-debugger` |
| README of 40+ words outside code blocks | pass: about 140 |
| `LICENSE` or `license` | pass: both |
| Launchers pinned | n/a: there is no launcher, only a remote `http` entry |
| No secrets; remote entry uses `https://` | pass |
| SKILL.md or command front matter valid | n/a: there are none in this bundle |
| Repo size and file count | pass in the new repo; **fail** in `kensaurus/mushi-mushi` (705 MiB) |

## After submitting

- Review time "isn't fixed".
- "Already submitted by another organization": email `directory@anthropic.com`.
- **Success metric:** listing live (yes or no), then setups from
  `src=claude.directory` (`by_src` in `GET /v1/admin/growth/daily`).
- **Kill switch:** none is needed. A listing costs nothing once it is live.
  Do not spend more than the one sitting.
