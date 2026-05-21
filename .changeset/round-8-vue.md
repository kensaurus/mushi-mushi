---
'@mushi-mushi/vue': minor
---

API-surface and SSR hardening.

- `MushiConfig` is now re-exported from `@mushi-mushi/core` instead of
  redefined locally. The local definition was masking new fields
  (`preFilter`, `redactionRules`, `transport`, `releaseChannel`, etc.)
  that the core SDK has shipped since the original Vue plugin landed.
- `install` now skips entirely on the server (`isBrowser()` guard) so
  Nuxt SSR doesn't crash trying to `Mushi.init(window)`.
- `app.config.errorHandler` is now **chained** with the existing handler
  instead of replacing it. Apps wired to Sentry / Bugsnag /
  custom logging keep their existing handler firing first.
