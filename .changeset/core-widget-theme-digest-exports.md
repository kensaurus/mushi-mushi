---
"@mushi-mushi/core": minor
---

Add widget-theme, digest, and project-scoped reporter-token exports consumed by the web + React Native banner SDKs:

- `sha256Hex` / `hmacSha256Hex` digest helpers (Hermes-safe).
- Banner/accent design tokens: `MUSHI_BANNER_NEON`, `MUSHI_TIER_COLORS`, `MUSHI_ON_ACCENT`, `MUSHI_INVERSE`, `MUSHI_ACCENT_SHADOW`, `MUSHI_BANNER_BRAND_BORDER`, `MUSHI_REPORTER_STATUS`.
- `resolveWidgetAccent` accent resolver and `safeWidgetHex` CSS-injection-safe hex sanitizer.
- `getReporterToken(projectId?)` is now project-scoped (per-project localStorage key with a one-time migration of the legacy global token). Calling without a `projectId` remains fully backward compatible.
