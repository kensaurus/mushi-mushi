---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/capacitor": minor
---

Page-aware in-SDK assistant, signed end-user identity, and shared design tokens.

- **In-SDK assistant ("Ask" tab):** the web widget gains a knowledge-grounded `Ask` tab backed by `apiClient.askAssistant({ message, threadId, context })`. New `MushiAssistantConfig` / `MushiAssistantStep` / `MushiAssistantReply` types in `@mushi-mushi/core`.
- **Page context:** `publishPageContext()` lets the host publish the current route/title/summary/filters/selection so the assistant and reports are page-aware. New `MushiPageContext` type.
- **Signed identity:** `identifyWithToken({ token })` forwards a host-minted identity JWT on the `X-Mushi-User-Token` header (verified server-side) — the trust anchor for "My Reports", rewards, and the per-user assistant index. Added on web and the Capacitor bridge. `@mushi-mushi/core` exports `buildIdentityClaims`, `parseIdentityToken`, and `MUSHI_IDENTITY_TOKEN_PREFIX`.
- **Design tokens:** `@mushi-mushi/core` now exports `mushiTokens` / `mushiPalette` plus `MUSHI_COLORS_LIGHT`, `MUSHI_COLORS_DARK`, `MUSHI_SPACING`, `MUSHI_RADIUS`, `MUSHI_TYPE`, `MUSHI_Z`, `MUSHI_MOTION`, `MUSHI_GEOMETRY`, and `MUSHI_COPY` so every SDK skins the widget from one source.
