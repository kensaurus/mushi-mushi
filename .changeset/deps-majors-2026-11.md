---
'@mushi-mushi/mcp': patch
'@mushi-mushi/cli': patch
'@mushi-mushi/ux': patch
'@mushi-mushi/react-native': patch
---

Dependency updates. `@mushi-mushi/mcp` now accepts `@sentry/node` 10 or 11 as its optional peer. On 11 it sends the same data as before: no user info, cookies, headers, request bodies or tool inputs and outputs. `@mushi-mushi/ux` moves to `@anthropic-ai/sdk` 1.x, and `@mushi-mushi/cli` to `@napi-rs/keyring` 2. `@mushi-mushi/react-native` builds and type-checks against React Native 0.88; its floating button no longer casts its animated style. The Svelte and Vue starter templates now use Vite 8 and TypeScript 6.
