---
"@mushi-mushi/web": minor
"@mushi-mushi/core": minor
---

The report panel is now graphical (ADR 0070). Reporters pick what the report is about from six colour-coded tiles with icons (Bug, Slow, Looks wrong, Confusing, Idea, Other), and the picked type tints the panel header and sets a matching prompt in the text box ("What did you do, and what happened?" for a bug). The length check is a small ring under the text box that counts down; Send is never greyed out, and pressing it too early turns the ring red and puts the cursor back in the text box. Screenshot and "point at it" are icon buttons, and an attached screenshot shows as a thumbnail. The beta notice is a "Beta" chip in the header that opens on tap, the privacy note is one line with a lock, and the success view draws a check with "Got it" and the reply-time chip. The panel edge is darker by default so a light panel stays visible on a light page (WCAG 1.4.11); `--mushi-border` still overrides it.

`@mushi-mushi/core` adds `MUSHI_REPORT_TYPE_COLORS` and `MUSHI_REPORT_TYPE_WASH`, the tile colours for light and dark mode (every pair is tested for WCAG AA). The web bundle budget goes from 89.8 KB to 94 KB gzipped: the tiles' CSS, the icons and the per-type prompts in five languages add 4.1 KB.

New optional locale keys (`panel.privacyShort`, `typeQuestion`, `prompts`, `charsLeft`, `ready`, `delivered`); a custom locale without them falls back to English. The Japanese panel title is now 「フィードバック」, short enough for one line.
