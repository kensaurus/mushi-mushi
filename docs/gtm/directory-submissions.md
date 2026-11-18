# Directory submissions: ready-to-paste kit

Prepared 2026-11-18. **The owner submits every one of these.** Nothing here has
been submitted. Each section says what was read from the venue's own docs
(verified) and what was not (unverified: check on the day).

Product name is always **Mushi Mushi**, never "Mushi". The MCP server slug in
configs stays `mushi` (that is what the console, CLI and docs write).

## Shared facts (checked in the repo on 2026-11-18)

| Item | Value | Source |
| --- | --- | --- |
| Hosted MCP URL | `https://kensaur.us/mushi-mushi/hosted-mcp/` | `packages/brand/src/index.js` `hostedMcp` |
| Builder tool set | `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe` (12 tools) | `packages/mcp/src/feature-groups.ts` `PRESET_TOOLS.vibe` |
| Full catalog | 133 tools, 8 resources, 4 prompts (`?features=all`) | `node scripts/check-catalog-count.mjs` |
| Auth | MCP OAuth (authorization code + PKCE); API key header for headless | `apps/docs/content/quickstart/mcp.mdx` |
| Transport | Streamable HTTP; legacy and 2026-07-28 protocol eras | `AGENTS.md`, `routes/openapi.ts` `x-mushi-extensions` |
| stdio package | `@mushi-mushi/mcp` 0.31.4 (latest in the official MCP registry, published 2026-11-17) | `registry.modelcontextprotocol.io/v0/servers?search=io.github.kensaurus/mushi-mushi` |
| Registry name | `io.github.kensaurus/mushi-mushi` | `packages/mcp/server.json` |
| Docs | `https://kensaur.us/mushi-mushi/docs/quickstart/mcp` | |
| Privacy policy | `https://kensaur.us/mushi-mushi/docs/legal/privacy` | `apps/docs/content/legal/` |
| Support | GitHub Issues `https://github.com/kensaurus/mushi-mushi/issues`; kensaurus@gmail.com (already public in the README) | `README.md` |
| Icon | `packages/brand/src/logo-mark-512.png` (512 px PNG; raw URL in `server.json`) | |
| Free plan | 1 app, 100 diagnoses a month, no card, no AI key | `README.md` Quick start |
| Licence | SDKs, CLI, MCP: MIT. Server and console: AGPLv3 | `README.md` License |
| Install doc for agents | `llms-install.md` at the repo root | |

## Listing copy (reuse everywhere)

**Name (≤ 100):** Mushi Mushi

**One-liner (≤ 200):**
Your users' bug reports, explained in plain English, with a fix your AI editor can apply.

**Short description (≤ 300):**
Mushi Mushi turns "it's broken" from a user into a plain-English diagnosis
and a ready fix prompt. Your editor reads it over MCP: list reports, get the
fix context, mark it fixed, reply to the reporter. Free for one app.

**Long description (≤ 2,000):**

> Built for people who ship apps with Cursor, Claude Code, Lovable or Bolt and
> don't fully know the code their AI wrote.
>
> When a user taps the Mushi Mushi report button and writes one sentence,
> Mushi Mushi attaches a screenshot and what the app was doing, then writes
> the likely cause in plain English with a fix prompt. This connector lets
> your AI read all of it where you already work.
>
> What you can ask:
> - "What did my users report this week?"
> - "Get the fix context for the checkout report and fix it."
> - "That's deployed. Mark it fixed and tell the reporter."
>
> The default tool set has 12 tools: list and search reports, read one, get
> the fix prompt, change a report's status, reply to the reporter, file a
> report, a setup check and the docs. The three that change something are
> marked as write tools, so your client can ask before it runs them.
>
> Sign-in is OAuth: you pick which projects the connection may see, and you
> can revoke it from the Mushi Mushi console. No key to copy.
>
> Works without Sentry or any monitoring stack. If you do run Sentry, its
> errors land in the same queue.
>
> Free plan: one app, 100 diagnoses a month, no card. Open source (SDKs and
> MCP MIT, server AGPLv3); self-hosting is supported.

**Categories / tags:** Developer tools, Debugging, Bug tracking, Productivity.

