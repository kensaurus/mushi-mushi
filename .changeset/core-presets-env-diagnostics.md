---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
---

Config presets and loud env diagnostics — a mis-prefixed env var can no longer silently disable the SDK.

- New `preset: 'minimal' | 'standard' | 'full'` expands to a documented config baseline (your explicit keys always win); `validateConfig` warns loudly about unknown keys and invalid enum values instead of silently ignoring them (suppress with `MUSHI_SILENT=1`).
- New `diagnoseEnvConfig()` detects near-miss prefixes (e.g. `NEXT_PUBLIC_MUSHI_API_KEY` set in a Vite app) and names the expected prefix for the detected bundler. `@mushi-mushi/web` init errors now include that diagnosis instead of a generic "apiKey is required", so "the repo is added but nothing happens" has an actionable message. Opt out with `MUSHI_SILENT=1`.
