# 0039. Better models make Mushi better: the yardstick for every feature

Status: Accepted Date: 2026-10-22

Related: ADR [0030](0030-agent-pr-review-gate.md) (Opus review gate), ADR
[0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md) (verified
fixes), `_shared/models.ts`, `_shared/claude-request.ts`
(`resolveClaudeModel`), `_shared/project-models.ts`.

## Context

The owner set this test on 2026-10-22: "if the LLM models keep getting
better, will our system do better? It should always be this yardstick when
implementing new features and enhancing."

Most of Mushi already passes. Diagnosis (`stage2_model`), the quick check,
the judge and the built-in fix agent read their model from
`project_settings`. Cursor follow-ups and spend-down read theirs from
organization settings. One stage did not: the agent PR review called the
`AGENT_PR_REVIEW_MODEL` constant, so a better reviewer needed a code change
and a deploy.

## Decision

Every feature is judged by one question: **when the models get better, does
this get better on its own?**

1. **The model is a setting, never a constant.** Each LLM stage reads its
   model from project or organization settings, then an edge secret, then
   the code default. Upgrading must need no code change. Retired ids map
   back to the default (`resolveClaudeModel`).
2. **Code for facts and safety, models for judgement.** Matching an
   advisory to a version, merge gates, test proof, budgets and permissions
   are deterministic code: a better model must not be able to talk its way
   past them. Diagnosis, fix plans and reviews go to the model, so they
   improve as it does.
3. **Give the model evidence, not workarounds.** Prefer more context (the
   diff, the logs, the report, the codebase graph) to prompt tricks that
   patch one model's weakness. Remove a workaround when a newer model no
   longer needs it.
4. **Measure outcomes per model.** Verdict rates, merged-and-stayed-fixed,
   regressions and cost per merged fix are stored with the model that
   produced them (`llm_invocations`, `fix_reviews.model`), so "better" is visible
   and comparable.
5. **Say it in the plan.** A plan or PR that adds an LLM stage states how
   that stage behaves when the model improves.

First application, in the same PR as this ADR:
- `project_settings.agent_pr_review_model` (migration `20261022021555`);
- the `AGENT_PR_REVIEW_MODEL` edge secret;
- the settings API field (project admins only, Claude ids only, null resets).

## Rejected

- **Pinning the best current model in code and bumping it per release.**
  That ties every model upgrade to a deploy, and a self-hoster to our
  release cadence.
- **Letting the model decide merges or safety checks on its own.** A better
  model is still not proof. ADR 0035 keeps merges on evidence.

## Consequences

- New LLM stages ship with a settings column or an organization setting
  plus a default, not a bare constant.
- Code review checks for a hard-coded model id outside `_shared/models.ts`
  defaults.
