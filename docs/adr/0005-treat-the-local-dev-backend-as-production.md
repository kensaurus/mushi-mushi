# 0005. Treat the local dev backend as production

Status: Accepted            Date: 2026-08-19

## Context

`apps/admin/vite.config.ts` proxies `/functions` to
`DEV_SUPABASE_TARGET`, which defaults to the cloud project
`dxptnwrhwsqckaftyymj`. There is no local Supabase stack in the normal
workflow (no `seed.sql`, port 54321 not running) and no staging project.

So `pnpm dev` on `127.0.0.1:6464` looks like a local sandbox and is in fact a
local frontend wired to the live backend holding real customer bug reports.
Every QA, exploratory-testing, and red-team skill in this repo assumes a
non-prod target and will happily submit forms, dispatch fixes, and mash
destructive controls.

## Decision

Any browser-driven testing against the dev server is **read-only by default**:
navigate, hover, inspect, and screenshot freely; do not dispatch fixes,
resolve/dismiss reports, delete, merge, or submit mutating forms. Unauthenticated
probing (junk input on login, route gating) is fine because it cannot mutate
state. When a skill demands a non-prod target, say explicitly that only prod
exists and scope the run down rather than proceeding as if it were a sandbox.

## Rejected alternatives

- **Stand up a local Supabase stack for testing** — the correct long-term fix.
  Not rejected on merit; it does not exist yet, and inventing seed data mid-task
  is its own risk. This ADR is superseded the day a seeded local stack lands.
- **Point dev at a staging project** — same: no staging project exists.
- **Test freely and clean up afterwards** — rejected: "clean up afterwards" on a
  live customer dataset is not a recovery plan, and dispatch/fix actions have
  outward-facing side effects (PRs, Slack messages, reporter notifications) that
  cannot be undone.

## Consequences

Visual and interaction verification of authenticated surfaces is limited to
what read-only navigation can prove; some gates will legitimately be reported
"not run" with the reason stated, rather than silently skipped or faked.
Revisit as soon as a seeded local stack or a staging project exists — at which
point this becomes Superseded, not deleted.
