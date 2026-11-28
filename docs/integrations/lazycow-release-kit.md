# Release kit → lazycow product video: the hand-off contract

Plan 025 P5, [ADR 0074](../adr/0074-security-proof-release-kits-and-store-media.md).
Mushi builds the kit; lazycow renders the video in its own repo, on the
founder's machine, under the founder's Remotion licence. Mushi never renders
video.

**The contract is lazycow's `lazycow.release-kit`, version 1.** Its source of
truth is in lazycow-studio: `docs/product-kit.schema.json` (JSON Schema),
`src/release-kit.ts` (the TypeScript type) and `docs/product-kit.md` (prose and
limits). Mushi keeps verbatim copies:

- `packages/server/supabase/functions/_shared/lazycow-release-kit.ts` (the type)
- `packages/server/src/__tests__/fixtures/lazycow-release-kit.schema.json` (the
  schema; `release-kit.test.ts` validates every exported manifest shape
  against it)

Change it in lazycow first, then copy both files here again.

## 1. Mushi exports the kit

- MCP `export_release_kit({ releaseId, projectId? })` (scope `mcp:write`), or
  `POST /v1/admin/projects/:projectId/releases/:releaseId/kit/export`
  (console JWT or an `mcp:write` key).
- Returns `{ kitUrl, expiresAt, preset, manifest }`. `kitUrl` is a signed
  https link to `manifest.json`, valid 24 hours. `preset` is lazycow's name
  for the kit's preset. An empty kit (no ready screenshot or recording) is a
  422 `KIT_EMPTY`.

## 2. lazycow renders

```text
make_product_video({ kitUrl, preset, name? })  →  job id;  job_status → the file when done
```

| Mushi kit preset | lazycow preset | Output |
|---|---|---|
| `app_store_preview` | `appstore-iphone` | 886×1920, 15–30 s, ≤ 30 fps |
| `play_promo` | `play-promo` | 1920×1080 (for YouTube, then Play's promo URL) |
| `social_vertical` | `social-9x16` | 1080×1920 |
| `social_square` | `social-1x1` | 1080×1080 |

lazycow also has `appstore-iphone-55` (1080×1920) and `appstore-ipad`
(1200×1600); pass one of those by hand for those devices.

App Store presets show only full-screen app captures (App Review Guideline
2.3.4): no device frame and no "before" screen. For them the kit's `after`
screens and recordings matter; `before` feeds the social and Play cuts.

## What Mushi puts in the manifest

| lazycow field | From |
|---|---|
| `schema`, `version` | `"lazycow.release-kit"`, `1` |
| `app.name`, `app.stores` | the project name (≤ 60); `app-store` / `google-play` for each store connector bound to the app |
| `release` | `version` (≤ 24), `date` (published day), `title` (≤ 80) |
| `brand.colors` | `primary` and `accent` from the widget accent (`sdk_widget_accent`); `background` / `text` from the widget theme when it is light or dark; kit overrides win |
| `brand.logo` | the kit's https logo URL, when set |
| `screens[]` (≤ 24) | one per "after" screenshot, paired with its "before" by surface and viewport. `id` from the surface (unique, `^[a-z0-9][a-z0-9-]{0,39}$`), `surface` a short name from the path (`/` → Home), `viewport` from the measured image size (scaled into 100–8000) with `device` from its shape and `platform` |
| `recordings[]` (≤ 8) | Playwright clips (WebM) and device recordings; never the rendered product video |
| `changelog[]` (≤ 30 × 140) | the kit's changelog lines |
| `expiresAt` | when every signed link stops working |
| `source` | `{ name: "Mushi Mushi" }` |

**Every asset is `{ url, type, bytes, sha256 }` with its own absolute signed
https URL.** A relative URL would not inherit the manifest link's signature.
lazycow checks `bytes` and `sha256` after download.

Mushi's own fields ride along under `mushi` (lazycow ignores unknown fields):
`kitId`, `release` (with `commitSha`), the preset's output spec, per-asset
store checks, the release's Security proof (`{ state, headline }`; a video may
say "Security proof" only when `state === "proven"`, ADR 0074), and
`handoff: { tool: "make_product_video", args: { kitUrl, preset }, returnTo }`.

## 3. lazycow hands the file back

1. `POST {MUSHI_API_ENDPOINT}{mushi.handoff.returnTo}` (that is
   `/v1/admin/projects/:projectId/releases/:releaseId/kit/uploads`) with an
   `mcp:write` key and
   `{ files: [{ name, kind: "product_video", mime: "video/mp4", bytes, source: "lazycow", durationMs, fps, codec: "h264", width, height, label: preset }] }`.
2. `PUT` the file to the returned `signedUrl` with `Content-Type: video/mp4`.
3. `POST …/kit/assets/:assetId/finalize` with `{ sha256 }`.

The file is then on the kit with the App Store preview checks shown, and can
go to the App Store through an approved `upload_app_preview` request
(`request_store_media_upload`). For Google Play, lazycow publishes to YouTube
(`publish_reel`, approval first) and the founder asks for `set_promo_video`
with that URL.

## Limits

- At most 12 videos per kit. A clip or device recording is at most the app's
  `release_kit_clip_max_mb` (default 25 MB); the rendered product video at most 100 MB.
- Social posting stays in lazycow, approval first. Mushi never posts.
