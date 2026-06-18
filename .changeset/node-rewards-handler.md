---
"@mushi-mushi/node": minor
---

Add a turnkey reward-webhook receiver for host backends.

`createMushiRewardsHandler({ secret, onTierChanged, onPointsAwarded })` returns a framework-agnostic handler (Express middleware + Web-standard `fetch` handler) that timing-safely verifies the `X-Mushi-Signature` HMAC and routes Mushi reward events — the host-side "grant a role / grant a membership" trigger. Also exports `verifyRewardSignature` and `parseRewardEvent`, plus the `MushiRewardEvent` / `MushiTierChangedEvent` / `MushiPointsAwardedEvent` types.
