---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
"@mushi-mushi/mcp": patch
---

Self-hosting is easier to follow and to check:

- `mushi selfhost doctor` exits 0 on a healthy minimal install. Optional extras that are not set up (Langfuse, Sentry, an AI key, a console address) print as `INFO` and never change the exit code; `WARN` exits 2 and `FAIL` exits 1 as before.
- The doctor now also checks that the console answers at the saved address (and warns when the CLI would sign you in on Mushi Mushi Cloud instead), that `/health` reports a stamped, self-hosted deploy, and, on the server, the AI key, that cron jobs no longer call Mushi Mushi Cloud, and that the private screenshots bucket exists. Lines lead with a plain name and the app's name, never `codebase_index:<uuid>`. `--console-url` checks another address.
- `mushi selfhost up` stamps the deploy with your commit (using the clone's own `scripts/deploy-edge-function.mjs` helper), so `/health` no longer reports `"dev"`, and sets `MUSHI_INSTANCE_MODE=self-hosted` so the server and console agree on what the instance is.
- With `--console-url`, `up` also sets `MUSHI_ADMIN_ORIGIN_ALLOWLIST` to the console's origin, so the API answers a console served on your own domain (before, only Mushi Mushi Cloud and localhost dev ports were allowed). The server now sends `mushi login` to that console (`ADMIN_BASE_URL`) on a self-host, instead of Mushi Mushi Cloud's.
- The no-key note points at Settings → AI keys (it said API Keys).
- The MCP docs index includes the new self-hosting pages (Environment variables, Operate and upgrade).
