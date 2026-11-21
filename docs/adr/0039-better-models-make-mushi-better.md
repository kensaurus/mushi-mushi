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

## Amendment 2026-10-31: the organization chooses Claude or OpenAI

The owner, 2026-10-31: "my Claude credits are running low on Claude api. try
… switching to openai api key for now that is already stored on the
settings. use latest model with similar model and pricing like opus 5.5."

- `organizations.ai_provider` (`anthropic` default, or `openai`; migration
  `20261030235848_org_ai_provider.sql`) is set in the console at Settings →
  AI keys → **Run AI on**, by an organization owner or admin
  (`PATCH /v1/admin/byok/ai-provider`). Choosing OpenAI with no OpenAI key
  opens the add-key form instead of refusing.
- On `openai`, no Claude key reaches any caller. `resolveLlmKeys` returns no
  Claude keys, and `platformAnthropicKey` replaces every direct read of
  `ANTHROPIC_API_KEY`. Only pausing the Claude key was not enough: the
  resolver then fell to the legacy field and the platform key.
- The pull request review (ADR 0030) runs on the app's OpenAI key when it has
  no Claude key, never on a platform key. The model is the project's
  `agent_pr_review_model` when it is a `gpt-…` id, else `OPENAI_PRIMARY`.
  Verdicts name the reviewer that actually ran ("GPT review: merge").
- `OPENAI_PRIMARY` is `gpt-6.1-sol` ($2 / $10 per 1M tokens) and `OPENAI_MINI`
  is `gpt-6-luna` ($0.10 / $0.50), per OpenAI's pricing page as read on
  2026-10-31. Opus 5.5 is $4 / $20.
- ADR 0035's second judge is meant to come from a different model family.
  While an organization runs on OpenAI, both the review and the second judge
  are OpenAI models. This is accepted for the duration; switching back to
  Claude restores the two families.
- Screenshot vision runs on Claude only, and is skipped while on OpenAI.

## Amendment 2026-11-21: platform AI follows the KENSAURUS AI routes

The owner, 2026-11-21: "move all services using CLAUDE API to openAI API
(cheaper and latest model) … easy to switch, monitor, auto-switch and notify …
not hard coding" (Claude credit at $1.30, OpenAI at $221).

- Which provider and model a platform-key call uses (Mushi-hosted AI, billed
  to the KENSAURUS wallet) comes from kenji `kensaurus_ai_routes`, per
  (app `mushi-mushi`, feature), through the vendored
  `_shared/kensaurus-ai-routes-client.ts` (CONTRACT 2026-11-21). mushi keeps no
  provider order of its own. A switch, a new model or a kill switch is one row
  on kenji, edited on the console's Providers & AI routes page.
- `withAnthropicOrOpenAi(db, project, claudeFn, openAiFn, { feature, tier })`
  is the one choke point. It runs the app's own Claude keys, then its own
  OpenAI keys (BYOK unchanged, with the caller's model), then the platform
  keys through `withPlatformRoute`. That walks the route's candidates in
  order, with down and recently failing providers last, and puts the route's
  model in `key.model`. Every chat feature calls it, the former self-resolving
  jobs included.
- The resolver no longer hands out the platform Claude key. `platformAnthropicKey`
  and `_shared/project-llm-key.ts` are gone. Embeddings and speech-to-text
  stay outside the routes.
- Without a kenji token (a self-host) nothing calls kenji. The built-in
  OpenAI-first list runs (OpenAI, OpenRouter, then Claude), and so does a cold
  instance when kenji is slow (800 ms).
- A spent account is its own failure class, `payment` (Anthropic's 400 "Your
  credit balance is too low", 402, OpenAI `insufficient_quota`). It is reported
  to kenji's provider ingest, which opens an incident, posts to Slack and adds
  an ops event, and the next candidate runs. `fallback_used` means only that
  the route's priority 1 did not answer.
- The drill is the kill switch on kenji. `KENSAURUS_LLM_DRILL=<provider>:payment`
  works only on calls marked `drill: true` (tests).
- The code tier moves to `gpt-6.2-sol` (`OPENAI_PRIMARY`; same $2 / $10 as
  6.1 Sol). Calls stay on the AI SDK's chat-completions path, which has run
  every OpenAI-organization call since 2026-10-31.
- Rejected: a mushi-local `MUSHI_HOSTED_LLM_ORDER` (the owner wants one control
  plane), and flipping `ai_provider`'s default, which would also take away
  customers' own Claude keys.
