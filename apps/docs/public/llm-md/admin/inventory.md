# User stories · Inventory

Source: https://kensaur.us/mushi-mushi/docs/admin/inventory

---
title: 'User stories · Inventory'
---

# User stories · Inventory

The **User stories** surface (sidebar → User stories) is the v2 positive
side of the loop. Where Reports / Graph / Fixes catch what your users
*felt* break, the inventory describes what should *exist* — every page,
every action, every expected outcome — so the gates can fail when the
two diverge.

  Inventory routes are gated behind **Advanced** mode in the sidebar
  while the surface is still maturing. A workspace owner can promote
  them via Settings → Workspace → *Surface advanced features*.

## What you see

Three nested layers:

1. **Truth-layer summary** across the top — verified / unwired /
   regressed counts rolled up across every story in the project.
2. **Story cards** — one per top-level user story (`signup`, `pricing`,
   `dashboard`, …) with per-story counts and a *Run gates* / *Run crawler*
   action on the row.
3. **Action drawer** — click any element / action to inspect the
   `expected_outcome` block, the last walk, and the raw YAML.

## Run gates / Run crawler from a row

Both buttons short-circuit to the same code path the GitHub Action uses
([`@mushi-mushi/mcp-ci`](/sdks/mcp-ci)):

- **Run gates** — runs all five gates against the current branch and
  posts the composite check back to your most recent open PR.
- **Run crawler** — kicks the discovery crawler on staging. Newly
  observed routes show up in the *Discovery* tab as candidates ready to
  be promoted into `inventory.yaml`.

## SDK-driven discovery

Most teams will never hand-author `inventory.yaml`. Turn on
`capture.discoverInventory` in the SDK config:

```ts

  

```

The SDK quietly observes routes, `data-testid`s, and outbound API paths
in production. Claude drafts a candidate `inventory.yaml` from the
stream every 24 h and the **Discovery** tab surfaces the diff for
review. You accept, edit, or skip — the production payload itself
never contains user data.

## Surface mode in the graph

The same inventory powers a **Surface** toggle on the
[Knowledge graph](/admin/graph) — every Page / Element / Action node
overlaid on the live bug graph so the dead corners (high-traffic
elements with no `expected_outcome`) light up.

## Five gates

The composite GitHub check is rolled up from:

| Gate                              | Surfaced as                      |
| --------------------------------- | -------------------------------- |
| `mushi-mushi/no-dead-handler`     | ESLint — empty `onClick` etc.    |
| `mushi-mushi/no-mock-leak`        | ESLint — faker / placeholder data in non-test paths |
| **Inventory drift**               | Action runner — added / removed / renamed actions |
| **Agentic-failure detection**     | Action runner — handler regressions across deploys |
| **Synthetic walk health**         | Synthetic monitor — last walk against staging |

Drilling into any failing gate from a story card opens the relevant
finding panel — `GateFindingCard` for the static rules, `DriftDiffPanel`
for inventory drift, `SyntheticTimeline` for the synthetic walks.

## Synthetic monitor

Mushi re-walks the inventory's `expected_outcome` checks against your
staging URL on a configurable cron (default: hourly). The monitor is
**fail-closed by default** — write paths (POST / PUT / DELETE actions)
are skipped unless you opt in per-project:

```yaml filename="inventory.yaml"
synthetic_monitor_allow_mutations: true
```

Set this only when staging is fully isolated from production and the
write endpoints have an idempotency key or roll back cleanly.

## Spec traceability — every fix carries the originating Action

As of the 2026-05-09 release every fix dispatched against a report that
has been linked to an inventory `Action` (via the `reports_against`
graph edge `classify-report` writes) carries that link end-to-end:

- The dispatch row (`fix_dispatch_jobs.inventory_action_node_id`) and
  the resulting attempt (`fix_attempts.inventory_action_node_id`) both
  store the FK to the `graph_nodes` row for the originating Action.
- The fix-worker LLM prompt includes a Markdown spec-context block
  with the action description, page, story, and every assertion in
  the contract — see
  [Concepts → Spec traceability — read AND write side](/concepts/inventory-and-gates#spec-traceability--read-and-write-side).
- A deterministic `validateAgainstSpec` gate runs before the PR opens.
  Soft warnings (no changed file references the contract's required
  DB table or page route) land on
  `fix_attempts.spec_validation_warnings JSONB` and surface in the
  Fixes drawer as a yellow "Sanity-check before merging" callout.
- A targeted post-PR synthetic probe is queued for the originating
  Action immediately after the PR opens. The synthetic-monitor cron
  drains the queue with priority on its next tick — so a fix that
  immediately makes the action `regressed` shows up here within
  minutes of merge, not on the next 15-min reconciler sweep.

Open any element / action drawer to see the **"Recent fixes"** strip
at the bottom — every fix attempt that mutated this Action, with its
spec-validation warnings (if any) and the post-PR synthetic result.

External AI agents (Cursor, Claude Code, OpenAI Agents SDK,
LangGraph, CrewAI, A2A v1.0.0) get the same anchor — see
[Connecting your AI agent](/concepts/orchestrator-interop) for the
per-surface details.

## See also

- [Concepts → Inventory and gates](/concepts/inventory-and-gates) — the
  conceptual model.
- [`@mushi-mushi/inventory-schema`](/sdks/inventory-schema) — the Zod /
  JSON Schema for `inventory.yaml`.
- [`@mushi-mushi/mcp-ci`](/sdks/mcp-ci) — the GitHub Action.
- [`eslint-plugin-mushi-mushi`](/sdks/eslint-plugin) — the lint rules.
- [`@mushi-mushi/inventory-auth-runner`](/sdks/inventory-auth-runner) —
  bootstrap an authenticated session for the crawler / monitor.