**Example prompts (for venues that ask):**
1. `What did my users report in Mushi Mushi this week?`
2. `Get the Mushi Mushi fix context for the newest report and fix it.`
3. `File a test report in Mushi Mushi: "The Save button on the settings page does nothing."`

---

## 1. Claude Connectors Directory

- **Where:** `https://claude.ai/directory/manage` → **MCP connector**.
- **Who can submit:** anyone on a paid Claude plan (verified, claude.com/docs/connectors/building/submission, read 2026-11-18).
- **Requirements (verified):** every tool has a `title` and the applicable
  `readOnlyHint` or `destructiveHint`; OAuth 2.0 for authenticated services;
  clear setup docs; directory terms and policy accepted.
- **Repo status:** the hosted server sets annotations
  (`packages/server/supabase/functions/mcp/manifest-tools.ts`, and
  `manifest-tools.test.ts` asserts `destructiveHint` on write tools). The
  portal's **Tools** step flags any tool without them: if it flags one, that
  is a server fix before submitting.

Portal steps and what to enter:

| Step | Enter |
| --- | --- |
| 1 Connection | `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe` (one URL for everyone) |
| 2 Tools | Synced from the server. Expect 12 tools; check none is flagged |
| 3 Listing | Name, one-liner, long description above; categories; docs URL; privacy URL; support contact; icon; slug `mushi-mushi` (permanent once published) |
| 4 Use cases | Read and write. Needs a Mushi Mushi account with a project (free) |
| 5 Company | kensaurus LLC, `https://kensaur.us`, owner's contact |
| 6 Authentication | Required; MCP OAuth (dynamic client registration). No client secret to hold |
| 7 Data handling | Own API. No health data, no sponsored content |
| 8 Test & launch | Run every one of the 12 tools as a custom connector in Claude first. No credentials in the portal; a reviewer asks by email for test access if needed |
| 9 Compliance | Seven acknowledgments, all required |

After submit: an automatic scan, then a Community listing by default.
Escalations: mcp-review@anthropic.com.

## 2. Cursor Marketplace

- **Where:** `https://cursor.com/marketplace/publish`, submit the repository link (verified, cursor.com/docs/reference/plugins).
- **Repo status:** `.cursor-plugin/marketplace.json` lists one plugin,
  `mushi-mushi`, with source `packages/cursor-plugin`.
- **Note (verified, Cursor forum, 2026-04):** the form is tied to your Cursor
  account; it cannot be switched to a company.
- **Paste:** repository `https://github.com/kensaurus/mushi-mushi`;
  description = the short description above.

## 3. Docker MCP Catalog

- **Where:** PR to `https://github.com/docker/mcp-registry` (verified, CONTRIBUTING.md "Adding a Remote MCP Server", read 2026-11-18). Remote servers are accepted; no image build.
- **Steps:** fork, run `task remote-wizard` (or add the files by hand), test
  with `task catalog -- mushi-mushi`, `docker mcp catalog import …`,
  `docker mcp server enable mushi-mushi`, then open the PR.
- **Files:** `servers/mushi-mushi/server.yaml`, `tools.json` (always `[]` for
  remote servers), `readme.md` (a docs link).

Draft `server.yaml`:

```yaml
name: mushi-mushi
type: remote
dynamic:
  tools: true
meta:
  category: devops
  tags:
    - debugging
    - bug-tracking
    - remote
about:
  title: Mushi Mushi
  description: Your users' bug reports, explained in plain English, with a fix your AI editor can apply.
  icon: https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/packages/brand/src/logo-mark-512.png
remote:
  transport_type: streamable-http
  url: https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe
oauth:
  - provider: mushi-mushi
    secret: mushi-mushi.personal_access_token
    env: MUSHI_MUSHI_PERSONAL_ACCESS_TOKEN
```

Draft `readme.md`: `Docs: https://kensaur.us/mushi-mushi/docs/quickstart/mcp`

**Unverified:** the example OAuth servers in the registry (Linear) use
providers Docker already knows. Whether Docker's gateway runs dynamic client
registration for a new provider is not stated in CONTRIBUTING.md. Run
`docker mcp oauth authorize mushi-mushi` locally before opening the PR; if it
fails, ask in the PR, and pick a `meta.category` from the registry's existing
list.

