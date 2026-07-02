---
"@mushi-mushi/core": patch
---

## PII scrubber

- Single-sourced pattern extraction into `pii-patterns.json` — the TypeScript scrubber and the generated Flutter/Dart scrubber now read from one canonical pattern list instead of two hand-maintained regex sets that could silently drift out of sync
- Behavior-identical to the previous scrubber for emails, phones, credit cards, SSNs, IP addresses, and vendor secret tokens (AWS/Stripe/Slack/GitHub/OpenAI/Anthropic/Google keys, JWTs)
