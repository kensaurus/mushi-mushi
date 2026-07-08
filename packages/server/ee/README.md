<!--
  FILE: packages/server/ee/README.md
  PURPOSE: Define the open-core commercial boundary for the Mushi Mushi server.
  OVERVIEW: Declares which server capabilities are Enterprise Edition (EE),
            how the MUSHI_EE_LICENSE_KEY gate works, and where the EE code
            lives. The core server is AGPLv3; this directory is the
            source-available commercial boundary (see ./LICENSE).
  USAGE: Read this before building, moving, or gating an enterprise feature.
  NOTES: This is the *licensing* boundary. The runtime enforcement gate
         (MUSHI_EE_LICENSE_KEY) is a tracked follow-up — until it ships, the
         boundary is contractual (see ./LICENSE §3) and documented here.
-->

# Mushi Mushi — Enterprise Edition (EE)

Mushi Mushi is **open-core**, the same model as Supabase, Grafana, and Sentry:

- **Core (AGPLv3).** Everything under `packages/server`, `packages/agents`,
  and `packages/verify` that is **not** in an `ee/` directory. Self-host it, fork
  it, modify it for your own org. Modified SaaS → publish changes (§13) or a
  [commercial license](../../../COMMERCIAL-LICENSE.md). The cloud at
  `kensaur.us/mushi-mushi/` runs this exact core.
- **Enterprise Edition (commercial).** The code in this `ee/` directory. It is
  **source-available** (read, audit, modify, test, contribute) but **Production
  Use requires a Valid License** — an Enterprise subscription or a
  `MUSHI_EE_LICENSE_KEY`. See [`./LICENSE`](./LICENSE).

> **Why split this way?** A genuinely free, honest open-source core earns trust and
> adoption; a small commercial boundary funds the maintainer. The wedge (capture
> → diagnosis → fix, self-host, BYOK) is **never** behind the EE boundary — it is
> always in the AGPL core. EE is operator/enterprise plumbing only.

## What is Enterprise Edition

These are the **Bucket C** features from [`/VISION.md`](../../../VISION.md) — the
ones an enterprise buyer needs and a solo vibe-coder does not. They are **paid in
production**, free to read and to run for development/evaluation:

| Capability | Where it lives today | EE in production |
| ---------- | -------------------- | ---------------- |
| SSO (SAML + OIDC self-service) | `supabase/functions/api/routes/sso-audit.ts`, `apps/admin/src/pages/SsoPage.tsx` | ✅ |
| SCIM provisioning | Not yet built — roadmap, no endpoint exists today | ⏳ |
| Audit-log ingest + export | audit ingest routes / tables | ✅ |
| Retention policy CRUD (beyond the free 7-day window) | retention routes | ✅ |
| Region pinning / data residency | `global.region` / `global.peerRegions` (Helm); single production cluster today, see [`/security/data-residency`](../../../apps/docs/content/security/data-residency.mdx) | ✅ |
| SOC 2 evidence + compliance exports | compliance routes | ✅ |

> The table maps the **boundary**, not a completed code move. EE feature code
> currently lives next to the core for build simplicity; relocating each module
> physically under `ee/` is a tracked, behavior-preserving follow-up. Until then
> the boundary is enforced contractually ([`./LICENSE`](./LICENSE) §3) and, when
> the runtime gate ships, by `MUSHI_EE_LICENSE_KEY`.

## The license gate (`MUSHI_EE_LICENSE_KEY`)

- **Unset / invalid** → EE features run only for development, testing, and
  evaluation. Production Use is not licensed (see [`./LICENSE`](./LICENSE) §3).
- **Valid** → Production Use of EE features is licensed for the term of the key.

Hosted **Mushi Cloud Enterprise** includes the key automatically — nothing to
configure. Self-hosters who need EE features in production obtain a key from
`support@kensaur.us`.

## What is NOT EE (always AGPL core, always free)

The entire wedge and depth: bug capture, the diagnosis loop (fast-filter →
classify → fix prompt), MCP server, multi-framework SDKs, knowledge-graph dedup,
self-host (Docker + Helm), BYOK, and Sentry enrichment. If a feature helps a solo
vibe-coder understand and fix a bug faster, it is core — never EE.
