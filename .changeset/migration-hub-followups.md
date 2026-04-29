---
'@mushi-mushi/cli': patch
---

fix(migration-hub): tighten cross-device checklist sync follow-ups

Two real bugs reported against Migration Hub Phase 2:

1. **Premature `'synced'` state after sign-in / auth-change** — both the
   `signIn().then` handler and the `mushi:docs:auth-change` event listener
   in `apps/docs/components/MigrationChecklist.tsx` jumped straight to
   `{ status: 'synced', lastSyncedAt: Date.now() }` the moment a session
   appeared, before the initial fetch + merge + push round-trip had run.
   The footer briefly displayed "Synced just now" with a fictitious
   timestamp, then flickered to "Syncing…" once the effect promoted state
   correctly. Both call sites now land on `'syncing'` with
   `lastSyncedAt: null`, mirroring the initial-state branch that already
   handled returning users correctly. The `useEffect([state.session])`
   initial-fetch effect owns the `'syncing' → 'synced'` promotion after
   the real round-trip.

2. **Infinite `refreshSession` loop in `DocsBridgePage`** — the bridge
   page's "keep the token fresh" effect called
   `supabase.auth.refreshSession()` on every `[session]` change. The
   refresh emits `TOKEN_REFRESHED`, which `useAuth()` translates into a
   new session object, which re-fires the effect. In the happy path the
   popup auto-closes after 500ms (limiting damage to ~2–3 wasted
   `/token` calls), but in error states (`missing_opener`,
   `invalid_origin`, `no_nonce`, `no_session`) the popup stayed open and
   the loop ran indefinitely against Supabase's auth endpoint. Pinned to
   at most one refresh per popup mount via a ref guard, and only fired
   when the access token is within a 5-minute expiry window.

Plus the four Copilot follow-ups left from PR #72:

- `apps/admin/src/pages/DocsBridgePage.tsx` — `ALLOWED_DOCS_ORIGINS` is
  now env-extendable via `VITE_DOCS_ORIGIN_ALLOWLIST`, mirroring the
  server's `MUSHI_DOCS_ORIGIN_ALLOWLIST`. Operators can no longer wire a
  new docs host into the API allowlist and have the bridge silently
  reject it with `invalid_origin`.
- `apps/docs/content/migrations/index.mdx` — the "run `npx mushi-mushi
  migrate`" callout pointed at a command the launcher silently ignores
  (the launcher only knows `init`). Updated to
  `npx @mushi-mushi/cli migrate` (or `mushi migrate` if installed
  globally), with a sentence clarifying which package owns each command.
- `apps/admin/src/lib/configDocs.ts` — fixed a `/docs/migrations/...`
  reference in the SDK install reference card; the canonical Migration
  Hub URL is `https://docs.mushimushi.dev/migrations/<slug>` (no `/docs`
  prefix).
- `apps/docs/content/migrations/mushi-sdk-upgrade.mdx` — corrected a
  `blob/main/...` GitHub link to `blob/master/...` so the SDK changelog
  link doesn't 404 (the repo's default branch is `master`).
