# Packet: Claude Connectors Directory (remote MCP server)

**Status:** ready to submit once the reviewer test account below exists.
**Owner time:** about 10 minutes to make the test account, then about 15 minutes
in the portal.
**Tag:** `claude.connectors`

## Where to submit

- **URL:** https://claude.ai/directory/manage, then **Submit new**, then
  **MCP connector**.
- **Who:** any paid Claude plan. On a Team or Enterprise org, an Owner submits.
- **Default listing:** "Community". Anthropic may move a connector to
  "Verified" on its own; there is no way to apply.
- **Escalations:** `mcp-review@anthropic.com`.

Sources, all accessed 2026-11-11 through Firecrawl (cache from 11-10):

- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
- https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- https://support.claude.com/en/articles/11175166 (the user-side custom-connector flow)

## Which URL to submit

Submit `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe`.

- **Domain:** the review criteria say "the MCP server domain should match your
  service". `kensaur.us` serves the docs and the console. The raw
  `*.supabase.co` URL does not, and its OAuth sign-in 404s.
- **Auth:** Policy 5D requires OAuth 2.0 for authenticated remote servers. The
  `kensaur.us` URL does authorization code with PKCE. Mushi Mushi's own
  troubleshooting table in `apps/docs/content/quickstart/lovable-mcp.mdx` says
  so.
- **Tools:** `?features=vibe` lists 12 tools instead of about 80. That gives
  reviewers a smaller surface, and Claude picks the right tool more often from
  a short list.

## Portal fields

| Step | Field | Value |
|---|---|---|
| 1 Connection | Server URL | `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe` |
| | Users connect to different URLs? | **No** (one URL) |
| 2 Tools | synced from the server | Check that each of the 12 tools shows a title and a read-only or destructive hint. `mcp/manifest-tools.test.ts` pins `destructiveHint` on every write tool. |
| 3 Listing | Server name (100 characters max) | `Mushi Mushi` |
| | One-liner (200 characters max) | `Find out what broke in your live app and fix it, in plain words. Reads your users' bug reports and gives Claude the cause and a ready fix.` (139 characters) |
| | Description (2,000 characters max) | see the block below |
| | Categories (1 to 5) | Developer tools; Debugging. Use the closest labels the portal offers. |
| | Documentation URL | `https://kensaur.us/mushi-mushi/docs/quickstart/mcp?src=claude.connectors` |
| | Privacy policy URL | `https://kensaur.us/mushi-mushi/docs/legal/privacy` (HTTP 200 on 2026-11-11) |
| | Support contact | the address on the privacy page, plus `https://github.com/kensaurus/mushi-mushi/issues` |
| | Icon | `https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/packages/brand/src/logo-mark-512.png` (the one in `packages/mcp/server.json`) |
| | URL slug (**permanent once published**) | `mushi-mushi` |
| 4 Use cases | Primary use cases | (1) "What did my users report this week?" (2) "Explain the checkout bug and fix it." (3) "That's deployed: mark it fixed and tell the person who reported it." |
| | What users need before connecting | A free Mushi Mushi account with one app that has the report button (one script tag), or a test report filed through the connector. |
| | Reads, writes or both | **Both.** Mostly reads. Three write tools: `transition_status`, `reply_to_reporter` and `file_report`. They are marked as write tools, so Claude asks before it runs them. |
| 5 Company | Name / website / contact | Kensaurus 合同会社 / `https://kensaur.us/mushi-mushi` / the address on the privacy page |
| 6 Authentication | Authentication requirement | **Required** |
| | Method | **OAuth** (the server publishes RFC 9728 and RFC 8414 metadata; sign-in opens the Mushi Mushi consent page) |
| | OAuth client ID / secret (optional) | leave empty. The server advertises a `registration_endpoint` (`_shared/mcp-oauth-metadata.ts`), so clients register themselves. |
| 7 Data handling | Your own API, proxied, or third party | **Our own API** |
| | Personal health data | **No** |
| | Sponsored content | **No** |
| 8 Test & launch | Test-account access | see "Reviewer test account" below |
| | Ran every tool in MCP Inspector or as a custom connector | do this before ticking: add the URL as a custom connector in Claude (Customize, Connectors, "+ Add", "Add custom connector") and run all 12 |
| 9 Compliance | seven policy acknowledgements | read all seven, then tick them |
| 10 Review and submit | | |

**Description** (paste as is; about 900 characters):

```text
Mushi Mushi is bug fixing for apps built with AI (Lovable, Bolt, Cursor, Claude Code).

Your app's users tap a small "Report a problem" button. Mushi Mushi turns each report into a plain-English explanation: what broke, how serious it is, and the likely cause. It also writes a ready fix.

With this connector, Claude can:
- list what your users reported, newest or most urgent first;
- open one report: what the person saw, the page, logs and screenshot;
- pull the fix context: the cause, the files to change and a fix prompt;
- after you deploy, mark the report fixed and tell the person who reported it.

Sign-in uses OAuth. You choose which apps Claude may see, and you can revoke access at any time in the Mushi Mushi console. Tools that change anything ask first.

Free for one app. Open source: https://github.com/kensaurus/mushi-mushi
```

## Reviewer test account (owner, about 10 minutes)

The policy asks for "a standard testing account with sample data" (3D) and "at
least three working examples of prompts" (3E). Use the seeded demo project
rather than a real app:

1. Create a fresh account for the reviewer with a mailbox you control. Do not
   reuse the owner account.
2. Give it access to a copy of the sample reports. `scripts/marketing/seed-demo.mjs`
   seeds 5 classified reports into a project. Run it against a new project the
   test account owns, so the reviewer never sees the owner's real apps.
3. Paste the login and these three prompts into step 8:
   - "Using Mushi Mushi, what did my users report this week?"
   - "Get the fix context for the checkout report."
   - "File a test report: 'The Save button on the settings page does nothing.'"

## Review criteria and how Mushi Mushi meets them

| Criterion (quoted) | State |
|---|---|
| "remote at an `https://` URL" | yes |
| "OAuth 2.0 if your tools act on a user's account" | yes, on the `kensaur.us` URL |
| "Every tool has a `title` and a `readOnlyHint` or `destructiveHint` annotation" | confirm in step 2; tests pin it for write tools |
| read and write are separate tools (no catch-all `api_request`) | yes |
| tool names 64 characters or fewer | yes (the longest in `vibe` is 18) |
| "clear, accessible privacy policy link" | `/docs/legal/privacy`. The page says it describes current practice and is "not a finished legal document". **Owner decision:** whether to submit before that review |
| public documentation by the publish date | `/docs/quickstart/mcp` and `/docs/quickstart/lovable-mcp` |

## After submitting

- Review time "varies with queue volume".
- **Success metric:** listing live (yes or no). Then connector setups: rows
  where the OAuth consent created a key labelled for Claude, and
  `src=claude.connectors` on the docs link.
- **Kill switch:** none needed after the one sitting. If review asks for more
  than 2 hours of fixes, park it until there are live installs.
