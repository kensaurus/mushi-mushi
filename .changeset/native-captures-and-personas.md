---
"@mushi-mushi/ux": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": minor
---

Phone apps get the same UX scorecard as web pages, and first-time user tests can play a persona (ADR 0073).

- `mushi-ux upload <dir> --platform android|ios|…` sends the screenshots any driver made (a Maestro flow, `adb exec-out screencap`, `xcrun simctl io booted screenshot`, an SDK debug build) and scores each screen on the written rubric. It reads an Android `uiautomator` dump or a `maestro hierarchy` next to a screenshot for the screen's words and buttons. Templates are in `docs/templates/ux-native/`.
- `mushi-ux fresh-eyes` plays the persona a queued test carries: its device (viewport, touch), language, 150% zoom for low vision, reduced motion, and its patience as the step cap. The local worker forwards the persona (it now says it can, `fresh_eyes_persona`).
- `--mint-account` sends the app it is for; the server makes accounts in Mushi's own sign-in only for an app that opted in.
- New MCP tools: `upload_ux_captures`, `list_personas` and `start_fresh_eyes`.
