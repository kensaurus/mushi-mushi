---
"@mushi-mushi/cli": patch
---

`mushi recipe init` now reads the whole repo. It lists the files git tracks, as `mushi recipe check` does, instead of stopping after the first 5,000, so token files and Supabase migrations deep in a large repo are found. The design scan covers the workspaces in `package.json` or `pnpm-workspace.yaml` and, for an app at the repo root, folders such as `app/`, `components/` and `lib/`; any folder with an `ARCHIVED.md` is skipped. A token file that a script generates is marked `role: "export"`, with the script that writes it as its `generator`, and is left out of `change.allowPaths`. A workflow that uploads to a store, deploys a site or edge functions, ships an OTA bundle or publishes a package is tagged `deploy` whatever its name. `.env.local.example`, `.env.sample` and `.env.template` count as the env template, as well as `.env.example`.
