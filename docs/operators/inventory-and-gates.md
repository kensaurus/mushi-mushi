# Inventory, gates & spec traceability (operators)

> **This is Bucket C — the platform depth for teams and operators.** It used to
> live in the top of the README; it was re-shelved here per
> [`/VISION.md`](../../VISION.md) §2.1 so the front door stays on the wedge (a
> solo builder understanding and fixing one bug). Nothing here was deleted — it
> moved. If you're a solo vibe coder, you can ignore this whole file until you
> graduate to a team.

The "Team graduation" layer adds the *positive* side to Mushi's *negative* side:
v1 catches what users _felt_ break and triages it; v2 lets a team declare what
the app is *supposed* to do, then gates the build when an agent's drafts diverge
from that contract.

## What v2 adds

- 🌱 **Sketch your app, not just its bugs.** A `User stories · Inventory` page
  groups every user-facing action under the story it serves and shows verified /
  unwired / regressed counts at a glance.
- 🤖 **The SDK proposes the inventory.** Turn on `capture.discoverInventory` and
  the SDK quietly observes routes, `data-testid`s, and outbound API paths in
  production — Claude drafts an `inventory.yaml` from the stream, you accept or
  edit. Most teams will never hand-author one.
- 🚦 **Five gates, one composite GitHub check.** `mushi-mushi/no-dead-handler`
  (empty `onClick`s), `mushi-mushi/no-mock-leak` (faker / "John Doe" arrays in
  non-test paths), inventory drift (added / removed / renamed actions),
  agentic-failure detection (handler regressions across deploys), and synthetic
  walk health.
- 🛰️ **Synthetic monitor** runs the inventory's `expected_outcome` checks against
  your staging URL on a cron — fail-closed by default, with explicit
  `synthetic_monitor_allow_mutations` opt-in for write paths.
- 🕸️ **Graph gets a Surface mode** — the same `Bug graph` toggles to a `Surface`
  view that overlays the positive inventory on the live knowledge graph so you
  can see the dead corners.
