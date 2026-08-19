# 0002. Disable OpenAI strict structured outputs for optional-field schemas

Status: Accepted            Date: 2026-08-19

## Context

Several edge functions ask an LLM for a structured object via the AI SDK's
`generateObject`/`streamObject` with a Zod schema. Our triage schemas carry
genuinely optional fields — `area`, `component`, `rootCause`,
`reproductionSteps` — because the model should omit what it cannot determine
rather than hallucinate a value.

OpenAI's strict structured-outputs mode requires every key in `properties` to
also appear in `required`. The AI SDK's OpenAI provider enables strict mode by
default for capable models, so an optional field makes the provider reject the
request outright:

    Invalid schema for response_format 'response': 'required' is required to be
    supplied and to be an array including every key in properties. Missing 'area'.

This failed in production four separate times — fast-filter, pdca-runner
(twice), test-gen-from-story — each patched in isolation, before recurring as
MUSHI-MUSHI-SERVER-1V/1W in classify-report. Anthropic tolerates optional
fields, so the bug only appears on the OpenAI fallback path, which is exactly
the path that runs when something else is already wrong.

## Decision

Any OpenAI structured-output call whose schema contains `.optional()` passes
`{ structuredOutputs: false }` on the model factory:
`openai(MODEL, { structuredOutputs: false })`. The AI SDK still validates the
returned object against the Zod schema, so type safety is unchanged.
`scripts/../packages/server/src/__tests__/openai-structured-outputs-guard.test.ts`
scans every edge function and fails closed.

## Rejected alternatives

- **Make every field required and use `.nullable()`** — strict-mode compatible
  and arguably cleaner. Rejected for the triage schemas: it forces the model to
  emit `null` for fields it should simply omit, and empirically raised the rate
  of invented values. `_shared/fix-schema.ts` does use this shape where a
  fully-required schema is natural; the rule is per-schema, not global.
- **Anthropic-only, no OpenAI fallback** — sidesteps the incompatibility.
  Rejected: the fallback exists precisely for Anthropic outages and quota
  exhaustion.
- **Catch and retry without strict mode on failure** — costs a full round trip
  on every fallback and hides the misconfiguration.

## Consequences

We give up OpenAI's server-side schema enforcement on these calls and rely on
client-side Zod validation plus the AI SDK's repair retry. New OpenAI
structured-output call sites must either pass the flag or use a fully-required
schema — the guard test will fail the build otherwise. Revisit if OpenAI ever
supports optional properties in strict mode.
