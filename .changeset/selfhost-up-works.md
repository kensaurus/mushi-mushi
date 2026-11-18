---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
---

`mushi selfhost up` now deploys a working self-hosted instance:

- Cron jobs call your project, not Mushi Mushi Cloud. `up` writes `supabase_url`, `service_role_key` and `internal_caller_token` into `mushi_runtime_config`, using the same secret it sets as `MUSHI_INTERNAL_CALLER_SECRET`. Before this, the migrations' Mushi Mushi Cloud URL stayed in place and no token was written.
- Works with Supabase CLI 3.x. `db push` and `db query` target the linked project (`--remote`; `--linked` on 2.x), and `up` asks once for consent (or takes `--yes`), so the CLI's own consent prompts don't fail when output is piped.
- No Mushi Mushi Cloud plan limits on your instance. `up` updates every `pricing_plans` row on your project: unlimited diagnoses, apps and seats, retention of at least 3650 days, and the `byok`, `sso`, `plugins`, `intelligence_reports`, `audit_log`, `self_hosted` and `teams` feature flags on. Before, a new org stopped at 100 diagnoses a month (reports went to `quota_exceeded`), with 1 app and 14-day retention. `inventory_v2` and `soc2` are left as the plan has them, because they start background jobs.
- `up` refuses to run against the Mushi Mushi Cloud project, including a checkout already linked to it.
- The broken `supabase storage create` step is gone, along with the "fine if it already exists" message that hid its failure. The private `screenshots` bucket is checked with SQL.
- Every edge function is deployed, with `verify_jwt` taken from `config.toml` as in production. Before, only six were deployed.
- The LLM key is optional. Pass `--anthropic-key` or `--openai-key` (either provider works), set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or paste one at the prompt. If you skip it, `up` says what won't work.
- Secrets go through 0600 temp files, never argv. `MUSHI_INTERNAL_CALLER_SECRET` from your shell is reused.
- `--console-url` sets `ADMIN_BASE_URL` and saves the console URL to the CLI config, so `mushi login` signs in on your console instead of Mushi Mushi Cloud. The endpoint is saved too, unless the config holds a key for another endpoint.
- The `/v1/admin/bootstrap` call was removed. It always returned 401.
- New command: `mushi selfhost secrets` writes a `.env` for `deploy/docker-compose.yml`. It contains a random Postgres password, JWT secret and internal caller secret, plus anon and service_role JWTs signed with the JWT secret.
