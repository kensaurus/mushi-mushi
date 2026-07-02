---
"@mushi-mushi/mcp": patch
---

## Tool catalog

- `award_bonus_points` and `set_tier` now correctly declare `destructive: true` — both are effectively irreversible (no point-reversal endpoint; tier overrides bypass automatic re-evaluation and any tied reward grant) so MCP clients that gate on destructive hints will now confirm before calling them
- Rewrote the `merge_fix`, `award_bonus_points`, and `set_tier` descriptions to be explicit about irreversibility and side effects that do *not* fire automatically (host `reward_webhooks` grants, tier-evaluation replay), so an agent calling these tools makes an informed choice instead of assuming parity with the points/tier system's normal automatic path
