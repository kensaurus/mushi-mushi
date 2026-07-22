# Inventory and gates (v2)

Source: https://kensaur.us/mushi-mushi/docs/concepts/inventory-and-gates

---
title: 'Inventory and gates (v2)'
---

# Inventory and gates

Mushi v1 was the **negative side** of the loop: catch what your users *felt* break,
classify it, dedupe it, optionally draft a fix. v2 adds the **positive side**: a
declarative `inventory.yaml` that names every user-facing story, page, and action —
and five composite gates that fail the build when the agent's drafts diverge from
the contract.

---

## The model

Each `action` carries a trigger (`click`, `type`, `submit`) and an `expected_outcome`
block — the assertions a healthy session would still satisfy. The synthetic monitor
re-walks those expectations on a cron; the crawler proposes new actions from
production traffic; the gates fail when reality diverges from the file.

`expected_outcome` is the load-bearing field for the v2 closed loop. It threads
through every stage of the agent pipeline — see
[Spec traceability](#spec-traceability--read-and-write-side) below for the full chain.

---

## Five gates

The composite GitHub status `mushi-mushi/gates` rolls up five checks:

Gates 1 and 2 run statically in CI — no network call. Gates 3, 4, and 5 reach the
Mushi gateway. **Branch protection should require the composite check**, not the
individual gates, so a transient monitor hiccup doesn't block merges permanently.

---

## Discovery — the SDK proposes the inventory

Most teams will never hand-author `inventory.yaml`. Turn on the v2.1 SDK option:

```ts

```

The SDK quietly observes routes, `data-testid`s, and outbound API paths in
production. Claude reads the stream and drafts an `inventory.yaml` in the
**Discovery** tab on the User Stories surface. You accept, edit, or skip —
the production payload itself never carries user data.

---

## Synthetic monitor

The monitor re-walks every action's `expected_outcome` against your staging URL
(or any explicit `synthetic_target_url`). Defaults are **fail-closed**: write paths
(POST / PUT / DELETE actions) are skipped unless you opt in per-project:

```yaml filename="inventory.yaml"
synthetic_monitor_allow_mutations: true
```

  Only set `synthetic_monitor_allow_mutations: true` when staging is fully isolated
  from production data and the write endpoints have an idempotency key or roll back
  cleanly.

---

## Surface mode in the graph

The same inventory powers a **Surface** toggle on the
[knowledge graph](/concepts/knowledge-graph) — every Page, Element, and Action
node from `inventory.yaml` overlaid on the live bug graph. Dead corners
(high-traffic pages with no `expected_outcome`) light up so you can prioritise
which stories to instrument next.

---

## Spec traceability — read AND write side

The v1 question every team asked was *"how do you keep agent work tied back to the
original spec once implementation starts?"* Until the 2026-05-09 release the
**read side** (proposer → ingest → gates → status reconciler → admin UI) was tight,
and the **write side** (report → fix → PR → re-verify) was a U-turn — the worker
dropped the inventory pointer the moment dispatch started. That's now closed
end-to-end:

  External orchestrators (Cursor, Claude Code, OpenAI Agents SDK, LangGraph,
  CrewAI, A2A v1.0.0) see the **same** anchor through the MCP `get_fix_context`
  tool, the A2A Task `metadata.inventoryActionNodeId` field, or the dispatch
  row's column directly. See [Connecting your orchestrator](/concepts/orchestrator-interop).

**What the agent sees in its prompt today** (rendered by `renderSpecContext()`):

```markdown
## Inventory Spec Context (whitepaper §2.10 spec-traceability)
This fix was dispatched against a tracked Action in the project's inventory.yaml.
The agent and the reviewer MUST keep the diff scoped to making the action work as
specified — do NOT refactor unrelated code or break sibling actions on the same page.

- Action: `signup-form: submit`
- Description: Submit the signup form and create a new user
- Page: `/signup` (id=`signup`)
- User story: New user signup (`signup`)

### Expected outcome contract
- Summary: POST /signup returns 200 and creates a user row
- HTTP status MUST be one of: 200, 201
- Response body: `$.user.id` exists
- Database: `public.users` MUST row_exists
- UI MUST show text containing: "Welcome"
- UI MUST navigate to: `/dashboard`
```

### Where each link lives

| Link | Where to look |
| ---- | ------------- |
| `expected_outcome` schema | `@mushi-mushi/inventory-schema` (Zod + JSON Schema, mirrored at `/v1/schemas/expected-outcome.json`) |
| `inventory_action_node_id` columns | Migration `20260509100000_inventory_action_traceability` — `fix_dispatch_jobs` + `fix_attempts` (FK, `ON DELETE SET NULL`), plus `spec_validation_warnings JSONB` |
| Spec context in the LLM prompt | `renderSpecContext()` in `@mushi-mushi/agents`, mirrored in the `fix-worker` Edge Function |
| Pre-PR gate | `validateAgainstSpec()` in `@mushi-mushi/agents`, wired into `FixOrchestrator` |
| Post-PR probe | `drainPostPrQueue()` + `evaluateExpectedOutcome()` in the `synthetic-monitor` Edge Function |
| External orchestrators | MCP tools `dispatch_fix` + `get_fix_context`, A2A `POST /v1/a2a/tasks` |

---

## Related packages

- [`@mushi-mushi/inventory-schema`](/sdks/inventory-schema) — Zod + JSON Schema for `inventory.yaml`.
- [`@mushi-mushi/inventory-auth-runner`](/sdks/inventory-auth-runner) — bootstrap an authenticated session so the crawler / monitor can reach pages behind a login wall.
- [`@mushi-mushi/mcp-ci`](/sdks/mcp-ci) — the GitHub Action that runs all five gates, plus `propose`, `discover-api`, `discovery-status`, and `auth-bootstrap` sub-commands.
- [`eslint-plugin-mushi-mushi`](/sdks/eslint-plugin) — `no-dead-handler` and `no-mock-leak`.
- [Admin → User stories · Inventory](/admin/inventory) — the in-app surface where you accept proposals and trigger one-off gate runs.
