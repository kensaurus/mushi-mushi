---
'@mushi-mushi/cli': patch
---

The CLI runs on the Node it claims. Its `commander` dependency had moved to 15, which requires Node ≥22.12, while the CLI (and every Mushi SDK) supports Node ≥20.19 — so `npm install -g mushi-mushi` on Node 20 warned, and with `engine-strict` it failed. Pinned back to commander 14, which supports Node ≥20.
