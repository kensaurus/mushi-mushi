---
'@mushi-mushi/web': minor
---

Improve `screenshot` and `element selector` capture UX in the floating
widget.

**Screenshot capture** — the widget now distinguishes between
"capturing in progress", "capture cancelled by user (no error)", and
"capture failed (error)". Previously a cancelled `getDisplayMedia`
picker (the user closing the OS screen-picker dialog) was silently
treated identically to a capture failure, leaving the widget stuck in
an ambiguous state. New states surface via three new widget setters
(`setScreenshotCapturing`, `setScreenshotAttached`,
`setScreenshotError`).

**Element selector** — the widget now hides itself while the element
selector is active and re-shows after selection (or cancel), so the
panel can no longer occlude the element the user is trying to click.
A `setElementCapturing` indicator surfaces the active state on
re-show.

**Example starter chips** — the report panel now shows three
contextual "starter" chips above the textarea (e.g. "Layout looks
broken on this card", "I clicked X and nothing happened", "The error
message wasn't helpful") to reduce first-report activation energy.
Tapping a chip pre-fills the description for the user to refine.

**New `--mushi-ok` CSS custom property** for the success-tone affordance
on the screenshot-attached pill.

All changes are additive on the public widget surface; existing
embedders see no behavioural difference unless they explicitly opt in
to the new starter chips via the upcoming `examples` config option
(default off).
