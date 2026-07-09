# Security audit — 2026-04-23

**Scope**: Mushi Mushi monorepo, focus on edge-function auth, secret hygiene, HMAC verification, session/CORS.
**Prior baseline**: `docs/audit-2026-04-21/audit-security.md` (Wave R found `fast-filter` / `classify-report` / `fix-worker` had unauth paths; all three since closed via `requireServiceRoleAuth`).

## Findings table

| # | Severity | Area | Finding | Evidence |
|---|---|---|---|---|
| S1 | **P1** | Edge auth | Unauthenticated admin requests crash → 500 instead of 401 | `GET /v1/admin/dashboard` with no/invalid bearer returns `{"error":"internal"}` 500 in < 550 ms; `sb-error-code: EDGE_FUNCTION_ERROR` |
| S2 | **P1** | Cron auth | `recover_stranded_pipeline` calls `fast-filter` without `Authorization` header → would 401 under load | `20260418005900_pipeline_recovery_cron.sql:104-108`; `requireServiceRoleAuth` rejects unsigned calls |
| S3 | P0 (ops) | Cron auth | `app.settings.service_role_key` GUC unset → six crons emit `Authorization: Bearer null` and fail at `http_request_queue.url NOT NULL` | See `audit-db-schema.md` |
| S4 | P2 | Secret hygiene | Root `.env` contains live `STRIPE_SECRET_KEY` (sk_live…), `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` | `.env` is gitignored (`git check-ignore .env` confirms) — NOT in git — but operator-local secrets would leak if machine compromised. 1Password recommended |
| S5 | P2 | Auth policy | Leaked-password protection disabled on Supabase Auth | `get_advisors(security)` — `auth_leaked_password_protection` |
| S6 | P2 | Auth policy | Only 1 MFA method available | `get_advisors(security)` — `auth_insufficient_mfa_options` |
| S7 | P3 | Extension placement | `pg_net` in `public` schema | `get_advisors(security)` — `extension_in_public` |
| S8 | P3 | Sentry capture gap | 500s from S1 aren't appearing in Sentry `mushi-mushi-server` (0 issues last 7 d) | `search_issues` MCP query, corroborated by logs showing 500s |
| S9 | INFO | HMAC signatures | `webhooks-github-indexer` verifies `X-Hub-Signature-256`; `stripe-webhooks` verifies `Stripe-Signature` | Greppable in `packages/server/supabase/functions/*/index.ts` |
| S10 | INFO | CORS | Split CORS policy correctly configured (`/v1/reports/*` = `*`, `/v1/admin/*` = allowlist) | `packages/server/supabase/functions/api/index.ts:101-158` |

## P1 detail — S1: unauthenticated 500 storm

**Repro**:
```
curl -s -X POST "https://<proj>.supabase.co/functions/v1/api/v1/admin/fixes/dispatch" \
  -H "Content-Type: application/json" -d '{}'
# → HTTP/1.1 500 Internal Server Error
# → body: {"error":"internal"}
# → sb-error-code: EDGE_FUNCTION_ERROR
```

**Why it matters**:
1. Every unauthenticated probe (scanner, ops check, expired session) consumes a function invocation AND logs a 500.
2. Legit 401s can't be distinguished from real 500s in dashboards / alerting.
3. `jwtAuth`'s downstream call to `db.auth.getUser()` is hitting the GoTrue server even on clearly-invalid tokens → wasted auth bandwidth.
4. `sentryHonoErrorHandler` catches the throw and reports `{error: 'internal'}` — but the Sentry transport silently drops the event (0 issues for 7 d). Either DSN is missing on the deployed function OR the rate-limit filter is swallowing it.

**Fix shape** (Phase 2):
```ts
export async function jwtAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'MISSING_AUTH', ... } }, 401)
  }
  const token = authHeader.slice(7)
  try {
    const { data: { user }, error } = await getServiceClient().auth.getUser(token)
    if (error || !user) return c.json({ error: { code: 'INVALID_TOKEN', ... } }, 401)
    c.set('userId', user.id); c.set('userEmail', user.email); c.set('authMethod', 'jwt')
    await next()
  } catch (err) {
    // db.auth.getUser throws on malformed JWT / auth server outage; don't leak as 500
    return c.json({ error: { code: 'INVALID_TOKEN', message: 'Auth check failed' } }, 401)
  }
}
```

## P1 detail — S2: cron caller auth gap

`recover_stranded_pipeline()` ships without an `Authorization` header when re-invoking `fast-filter` via pg_net. It works today only because there are zero stranded reports for the cron to find. The moment LLM providers have a bad minute and fast-filter stages drop back to `new`/`queued`, the recovery cron will fire 25 × `401`s per run forever, and reports stay stranded.

**Fix shape**:
```sql
SELECT value INTO v_internal_token FROM public.mushi_runtime_config WHERE key = 'internal_caller_token';
PERFORM net.http_post(
  url     := v_url || '/functions/v1/fast-filter',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || v_internal_token
  ),
  body    := ...
);
```

## Secret scanning

Ran `git ls-files | xargs rg -n "sk_live|AKIA[0-9A-Z]{16}|sntryu_|sk-ant-api|ghp_" --no-messages` across the tracked tree:

- Zero matches in tracked files. Secrets only live in `.env` / `.env.local` / `apps/admin/.env` — all in `.gitignore`.
- `pnpm check:secrets` (`scripts/check-no-secrets.mjs`) passes on CI today.

`.env` does carry live `sk_live_…` Stripe key; recommend rotating to `sk_test_…` for local dev and storing the live key only in Supabase's project secrets + 1Password.

## HMAC / signature checks

| Endpoint | Verifies | File |
|---|---|---|
| `POST /v1/webhooks/github` | `X-Hub-Signature-256` (HMAC-SHA256) | `functions/webhooks-github-indexer/index.ts` |
| `POST /v1/webhooks/stripe` | `Stripe-Signature` (v1=timestamp.payload) | `functions/stripe-webhooks/index.ts` |
| `POST /v1/webhooks/sentry` | `Sentry-Hook-Signature` | `functions/webhooks-sentry/index.ts` |

All three are wired; spot-checked for constant-time compare. OK.

## Sentry 401/403/CSRF/CSP last 30 d

`search_issues` on project `mushi-mushi-server` — 0 issues. On `mushi-mushi-admin` — 0 issues.

Either (a) the product is genuinely clean, (b) the Sentry DSN is missing in deployed-function secrets, or (c) the admin SPA has `SENTRY_SUPPRESSED=1`. Combined with the observation that unauthenticated 500s also don't surface, **(b) is the most likely explanation** — add `SENTRY_DSN_SERVER` as a Supabase function secret via `supabase secrets set` in Phase 2.

## Recommendations (Phase 2)

1. Patch `jwtAuth` try/catch (S1). Add integration test that hits `/v1/admin/dashboard` without a token and expects 401.
2. Extend `mushi_runtime_config` with `internal_caller_token`; rewrite all six cron `http_post` bodies (S2, S3).
3. Verify `SENTRY_DSN_SERVER` deployed to functions; log a startup breadcrumb so future audits can confirm.
4. Flip Supabase Auth: enable leaked-password check + add TOTP + WebAuthn as MFA methods (S5, S6).
5. Move `pg_net` to `extensions` schema (S7) — needs migration + schema-qualify every `net.http_post` call.
