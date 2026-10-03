# 0017. Strike the Plan 019/020 sequencing gate

Status: Accepted            Date: 2026-10-02

Supersedes: the sequencing gate in [0016](0016-mushi-as-the-app-recipe-control-plane.md)
(the rest of 0016 stands). Plans: [Plan 019](../execplans/app-recipe-control-plane.md),
[Plan 020](../execplans/portfolio-operator.md). Positioning companion:
[portfolio-positioning.md](../marketing/portfolio-positioning.md).

## Context

ADR 0016 put Plan 019 Phases 2, P2 and 3 behind a sequencing gate: "gated
phases start when at least 3 external projects are activated or the owner sets
a review date; the owner may strike the gate." Plan 020 (the portfolio
operator layer) inherits the same gate for its Phases 2–4, and lists six owner
decisions in its §15.

On 2026-10-02 the owner wrote: *"please complete all the non finished next for
me - complete all the phases then. fix the bugs too."* That is the owner
striking the gate. The north-star count of activated external projects is
still 0; the gate is struck by decision, not met.

## Decision

1. **The gate is struck.** Plan 019 Phases 2, P2 and 3 and Plan 020 Phases
   1–4 are built now, in the order the plans give.
2. **Plan 020 §15 owner decisions, taken by default:**
   1. **ICP evolution** per the positioning doc §9.1: the portfolio operator is
      the same vibe coder with several apps, not a new buyer, and never leads a
      public surface. The drift test gains one clarification: *a hole found
      before a user hits it is a bug fixed in zero minutes*. A check that
      prevents or explains a bug in at least one app passes; cost and CI
      minutes on their own still do not. The VISION.md / AGENTS.md diff from
      §9.2 is applied with this ADR.
   2. **S-1: store listings live as code** in the host repo (fastlane
      `metadata/` layout, pointed at by the `store` block of
      `mushi.recipe.json`). Mushi proposes draft PRs to those files; the
      host's own CI publishes them with the operator's own key. Mushi holds at
      most a read-only key per store.
   3. **Connector kinds `public_probe`, `llm_usage` and `revenuecat`** join
      Plan 019's `ConnectorKind` union, each read-only.
   4. **The public diagram page** is opt-in per repo, public repos by default.
   5. **P-2: `monthly_llm_budget_usd` is enforced**, not relabelled "alert only".
   6. **Plan 020 is registered** in `docs/execplans/PLANS.md`.
3. **One exception stays: nothing acts on its own.** The "act" capabilities of
   Plan 019 Phase 3 / Plan 020 Phase 4 are built and tested against fakes, but
   every live execution — promoting a store track, changing a rollout %,
   publishing a listing, any connector write — needs a human approval of that
   one action through `connector_actions`: the approval binds a SHA-256 of the
   exact payload, is single-use, expires, and is accepted only from a console
   JWT session, never from an API key. No action executes automatically, and
   no capability ships enabled.

## Rejected alternatives

- **Keep the gate until 3 projects activate.** The owner struck it in writing.
- **Build the act capabilities but leave the approval for later.** An act
  path without its approval check is the silent fail-open this repo has
  shipped four times; the approval lands in the same change as the first act.
- **Let MCP or an API key approve an action.** An agent that can request and
  approve its own action has no human in the loop. MCP can request; only the
  console approves.

## Consequences

- Activation is still the north star. Portfolio and radar surfaces stay in
  Bucket B / C, below the first screen, and never in the README hero or the
  npm description; `scripts/check-positioning-consistency.mjs` still passes.
- More surface to keep honest: every connector without credentials renders
  `not_connected`, never a failure, and a check that never ran renders
  `unknown`, never green.
- Apple App Store Connect is blocked by an agreement the owner has not
  accepted; ASC connectors surface that as a `blocked` reason, not an error.
