---
"@mushi-mushi/cli": patch
---

fix(cli): `mushi project create` no longer overwrites an existing `.env.local`. The project-bootstrap writer now reads the current file, strips only prior `MUSHI_*` lines (bare and framework-prefixed), and appends a fresh Mushi block — preserving every other variable (`DATABASE_URL`, `NEXT_PUBLIC_*`, Stripe keys, …). Running it again is idempotent.
