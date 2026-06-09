---
"@mushi-mushi/server": patch
---

fix(server,admin): three critical feature-board correctness bugs

- `POST /v1/admin/feature-board/:id/comments`: replaced `db().from('auth.users')` query with `c.get('userEmail')` from the Hono auth middleware. PostgREST never exposes the `auth.*` schema so the old query always returned null, storing the caller's UUID as `author_email` on every comment.
- `FeatureBoardPage` (admin): guard `handleShip` against `prompt()` returning `null` when the user clicks Cancel. Previously clicking "✓ Mark shipped" then cancelling the dialog still irreversibly marked the ticket shipped. Empty string (no note) now proceeds; null aborts.
- `apps/admin/src/lib/env.ts`: when `_storedAtLoad.mode === 'cloud'`, short-circuit directly to `CLOUD_SUPABASE_URL`/`CLOUD_SUPABASE_ANON_KEY` before evaluating `VITE_SUPABASE_*` env vars. Without this, a self-hosted `.env` would override an explicit "Use Mushi Cloud" selection made via the BackendModePanel UI.
