# 0009. Speak the A2A 1.0 wire format, keep the 0.3 names as aliases

Status: Accepted            Date: 2026-09-12

## Context

`a2a-push-notify`, `POST /v1/a2a/tasks` and the agent card advertise A2A
`1.0.0` but use the 0.3 vocabulary: `configuration.pushNotificationConfig`,
`authentication.schemes[]`, a bare callback body, and the card at
`/.well-known/agent-card`. A2A 1.0 (a2a-protocol.org, verified 2026-09-12)
names the field `configuration.taskPushNotificationConfig` with a singular
`authentication.scheme`, POSTs callbacks as a `StreamResponse` body
(`{ statusUpdate: {...} }`) with `Content-Type: application/a2a+json`, serves the
card at `/.well-known/agent-card.json`, and treats an empty `A2A-Version`
header as 0.3.

## Decision

Accept both field spellings on input (1.0 preferred, 0.3 logged as
deprecated), emit the 1.0 callback envelope with the Standard Webhooks
signature headers unchanged, serve `agent-card.json` with the old paths as
aliases, and read `A2A-Version`. No existing consumer is broken; new consumers
get the spec they read.

## Rejected alternatives

- **Advertise 0.3 instead** — honest, but 1.0 is the released spec and the
  card already says 1.0.0; downgrading the label is a regression for anyone
  who integrated against the number.
- **Drop the 0.3 names** — the push config is stored on
  `fix_dispatch_jobs.push_notification_config` for live jobs; a hard cut would
  strand them.
- **PascalCase JSON-RPC methods** — the surface is REST; no JSON-RPC endpoint
  exists to rename.

## Consequences

Callback consumers receive `{ statusUpdate }` instead of a flat object; the
change is additive because the previous body was undocumented. Aliases are
removable in a later ADR once telemetry shows no 0.3 senders.
