# @mushi-mushi/mcp

[Model Context Protocol](https://spec.modelcontextprotocol.io/) server that exposes Mushi Mushi reports, fixes, and project state to coding agents (Claude Code, Cursor, Codex, Continue, Cline, Zed, Windsurf, and any other MCP-compatible client).

> **What this is, and what it isn't**
>
> - **This package** is the MCP **server** — runs locally next to your editor, talks to the Mushi Mushi API, and presents bug reports as MCP tools/resources to your coding agent.
> - **`@mushi-mushi/agents`** ships the MCP **client adapter** — used by the autofix orchestrator when your project's `autofix_agent = 'mcp'`. See `packages/agents/src/adapters/mcp.ts`.
> - The `generic_mcp` adapter shipped before V5.3 was a misnomer (it spoke plain REST). It is now `RestFixWorkerAgent`; the old export is kept as a deprecated alias for one more minor.

## Quick start

### 1. With Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mushi-mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "key_xxx",
        "MUSHI_PROJECT_ID": "proj_xxx",
        "MUSHI_API_ENDPOINT": "https://api.mushimushi.dev"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a hammer icon in the chat input — click it to see the Mushi Mushi tools.

### 2. With Cursor

In Cursor settings, open **MCP** → **Add new MCP server** and paste:

```bash
npx -y @mushi-mushi/mcp@latest
```

Set the same three env vars (`MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, optional `MUSHI_API_ENDPOINT`).

### 3. From the command line

```bash
MUSHI_API_KEY=key_xxx MUSHI_PROJECT_ID=proj_xxx npx -y @mushi-mushi/mcp@latest
```

The server speaks stdio MCP transport by default — your client launches it as a subprocess.

## Tools

### Read

| Tool | What it does |
|---|---|
| `get_recent_reports` | Fetch the N most recent reports, with optional `status` / `category` / `severity` filters |
| `get_report_detail` | Full payload for a single report — description, console logs, network requests, screenshot URL, classification result, fix history |
| `search_reports` | Semantic + keyword search (server-side pgvector; falls back to keyword match when embeddings aren't available) |
| `get_similar_bugs` | Embedding-nearest neighbours for a component, page, or description |
| `get_fix_context` | One-shot brief for a coding agent: report + repro + root-cause + ontology tags |
| `get_fix_timeline` | Ordered timeline of a fix attempt (dispatched → started → branch → commit → PR → CI → completed/failed) |
| `get_blast_radius` | Graph traversal showing other components a bug group touches |
| `get_knowledge_graph` | Traverse the knowledge graph from a seed component or page |

### Write / agentic

| Tool | What it does |
|---|---|
| `submit_fix_result` | Record a fix outcome (branch, PR, files, lines) from an external agent |
| `dispatch_fix` | Kick off the agentic fix orchestrator for a report — returns a `fix_attempt` id |
| `trigger_judge` | Run the Sonnet-as-Judge over a batch of classified reports |
| `transition_status` | Move a report between workflow states (enforces the same rules as the UI) |
| `run_nl_query` | Natural-language → read-only SQL against your project data (60/hour rate-limited) |

> Need a tool that isn't here? Open an issue at [github.com/kensaurus/mushi-mushi/issues](https://github.com/kensaurus/mushi-mushi/issues) and tag it `mcp`.

### Tool annotations — what MCP clients see before invoking

Every tool is registered via `server.registerTool()` with MCP 2025-10 **tool annotations** so clients (Cursor, Claude Desktop, Continue, Cline, Zed) can render a proper "is this safe to auto-invoke?" UI without calling the tool first. The annotations come from a single source of truth — `src/catalog.ts` — mirrored into the admin console (`apps/admin/src/lib/mcpCatalog.ts`) and guarded against drift by `scripts/check-mcp-catalog-sync.mjs`.

| Annotation | Meaning | Example |
|---|---|---|
| `readOnlyHint: true` | Safe to loop on — never mutates state | `get_recent_reports`, every `project://` resource |
| `destructiveHint: true` | Mutates project state; client should confirm | `dispatch_fix`, `transition_status` |
| `idempotentHint: true` | Repeated calls produce the same effect | `transition_status`, `submit_fix_result` |
| `openWorldHint: true` | Reaches out to your Mushi deployment (not a pure local function) | Every tool in this server |

The same catalog entries power the `/mcp` beginner console in the admin app — so the tool catalog the agent sees and the tool catalog the human operator reads can never disagree.

### Progress notifications on long-running tools

`dispatch_fix` emits an MCP `notifications/progress` event the moment the orchestrator accepts the request, so clients that support progress (Cursor, Claude Desktop) can render a live "Dispatching fix…" indicator instead of freezing until the HTTP round-trip returns. The notification mirrors the `ProgressToken` the client passed in `_meta.progressToken`; clients that don't pass one get the normal non-streaming response, unchanged.

## Resources

| URI | Returns |
|---|---|
| `project://stats` | Counts of new / classified / fixed reports + last 7-day trend |
| `project://settings` | Project config — autofix agent, plugins enabled, ontology, LLM budgets |
| `project://dashboard` | PDCA health snapshot — stage counts, bottleneck, recent activity (the same payload the admin console polls every 15 s) |

## Prompts

Named templates the MCP client surfaces in its slash-menu. Each one bakes in the house voice ("lead with the fix, skip the preamble") so agents produce consistent outputs across editors.

| Prompt | When to use |
|---|---|
| `summarize_report_for_fix` | Before asking the agent to write the patch — produces a one-line root cause, smallest file set, repro steps, and blast-radius warnings |
| `explain_judge_result` | After the judge scores a fix — turns the raw scores into ship / iterate / dismiss guidance |
| `triage_next_steps` | "What should I focus on right now?" — five-item markdown list drawn from the dashboard + recent classified queue |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MUSHI_API_KEY` | yes | — | Project API key with `mcp:read` or `mcp:write` scope. Mint one in the admin console → **Projects** (the one-time reveal card has a **Copy as `.env.local`** tab). |
| `MUSHI_PROJECT_ID` | yes | — | UUID from the admin console URL (`/projects/<uuid>/...`) or the reveal card. |
| `MUSHI_API_ENDPOINT` | no | `https://api.mushimushi.dev` | Override only if you self-host. Localhost value: `http://localhost:54321/functions/v1/api`. |

### Storing the key in `.env.local`

The MCP binary reads these three vars from `process.env` on spawn — that means **anywhere you normally put env vars works**. The zero-friction path:

1. In the admin console, mint a key and pick **Copy as `.env.local`** on the reveal card. You get a pre-formatted block:

   ```bash
   # Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.
   MUSHI_API_ENDPOINT=https://api.mushimushi.dev
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

   Cursor spawns the subprocess with the parent shell's env, so as long as you ran Cursor from a terminal that has `.env.local` sourced (or you're using `direnv` / `dotenv-cli`), the three vars are already in place. If you prefer to inline them — Cursor / Claude Desktop both support an `env` block in `mcp.json` — use the **Copy as `.cursor/mcp.json`** tab on the reveal card, which hard-codes the three values into the JSON for you.

4. **Never** commit `.env.local`, and **never** paste a key into a repo-tracked `.cursor/mcp.json`. If you accidentally do, rotate the key from the admin console — the denormalised owner binding is rebuilt automatically on rotation.

## API key scopes

The admin routes the MCP server hits enforce per-key scopes. When you mint a key, pick the smallest scope that works for your agent workflow:

| Scope | Grants | Use for |
|---|---|---|
| `report:write` | SDK ingest only (`/v1/reports`, `/v1/notifications`). **No admin access.** | Your app's runtime Mushi SDK — never give this to an MCP client. |
| `mcp:read` | Every MCP read tool (`get_recent_reports`, `search_reports`, `get_fix_context`, `get_fix_timeline`, `get_blast_radius`, `get_knowledge_graph`) and every `project://*` resource. | Safe default for agents that only *read* from Mushi. |
| `mcp:write` | Everything `mcp:read` grants **plus** mutating tools (`dispatch_fix`, `submit_fix_result`, `trigger_judge`, `transition_status`, `run_nl_query`). | Agents that should act on bugs (open PRs, judge, transition status). |

The middleware replies **403 `INSUFFICIENT_SCOPE`** with a human-readable message if your key is missing a required scope — no silent failures.

## Is this actually useful? — honest answer

The short version: **yes, but only for teams that already fix bugs in an AI-augmented editor.** If your team still opens bugs exclusively in Jira and writes patches longhand, this server is solving a problem you don't have yet. Use the SDK + Discord webhook and come back later.

For teams that do live in Cursor / Claude Code / Continue / Cline / Zed / Windsurf, the wins are concrete:

| Use case | What it replaces | Why MCP wins |
|---|---|---|
| **"What should I triage right now?"** | Flipping to the admin tab, squinting at the dashboard, copying a report URL into chat | `triage_next_steps` prompt reads the live dashboard and gives the agent a five-item plan grounded in today's numbers — zero context-switch |
| **"Fix this bug"** (from an agent) | Copy-pasting the Sentry issue body, guessing at the blast radius, hoping the agent knows which files to touch | `get_fix_context` returns a pre-baked brief (root cause + smallest file set + repro + ontology tags) over a standardised MCP transport every client supports |
| **Cross-IDE parity** | Shipping a Cursor plugin AND a VS Code extension AND a JetBrains plugin | Ship **one** MCP server; every MCP-compatible editor picks it up. Cursor, Claude Desktop, Continue, Cline, Zed, Windsurf all already speak the protocol |
| **Scoped automation** | Giving the agent a full admin token or writing a brittle REST wrapper | `mcp:read` vs `mcp:write` scopes are enforced at the edge function. The agent can safely loop on reads; writes require the stricter key. No bespoke ACLs |
| **Natural-language data questions** | Opening the admin `/query` page, writing SQL by hand | `run_nl_query` — ask the agent "how many critical reports landed this week by component?" and it goes through the same NL→SQL pipeline the admin UI uses, rate-limited to 60/hour |
| **Ad-hoc dashboards inside chat** | Refreshing the admin tab every 15 s during a release | `project://dashboard` resource returns the live PDCA snapshot; clients can re-read the URI whenever the conversation needs fresh numbers |

### Are we using the full power of MCP?

Honest scorecard against the MCP 2025-10 spec:

- ✅ **Tools, resources, prompts** — all three primitives advertised.
- ✅ **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) — every tool, every run.
- ✅ **Progress notifications** — wired on `dispatch_fix` (the one genuinely long-running call). Sends `notifications/progress` the moment the orchestrator accepts the job.
- ✅ **Scope-aware errors** — `[INSUFFICIENT_SCOPE]` surfaces verbatim so agents don't silently retry.
- ✅ **Stdio transport** — default for local editor integration.
- ⏳ **Resource subscriptions / `notifications/resources/list_changed`** — the spec supports live-updating resources (e.g. dashboard numbers that push rather than poll). Worth adding once Cursor + Claude Desktop both ship client support (currently patchy).
- ⏳ **Sampling / elicitation** — letting the server ask the client to run an LLM call (e.g. to draft a commit message from the fix context). Not yet wired; would let us move some orchestrator LLM spend from server-side to the user's own subscription.
- ⏳ **Streamable HTTP transport** — the spec's alternative to stdio for remote hosting. Relevant if we ever host the MCP server on behalf of customers; irrelevant for the local-install path that 95% of users want.

If you want a feature from the "⏳" column, open an issue — we're holding them back on "MCP client support has shipped in ≥2 major clients", not on implementation effort.

## Admin console: `/mcp` page

The admin app ships a beginner-friendly `/mcp` page (sidebar → **Act → MCP**) that mirrors this README for non-CLI users:

- **Connection status strip** — live-reads the active project's keys and tells you whether you have `mcp:read` / `mcp:write`, linking to the mint form if not.
- **Install block** — toggles between `.cursor/mcp.json` and `.env.local` output, pre-filled with the active project's id and a `MUSHI_API_KEY` placeholder.
- **Use-cases grid** — the same honest table above, but clickable so you can jump from a use case straight to the relevant tool in the catalog.
- **Full tool / resource / prompt catalog** — rendered from the same `catalog.ts` the MCP server registers from, so the human doc and the machine-readable server contract cannot drift.

The page is the recommended first stop for a new team member — it takes about 60 seconds to go from "I have a Mushi account" to "Cursor is calling `get_recent_reports` for me". The source of truth lives at `apps/admin/src/pages/McpPage.tsx`.

## Security

- The server runs locally; your API key never leaves your machine except in calls to your configured `MUSHI_API_ENDPOINT`.
- **Scope keys tightly.** Give MCP the smallest scope that works — `mcp:read` is fine for 90% of agent loops.
- Never paste a service-role key or a `report:write` SDK key — the former bypasses RLS, the latter is rejected by admin routes anyway.
- Rotate keys from the admin console if a laptop is lost — the denormalised owner binding is rebuilt automatically on rotation.
- The server logs to stderr; redirect to a file if you need an audit trail.

## Testing locally

Three layers of testing, each solving a different problem.

### Layer 1 — In-process integration tests (fastest, no subprocess)

Real `Client ↔ Server` handshake over `InMemoryTransport` with a mocked `fetch`. Catches protocol regressions in under a second.

```bash
pnpm --filter @mushi-mushi/mcp test
# 18/18 pass — handshake, tool contracts, envelope unwrapping, scope errors, annotation contract
```

### Layer 2 — Stdio smoke test (verifies the built bin boots)

Spawns `dist/index.js` with a dummy unreachable endpoint and confirms it advertises the expected tools/resources/prompts over stdio. Good CI gate before publishing.

```bash
pnpm --filter @mushi-mushi/mcp build
pnpm --filter @mushi-mushi/mcp test:smoke
# OK — 13 tools, 3 resources, 3 prompts
```

### Layer 3 — Full localhost E2E (real binary + real backend behaviour)

Boots a tiny `node:http` mock of `/v1/admin/*`, spawns the real MCP binary pointed at it, and runs a real `StdioClientTransport` client through every tool + resource + a scope-denial path. This is the closest you can get to a production handshake without running Supabase Edge Functions.

```bash
pnpm --filter @mushi-mushi/mcp build
node packages/mcp/scripts/localhost-e2e.mjs
# 27/27 assertions — every tool, every resource, scope denial surfaced correctly
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
3. Click **New key**, pick **MCP read** or **MCP read-write** (the scope picker on the "New key" form), and copy the plain-text key that appears once — it's not retrievable later.
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

Rebuild the package (`pnpm --filter @mushi-mushi/mcp build`) after any MCP source change — Cursor re-spawns the subprocess on config reload but doesn't recompile for you.

### Sanity check: did it connect?

In Cursor chat, type `/` — you should see the Mushi Mushi slash-prompts (`/summarize_report_for_fix`, `/explain_judge_result`, `/triage_next_steps`). Or ask the agent directly: _"Use the Mushi MCP to list my recent reports"_. If scope is wrong you'll see the `[INSUFFICIENT_SCOPE]` error text verbatim — rotate the key with the right scope and retry.

## See also

- [V5.3 whitepaper §2.10](../../MushiMushi_Whitepaper_V5.md) — the agentic fix architecture this server feeds into.
- [`@mushi-mushi/agents`](../agents/README.md) — orchestrator that consumes MCP-exposed fix workers.

## License

MIT
