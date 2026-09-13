# 0007. Knip is the dead-code gate, ratcheted inside the build job

Status: Accepted            Date: 2026-09-12

## Context

The 2026-09-12 dead-code audit (`docs/execplans/dead-code-voice-agent-loop.md`)
found no stray-file problem but a register of unreachable features: events with
consumers and no producers, agent kinds allowed by a CHECK constraint but
rejected by the worker, gate scripts that exist and never run. `tsc`'s
`noUnusedLocals` was enforced in only 26 of 51 tsconfigs, and nothing reported
unused files, exports or dependencies at all. `ci.yml` has four sibling jobs and
no aggregator; the required check is the single `build` job.

## Decision

`knip@6` (oxc backend) is the tool for unused files, exports, types and
dependencies. It runs twice inside the `build` job, next to `Check dead
buttons`: `--production` and default mode, each pinned with `--max-issues` to
the count measured after the cleanup, and the default run treats configuration
hints as errors. Companion ratchets (`check:residue` for suppressions, `any`
and console residue outside the CLI; `check:env-source-parity`) live in the same
job. The Deno edge functions are excluded from the knip graph by project
negation inside the `packages/server` workspace, never by `ignore` patterns.
Export bombs that are public API (`packages/core/src/index.ts`,
`apps/admin/src/components/ui.tsx`) are tagged `@public`, not deleted. Counts
only go down; raising a `--max-issues` value requires a superseding ADR.

## Rejected alternatives

- **ts-prune / depcheck / eslint-plugin-unused-imports** — each covers one
  dimension; knip covers files, exports, types, dependencies and workspace
  isolation with one config and reads `pnpm-workspace.yaml` natively.
- **A new parallel CI job** — branch protection requires only `build`; a
  sibling job can go red without blocking a merge.
- **`knip --fix` in a pre-commit hook** — auto-deletion without a human reading
  the register is exactly how "wire, not kill" items would be lost.
- **Bringing the Deno functions into the knip graph** — knip has no Deno
  resolver; `npm:`/`jsr:`/`https://` specifiers report as unresolved noise.

## Consequences

Adding a dependency or an exported symbol that nothing imports fails CI
immediately. Register items decided as "wire" (Cursor dispatch,
`fix.requested`, Slack commands) must be wired before the delete pass, or the
delete pass removes them. The baselines are committed under
`docs/execplans/knip-baseline/` so a future reader can see what was accepted.
