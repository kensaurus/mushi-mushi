---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/vue': minor
'@mushi-mushi/svelte': minor
'@mushi-mushi/angular': minor
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
'@mushi-mushi/wasm-classifier': minor
'@mushi-mushi/capacitor': minor
---

# v0.8.0 — Wave C: mobile parity, A2A discovery, SOC 2 readiness, residency, BYO storage, BYOK

Wave C closes the platform-parity gap with the V5.3 whitepaper. Mobile gets
first-class native SDKs, the public agent surface becomes A2A-discoverable,
and customers gain the operational levers (residency, storage, keys, audit
evidence) needed to run Mushi in regulated environments.

This release is **non-breaking** for existing SDK consumers. New surface only.

## Highlights

- **Native iOS SDK** (`MushiMushi`, SwiftPM + CocoaPods): shake-to-report
  widget, offline queue with SQLite-backed retry, automatic device context
  capture, screenshot capture via `UIGraphicsImageRenderer`, optional Sentry
  bridge for unified breadcrumbs, and a macOS GitHub Actions matrix.
  (V5.3 §2.18)
- **Native Android SDK** (`dev.mushimushi:sdk`, Maven Central + AAR):
  feature-equivalent to the iOS SDK — shake detection via `SensorManager`,
  bottom-sheet capture UI, `OfflineQueue` with `WorkManager`-style retry,
  Sentry breadcrumb bridge, and Android CI. (V5.3 §2.18)
- **Flutter SDK** (`mushi_mushi` on pub.dev): pure-Dart with platform
  channel bridges, `RepaintBoundary`-driven screenshot capture, shake
  detection via `sensors_plus`, and reuses the same offline-queue
  contract as the JS Core SDK. (V5.3 §2.18)
- **Capacitor plugin** (`@mushi-mushi/capacitor`): web fallback delegates
  to `@mushi-mushi/core`; native iOS/Android delegate to the standalone
  native SDKs so a hybrid app gets the same shake/screenshot UX as a
  native app. (V5.3 §2.18)
- **A2A Agent Card discovery**: public endpoints
  `GET /.well-known/agent-card` and `GET /v1/agent-card` advertise the
  Mushi agent's identity, skills, supported A2A versions, MCP transport
  details and auth requirements per the A2A protocol. Other agents can
  now negotiate with the Mushi platform without out-of-band config.
  (V5.3 §2.19)
- **SOC 2 Type 1 readiness module**: new tables
  `project_retention_policies`, `data_subject_requests`, `soc2_evidence`,
  the `mushi_apply_retention()` and `mushi_rls_coverage_snapshot()`
  SECURITY DEFINER helpers, a nightly `soc2-evidence` Edge Function, and
  a new admin **Compliance** page that surfaces the latest control
  evidence (CC6.1, CC6.7, CC7.2, CC8.1, A1.2), DSAR queue, and per-table
  retention policies. (V5.3 §2.20)
- **Data residency regions (US / EU / JP)**: opt-in pinning per project,
  cluster-aware `regionRouter` middleware that 307-redirects cross-region
  calls, an SDK-side `resolveRegionEndpoint` that primes a localStorage
  cache so subsequent calls go straight to the right cluster, and a
  public `region_routing` lookup table. The US cluster remains the
  catalog of record for project metadata. (V5.3 §2.21)
- **BYO Storage abstraction** (`s3` / `r2` / `gcs` / `minio` / `supabase`):
  per-project `project_storage_settings`, a vault-backed credential model
  (no raw keys in DB), a zero-dependency `StorageAdapter` with inline
  SigV4 and GCS JWT signing, a healthcheck endpoint, and a new admin
  **Storage** page. Screenshots are now uploaded through the adapter
  end-to-end. (V5.3 §2.22)
- **BYOK Anthropic / OpenAI keys end-to-end**: `resolveLlmKey` now
  flows through `fast-filter`, `classify-report` (text + vision), and
  `judge-batch`. Every LLM invocation records `key_source` (`byok`
  vs `env`) for billing reconciliation and SOC 2 evidence. New admin
  endpoints `GET / PUT / DELETE /v1/admin/byok/:provider` write keys
  to Supabase Vault via SECURITY DEFINER `vault_store_secret`, never
  to plain DB columns. New **Settings → LLM Keys** panel exposes
  rotation, clearing, and last-used timestamps with `…<last4>` hints.
  (V5.3 §2.23)

## Migrations included

`20260418001300_soc2_readiness`, `20260418001400_data_residency`,
`20260418001500_byo_storage`, `20260418001600_byok_key_source`.

## New packages

- `@mushi-mushi/capacitor@0.2.0` — Capacitor plugin published to npm.
- `MushiMushi` (iOS) — published to CocoaPods + SwiftPM.
- `dev.mushimushi:sdk` (Android) — published to Maven Central.
- `mushi_mushi` (Flutter) — published to pub.dev.

## Breaking changes

None.

## Operator notes

- **Region rollout**: a single-region deploy continues to work unchanged.
  To enable EU/JP, deploy a sibling Supabase project per region, set
  `MUSHI_REGION` on each Edge Function deployment, and CNAME
  `eu.api.mushimushi.dev` / `jp.api.mushimushi.dev` to the corresponding
  cluster. SDKs auto-discover via `/v1/region/resolve` — no SDK upgrade
  required for old clients (they just won't get the redirect optimization).
- **BYO Storage**: secrets MUST be loaded into Supabase Vault before being
  referenced from `project_storage_settings`. The settings table only
  stores the *vault entry name*; misconfiguration falls back to the
  cluster default Supabase bucket and surfaces in the storage healthcheck
  as `degraded` rather than failing reports.
- **BYOK**: rotating a key is non-destructive — the old vault entry is
  overwritten and the next LLM call picks up the new value within one
  second (settings cache TTL). To force every node to drop its cached
  resolution, the admin UI's **Clear** button issues a Vault delete plus
  a settings upsert that nulls the ref column.
- **SOC 2**: the nightly evidence sweep and retention sweep are scheduled
  via `pg_cron`. Verify both jobs are active with
  `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'soc2-%' OR jobname LIKE 'mushi-%';`.
- **A2A Agent Card** is intentionally public (no auth) so peer agents can
  discover Mushi. It advertises auth requirements but never the keys
  themselves.
