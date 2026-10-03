# 0018. Gate findings are readable on every plan

Status: Accepted (owner-delegated, 2026-10-03)            Date: 2026-10-03

Amends: the `inventory_v2` gating of migration `20260504120000_inventory_v2_plan_flags.sql`
for one read route. Related: [0004](0004-lead-with-the-bug-mediator-category.md)
(the buyer), [0016](0016-mushi-as-the-app-recipe-control-plane.md) (drift becomes
`gate_findings`), [0017](0017-strike-the-plan-019-020-sequencing-gate.md).

## Context

Every check Mushi runs writes its result as `gate_runs` + `gate_findings`: the
inventory gates, the recipe drift gates (`design_drift`, `ci_drift`,
`deploy_drift`, `env_drift`), code health, Mushi's own setup checks (`radar`,
including `spend_cap_unset`) and the app hole checks. The one place that lists
those findings with their file, line, message and suggested fix is
`GET /v1/admin/inventory/:projectId/findings`, also read by the MCP tool
`list_gate_findings`.

That route sat behind `requireFeature('inventory_v2')`, which is `false` on the
`free_cloud` and `indie` plans (`20260806070334_restore_active_plan_entitlements.sql`).
So the solo vibe coder the product leads with (ADR 0004) saw counts on the
Full-stack audit page and portfolio card ("2 holes", "warn") but could not read
which file, which rule, or the one-click fix — and their editor agent could not
either. A count you cannot open is the same fail-open shape Plan 020 P-1 removes
elsewhere: a number with nothing behind it.

The owner delegated this decision (gap #32 of the 2026-10-03 completeness
pass).

## Decision

1. **Reading gate findings is free on every plan.** The route
   `GET /v1/admin/inventory/:projectId/findings` no longer runs
   `requireFeature('inventory_v2')`. It keeps `adminOrApiKey()` and
   `assertProjectScope`, so a caller still sees only projects it can reach and a
   project-bound key only its own project.
2. **The MCP tool `list_gate_findings` follows the route** on both transports;
   its description no longer implies a plan requirement.
3. **Everything else under `/v1/admin/inventory` stays on `inventory_v2`**:
   ingesting `inventory.yaml`, the snapshot, diff, user stories, running gates,
   reconcile/crawl, proposals, discovery, test generation and settings. Those
   are the bidirectional-inventory features the plan sells; the read of results
   Mushi already produced is not.
4. `GATED_ROUTES` keeps the `/v1/admin/inventory` prefix and names this one
   route in `except`, so the entitlements introspection stays truthful.

## Rejected alternatives

- **Keep the gate and show an upgrade prompt on the finding.** The finding is
  usually Mushi telling the user that Mushi itself is misconfigured (a rejected
  key, no spend cap, a webhook that never delivered). Charging to read that is
  charging to learn the product is broken.
- **Ungate all of `/v1/admin/inventory`.** Running gates, crawls and test
  generation cost LLM and CI minutes; those stay a paid plan feature.
- **Duplicate the findings into a new free route.** Two routes over one table
  drift; the console, MCP and CLI already speak this one.

## Consequences

- The Full-stack audit page and the Recipe page's setup checks list findings
  with file, line and message on every plan, and `spend_cap_unset` can be fixed
  in one click from there.
- The route is now reachable by more callers; its cost is one indexed select of
  at most 50 runs and 500 findings, already bounded.
- `entitlements.test.ts` and the route test pin both halves: the findings read
  answers on a plan without `inventory_v2`, and the rest of the prefix still
  returns 402.
