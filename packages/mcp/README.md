# @mushi-mushi/mcp

> **Your AI wrote it. Mushi tells you why it broke.**

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-0098FF)](https://kensaur.us/mushi-mushi/docs/connect)
[![Add to VS Code](https://img.shields.io/badge/Add%20to-VS%20Code-007ACC?logo=visualstudiocode&logoColor=white)](https://kensaur.us/mushi-mushi/docs/connect)
[![Try the demo — no signup](https://img.shields.io/badge/Try%20the%20demo-no%20signup-E34234)](https://kensaur.us/mushi-mushi/docs/connect)
[![npm](https://img.shields.io/npm/v/@mushi-mushi/mcp?color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/mcp)

[Model Context Protocol](https://spec.modelcontextprotocol.io/) server that wires Mushi into Cursor, Claude Code, and any MCP client. Pull fix context, review bugs, and dispatch fixes without a second LLM vendor key.

Wire it into Cursor, Claude Code, or any MCP client in one command:

```bash
npx mushi-mushi setup --ide cursor
# or: npx mushi-mushi setup --ide claude
```

That command reads CLI config at **`~/.config/mushi/config.json`** (legacy `~/.mushirc` auto-migrates), writes `.cursor/mcp.json` with the `mushi-<slug>` server block, and prints "Done; restart Cursor and ask: `list mushi tools`". No copy-pasting environment variables.

### Codebase Understand tools (indexed repos)

When codebase indexing is enabled on a project, these MCP tools ground on `project_codebase_files` (+ wiki chunks when configured):

| Tool | Scope | Purpose |
|------|-------|---------|
| `ask_codebase` | write | Plain-English Q&A with file:line citations |
| `get_file_summary` | read | Lazy plain-English file/symbol summary |
| `get_codebase_tour` | read | Dependency-ordered onboarding tour |
| `search_codebase` | read | Semantic (or scoped) embedding search |
| `get_codebase_domains` | read | Business domain / flow map |
| `analyze_codebase_impact` | read | Diff impact (paths, last push, compare, fix PR) |
| `analyze_wiki_knowledge` | read | Wiki/docs knowledge graph |

> **What this is, and what it isn't**
>
> - **This package** (`@mushi-mushi/mcp`) is the MCP **server**; runs locally next to your editor, talks to the Mushi API, and presents bug reports as MCP tools/resources to your coding agent. Always install it by its scoped name (`npx -y @mushi-mushi/mcp@latest`); the bare `mushi-mcp` name was never published to npm.
> - **`@mushi-mushi/agents`** ships the MCP **client adapter**; used by the autofix orchestrator when your project's `autofix_agent = 'mcp'`. See `packages/agents/src/adapters/mcp.ts`.
> - The `generic_mcp` adapter shipped before V5.3 was a misnomer (it spoke plain REST). It is now `RestFixWorkerAgent`; the old export is kept as a deprecated alias for one more minor.

## Quick start

### 0. One-click: "Add to Cursor" deeplink

The Mushi admin console (**Admin → MCP → Setup tab**) generates a one-click deeplink that opens Cursor's "Install MCP server?" dialog with your project ID and a freshly-minted `mcp:write` key already embedded:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=mushi-<project>&config=<base64>
```

Click **"⚡ Add to Cursor"** (or **"Add to VS Code"**); Cursor prompts you to confirm, then writes the server block into your global `mcp.json` automatically. No copy-pasting.

> **Security note:** The deeplink mints a dedicated `mcp:write` key (or `mcp:read` for read-only), separate from your app's SDK key. Your SDK key (the `report:write`-scoped key your app sends bug reports with) should never carry `mcp:write`; it would expose admin-level triage and fix dispatch to anyone who extracted it from your browser bundle. The deeplink mint enforces this separation automatically. See [API key scopes](#api-key-scopes) below.

### 1. One-liner CLI (recommended for first-time setup)

```bash
# First: make sure you've logged in
npx mushi-mushi login --api-key mushi_xxx --endpoint https://<ref>.supabase.co/functions/v1/api

# Then wire your IDE
npx mushi-mushi setup --ide cursor          # Cursor
npx mushi-mushi setup --ide claude          # Claude Code / Claude Desktop
npx mushi-mushi setup --ide cursor --with-rules  # also write .cursorrules
```

### 2. With Claude Desktop (manual)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mushi-mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "mushi_xxxxxxxxxxxxxxxxxxxx",
        "MUSHI_PROJECT_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "MUSHI_API_ENDPOINT": "https://<your-ref>.supabase.co/functions/v1/api"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a hammer icon in the chat input; click it to see the Mushi Mushi tools.

> **Where do I find these values?**
> - **`MUSHI_API_KEY`**: [Admin → Connect](https://kensaur.us/mushi-mushi/admin/connect) or **MCP** setup; mint an `mcp:read` / `mcp:write` key. This is **not** the SDK ingest key from **Setup → Verify** (`report:write`) and **not** a BYOK key from **Settings → API Keys**.
> - **`MUSHI_PROJECT_ID`**: [Admin console](https://kensaur.us/mushi-mushi/projects) → click your project → copy the UUID below the project name (e.g. `542b34e0-019e-41fe-b900-7b637717bb86`)
> - **`MUSHI_API_ENDPOINT`**: Shown when you mint the MCP key, or use your project's API base (`https://<ref>.supabase.co/functions/v1/api`)
>
> Or visit **Admin → MCP** in the console for a one-click pre-filled config snippet.

### 3. With Cursor (manual)

In Cursor settings, open **MCP** → **Add new MCP server** and paste:

```bash
npx -y @mushi-mushi/mcp@latest
```

Then set the same three environment variables:

| Variable | Where to find it |
|---|---|
| `MUSHI_API_KEY` | **Connect** or **MCP** tab: mint `mcp:read` / `mcp:write` (not Setup → Verify ingest key; not Settings → BYOK) |
| `MUSHI_PROJECT_ID` | Admin console → Projects → click project → UUID below the name |
| `MUSHI_API_ENDPOINT` | Shown at key mint, or your Supabase `.../functions/v1/api` base |

Without `MUSHI_PROJECT_ID` the server starts but scoped tools return an empty result with a message pointing you here.

### 4. From the command line

```bash
MUSHI_API_KEY=mushi_xxxxxxxxxxxxxxxxxxxx \
MUSHI_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npx -y @mushi-mushi/mcp@latest
```

The server speaks stdio MCP transport by default; your client launches it as a subprocess.

### 5. Hosted Streamable HTTP (no subprocess)

The Mushi backend now exposes the same tool catalog over the **Streamable HTTP** transport from the MCP 2025-03-26 spec at `/functions/v1/mcp`. Use this when you want to skip the local subprocess; typical for OpenAI Agents SDK, ChatGPT Agent, hosted CrewAI, or any orchestrator that talks remote MCP:

```jsonc
// .cursor/mcp.json — example (hosted HTTP)
{
  "mcpServers": {
    "mushi-mushi-hosted": {
      "type": "http",
      "url": "https://<your-ref>.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer mushi_xxxxxxxxxxxxxxxxxxxx",
        "X-Mushi-Api-Key": "mushi_xxxxxxxxxxxxxxxxxxxx",
        "X-Mushi-Project-Id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  }
}
```

> **Cursor icon:** HTTP MCP URLs on `*.supabase.co` often show the **Supabase favicon** in Cursor settings; not a Mushi bug. Use **stdio** (`command` + `npx @mushi-mushi/mcp`) for the red 虫 stamp, or set `"icon": "https://kensaur.us/mushi-mushi/integrations/mushi-mark-512.png"` in your server block. The hosted endpoint also emits MCP `serverInfo.icons` and serves inline SVG at `?icon=1`.

### Feature groups (`?features=` / `MUSHI_FEATURES`)

Full catalog is **69 tools** (stdio / `MUSHI_FEATURES=all`). The hosted HTTP
endpoint exposes a leaner subset filtered by feature groups (see
`mcp-hosted-tool-manifest.json`). New installs now default to the lean
`triage,fixes,inventory,setup,docs` set automatically (stdio: when
`MUSHI_FEATURES` is unset; HTTP: pass the same `?features=` on the URL). To
change the surface:

- **Stdio:** `MUSHI_FEATURES=all` for the full catalog, or a CSV like `MUSHI_FEATURES=triage,qa,skills`
- **HTTP:** `?features=all` or `?features=triage,qa,skills` on the MCP URL

Renamed tools (`inventory_get` → `get_inventory`, `inventory_diff` →
`diff_inventory`, `inventory_findings` → `list_gate_findings`, `fix_suggest` →
`suggest_fix`, `graph_neighborhood` → `get_graph_neighborhood`,
`graph_node_status` → `get_graph_node`) and the consolidated setup tooling
(`setup_check` / `ingest_setup_check` / `diagnose_connection` → `diagnose_setup`;
`get_activation_status` → `activation_status`; `get_reporter_thread` →
`get_report_timeline`) are documented in the changelog; update calls to the new
names.

New unified tools: `diagnose_setup` (replaces the setup trilogy), `search_mushi_docs` (keyword doc search).

Append `?read_only=1` to the URL to hide write tools (Supabase-parity mode).

## Programmatic imports

For custom MCP hosts or tests:

| Subpath | Exports |
| --- | --- |
| `@mushi-mushi/mcp/catalog` | `TOOL_CATALOG`, scopes, tool specs |
| `@mushi-mushi/mcp/server` | `createMushiServer()` |
| `@mushi-mushi/mcp/branding` | Icons and server metadata |
| `@mushi-mushi/mcp/feature-groups` | `MUSHI_FEATURES` filtering |

## Cursor config hygiene

1. **One global MCP config**; keep `mushi` in `~/.cursor/mcp.json` only. Do **not** duplicate `mushi` / `mushi-stdio` in per-project `.cursor/mcp.json` (prevents connection storms). Project repos may ship `{}` or a comment pointing to the global file.
2. **Windows paths**; use forward slashes in JSON (`C:/Users/...`) or escaped backslashes (`C:\\Users\\...`). Raw `\f`, `\n`, `\t` in paths corrupt JSON.
3. **Multi-project**; either one HTTP server per project (distinct server name + `X-Mushi-Project-Id`) or one stdio server and pass `project_id` on each tool call.
4. **After editing global config**; fully restart Cursor (MCP panel must reload).

| Header | Role |
|--------|------|
| `Authorization: Bearer <key>` | Auth (optional duplicate of API key) |
| `X-Mushi-Api-Key` | Auth (preferred for MCP clients) |
| `X-Mushi-Project-Id` | **Project scope**: required for API-key callers |

~~`X-Mushi-Project`~~ is deprecated for project UUID (collision with legacy slug header).

The endpoint accepts JSON-RPC 2.0 over POST (returns `application/json` or `text/event-stream` per content negotiation), opens an SSE stream on GET for server-pushed notifications, and accepts DELETE for session termination. Auth is the same dual-mode API-key / JWT used everywhere else on `/v1/admin/*`.

## Tools

### Read

| Tool | What it does |
|---|---|
| `get_recent_reports` | Fetch the N most recent reports, with optional `status` / `category` / `severity` filters |
| `get_report_detail` | Full payload for a single report: description, console logs, network requests, screenshot URL, classification result, fix history |
| `search_reports` | Semantic + keyword search (server-side pgvector; falls back to keyword match when embeddings aren't available) |
| `get_similar_bugs` | Embedding-nearest neighbours for a component, page, or description |
| `get_fix_context` | One-shot brief for a coding agent: report + repro + root-cause + ontology tags |
| `get_fix_timeline` | Ordered timeline of a fix attempt (dispatched → started → branch → commit → PR → CI → completed/failed) |
| `get_blast_radius` | Graph traversal showing other components a bug group touches |
| `get_knowledge_graph` | Traverse the knowledge graph from a seed component or page |
| `diagnose_setup` | Setup health in one call: `mode=full` (default) runs ingest + dispatch preflight, `mode=ingest` / `mode=dispatch` narrow it. Returns the single best next action. Run first when a user says setup is broken |
| `activation_status` | Unified activation posture for the active project: required steps, SDK heartbeat, dispatch preflight, and the next best action |
| `get_report_timeline` | Ordered report timeline: the reporter/admin comment thread (including verify/reopen signals) plus fix, QA, and status lanes. Use when triaging whether an end user still sees a bug as unfixed |
| `list_projects` | Discover all Mushi projects accessible to this API key. Returns project id, name, and created date |
| `get_project_context` | Rich context snapshot: SDK heartbeat, ingest status, autofix readiness, and open report counts |
| `get_pipeline_logs` | Recent log entries from fix-worker, pipeline, and QA story runner: filterable by service, level, time, and limit |
| `get_report_evidence` | Focused evidence package for a report: screenshot URL, console logs, network excerpts, environment, and user comments (lighter than `get_report_detail`) |
| `triage_issue` | **Primary triage entry point**: combines report detail, evidence, similar bugs, fix context, blast radius, pipeline logs, and recommended next actions in one packet |
| `query_lessons` | Token-budget retrieval of relevant learning rules for a code diff |
| `list_lessons` | List promoted learning rules (lessons) for the current project |

### Write / agentic

| Tool | What it does |
|---|---|
| `submit_fix_result` | Record a fix outcome (branch, PR, files, lines) from an external agent |
| `dispatch_fix` | Kick off the agentic fix orchestrator for a report: returns a `fix_attempt` id |
| `trigger_judge` | Run the Sonnet-as-Judge over a batch of classified reports |
| `transition_status` | Move a report between workflow states (enforces the same rules as the UI) |
| `run_nl_query` | Natural-language → read-only SQL against your project data (60/hour rate-limited) |

> Need a tool that isn't here? Open an issue at [github.com/kensaurus/mushi-mushi/issues](https://github.com/kensaurus/mushi-mushi/issues) and tag it `mcp`.

### Tool annotations (what clients see before invoking)

Every tool is registered via `server.registerTool()` with MCP 2025-10 **tool annotations** so clients (Cursor, Claude Desktop, Continue, Cline, Zed) can render a proper "is this safe to auto-invoke?" UI without calling the tool first. The annotations come from a single source of truth; `src/catalog.ts`; mirrored into the admin console (`apps/admin/src/lib/mcpCatalog.ts`) and guarded against drift by `scripts/check-mcp-catalog-sync.mjs`.

| Annotation | Meaning | Example |
|---|---|---|
| `readOnlyHint: true` | Safe to loop on: never mutates state | `get_recent_reports`, every `project://` resource |
| `destructiveHint: true` | Mutates project state; client should confirm | `dispatch_fix`, `transition_status` |
| `idempotentHint: true` | Repeated calls produce the same effect | `transition_status`, `submit_fix_result` |
| `openWorldHint: true` | Reaches out to your Mushi deployment (not a pure local function) | Every tool in this server |

The same catalog entries power the `/mcp` beginner console in the admin app; so the tool catalog the agent sees and the tool catalog the human operator reads can never disagree.

### Progress notifications on long-running tools

`dispatch_fix` emits an MCP `notifications/progress` event the moment the orchestrator accepts the request, so clients that support progress (Cursor, Claude Desktop) can render a live "Dispatching fix…" indicator instead of freezing until the HTTP round-trip returns. The notification mirrors the `ProgressToken` the client passed in `_meta.progressToken`; clients that don't pass one get the normal non-streaming response, unchanged.

## Resources

Full list (8). See also the generated catalog at
[`apps/docs/content/sdks/mcp-tools.generated.mdx`](../../apps/docs/content/sdks/mcp-tools.generated.mdx).

| URI | Returns |
|---|---|
| `project://stats` | Counts of new / classified / fixed reports + last 7-day trend |
| `project://settings` | Project config: autofix agent, plugins enabled, ontology, LLM budgets |
| `project://dashboard` | PDCA health snapshot: stage counts, bottleneck, recent activity (the same payload the admin console polls every 15 s) |
| `privacy://status` | Privacy / PII scrubber status for the project |
| `evolution://history` | Evolution / PDCA history snapshot |
| `mushi://activation` | Activation / connection status for the project |
| `project://integration-health` | Integration health probes (Slack, Sentry, GitHub, …) |
| `inventory://current` | Current inventory snapshot |

## Prompts

Named templates the MCP client surfaces in its slash-menu. Each one bakes in the house voice ("lead with the fix, skip the preamble") so agents produce consistent outputs across editors.

| Prompt | When to use |
|---|---|
| `summarize_report_for_fix` | Before asking the agent to write the patch: produces a one-line root cause, smallest file set, repro steps, and blast-radius warnings |
| `explain_judge_result` | After the judge scores a fix: turns the raw scores into ship / iterate / dismiss guidance |
| `triage_next_steps` | "What should I focus on right now?": five-item markdown list drawn from the dashboard + recent classified queue |
| `mushi_setup` | Guided first-time MCP / SDK setup checklist |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MUSHI_API_KEY` | yes | — | Project API key with `mcp:read` or `mcp:write` scope. Mint one in the admin console → **Projects** (the one-time reveal card has a **Copy as `.env.local`** tab). |
| `MUSHI_PROJECT_ID` | yes | — | UUID from the admin console URL (`/projects/<uuid>/...`) or the reveal card. |
| `MUSHI_API_ENDPOINT` | no | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` | Override only if you self-host. Localhost: `http://localhost:54321/functions/v1/api`. |

### Storing the key in `.env.local`

The MCP binary reads these three vars from `process.env` on spawn; that means **anywhere you normally put env vars works**. The zero-friction path:

1. In the admin console, mint a key and pick **Copy as `.env.local`** on the reveal card. You get a pre-formatted block:

   ```bash
   # Mushi MCP; drop into .env.local (gitignored). The MCP binary picks these up on spawn.
   MUSHI_API_ENDPOINT=https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api
   MUSHI_PROJECT_ID=<your-uuid>
   MUSHI_API_KEY=mushi_live_…
   ```

2. Paste it into your repo's `.env.local` (already gitignored by every Vite / Next.js / Node project scaffold). Confirm `.env.local` is in `.gitignore` if you're in an unusual setup.

3. Tell your MCP client to inherit the shell env. For Cursor, the simplest form:

   ```json
   {
     "mcpServers": {
       "mushi-mushi": {
         "command": "npx",
         "args": ["-y", "@mushi-mushi/mcp@latest"]
       }
     }
   }
   ```

   Cursor spawns the subprocess with the parent shell's env, so as long as you ran Cursor from a terminal that has `.env.local` sourced (or you're using `direnv` / `dotenv-cli`), the three vars are already in place. If you prefer to inline them; Cursor / Claude Desktop both support an `env` block in `mcp.json`; use the **Copy as `.cursor/mcp.json`** tab on the reveal card, which hard-codes the three values into the JSON for you.

4. **Never** commit `.env.local`, and **never** paste a key into a repo-tracked `.cursor/mcp.json`. If you accidentally do, rotate the key from the admin console; the denormalised owner binding is rebuilt automatically on rotation.

## API key scopes

The admin routes the MCP server hits enforce per-key scopes. When you mint a key, pick the smallest scope that works for your agent workflow:

| Scope | Grants | Use for |
|---|---|---|
| `report:write` | SDK ingest only (`/v1/reports`, `/v1/notifications`). **No admin access.** | Your app's runtime Mushi SDK: never give this to an MCP client. |
| `mcp:read` | Every MCP read tool (`get_recent_reports`, `search_reports`, `get_fix_context`, `get_fix_timeline`, `get_blast_radius`, `get_knowledge_graph`) and every `project://*` resource. | Safe default for agents that only *read* from Mushi. |
| `mcp:write` | Everything `mcp:read` grants **plus** mutating tools (`dispatch_fix`, `submit_fix_result`, `trigger_judge`, `transition_status`, `run_nl_query`). | Agents that should act on bugs (open PRs, judge, transition status). |

The middleware replies **403 `INSUFFICIENT_SCOPE`** with a human-readable message if your key is missing a required scope; no silent failures.

## When MCP helps (and when it doesn't)

Useful if you already fix bugs in an AI-augmented editor. If your team still opens bugs exclusively in Jira and writes patches longhand, this server is solving a problem you don't have yet; use the SDK + Discord webhook and come back later.

For teams that live in Cursor / Claude Code / Continue / Cline / Zed / Windsurf:

| Use case | What it replaces | Why MCP wins |
|---|---|---|
| **"What should I triage right now?"** | Flipping to the admin tab, squinting at the dashboard, copying a report URL into chat | `triage_next_steps` prompt reads the live dashboard and gives the agent a five-item plan grounded in today's numbers: zero context-switch |
| **"Fix this bug"** (from an agent) | Copy-pasting the Sentry issue body, guessing at the blast radius, hoping the agent knows which files to touch | `get_fix_context` returns a pre-baked brief (root cause + smallest file set + repro + ontology tags) over a standardised MCP transport every client supports |
| **Cross-IDE parity** | Shipping a Cursor plugin AND a VS Code extension AND a JetBrains plugin | Ship **one** MCP server; every MCP-compatible editor picks it up. Cursor, Claude Desktop, Continue, Cline, Zed, Windsurf all already speak the protocol |
| **Scoped automation** | Giving the agent a full admin token or writing a brittle REST wrapper | `mcp:read` vs `mcp:write` scopes are enforced at the edge function. The agent can safely loop on reads; writes require the stricter key. No bespoke ACLs |
| **Natural-language data questions** | Opening the admin `/query` page, writing SQL by hand | `run_nl_query`: ask the agent "how many critical reports landed this week by component?" and it goes through the same NL→SQL pipeline the admin UI uses, rate-limited to 60/hour |
| **Ad-hoc dashboards inside chat** | Refreshing the admin tab every 15 s during a release | `project://dashboard` resource returns the live PDCA snapshot; clients can re-read the URI whenever the conversation needs fresh numbers |

### MCP spec coverage

| Status | Capability |
| --- | --- |
| Shipped | Tools, resources, prompts; tool annotations; progress on `dispatch_fix`; scope-aware errors; stdio + Streamable HTTP; `outputSchema` / `structuredContent` on key tools; inventory action anchors on `dispatch_fix` / `get_fix_context` |
| Waiting on clients | Resource subscriptions / `list_changed` push; sampling / elicitation |

Detail and tool tables: [docs `/sdks/mcp`](https://kensaur.us/mushi-mushi/docs/sdks/mcp) and the generated [MCP tools](https://kensaur.us/mushi-mushi/docs/sdks/mcp-tools.generated) page. Open an issue for a waiting-on-clients row once ≥2 major clients ship support.

## Admin console: `/mcp` page

The admin app ships an `/mcp` page (sidebar → **Act → MCP**) with connection status, install snippets, the use-case table above (clickable into the catalog), and the full tool / resource / prompt list from the same `catalog.ts` the server registers.

The page is the recommended first stop for a new team member; it takes about 60 seconds to go from "I have a Mushi account" to "Cursor is calling `get_recent_reports` for me". The source of truth lives at `apps/admin/src/pages/McpPage.tsx`.

## Security

- The server runs locally; your API key never leaves your machine except in calls to your configured `MUSHI_API_ENDPOINT`.
- **Scope keys tightly.** Give MCP the smallest scope that works; `mcp:read` is fine for 90% of agent loops.
- **Keep your SDK key (`report:write`) separate from your MCP key.** Your app's Mushi SDK key is embedded in client-side code (e.g. `NEXT_PUBLIC_MUSHI_API_KEY`) and should carry only `report:write` scope. This scope is intentionally rejected by every admin route; so even if extracted from a browser bundle, it cannot triage, dispatch fixes, or mutate report status. Mint a dedicated `mcp:write` key for Cursor/Claude (use the **"⚡ Add to Cursor"** deeplink on the `/mcp` console page; it mints one automatically). If you discover your public SDK key carries `mcp:write`, rotate it immediately.
- Never paste a service-role key; it bypasses RLS on every table.
- Rotate keys from the admin console if a laptop is lost; the denormalised owner binding is rebuilt automatically on rotation.
- The server logs to stderr; redirect to a file if you need an audit trail.

## Testing locally

Three layers of testing, each solving a different problem.

### Layer 1; In-process integration tests (fastest, no subprocess)

Real `Client ↔ Server` handshake over `InMemoryTransport` with a mocked `fetch`. Catches protocol regressions in under a second.

```bash
pnpm --filter @mushi-mushi/mcp test
# 49/49 pass; handshake, tool contracts, envelope unwrapping, scope errors, annotation contract, outputSchema, catalog parity
```

### Layer 2; Stdio smoke test (verifies the built bin boots)

Spawns `dist/index.js` with a dummy unreachable endpoint and confirms it advertises the expected tools/resources/prompts over stdio. Good CI gate before publishing.

```bash
pnpm --filter @mushi-mushi/mcp build
pnpm --filter @mushi-mushi/mcp test:smoke
# OK; prints live tool/resource/prompt counts from the catalog
# (see packages/mcp/src/catalog.ts — currently 69 tools / 8 resources / 4 prompts)
```

### Layer 3; Full localhost E2E (real binary + real backend behaviour)

Boots a tiny `node:http` mock of `/v1/admin/*`, spawns the real MCP binary pointed at it, and runs a real `StdioClientTransport` client through every tool + resource + a scope-denial path. This is the closest you can get to a production handshake without running Supabase Edge Functions.

```bash
pnpm --filter @mushi-mushi/mcp build
node packages/mcp/scripts/localhost-e2e.mjs
# 27/27 assertions; every tool, every resource, scope denial surfaced correctly
```

The harness is also the quickest way to iterate on new tools: extend the `FIXTURES` + the route switch in `scripts/localhost-e2e.mjs`, rebuild, rerun. No migrations, no Supabase boot time, no DB state.

## Configuring against your own localhost

When you're ready to wire the MCP into your local Mushi Mushi stack (i.e. `pnpm dev` is running the admin console + local Supabase), use these endpoints:

| Env var | Localhost value | Notes |
|---|---|---|
| `MUSHI_API_ENDPOINT` | `http://localhost:54321/functions/v1/api` | Default Supabase CLI port; the `/api` suffix is the Hono `basePath`. |
| `MUSHI_API_KEY` | the key you minted (see below) | Must have `mcp:read` or `mcp:write` scope. |
| `MUSHI_PROJECT_ID` | the UUID from the admin URL | `/projects/<uuid>` in the admin console. |

### Minting a localhost key

1. Start the stack: `pnpm dev` (admin on `:6464`, Supabase on `:54321`).
2. Sign in and open **Settings → API keys**.
3. Click **New key**, pick **MCP read** or **MCP read-write** (the scope picker on the "New key" form), and copy the plain-text key that appears once; it's not retrievable later.
4. The admin console URL is `http://localhost:6464/projects/<uuid>/...`; the `<uuid>` is your `MUSHI_PROJECT_ID`.

### Pointing Cursor/Claude Desktop at localhost

Replace the public endpoint block in your client's MCP config with the three env vars above. For Cursor, this lives in `.cursor/mcp.json` at your repo root:

```json
{
  "mcpServers": {
    "mushi-mushi-local": {
      "command": "node",
      "args": ["/absolute/path/to/mushi-mushi/packages/mcp/dist/index.js"],
      "env": {
        "MUSHI_API_ENDPOINT": "http://localhost:54321/functions/v1/api",
        "MUSHI_API_KEY": "mushi_live_abc…",
        "MUSHI_PROJECT_ID": "00000000-0000-0000-0000-000000000000"
      }
    }
  }
}
```

Rebuild the package (`pnpm --filter @mushi-mushi/mcp build`) after any MCP source change; Cursor re-spawns the subprocess on config reload but doesn't recompile for you.

### Sanity check: did it connect?

In Cursor chat, type `/`; you should see the Mushi Mushi slash-prompts (`/summarize_report_for_fix`, `/explain_judge_result`, `/triage_next_steps`). Or ask the agent directly: _"Use the Mushi MCP to list my recent reports"_. If scope is wrong you'll see the `[INSUFFICIENT_SCOPE]` error text verbatim; rotate the key with the right scope and retry.

## Debug MCP logs in Cursor

If tools are not showing up or returning unexpected errors:

1. **Check the Cursor MCP logs**: Cursor → Help → Toggle Developer Tools → Console. Filter by `mushi`.
2. **Verify the server started**: In the MCP panel (Cursor → Settings → MCP), look for a green dot next to the Mushi server.
3. **Check scope errors**: A `INSUFFICIENT_SCOPE` response means your API key lacks the required scope; mint a new key with `mcp:read` (or `mcp:write` for mutating tools).
4. **Run the health check**: `/test-mushi-mcp` command or call `list_projects`; a clean response confirms auth is working.
5. **Restart Cursor**: After changing environment variables or `mcp.json`, restart Cursor to pick up the new config.

## Mushi vs Sentry MCP

| | Sentry MCP | Mushi MCP |
|--|-----------|-----------|
| Signal source | Thrown exceptions | User-felt bugs (rage-click, console errors, network failures flagged by real users) |
| Evidence | Stack traces, breadcrumbs | Screenshots, console logs, network excerpts, user comments, replay pointers |
| Triage tool | `sentry_get_issue` | `triage_issue` (evidence + similar bugs + blast radius + logs + recommended actions) |
| Fix dispatch | — | `dispatch_fix` → draft GitHub PR → human review |
| QA coverage | — | QA story runner, PDCA improvement loop |

Both are complementary; use Sentry for exception noise, Mushi for "the user says it's broken" signal.

## See also

- [GTM distribution runbook](../../docs/marketing/GTM-DISTRIBUTION.md); MCP registry, Glama, Connect, cursor.directory, release checklist.
- [V5.3 whitepaper §2.10](../../MushiMushi_Whitepaper_V5.md); the agentic fix architecture this server feeds into.
- [`@mushi-mushi/agents`](../agents/README.md); orchestrator that consumes MCP-exposed fix workers.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 325 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
