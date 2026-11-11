---
"@mushi-mushi/cli": patch
---

`mushi work` installs dependencies on Windows again (pnpm, npm and yarn are `.cmd` shims there, so every install failed and the agent ran without tests). `mushi login` and `mushi whoami` now say when a `MUSHI_API_KEY` in your environment overrides the key you just saved, and how to remove it.