## 4. Glama, PulseMCP, mcp.directory

| Venue | Step | Status |
| --- | --- | --- |
| Glama (server) | `glama.json` at the repo root already names `kensaurus` as maintainer. Sign in to glama.ai with that GitHub account and open the `mushi-mushi` server page to manage it | `glama.json` verified in repo; listing page not checked |
| Glama (remote connector) | Glama's FAQ: claim a connector with a `glama_claim_…` token in a `connector.json` (schema `https://glama.ai/mcp/schemas/connector.json`). Get the token from the connector page | Unverified: file location and flow from the FAQ snippet only |
| PulseMCP | Believed to import the official MCP registry, where 0.31.4 is live. Search pulsemcp.com for "Mushi Mushi"; if missing, use its submit form and paste the listing copy | Unverified |
| mcp.directory | Search for "Mushi Mushi"; if missing, use its submit form with the repo URL, hosted URL and listing copy | Unverified |

---

## 5. Post drafts

Rewrite each in your own words before posting: HN removes posts that read as
AI-written. Fill the `[N]` numbers from the day's scorecard, never from
memory.

### Show HN

Rules (from `docs/launch/show-hn.md`, read 2026-10-02): something people can
try; no sign-up wall in the way; no vote asks.

- **URL:** `https://kensaur.us/mushi-mushi/docs/connect?utm_source=hn&utm_medium=post&utm_campaign=directory-2026-11`
- **Demo status:** on 2026-11-18 the page rendered its "Live demo — no signup"
  mode. The demo key was **not** exercised. The morning you post, open it in
  a private window and ask your editor for the demo's reports. If that fails,
  don't post that day.
- **Title (≤ 80):** `Show HN: Mushi Mushi – user bug reports, explained in plain English for your AI editor`

First comment:

```
I'm Kenji; I build this alone. My apps are mostly written by Cursor and
Claude Code, and when a user says "it's broken" I lose an afternoon reading
code I didn't write.

Mushi Mushi is a report button for your app plus an MCP server. The user
writes one sentence; it attaches a screenshot and the console and network
tail; a model writes the likely cause and a fix prompt. Your editor pulls it
with get_fix_context.

The link installs read-only access to a demo project, no signup. The reports
there are samples I wrote; the diagnoses are real model output.

No SDK? One curl files a report:
https://kensaur.us/mushi-mushi/docs/quickstart/http-api

Free for one app. SDKs and MCP are MIT, the server AGPLv3.
Where it stands: [N] sign-ups, [N] outside projects with a real report.
I'd most like to hear where a diagnosis was wrong.
```

### r/SideProject

Rule (secondary sources, Aug–Sep 2026; re-read `reddit.com/r/SideProject/about/rules` first):
title format `[Project name] - [Short description]`; say you built it.

- **Title:** `Mushi Mushi - a bug report button that explains the bug in plain English for your AI editor`
- **Body:**

```
I built this because my apps are mostly AI-written and I couldn't read my
own bug reports fast enough.

Your user taps a button and writes one sentence. Mushi Mushi adds a
screenshot and what the app was doing, then writes the likely cause and a
fix prompt. Cursor, Claude Code, Lovable, Bolt or Replit can read it over
MCP and make the fix.

Try the read-only demo without signing up:
https://kensaur.us/mushi-mushi/docs/connect?utm_source=reddit&utm_medium=post&utm_campaign=sideproject

Free for one app, open source. What would stop you from adding it?
```

### r/indiehackers

Rule (secondary sources, Aug–Sep 2026; re-read `reddit.com/r/indiehackers/about/rules` first):
one self-promotion post, with the **Self Promotion** flair, written as a
request for feedback with your real journey and numbers.

- **Title:** `[N] months building a bug-report tool for vibe coders: what worked, what didn't`
- **Body:** where you are (`[N]` sign-ups, `[N]` outside projects with a
  real report, `[N]` paid), the one thing that moved a number, the one that
  didn't, then one line with the demo link and a direct question ("would you
  trust an AI's diagnosis of your bug, and what would make you?").

New accounts get posts silently filtered. Check the post in a logged-out
window on `/r/<sub>/new` after posting.
