# Hosted LLM billing

Turns the **hosted LLM** tier into a paid feature: when a triage call runs on
kensaurus's own provider key instead of the customer's, the project owner's
central KENSAURUS credit wallet is debited for it.

## What triggers a charge

Exactly one condition: the call ran on the **platform key**.

`_shared/byok.ts` resolves credentials in three steps — the project's
`byok_keys` pool, the legacy `project_settings.byok_*_key_ref` columns, then
`Deno.env.get('ANTHROPIC_API_KEY')` and friends. Only that third step produces
`ResolvedKey.source === 'env'`, and that is the billing discriminator.

| `key_source` | Who pays the provider | Wallet |
| ------------ | --------------------- | ------ |
| `byok`       | the customer          | never touched |
| `env`        | kensaurus             | debited (provider cost + 50% markup) |

Charges are taken only for `status === 'success'` invocations. A failed call
spends little or nothing and is not billed.

## Where it is wired

Two seams, one debit per call.

**Debit — `_shared/telemetry.ts` → `logLlmInvocation()`.** This is the only
place that already carries project, model, key source, and token counts
together, so the debit rides along with the telemetry write rather than being
repeated at every route. It is scheduled on `EdgeRuntime.waitUntil`, because
most callers invoke telemetry as `void logLlmInvocation(...)` and an awaited
bridge POST would die at isolate teardown.

**Preflight — `_shared/llm-failover.ts` → `withLlmFailover()`.** Runs before
any provider money is spent, and is the only seam that knows the key source
ahead of the call. In `on` mode an insufficient balance throws
`WalletDeniedError`; routes can turn that into a 402 with
`walletDeniedResponse()` from `_shared/kensaurus-wallet.ts`.

`WalletDeniedError` is re-exported from `_shared/llm-failover.ts`. **A retry
loop around an LLM call must rethrow it rather than treat it as a model
failure** — otherwise it retries against the bridge and stringifies `reason`
and `balanceMicro` away, leaving the UI nothing to prompt a top-up with.
`inventory-propose` and `story-mapper` both do this explicitly.

`withLlmFailover` also takes an optional `meter` argument for a caller that
writes no `llm_invocations` row. Since 2026-10-04 no caller passes it: every
generation writes a row through `_shared/llm-usage.ts` (`recordLlmUsage` /
`withLlmUsage`). **Do not pass `meter` from a path that also writes a row** —
that charges the same call twice.

## Coverage — read this before quoting revenue

This is a first cut. It bills the paths that were already instrumented, not
every path that can burn a platform key.

**Debited** — a call that runs on the platform key, writes an
`llm_invocations` row with `keySource: 'env'`, and whose path opts in.
Recording a call's cost does not bill it: `_shared/llm-usage.ts` writes rows
with `skipHostedBilling` unless the site passes `billHosted: true`. Since
2026-10-04 only `inventory-propose` and `story-mapper` opt in (they were
billed before through the `meter`), plus the paths that call
`logLlmInvocation` directly as before (classify-report, fast-filter,
fix-worker, ask-mushi, codebase-understand, repo-diagram, voice).

**Recorded, not debited (owner decision to bill):** `judge-batch`,
`generate-synthetic`, `mistake-clusterer`, `mistake-summarizer`,
`release-builder`, `pdca-runner`, `test-gen-from-report`,
`test-gen-from-story`, `library-modernizer`, `prompt-auto-tune`,
`nl-query`, the `classify-report` vision call, and embeddings. Their cost
shows on Costs and counts toward the monthly budget. To bill one, pass
`billHosted: true` at the site; a test pins the opt-in list.

**Not debited:**

- Writes an `llm_invocations` row but never sets `keySource`, so the gate never
  fires: `sdk-assistant`, `intelligence-report`. The cheapest to fix — one
  field at the existing telemetry call.
- Embeddings. Every embedding call writes a row (stage `embedding`) so its
  cost shows on Costs and counts toward the budget, but the row carries
  `skipHostedBilling`: embeddings were never wallet-billed and the wallet
  price table is not known to price them. Turning that on is an owner
  decision — confirm `kensaurus_model_prices` has `text-embedding-3-small`,
  then drop the flag in `_shared/embeddings.ts`.
