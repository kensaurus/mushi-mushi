---
'mushi-mushi': minor
'create-mushi-mushi': minor
---

`npx mushi-mushi` and `npm create mushi-mushi` now share one arg parser and say plainly what they do.

- Arg parsing, the Node-version guard, and the flags help are consolidated into `@mushi-mushi/cli/wizard-args` — the two entry points can no longer drift apart.
- Minimum Node version is now 20 for both (create-mushi-mushi previously allowed 18, below what the wizard actually needs).
- Help text states up front that the wizard **adds Mushi to an existing project** — it does not scaffold a new app.
