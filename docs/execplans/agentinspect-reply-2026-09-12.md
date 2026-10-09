# Reply to AgentInspect (drafted 2026-09-12)

> Send as-is or trim. Every technical claim below was verified against the
> Mushi tree and the OpenTelemetry GenAI conventions on 2026-09-12.

Hi,

Yes, please send one fixture. Here is the boundary we will hold it to, so the
result is conclusive either way.

**What a tool-path + retry-sequence bundle without payloads can diagnose.**
The "stuck / looped / gave up" family: loop detection (same tool, same
arguments shape, N times), retry without backoff, timeout cascades, wrong tool
chosen by name, budget or step-limit exhaustion. That family dominates the
agent failures our users actually see, so the bundle is worth having.

**What it cannot diagnose, and should not claim to.** Wrong-argument bugs,
schema mismatches between what the model sent and what the tool accepted, and
hallucinated fields. Those need the argument *shape* at minimum (key names,
types, sizes; never values), and in practice the tool's validation error class.

**What the fixture needs to join with what Mushi already has.**

1. A `trace_id` join key (W3C 32-hex). Our web SDK generates `traceparent` on
   every captured fetch/XHR and stores the trace id on the network entry, and
   our backend spans table is keyed on it. Without it the bundle is an orphan
   artifact we can display but not correlate. Once we ship MCP 2026-07-28
   (in progress), MCP requests also carry `traceparent`/`tracestate`/`baggage`
   in `_meta` (SEP-414), so any MCP hop your client instruments will join on
   the same id for free.
2. Per step: attempt/retry index, parent step id, tool **name**, status,
   duration, and the terminal error **class** (not the message).
3. Optional but valuable: argument shape (keys, types, sizes), token and cost
   counters per step.

**Format.** Please use the OpenTelemetry GenAI attribute names so we share a
vocabulary (the conventions now live in the `semantic-conventions-genai`
repository, Development status): `gen_ai.operation.name` = `invoke_agent` /
`execute_tool`, `gen_ai.agent.name`, `gen_ai.tool.name`, `gen_ai.tool.call.id`,
`error.type`, `gen_ai.usage.input_tokens` / `output_tokens`; for MCP hops
`mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`. Leave
`gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` off (they are opt-in
in the spec, and off is our content-capture posture).

One correction to what we said earlier: our ingest endpoint
`POST /v1/ingest/spans` is **not** OTLP. It takes our own span JSON, batch of
up to 100, 8 KB per span, 500 per minute:

```json
{ "spans": [ { "traceId": "<32 hex>", "spanId": "<16 hex>", "parentSpanId": "<16 hex>",
  "name": "execute_tool search_reports", "status": "error",
  "duration_ms": 1240,
  "attributes": { "gen_ai.operation.name": "execute_tool",
                  "gen_ai.tool.name": "search_reports",
                  "gen_ai.tool.call.id": "call_…", "error.type": "timeout",
                  "mushi.attempt": 3, "mushi.parent_attempt": 2 } } ] }
```

Put the OTel attribute names inside `attributes` and we ingest it today. If
you can only export OTLP/JSON, say so and we will add a translator on our side
rather than ask you to build a bespoke exporter.

**On `verify-safe`.** Welcome, and we will still run our own PII/secret
scrubber on everything we ingest. Inbound attestation is not accepted as a
substitute for that, for any sender.

Thanks,
Mushi Mushi