- `generate-synthetic`, `mistake-*` and `release-builder` read
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` straight from the environment and
  never honour a customer's BYOK key — a separate bug. Their rows are
  `key_source = 'env'`; they are recorded, not debited.
- `fine-tune-vendor` predictions (an `ft:` model has no price row) and the
  `integration-probes` key checks write no row.

`activation.ts` and `project-integrations.ts` call `resolveLlmKey` as key
*validation probes*, not billable generations. They write no telemetry row and
are correctly excluded.

### Preflight is broader than the debit

The `on`-mode preflight lives in `withLlmFailover`, so it covers every
`withAnthropicOrOpenAi` caller. Paths that call the provider directly
(`judge-batch`, `generate-synthetic`, `mistake-*`, `release-builder`,
`library-modernizer`, `prompt-auto-tune`, `nl-query`, the vision call) are
neither gated nor debited. If one is opted into billing, give it the same
preflight first, or an empty wallet will not refuse it.

One softness worth knowing: `keySource` is what the caller *inferred*, not what
`resolveLlmKey` returned. `classify-report` does
`anthropicResolved?.source ?? 'env'`, so a failed resolution reports `env`.
That is the right answer for billing — those paths do fall through to
`Deno.env.get(...)` — but it is inference, not observation.

## Flag states

`MUSHI_HOSTED_LLM_BILLING`:

| Value    | Preflight | Debit | Blocks a call? |
| -------- | --------- | ----- | -------------- |
| `off` (default) | skipped | skipped | no — zero bridge calls, behaviour identical to before this feature |
| `shadow` | skipped | `$0` ledger row at `markup_bps 0`, real cost preserved in `metadata.shadow_provider_cost_micro` | no |
| `on`     | runs, **fails open** | real, provider cost + 50% markup | only on an explicit `allowed: false` — `WalletDeniedError` carrying `reason` and `balanceMicro` |

Anything other than `shadow` or `on` is `off`. The flag is also forced to `off`
whenever `KENSAURUS_WALLET_URL` or `KENSAURUS_WALLET_INTERNAL_TOKEN` is
missing, which is what keeps **self-hosted installs unbilled**: a self-hoster
has no bridge token, so even a copied production env file cannot charge them.
There is no per-project opt-in state and therefore no migration — the env flag
is the whole switch.

Recommended rollout: `shadow` for a full billing period to see real
cost-per-project, then `on`.

## Environment

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `MUSHI_HOSTED_LLM_BILLING` | no (default `off`) | `off` \| `shadow` \| `on` |
| `KENSAURUS_WALLET_URL` | when billing is on | `https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/kensaurus-wallet-api` |
| `KENSAURUS_WALLET_INTERNAL_TOKEN` | when billing is on | shared secret for the `x-kensaurus-internal-token` header |
| `MUSHI_HOSTED_LLM_PREFLIGHT_TIMEOUT_MS` | no (default `800`) | hot-path budget for the preflight; exceeding it proceeds unbilled |

## Latency and fail-open

Stage 1 (`fast-filter`, haiku, ~$0.0028/call) and Stage 2 (`classify-report`,
sonnet, ~$0.0150/call) run **per event on the hot path**, and the wallet is a
cross-project HTTPS call. So the preflight **fails open**:

- Only an explicit, successful `allowed: false` refuses the call.
- A bridge error, a non-200, a timeout, or an unbillable project all let the
  call proceed **unbilled**, and log.
- The whole preflight — identity resolution included — is capped at 800 ms by
  an outer race, and the HTTP request itself is cancelled via
  `AbortSignal.timeout`.

A wallet outage must never stop customers' error triage. This is deliberately
the opposite of the canonical `meteredCall`, which fails closed for
interactive consumer features, and it is why the preflight does not go through
`makeMushiWalletBackend().check()` — the verbatim SYNC helper has no timeout
hook. Same wire contract, still one round trip.

**Budget: exactly one blocking bridge call per LLM call.** Don't add more. An
escalating report costs ~$0.018 in raw LLM COGS against ~$0.0245 of Pro overage
revenue — roughly 27% margin before infra, which extra round trips eat. Price
lookup and debit are both deferred onto `waitUntil` and off the latency path,
and prices are cached in-isolate for 5 minutes.

## Identity

The wallet federates by **verified email**, so mushi resolves
`projects.owner_id` → that user's email in mushi's own `auth.users`, and sends
`external_project: 'mushi'`, `external_user_id: <owner_id>`, `email: <owner
email>`. Resolution is cached for 5 minutes per project.

A project whose owner has no email — or no `owner_id` at all, which is possible
because the column is `on delete set null` — **cannot be billed**. Such a call
proceeds unmetered and logs a warning. Preflight allows it too: locking a
customer out of triage over an identity gap they cannot see or fix is worse
than serving one unmetered call.

## Failure behaviour

A lost debit must never break triage, so `chargeHostedLlm` never throws into
its caller. It retries once on the same `request_id` (the wallet's debit RPC
dedupes on `(ref_type, ref_id)`, so a retry cannot double-charge), then logs
`console.error`.

An **unpriced model** is treated as *cannot bill*: log loudly, skip the debit,
let the call succeed. It deliberately does not use `meteredCall` from
`_shared/kensaurus-wallet.ts`, which throws before the provider call on a
missing price — that would take triage dark the moment mushi ships a model with
no row in kenji's `kensaurus_model_prices`.

### Model ids are passed through verbatim

The model id goes to the price lookup exactly as mushi sent it to the provider
— **no normalisation, no stripping of the date suffix**. `kensaurus_model_prices`
is keyed on the exact id, so `claude-haiku-4-5-20251001` and `claude-haiku-4-5`
are different rows and collapsing them mis-prices the call. (`providerFromModel`
derives only the *provider slug* — `anthropic` / `openai` — and never mutates
the model id.)

Priced as of 2026-08-08: `claude-sonnet-4-6`, `claude-haiku-4-5`,
`claude-haiku-4-5-20251001`, `gpt-5.4`, `gpt-5.4-mini`. When adding a model to
`_shared/pricing.ts`, add the matching wallet row too — with the **exact** id
mushi sends, including any dated failover variant — and **backdate
`effective_from`**: a future-dated row prices as missing.

Anthropic's cache-creation tokens are folded into `inputTokens` at 1.0x
(the provider bills them at 1.25x, and the wallet price table has no
cache-creation rate) — a small, deliberate undercharge.

## Plan interaction

Hosted LLM is billed from the wallet, not from the plan. `pricing_plans` rows
are untouched. The project's plan id is recorded in the debit metadata as
`mushi_plan_id` purely so revenue can be attributed per tier; a lookup failure
records `null` and never blocks the debit.

## Related

- `_shared/kensaurus-wallet.ts` — the canonical wallet helper, copied verbatim
  from yen-yen. It carries a SYNC header; there are now **six** copies across
  the fleet (yen-yen edge + mobile, glot.it, help-her-take-photo,
  the-wanting-mind, mushi). Well past the "extract a package at the third copy"
  line its own header draws.
- `yen-yen/docs/kensaurus-wallet.md` — full wallet reference.
- `_shared/byok.ts` — where `source: 'byok' | 'env'` is decided.
