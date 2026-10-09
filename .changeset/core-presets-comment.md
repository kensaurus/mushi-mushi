---
"@mushi-mushi/core": patch
---

No behaviour change: a source comment in the config-key list now describes the earlier `replaySampleRate` bug accurately (it was declared on `MushiConfig` but missing from the known-keys list, so setting it logged "Unknown config key").
