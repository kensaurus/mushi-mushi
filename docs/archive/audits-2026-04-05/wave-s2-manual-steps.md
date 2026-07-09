# Wave S2 — Manual Supabase Dashboard Steps

Some hardening toggles from the 2026-04-21 audit aren't configurable from a
SQL migration. This file tracks the one-time clicks an operator must make in
the Supabase dashboard for each project (cloud + self-hosted instances).

## Auth → Providers → Email

1. **Leaked password protection.** Enable the `Check passwords against the
   HIBP (Have I Been Pwned) database` toggle. Rejects signups where the
   candidate password appears in the breach corpus.
2. **Minimum password length.** Set to **12 characters** (NIST 2026 updated
   guidance moved from 8 → 12 for human-chosen passwords).

## Auth → Providers → Settings

1. **Enable MFA.** Flip `Enable multi-factor authentication` on.
2. **Factor types.** Enable `TOTP` and `Phone (SMS)`. WebAuthn is a future
   follow-up once the admin UI surfaces a passkey enrolment flow.
3. **Force MFA for admin users.** Uses a Postgres hook:
   - Go to Database → Functions, create `require_mfa_for_admins()` if not
     already present. Supabase's docs:
     https://supabase.com/docs/guides/auth/auth-mfa/totp
   - Wire it under Auth → Hooks → Custom Access Token Hook.

## Storage → Settings

1. **CORS allowlist.** Remove `*` from the storage buckets used by the widget
   (`report-screenshots`, `report-replays`). Replace with the admin app
   origin + any self-hosted dashboards.

## Database → Extensions

No manual steps; the `extensions` schema relocation is automated in
`20260418005800_extensions_out_of_public.sql`. `pg_net` stays in `public`
because Supabase's build rejects `ALTER EXTENSION pg_net SET SCHEMA`.

## Verification checklist

After applying the above, run the advisors:

```bash
supabase db lint
```

The following warnings should disappear:

- `auth.leaked_password_protection_disabled`
- `auth.insufficient_mfa_options`
- `storage.public_bucket_permissive_cors`

Any remaining advisory warnings are expected (the audit logs them
individually).
