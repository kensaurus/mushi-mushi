---
"@mushi-mushi/cli": minor
---

CLI DX uplift (Phase 4):

- **`mushi upgrade --self`** — upgrade the globally-installed CLI itself (detects npm/pnpm/yarn/bun install method, semver-guarded, registry cooldown).
- **Multi-profile credentials** — `mushi profile list|current|use`, plus a global `--profile <name>` flag and `MUSHI_PROFILE` env var. Legacy single-profile config files keep the flat format until the first profile-scoped write, then upgrade transparently (all profiles preserved).
- **Global `-o, --output <text|json>`** — uniform machine-readable output across commands (wired into `reports list`, `keys list`, `profile list`; per-command `--json` still works).
- **Shell-completion install docs** (`docs/SHELL_COMPLETION.md`) and a **composite GitHub Action** (`action.yml`) wrapping `mushi sourcemaps upload`.
