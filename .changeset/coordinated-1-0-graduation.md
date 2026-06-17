---
"@mushi-mushi/capacitor": major
"@mushi-mushi/node": major
"@mushi-mushi/vue": major
"@mushi-mushi/svelte": major
"@mushi-mushi/angular": major
---

Graduate capacitor, node, vue, svelte, and angular to v1.0.0 — the coordinated stable release across all platform SDKs.

These packages have been in 0.x "pre-production" labelling despite being widely used in production. The API surface is stable and locked by tests. This major bump signals production-readiness and aligns the full `@mushi-mushi/*` suite on 1.x semver so new teams aren't deterred by 0.x labels.

Breaking changes from 0.x:
- `@mushi-mushi/vue`: `MushiPlugin` no longer requires a second `Mushi.init()` call or separate `@mushi-mushi/web` install — the plugin handles it internally. Remove any explicit `Mushi.init(config)` call when using `MushiPlugin`.
- `@mushi-mushi/svelte`: `initMushi()` no longer requires a second `Mushi.init()` call. Remove explicit `Mushi.init(config)` calls.
- `@mushi-mushi/angular`: `provideMushi()` no longer requires a second `Mushi.init()` call. Remove explicit `Mushi.init(config)` calls.
- `@mushi-mushi/react-native`: `MushiProvider` now also accepts a `config` prop (object shape) as an alias to bare props, and reads env vars when neither is supplied.
- `@mushi-mushi/node`: stable 1.0 API — `MushiNodeClient`, `attachUnhandledHook`, framework adapters. No functional changes from 0.x.
- `@mushi-mushi/capacitor`: stable 1.0 API — `Mushi.configure()` is the canonical init call (not `Mushi.init()`). API key format is now consistently `mushi_*`.
