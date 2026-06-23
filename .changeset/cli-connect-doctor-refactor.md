---
"@mushi-mushi/cli": minor
---

CLI pipeline enhancements and slimmer entry point:

- New `mushi connect` (one-click client/SDK connect), `mushi reset`, `mushi upgrade` (SDK upgrade PR), and `mushi nudge` command groups, plus a refactored `doctor` command module.
- `init`/`project` bootstrap extracted into `project-bootstrap.ts`; `index.ts` reduced to thin command registration (registration order preserved so `mushi --help` is unchanged).
- The `fix` / `fixes (tail|merge|refresh-ci)` commands are unchanged and fully intact.
