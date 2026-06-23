---
"@mushi-mushi/cli": patch
---

# v0.22.1 — Post-release SDK reliability fixes

- **CLI keeps your `.env.local`**: `mushi project create` no longer overwrites an existing `.env.local`. It reads the current file, replaces only prior `MUSHI_*` lines (bare and framework-prefixed), and appends a fresh Mushi block — preserving `DATABASE_URL`, `NEXT_PUBLIC_*`, Stripe keys, and everything else. Re-runs are idempotent.
