# Mushi Screenshot Preview & Consent Caption

**Shipped in `@mushi-mushi/core` / `@mushi-mushi/web` 1.19.0 and
`@mushi-mushi/react-native` 0.19.0 (Jun 2026).**

Before this release, screenshot capture could attach an image to a bug report
without showing the reporter what would be sent. Finance and health apps often
disabled screenshots entirely — losing valuable repro context — because there
was no in-flow review step.

The widget now **always renders a visible preview** of the captured screenshot
on the details step, with a **Remove** control and an optional **privacy
caption** reminding reporters to drop anything sensitive before they submit.

## Table of contents

- [Reporter experience](#reporter-experience)
- [Configuration](#configuration)
- [Console (no-rebuild) tuning](#console-no-rebuild-tuning)
- [Backend & runtime config](#backend--runtime-config)
- [Web widget (`@mushi-mushi/web`)](#web-widget-mushi-mushiweb)
- [React Native (`@mushi-mushi/react-native`)](#react-native-mushi-mushireact-native)
- [Host-app integration notes](#host-app-integration-notes)
- [Security](#security)
- [Companion fixes in 1.19.0](#companion-fixes-in-1190)
- [Related docs](#related-docs)

---

## Reporter experience

```mermaid
sequenceDiagram
  participant User
  participant Widget
  participant API

  User->>Widget: Opens report sheet (screenshot mode on-report/auto)
  Widget->>Widget: Capture screen → data URL
  Widget->>User: Show <img> preview + privacy caption + Remove
  alt User removes screenshot
    User->>Widget: Tap Remove
    Widget->>User: Preview cleared; report submits without image
  else User keeps screenshot
    User->>Widget: Optional Mark up (web) → annotate/blur
    User->>Widget: Submit
    Widget->>API: POST report (screenshot blob attached)
  end
```

| Surface | Before 1.19.0 | After 1.19.0 |
| --- | --- | --- |
| Web details step | "Screenshot attached ✓" label only | Full `<img>` preview, caption, Remove |
| React Native sheet | Thumbnail only | Thumbnail + configurable privacy caption |
| Annotate flow (web) | N/A to preview sync | Preview stays in sync through markup overlay |

The preview and Remove control **always show** when a screenshot is attached.
The privacy caption is controlled separately via `screenshotSensitiveHint`.

---

## Configuration

`screenshotSensitiveHint` lives on `MushiWidgetConfig` in `@mushi-mushi/core`:

```typescript
widget: {
  /** @default true — localized default caption under the preview */
  screenshotSensitiveHint?: boolean | string
}
```

| Value | Caption behaviour | Preview + Remove |
| --- | --- | --- |
| `true` or omitted | Localized default (see i18n below) | Always shown when attached |
| `"Custom copy"` | Your string verbatim (≤ 200 chars when set via console) | Always shown when attached |
| `false` | Caption hidden | Always shown when attached |

### SDK init (host app)

```typescript
import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  widget: {
    screenshotSensitiveHint: true, // default — localized caption
    // screenshotSensitiveHint: 'Review before sending — hide account numbers.',
    // screenshotSensitiveHint: false, // preview still shows; caption off
  },
  capture: { screenshot: 'on-report' },
})
```

```tsx
import { MushiProvider } from '@mushi-mushi/react-native'

<MushiProvider
  projectId="proj_xxx"
  apiKey="mushi_xxx"
  config={{
    widget: { screenshotSensitiveHint: true },
    capture: { screenshot: true },
  }}
>
  <App />
</MushiProvider>
```

Screenshot **mode** (`capture.screenshot`: `'on-report' | 'auto' | 'off'`) is
unchanged — this feature only affects what happens **after** a screenshot is
captured. See [CONFIG_REFERENCE — Screenshot mode](./CONFIG_REFERENCE.md).

### Localized default captions (web)

| Locale | Key | Default string |
| --- | --- | --- |
| `en` | `step3.screenshotSensitiveHint` | Check the preview — remove it if any private info (balances, personal details) is visible. |
| `es`, `ja`, `th` | same key | Translated equivalents in `packages/web/src/i18n/*.ts` |

React Native uses a single English default in the provider when no custom string
is supplied; override with a string value or fetch copy from runtime config.

---

## Console (no-rebuild) tuning

**Projects → SDK install card → Screenshot privacy caption**

| UI state | DB column `sdk_screenshot_sensitive_hint` | SDK value |
| --- | --- | --- |
| Caption on, empty custom box | `NULL` | `true` (default copy) |
| Custom text entered | trimmed string (≤ 200 chars) | that string |
| Caption off | `''` (empty string) | `false` |

Changes propagate through `GET /v1/sdk/config` on the next widget poll — no host
rebuild required when `runtimeConfig: true` (default).

Console help: **ConfigHelp** id `sdk-install.screenshot_sensitive_hint` in
`apps/admin/src/lib/configDocs.ts`.

---

## Backend & runtime config

### Database

Migration: `packages/server/supabase/migrations/20260619100000_sdk_screenshot_sensitive_hint.sql`

```sql
-- project_settings.sdk_screenshot_sensitive_hint text
--   NULL  → SDK default caption
--   ''    → hide caption (maps to screenshotSensitiveHint: false)
--   other → custom caption (≤ 200 chars, check constraint)
```

The column is included in `touch_project_settings_sdk_config_updated_at()` so
direct SQL edits bump `sdk_config_updated_at`.

### API routes

| Route | Auth | Role |
| --- | --- | --- |
| `GET /v1/sdk/config` | `apiKeyAuth` | Emits `widget.screenshotSensitiveHint` in normalized config |
| `PUT /v1/admin/projects/:id/sdk-config` | `jwtAuth` | Persists via `coerceSdkConfigUpdate()` in `api/helpers.ts` |

**Coercion (write path):**

```text
true  → NULL   (use SDK default)
false → ''     (hide caption)
string → trim, max 200 chars; empty → NULL
null  → NULL   (clear override)
```

**Normalization (read path):**

```text
NULL   → omit key (SDK default)
''     → false
other  → custom string
```

Implementation: `normalizeSdkConfig()` / `coerceSdkConfigUpdate()` in
`packages/server/supabase/functions/api/helpers.ts` (admin PUT + shared types);
public `GET /v1/sdk/config` in `api/routes/public.ts` mirrors the same emit
logic.

Web SDK merges runtime widget keys wholesale in `mergeRuntimeConfig()` —
no extra mapping required for new widget fields.

---

## Web widget (`@mushi-mushi/web`)

| File | Responsibility |
| --- | --- |
| `packages/web/src/widget.ts` | `setScreenshotPreview()`, `resolveScreenshotHint()`, renders preview on step 3 |
| `packages/web/src/widget-render.ts` | HTML-escapes preview `src` and caption text |
| `packages/web/src/mushi.ts` | Feeds captured data URL into widget; syncs through annotate overlay |
| `packages/web/src/i18n/*.ts` | Default caption strings (`en`, `es`, `ja`, `th`) |

Unit tests: `packages/web/src/widget.test.ts` — preview visibility, caption
on/off, custom string override.

Works alongside existing privacy controls:

- `privacy.allowUserRemoveScreenshot` — Remove button (default on)
- Screenshot annotation ("Mark up") — preview updates after blur/highlight

---

## React Native (`@mushi-mushi/react-native`)

| File | Responsibility |
| --- | --- |
| `packages/react-native/src/provider.tsx` | `resolveScreenshotHint()` from `config.widget.screenshotSensitiveHint` |
| `packages/react-native/src/components/MushiBottomSheet.tsx` | Renders caption under thumbnail |

Requires optional peer `react-native-view-shot` for capture. The SDK captures
**before** the bottom sheet overlays the screen; the user reviews the thumbnail
and can remove it before submit.

---

## Host-app integration notes

### Finance / PII-heavy apps (yen-yen pattern)

You no longer need `capture: { screenshot: false }` globally just to avoid
silent attachment. Recommended posture:

1. Keep `capture.screenshot: true` (or `'on-report'` on web).
2. Leave `screenshotSensitiveHint: true` (or customize compliance copy via console).
3. Optionally disable capture on specific routes/screens with dynamic config.
4. For Metro/Hermes hosts, keep `scripts/patch-mushi.mjs` (or equivalent) so
   `react-native-view-shot` resolves — see yen-yen `apps/mobile/lib/mushi.ts`.

**Reference host:** `kensaurus/yen-yen` — `@mushi-mushi/core@1.19.0`,
`@mushi-mushi/react-native@0.19.0`, neon feedback band + manual trigger,
screenshot enabled with user review gate.

### Capacitor / static export

Runtime config from `GET /v1/sdk/config` applies the console caption without
rebuilding the native shell. Ensure `NEXT_PUBLIC_MUSHI_*` vars are baked at
compile time; caption copy can still change server-side.

---

## Security

| Risk | Mitigation |
| --- | --- |
| XSS via screenshot data URL | Preview `src` escaped in render path |
| XSS via custom caption | Console PUT trims + widget escapes caption HTML |
| XSS via i18n interpolation | `aria-label`, `placeholder`, header eyebrow use `escapeHtml` on locale strings (1.19.0 hardening) |
| PII in screenshot at rest | Reporter can Remove before submit; optional `privacy.maskSelectors` / annotation blur on web |

Custom console captions are capped at **200 characters** at the DB layer.

---

## Companion fixes in 1.19.0

Shipped in the same release line (see package CHANGELOGs):

| Area | Fix |
| --- | --- |
| `@mushi-mushi/core` offline queue | Transient IndexedDB persist failures no longer re-flush forever past `MAX_DELIVERY_ATTEMPTS` |
| `@mushi-mushi/web` widget | Back to category step collapses expanded "more issue types" list |
| `@mushi-mushi/web` widget-render | Locale strings in `aria-label` / placeholders routed through `escapeHtml` |

---

## Related docs

- [CONFIG_REFERENCE — Screenshot privacy caption](./CONFIG_REFERENCE.md) (generated from `configDocs.ts`)
- [`@mushi-mushi/web` README](../packages/web/README.md) — bundle budget + feature list
- [`@mushi-mushi/react-native` README](../packages/react-native/README.md) — view-shot setup
- [Public docs — web SDK](https://docs.mushimushi.dev/sdks/web) · [React Native SDK](https://docs.mushimushi.dev/sdks/react-native)
- [Next.js App Router + CSP](./apps/docs/content/sdks/nextjs-app-router-csp.mdx) — keep `img-src data:` when previews are enabled