- 🔌 **First-class orchestrator interop.** MCP Streamable HTTP at
  `/functions/v1/mcp` (2025-03-26 spec), A2A `tasks` endpoints at `/v1/a2a/tasks`
  (create / get / cancel / SSE subscribe), OpenAPI 3.1 at `/openapi.json`, AG-UI
  v0.4 SSE accepts API keys (`mcp:read`), `SandboxProvider` as an open contract,
  and JSON Schemas at `/v1/schemas/*`. See
  [Connecting your orchestrator](https://kensaur.us/mushi-mushi/docs/concepts/orchestrator-interop).

Get started in any project that already has Mushi installed:

```yaml
# .github/workflows/mushi-gates.yml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: gates # also: propose · discover-api · discovery-status · auth-bootstrap
```

Inside your IDE the same commands are exposed as MCP tools via
[`@mushi-mushi/mcp`](../../packages/mcp/). Full schema in
[`@mushi-mushi/inventory-schema`](../../packages/inventory-schema/), ESLint rules
in [`eslint-plugin-mushi-mushi`](../../packages/eslint-plugin-mushi-mushi/), the
auth-bootstrap helper in
[`@mushi-mushi/inventory-auth-runner`](../../packages/inventory-auth-runner/).

## How spec traceability works

The most-asked v2 question is "how do you keep agent work tied back to the
original spec once implementation starts?" The chain is closed end-to-end:

```
report ──► classify-report writes graph_edge (reports_against)
              │
              ▼
        inventory Action node ◄────────── inventory.yaml (expected_outcome)
              │
              ▼
       POST /v1/admin/fixes/dispatch  (or /v1/a2a/tasks, MCP dispatch_fix)
              │  body may carry { inventoryActionNodeId } — else worker walks the edge
              ▼
        fix_dispatch_jobs.inventory_action_node_id  ──► persisted
              │
              ▼
        fix-worker assembles FixContext
              + inventoryAction.expectedOutcome  ──► Markdown spec block in the LLM prompt
              ▼
        validateAgainstSpec  (deterministic pre-PR gate)
              │  HARD ERROR if the diff removes a json_path field the contract asserts on
              │  WARN to fix_attempts.spec_validation_warnings if no file references the contract's table / route
              ▼
        GitHub PR + fix_attempts row stamped with inventory_action_node_id
              │
              ▼
        synthetic_runs queued (status='skipped', error_message='queued_post_pr', action_node_id=…)
              │
              ▼
        synthetic-monitor cron drains the queue with priority on the next tick,
        runs an HTTP probe, evaluates expected_outcome (status_in + JSONPath assertions),
        records a real synthetic_runs row.
              │
              ▼
        Status reconciler picks it up → admin UI flips the Action to verified / regressed.
```

Every link has a real column / migration / test:

| Link | Where to look |
| ---- | ------------- |
| `expected_outcome` schema | [`packages/inventory-schema/src/index.ts`](../../packages/inventory-schema/src/index.ts) — Zod + JSON Schema, mirrored at `/v1/schemas/expected-outcome.json` |
| `inventory_action_node_id` columns | `20260509100000_inventory_action_traceability.sql` — `fix_dispatch_jobs` + `fix_attempts` (FK, `ON DELETE SET NULL`) + `spec_validation_warnings JSONB` |
| Spec context in the LLM prompt | `renderSpecContext()` in [`packages/agents/src/review.ts`](../../packages/agents/src/review.ts), mirrored in the `fix-worker` edge function |
| Pre-PR gate | `validateAgainstSpec()` in `packages/agents/src/review.ts`, wired into `packages/agents/src/orchestrator.ts` |
| Post-PR probe | `drainPostPrQueue()` + `evaluateExpectedOutcome()` in the `synthetic-monitor` edge function |
| External orchestrators see the same anchor | `dispatch_fix` and `get_fix_context` MCP tools; A2A `inventoryActionNodeId` body field on `/v1/a2a/tasks` |

What the agent sees in its prompt today (rendered by `renderSpecContext`):

```markdown
## Inventory Spec Context (whitepaper §2.10 spec-traceability)

This fix was dispatched against a tracked Action in the project's `inventory.yaml`.
The agent and the reviewer MUST keep the diff scoped to making the action work as
specified — do NOT refactor unrelated code or break sibling actions on the same page.

- Action: `signup-form: submit`
- Description: Submit the signup form and create a new user
- Page: `/signup` (id=`signup`)
- User story: New user signup (`signup`)

### Expected outcome contract (success criteria after fix)

- Summary: POST /signup returns 200 and creates a user row
- HTTP status MUST be one of: 200, 201
- Response body assertions:
  - `$.user.id` exists
- Database: `public.users` MUST row_exists
- UI MUST show text containing: "Welcome"
- UI MUST navigate to: `/dashboard`

After the PR merges, the synthetic monitor will probe the action against this
contract. A draft fix that the synthetic monitor will then immediately mark
`regressed` is worse than no fix at all.
```

## QA Coverage Suite

Define user-story tests as prompts or Playwright scripts and schedule them to run
automatically.

1. Go to **Check → QA Coverage** in the sidebar.
2. Click **+ New story** and describe the test in natural language.
3. Pick a provider (Firecrawl by default — no API key needed).
4. The story runs hourly and results appear on the page and the Dashboard tile.

| Provider | Requirements | Best for |
|----------|-------------|---------|
| `firecrawl_actions` | None (default) | Content verification, navigation checks, link health |
| `browserbase` | `BYOK_BROWSERBASE_API_KEY` in project settings | Complex UI interactions, JavaScript-heavy SPAs |
| `local` | CLI runner (`mushi-dev run-qa-stories`) | Full Playwright access, local-only environments |

When you click **Generate test from report** on a report, Mushi writes a
Playwright script, opens a GitHub PR, and automatically creates a QA story for it
— scheduled weekly as a regression guard. Story runners use your own API keys
(BYOK) stored in `mushi_runtime_config`; resolution order is project override →
org override → Mushi platform default (Firecrawl only). If a story fails and your
project has an A2A endpoint configured, `qa-story-runner` pushes a structured
failure notification to connected agents (Cursor, Claude Code, etc.) via the A2A
protocol.
