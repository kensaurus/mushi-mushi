---
'@mushi-mushi/mcp': minor
'@mushi-mushi/cli': minor
---

New installs get the `vibe` tool set: about a dozen tools for the core loop of report, plain-English diagnosis and fix context. The one-click configs in `@mushi-mushi/mcp/clients` (the console and docs buttons) now write `?features=vibe` or `MUSHI_FEATURES=vibe` explicitly, and the keyless OAuth installs carry `?features=vibe` too. The Claude Code command now quotes the URL, because zsh globs an unquoted `?`. `mushi setup --ide` writes `MUSHI_FEATURES=vibe`. Add `fixes` (`vibe,fixes`) to dispatch fixes to cloud agents, or use `all` for every tool. Configs you already have are untouched, and the hosted server's default for a URL with no `?features=` is unchanged. New export: `NEW_INSTALL_FEATURES`.
