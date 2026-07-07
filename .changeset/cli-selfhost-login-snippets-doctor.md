---
'@mushi-mushi/cli': minor
---

One-command self-hosting, verified snippet insertion, and a doctor that tells you how to fix what it finds.

- New `mushi selfhost up` wraps the entire self-hosted bootstrap: link → `db push` → secrets → deploy the required edge functions → create the `screenshots` bucket → apply the pg_cron prerequisite SQL → seed the internal caller token → idempotent `/v1/admin/bootstrap` → **proof step** (health check + a classified test report). `mushi selfhost doctor` re-runs the same steps as checks. When the Supabase CLI is missing or the shell is non-TTY, it degrades to printing the exact commands instead of failing. (Also fixes a would-be footgun: `pipeline-recovery` is a SQL function driven by pg_cron, not an edge function — it is no longer in the function deploy list.)
- New verified snippet insertion: the wizard can inject the init snippet into your detected entry file inside idempotent `// <mushi-mushi:init>` marker blocks (always prompt-before-write; declining keeps the printed snippet and adds a doctor check that greps for the import so setup state stays verifiable).
- `mushi login` device-auth flow is now fully tested and no longer `process.exit`s from inside the poll loop; `setup` auto-runs login when credentials are missing, and on `INSUFFICIENT_SCOPE` offers to re-login with upgraded scope, rewrite `mcp.json`, and re-probe — without leaving the command.
- `mushi doctor` upgrades: fix hints now survive `--json` output, exit codes are 0/pass 1/fail 2/warn, a version-drift check compares the CLI against npm latest and the `@mushi-mushi/*` versions in your repo, and results from the new server-side `GET /v1/admin/doctor` (cron health, stranded reports, index errors, internal-token presence) are folded in.
