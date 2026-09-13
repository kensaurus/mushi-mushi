---
"@mushi-mushi/core": patch
---

Stop rejecting five documented, typed config options as unknown.

`tunnel`, `ignoreErrors`, `denyUrls`, `allowUrls` and `replaysOnErrorSampleRate`
are all declared on `MushiConfig`, but none were listed in `KNOWN_CONFIG_KEYS`.
Setting any of them logged `[mushi] Unknown config key: … — check for typos
(see MushiConfig). Ignored.` and dropped the value, so error filtering and the
replay-on-error sample rate silently did nothing for anyone who configured them.

Same defect class as the `presets.config-keys` guard added in #376 — that test
is what caught these once both branches were merged.
