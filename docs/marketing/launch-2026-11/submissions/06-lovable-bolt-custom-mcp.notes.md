# Notes: Lovable / Bolt custom MCP how-to (never paste this file)

Paste file: `06-lovable-bolt-custom-mcp.paste.md`.
- Line 1 is the title, the rest is the body.
- Its `##` headings are meant to be pasted.

## Where to publish

Pick one, and keep the tags:

| Where | Tag change | Notes |
|---|---|---|
| dev.to | none (`lovable.howto`) | Tags: `lovable`, `ai`, `webdev`, `tutorial`. |
| Docs site | none | The docs page `quickstart/lovable-mcp.mdx` already covers Lovable. The Bolt section below is a patch for that file (it is outside this lane). |
| Lovable community / Discord "show and tell" | `lovable.community` (add it to `links.md` first) | Only where the channel allows how-tos. |
| r/lovable | do not post it | Rule 4 there is "No advertising" (see `07-reddit-vibecoding.notes.md`). |

## Facts behind the steps

- **Lovable steps:** https://docs.lovable.dev/integrations/custom-mcp and
  `/introduction`, read 2026-11-11 through Firecrawl (cache 11-10).
  - "Custom MCP servers are available on all plans."
  - Fields: Server name / Connection (Direct, or Lovable static IPs on
    Enterprise) / Server URL / Authentication (OAuth default, Bearer token or
    API key, No authentication).
  - Buttons: **Add & authorize** or **Add server**.
  - Connections are per user and chat-only, "never part of your published app".
- **Bolt steps:** https://support.bolt.new/integrations/mcp, read 2026-11-11
  (cache 11-10, page modified 2026-10-14).
  - Fields: Name / URL / Transport type (HTTP standard) / Authentication (API
    key or MCP OAuth; None for public).
  - Then **Connect**, an optional "Auto-enable for all projects", and a
    per-project toggle.
  - Plan availability is not stated `[unverified]`.
- **The approval card and `?features=vibe`** come from
  `apps/docs/content/quickstart/lovable-mcp.mdx`.

## Before publishing

- [ ] **Lovable:** run the steps once in a fresh Lovable workspace, on the day
  you publish.
- [ ] **Bolt:** test it. The paste file says "We have not tested this in Bolt
  yet". Once you have, delete that sentence and the following one.
- [ ] **Grep gate.** The paste file has no code fences, so this must print
  nothing:
  `grep -nE 'Title \(set|READY|Source notes|Questions for the owner|\`\`\`' 06-lovable-bolt-custom-mcp.paste.md`

## Docs patch for `apps/docs/content/quickstart/lovable-mcp.mdx`

Outside this lane. Replace its "## Bolt" section with the researched fields:

```mdx
## Bolt

In the Bolt chatbox, click **+** → **Connectors** → **Manage connectors**, then
**Custom MCP server** ([Bolt docs](https://support.bolt.new/integrations/mcp)):

| Field | Value |
| --- | --- |
| **Name** | `Mushi Mushi` |
| **URL** | `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe` |
| **Transport type** | **HTTP** |
| **Authentication** | **MCP OAuth** |

Click **Connect**, sign in, then turn the connector on for your project
(chatbox **+** → **Connectors** → toggle). We have not tested Mushi Mushi in Bolt yet.
```

## Success metric and kill switch

- **Metric:** projects whose first live origin is `*.lovable.app` or a Bolt
  host. A query for this is in `PLAN.md`.
- **Kill switch:** fewer than 2 such projects 4 weeks after publishing. Stop
  promoting it, and keep the page.
