---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react-native": minor
---

Show the captured screenshot as a visible preview with a configurable
"remove anything sensitive" privacy caption, so reporters can see and consent to
exactly what gets sent.

- **core/types**: new `widget.screenshotSensitiveHint?: boolean | string` config.
  `true` (default) shows the localized caption, a string overrides it verbatim,
  `false` hides the caption (the preview + remove control always remain). Travels
  in the `widget` block of `GET /v1/sdk/config`, so it's settable per-host via the
  SDK and remotely via the Mushi console runtime config.
- **web/widget**: the details step now renders the attached screenshot as an
  `<img>` preview (previously only a "Screenshot attached ✓" label) with an
  optional privacy caption beneath it. The preview stays in sync through the
  annotate/markup flow and clears when the screenshot is removed. Image `src` and
  caption are HTML-escaped. New `en`/`es`/`ja`/`th` strings.
- **react-native**: the bottom sheet's existing screenshot thumbnail gains the
  same configurable privacy caption, resolved by the provider from
  `widget.screenshotSensitiveHint`.

This lets privacy-sensitive hosts (e.g. finance apps) enable screenshot capture
with an explicit user-facing review-and-remove step instead of disabling it
outright.
