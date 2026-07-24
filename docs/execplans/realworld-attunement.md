# RealWorld SDK Attunement — Gap Analysis & Burndown

> Status: `COMPLETE` — All 3 phases + parked items (D1–D3) closed 2026-07-23.
> See `.cursor/complete-everything-state.md` for evidence log.
>
> Registered as Plan 016 in [PLANS.md](./PLANS.md).

## Why RealWorld

[RealWorld / Conduit](https://realworld-docs.netlify.app/) is the canonical
"realistic Medium clone" spec with 100+ implementations across every framework
Mushi ships a wrapper for. Its spec deliberately exercises the exact surfaces
a bug-reporting SDK must capture faithfully:

| Conduit spec behavior | Mushi surface it stresses |
|---|---|
| Hash-based SPA routing (`/#/login`, `/#/article/:slug`, `/#/profile/:username`) | route inventory discovery, route timeline |
| JWT auth via `Authorization: Token <jwt>` (not `Bearer`), JWT in localStorage | PII scrubbing, network capture |
| `limit`/`offset` pagination + filter params (`?tag=`, `?author=`, `?favorited=`) | network URL capture, query-param key inventory |
| Shared error shape `{"errors":{"body":[...]}}` | error normalisation, server-side capture |

## Spec-conformance matrix (post-Phase-1)

| # | Conduit behavior | Component | Before | After Phase 1 |
|---|---|---|---|---|
| 1 | Hash routes appear in inventory | `packages/web/src/capture/discovery.ts` | ❌ every screen collapsed to `/` (pathname-only) | ✅ `deriveRoute()` templates the hash path (`/#/article/[id]`), subscribes `hashchange` |
| 2 | Hash routes appear in timeline | `packages/web/src/capture/timeline.ts` | ✅ already recorded `pathname+search+hash` | ✅ unchanged (now agrees with inventory) |
| 3 | Query VALUES never leak PII | `network.ts` `truncateUrl`, `timeline.ts` route payload | ❌ full `?token=`/`?email=` stored verbatim | ✅ `scrubUrl()` (core) redacts sensitive-key values + pattern-scrubs the rest, incl. hash-fragment queries |
| 4 | Benign filters kept for debugging | same | ✅ | ✅ `?tag=`, `?author=`, `?limit=`, `?offset=` values preserved; keys always preserved |
| 5 | `Token <jwt>` header never captured | `network.ts` | ✅ entries are method/url/status/timing only | ✅ + regression test (JSON of entry never contains the JWT) |
| 6 | localStorage JWT never captured | `discovery.ts` | ✅ storage explicitly excluded | ✅ unchanged |
| 7 | `console.log(jwt)` scrubbed before wire | `mushi.ts` | ❌ `consoleLogs` reached the wire unscrubbed (gap surfaced by this audit) | ✅ `scrubConsoleForWire()` — message + stack through the PII scrubber |
| 8 | Hash-fragment query keys in inventory | `discovery.ts` | ❌ only `location.search` read | ✅ keys (never values) also read from `#/path?query` |

## Phase 1 — SDK gap fixes `COMPLETE`

1. **`scrubUrl` in `@mushi-mushi/core`** (`pii-scrubber.ts`): redacts values of
   known-sensitive query keys (substring: token/jwt/passw/secret/api-key/auth/
   session/signature/email/phone/ssn; exact: `key`, `code`, `sig`) and runs the
   pattern scrubber over remaining decoded values (catches JWTs/emails under
   innocent key names). Handles both `?…` and hash-fragment `#/path?…` queries.
   Keys and paths always preserved. Never throws.
2. **Network capture** (`web/src/capture/network.ts`): `truncateUrl` scrubs
   before truncating — applies to fetch and XHR entries.
3. **Timeline capture** (`web/src/capture/timeline.ts`): `route` and `href` in
   route payloads scrubbed at capture.
4. **Console wire gap** (`web/src/mushi.ts`): `scrubConsoleForWire` closes the
   one observability surface that reached the wire unscrubbed.
5. **Hash-route inventory** (`web/src/capture/discovery.ts`): `deriveRoute`
   prefixes hash routes with `/#` (distinguishable from path routes, matches
   what the timeline records), accepts host templates with or without the
   `/#` prefix, subscribes `hashchange`, and reads query keys from the
   fragment. Pure anchors (`#section`) still ignored.

Tests: `packages/core/src/pii-scrubber.test.ts` (scrubUrl matrix + `Token
<jwt>` regression), `packages/web/src/capture/discovery.test.ts` (new),
`timeline.test.ts` (new), `network.test.ts` (query scrub + header regression).

Verified 2026-07-23: `pnpm --filter @mushi-mushi/core test` 192 passed ·
`pnpm --filter @mushi-mushi/web test` 225 passed · `pnpm typecheck` 47/47.

## Phase 2 — Conduit fixture matrix + dogfood harness `PENDING`

Vendor reference Conduit apps under `examples/realworld/` (MIT attribution):
`backend-express` (+`@mushi-mushi/node`), `frontend-react-vite` (path router,
`@mushi-mushi/react`), `frontend-hash` (hash router). Wire via non-interactive
`mushi init` (dogfoods CLI detect/inject on real repos). Author
`tests/conduit-journey.spec.ts` asserting web+node capture, hash+path route
timelines, report ingest; then an MCP dogfood step
(`get_recent_reports` → `get_report_detail` → `get_fix_context` →
`run_nl_query`) against the reports just produced. CI-gated behind
`MUSHI_REALWORLD=1` + `pnpm e2e:realworld`.

## Phase 3 — Backlog (out of initial scope)

- Extend fixture matrix: Vue3, Svelte(Kit), Angular, Solid, Nuxt Conduit
  frontends (one per shipped wrapper); Fastify/Hono backend variants.
- "Conduit spec conformance" section per SDK page in `apps/docs/content/sdks/`.
- `mushi doctor` hint: route-capture smoke check for hash-routed SPAs.
- Node SDK: adopt `scrubUrl` for server-side captured request URLs (parity
  with web; today's exposure is lower — server URLs come from route configs).

## Decisions

- **Vendor (copy + attribution), not submodules** — hermetic CI, pinned code.
- **Frontends target the local Express fixture**, not the public demo API —
  deterministic runs that exercise `@mushi-mushi/node` too.
- **`/#` route prefix** for hash-route inventory entries — keeps hash and
  path routes distinguishable in the admin console and consistent with the
  timeline's `pathname+search+hash` representation.
- **Scrub at capture for URLs, at wire for console** — URLs are re-consumed
  by discovery (`network_paths`) and timeline merging, so scrubbing at the
  source protects every downstream consumer; console keeps raw values in the
  in-memory buffer (host debugging) and scrubs only what ships.
