---
"@mushi-mushi/cli": patch
---

- **`mushi worker install` on Windows without administrator rights** — the logon task (`schtasks /SC ONLOGON`) answered "Access is denied" and the worker was left with no service. The installer now falls back to a hidden launcher in your Startup folder, starts the worker straight away, and logs to `~/.cache/mushi-work/logs/worker.log`. `mushi worker status` shows it, and `mushi worker revoke` removes it.
- **pnpm repos on a Windows worker** — the worker looked for pnpm only beside `node.exe`, so a global `npm i -g pnpm` was never found and pnpm repos ran with no dependencies (no tests, failing commit hooks). It now also looks on PATH, including a standalone `pnpm.exe`.
- **The worker's stop hint** — on Windows it no longer says `systemctl`.
- **`mushi login` outside an app folder** — run from a folder with no `package.json` or `.git` (your home folder, say) by an account that already has projects, it no longer creates a new project named after the folder. It lists your projects with their `--project-id` instead.
