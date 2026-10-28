---
'@mushi-mushi/ux': minor
---

`mushi-ux fresh-eyes` tries one goal as a first-time visitor: signed out, from your landing page, with a model that reads only what is on screen. It times what the app makes the visitor wait plus reading time (never the model's own thinking) until a goal check passes, and records where each session stalled: a sign-in it cannot pass, a captcha, a dead end, an error, or a step that needs an inbox, an API key, a terminal or another account. Measured problems are filed once a replay without the model shows them again; opinions only when two sessions agree. Writes reach only your app's own origins; payments, third-party sign-in and public sign-up endpoints are refused, and `--dry-run` writes nothing. `--terminal` runs a CLI setup step itself, `--sync` mirrors the run to the console, and `timeline.md` keeps every step with its screenshot.

The write guard gains a `writes: 'same-origin'` mode (the default stays read-only), and every mode now refuses navigations to payment and third-party sign-in pages.
