# GTM distribution — MCP / CLI / marketplace runbook

**Audience:** Maintainers shipping `@mushi-mushi/mcp` releases and keeping directory
listings accurate.

**Goal:** Cold discovery for the MCP-first install path
(`npx mushi-mushi setup --ide cursor`). Every public surface should say the same
thing and point to the same install flow.

**Related docs:**

| Doc | Use when |
| --- | --- |
| [`STOREFRONTS.md`](./STOREFRONTS.md) | One-time polish on README / npm / GitHub chrome |
| [`../marketplace/cursor-submission-checklist.md`](../marketplace/cursor-submission-checklist.md) | Submitting the Cursor Marketplace plugin |
| [`../marketplace/vscode-extension-publishing.md`](../marketplace/vscode-extension-publishing.md) | Publishing the VS Code / Open VSX extension |
| [`../operators/reporter-comms-and-mcp-setup.md`](../operators/reporter-comms-and-mcp-setup.md) | Org-scoped MCP keys + reporter two-way comms |

---

## What shipped (Jun 2026)

| Surface | Artifact | Status |
| --- | --- | --- |
| **Official MCP registry** | `packages/mcp/server.json` + CI publish | ✅ Live as `io.github.kensaurus/mushi-mushi` |
| **Glama** | `glama.json`, root `Dockerfile`, release **v0.1.0** | ✅ Claimed, installable — [listing](https://glama.ai/mcp/servers/kensaurus/mushi-mushi) |
| **Connect landing** | `apps/docs/app/connect/page.tsx` | ✅ Public `/connect` with optional keyless demo |
| **Install badges** | Root `README.md`, `packages/mcp/README.md` | ✅ Point to `https://kensaur.us/mushi-mushi/docs/connect` |
| **cursor.directory** | Root [`.mcp.json`](../../.mcp.json) | ✅ Auto-detect manifest committed — submit repo URL |
| **VS Code extension** | `packages/vscode-extension/` | 📦 Built; marketplace publish is manual (see marketplace doc) |
| **Cursor Marketplace plugin** | `packages/cursor-plugin/` | 📋 Checklist ready; submission pending |
| **npm keywords** | All primary `@mushi-mushi/*` packages | ✅ Aligned to MCP / vibe-coder discovery terms |

| **PulseMCP** | Auto-index from official registry | ⏳ Ingest weekly — no form; verify after ~7 days |
| **awesome-mcp-servers** | PR [#8625](https://github.com/punkpeye/awesome-mcp-servers/pull/8625) | 📬 Open |
| **awesome-remote-mcp-servers** | PR [#431](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/431) (supersedes closed #428) | 📬 Open |
| **cursor.directory** | Repo already registered | ✅ Duplicate on re-submit confirms live listing |
| **mcp.so** | Web submit at `/submit` | ✅ Live — [mcp.so/server/mushi-mushi](https://mcp.so/server/mushi-mushi). Description + Overview + Server Config on canonical URLs — see [`mcp-so-listing.md`](./mcp-so-listing.md) |
| **smithery.ai** | `kensaurus/mushi-mushi` | ✅ Republished Jun 2026 — upstream `kensaur.us/mushi-mushi/hosted-mcp/` — see [`smithery-external-publish.json`](./smithery-external-publish.json) |

Paste fields for remaining manual surfaces: [`STOREFRONTS.md` §7](./STOREFRONTS.md#7-mcp-registry--directory-listings-diagnoses-era).
Canonical hosts: [`canonical-urls.md`](./canonical-urls.md) — **do not** use `api.mushimushi.dev` or `docs.mushimushi.dev` in listings until DNS is verified (503 as of Jun 2026).

---

## Canonical listing fields (paste verbatim)

Keep every directory identical. Drift confuses search and hurts Glama coherence
scores. Full URL table: [`canonical-urls.md`](./canonical-urls.md).

| Field | Value |
| --- | --- |
| Name | `Mushi Mushi` |
| Registry name | `io.github.kensaurus/mushi-mushi` |
| npm install | `npx -y @mushi-mushi/mcp@latest` |
| Setup wizard | `npx mushi-mushi setup --ide cursor` |
| Hosted HTTP MCP (direct) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs` |
| Smithery / directory upstream | `https://kensaur.us/mushi-mushi/hosted-mcp/` |
| API endpoint (`MUSHI_API_ENDPOINT`) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` |
| Repo | `https://github.com/kensaurus/mushi-mushi` |
| Homepage | `https://kensaur.us/mushi-mushi` |
| Connect | `https://kensaur.us/mushi-mushi/docs/connect` |
| Docs / MCP quickstart | `https://kensaur.us/mushi-mushi/docs/quickstart/mcp` |
| License | MIT (SDK) · AGPLv3 (server) |
| One-liner | *Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key.* |

> **Registry `description` cap:** `packages/mcp/server.json` `description` must
> stay ≤ **100 characters** or `mcp-publisher` returns HTTP 422.

---

## Architecture — how the pieces connect

```mermaid
flowchart TB
  subgraph repo [mushi-mushi repo]
    SJ[packages/mcp/server.json]
    GJ[glama.json]
    DF[Dockerfile]
    MCPJ[.mcp.json]
    PKG[@mushi-mushi/mcp on npm]
  end

  subgraph registries [Discovery surfaces]
    OFF[registry.modelcontextprotocol.io]
    GL[glama.ai]
    CD[cursor.directory]
    CON[kensaur.us/mushi-mushi/docs/connect]
  end

  PKG --> SJ
  SJ -->|release.yml + publish-mcp-registry.yml| OFF
  OFF -->|auto-index| GL
  GJ --> GL
  DF -->|Glama build test| GL
  MCPJ --> CD
  CON -->|deeplinks from clients.ts| Cursor
  CON -->|deeplinks from clients.ts| VSCode
```

**Install paths visitors can take:**

1. **One-click Connect** — `https://kensaur.us/mushi-mushi/docs/connect` (minted key in
   console) or admin **Connect & Update** at `https://kensaur.us/mushi-mushi/admin`.
2. **Setup wizard** — `npx mushi-mushi setup --ide cursor|claude|vscode`.
3. **npm stdio** — `npx -y @mushi-mushi/mcp@latest` + three env vars.
4. **Hosted HTTP** — Streamable MCP at `dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp`.
5. **Glama workspace install** — after a Glama release exists (see below).

**Never hand-author deeplinks.** Per-install `cursor://…` and `vscode:mcp/install?…`
URLs embed base64 config (API key + project). Build them only via
[`packages/mcp/src/clients.ts`](../../packages/mcp/src/clients.ts) — the Connect
page and admin console consume the same helpers.

---

## Official MCP registry

### Files

| File | Role |
| --- | --- |
| [`packages/mcp/server.json`](../../packages/mcp/server.json) | Registry manifest (schema `2025-12-11`): name, description, npm package, env vars, hosted remote, icons |
| [`scripts/sync-server-json-version.mjs`](../../scripts/sync-server-json-version.mjs) | Syncs manifest version with `packages/mcp/package.json` before publish |

### Publish paths

1. **Automatic** — `.github/workflows/release.yml` runs `mcp-publisher publish`
   when `@mushi-mushi/mcp` ships to npm (uses GitHub OIDC; no extra secret).
2. **Manual** — GitHub Actions → **Publish MCP Registry**
   (`.github/workflows/publish-mcp-registry.yml`). Use after a metadata-only fix
   or if the release step silently failed (`continue-on-error` on the release job).

### Verify

```bash
curl -fsS "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kensaurus/mushi-mushi" \
  | grep -q "io.github.kensaurus/mushi-mushi" && echo OK
```

### On each `@mushi-mushi/mcp` release

1. Bump `packages/mcp/package.json` version (Changesets).
2. Ensure `server.json` description still ≤ 100 chars.
3. Merge + run release workflow — registry publish follows npm automatically.
4. If registry record lags, dispatch **Publish MCP Registry** manually.

---

## Glama

Glama auto-indexes from the official MCP registry but **installability** requires
a maintainer-claimed server with a successful **Glama release** (Docker build +
tool introspection).

### Repo files

| File | Role |
| --- | --- |
| [`glama.json`](../../glama.json) | Maintainer claim (`maintainers: ["kensaurus"]`), tool name + description list for schema page |
| [`Dockerfile`](../../Dockerfile) | Reference introspection image (npm global install); Glama's web UI generates its own Dockerfile from admin settings |

### Current release (Jun 2026)

- **Version:** `0.1.0` (latest)
- **Listing:** https://glama.ai/mcp/servers/kensaurus/mushi-mushi
- **Install:** enabled (`Deploy Mushi-Mushi` dialog)
- **Schema:** env vars + 70+ tool descriptions from release introspection
- **Score:** ~67% at launch; Server Coherence + TDQS populate after Glama's background job

### Glama Dockerfile admin settings (lean npm path)

These values were validated with a **42s successful build test**. Re-enter them
if Glama admin config is reset:

| Field | Value |
| --- | --- |
| Base image | `debian:bookworm-slim` (or `debian:trixie-slim`) |
| Build steps | `["npm install -g @mushi-mushi/mcp@latest"]` |
| CMD arguments | `["mcp-proxy", "--", "mushi-mcp"]` |
| Env (introspection) | `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, `MUSHI_API_ENDPOINT` — placeholders OK for sandbox |

The root `Dockerfile` documents the same offline-placeholder pattern for local
smoke tests.

### Create or refresh a Glama release

1. Sign in to Glama with the GitHub account that owns `kensaurus/mushi-mushi`.
2. Open **Admin → Dockerfile** on the server page.
3. Confirm build steps + CMD match the table above.
4. Click **Build & Release** — a passing build creates the release automatically
   (no separate “create release” form; the releases page shows `0.1.0` after success).
5. Confirm on **Admin → Releases** and that **Install Server** is enabled on the overview.

### Update tool descriptions on Glama

Edit [`glama.json`](../../glama.json) `tools[]` descriptions, commit to `master`,
then cut a new Glama release (step 4 above). Glama reads maintainers from
`glama.json` for ownership verification.

---

## cursor.directory

Root [`.mcp.json`](../../.mcp.json) is a **secret-free** Open Plugins manifest:

- `mushi` — hosted Streamable HTTP with `${MUSHI_API_KEY}` placeholders
- `mushi-stdio` — `npx -y @mushi-mushi/mcp@latest` stdio transport

**Submit:** https://cursor.directory/plugins/new → paste
`https://github.com/kensaurus/mushi-mushi` → confirm auto-detected servers → publish.

Also ships `packages/cursor-plugin/` rules, skills, and commands for the Cursor
Marketplace bundle (separate submission — see marketplace checklist).

---

## Public Connect page + keyless demo

| Surface | Path |
| --- | --- |
| Public Connect | `apps/docs/app/connect/page.tsx` → `https://kensaur.us/mushi-mushi/docs/connect` |
| Admin Connect | `apps/admin` ConnectStudio → `https://kensaur.us/mushi-mushi/admin` |
| Shared client registry | `packages/mcp/src/clients.ts` (`MCP_CLIENTS`, deeplink encoders) |

### Keyless “Try the demo” (optional)

Set build-time vars in `apps/docs/.env.example` so `/connect` installs against a
seeded read-only project without signup:

```bash
NEXT_PUBLIC_MUSHI_DEMO_API_KEY=...      # mcp:read only
NEXT_PUBLIC_MUSHI_DEMO_API_ENDPOINT=...
NEXT_PUBLIC_MUSHI_DEMO_MCP_HTTP=...
NEXT_PUBLIC_MUSHI_DEMO_PROJECT_ID=...
NEXT_PUBLIC_MUSHI_DEMO_PROJECT_NAME=mushi-demo
```

Seed synthetic reports with `node scripts/marketing/seed-demo.mjs`. The demo key is
**public by design** — bound to synthetic data only, `?read_only=1`, safe feature
subset `['triage', 'docs']`.

When vars are unset, `/connect` shows placeholder keys + “Sign in to mint” CTA
(unchanged fallback).

---

## VS Code extension

Package: [`packages/vscode-extension/`](../../packages/vscode-extension/).

Registers an MCP server definition provider; stdio default runs
`npx -y @mushi-mushi/mcp@latest`. Includes **Use the read-only demo** command.

Publishing to VS Code Marketplace + Open VSX is documented in
[`../marketplace/vscode-extension-publishing.md`](../marketplace/vscode-extension-publishing.md).
Not yet wired into `release.yml` — manual `VSCE_PAT` / `OVSX_PAT` publish per release.

---

## Cursor Marketplace plugin

Bundle: [`packages/cursor-plugin/`](../../packages/cursor-plugin/) (`plugin.json`,
`mcp.json`, skills, rules, commands).

Follow [`../marketplace/cursor-submission-checklist.md`](../marketplace/cursor-submission-checklist.md)
before submitting to cursor.sh/marketplace.

---

## Smithery

**Listing:** https://smithery.ai/servers/kensaurus/mushi-mushi

Mushi is **API-key-only** (not OAuth). Smithery’s publisher deploy still runs an
OAuth metadata probe on the **Supabase project origin**; end-user connect via
`--headers` works today.

### Publish (maintainers)

**Preferred upstream (Smithery):** `https://kensaur.us/mushi-mushi/hosted-mcp/`  
**Direct Supabase (CLI connect / dev):** `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp`

```bash
cd mushi-mushi
npx @smithery/cli auth login          # once per machine

# 1) Wire CloudFront proxy + origin PRM (once; also runs on deploy-admin.yml)
node scripts/aws-setup-hosted-mcp.mjs

# 2) Publish Smithery with kensaur.us URL (not raw *.supabase.co)
npx @smithery/cli mcp publish \
  "https://kensaur.us/mushi-mushi/hosted-mcp/" \
  -n kensaurus/mushi-mushi \
  --config-schema docs/marketing/smithery-config-schema.json
```

Config schema: [`smithery-config-schema.json`](./smithery-config-schema.json)  
Paste bundle: [`smithery-external-publish.json`](./smithery-external-publish.json)

After deploy, open **Releases → AUTHORIZE → Connect** (paste `MUSHI_API_KEY` from
`.env.local`). If setup returns `oauth/resource_metadata_process_failed`, confirm
origin PRM is live:

```bash
curl -sS https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp
node scripts/verify-hosted-mcp.mjs
```

Then republish with the kensaur.us upstream URL (not raw `*.supabase.co`).

### Hosted MCP auth surfaces (Jun 2026)

The `mcp` edge function serves:

- `GET|HEAD /.well-known/mcp/server-card.json` — static tool catalog (SEP-1649 bypass)
- `GET|HEAD /functions/v1/mcp` (no SSE) — RFC 9728 PRM (Smithery resource probe)
- `GET|HEAD /.well-known/oauth-protected-resource` — RFC 9728 PRM (same document)
- `GET|HEAD /.well-known/oauth-authorization-server` — RFC 8414 AS metadata
- `POST` without key → `401` + `WWW-Authenticate: Bearer resource_metadata="…"`
- `User-Agent` matching `/smithery/i` → unauthenticated `initialize` / `tools/list` scan

**Not fixable on Supabase alone:** Smithery also probes  
`https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp`  
when the upstream URL is `https://kensaur.us/mushi-mushi/hosted-mcp/`. Run
[`scripts/aws-setup-hosted-mcp.mjs`](../../scripts/aws-setup-hosted-mcp.mjs) (wired
into `deploy-admin.yml`).

### Verify end-user connect (works today)

```bash
npx @smithery/cli mcp add kensaurus/mushi-mushi --name mushi-test
npx @smithery/cli mcp update mushi-test \
  --headers '{"x-mushi-api-key":"<MUSHI_API_KEY>","x-mushi-project-id":"<MUSHI_PROJECT_ID>"}'
npx @smithery/cli tool list mushi-test
```

Mint keys at https://kensaur.us/mushi-mushi/docs/connect (`mcp:read` scope).

Redeploy after auth changes:

```bash
cd packages/server
npx supabase functions deploy mcp --project-ref dxptnwrhwsqckaftyymj --no-verify-jwt
```

---

## Release checklist (maintainers)

Run on every `@mushi-mushi/mcp` version bump:

- [ ] npm publish succeeded (`@mushi-mushi/mcp@<version>` on registry.npmjs.org)
- [ ] Official MCP registry record shows new version
  (`curl` verify above, or Actions log)
- [ ] Glama **Build & Release** if tool catalog or env schema changed materially
- [ ] `glama.json` tool list matches `packages/mcp/src/catalog.ts` (72 tools)
- [ ] `node scripts/check-mcp-catalog-sync.mjs` — 0 drift
- [ ] Connect page + README badges still point to `/connect`
- [ ] VS Code extension version bumped to match (if publishing extension)
- [ ] cursor.directory listing still accurate (`.mcp.json` diff review)

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Glama “cannot be installed” | No Glama release | Dockerfile admin → **Build & Release** |
| Glama schema “no description” | No release introspection yet | Successful release + wait for Glama job |
| Registry publish 422 | `server.json` description > 100 chars | Shorten description, re-run publish workflow |
| Registry empty after release | Silent failure in release.yml | Dispatch **Publish MCP Registry** manually |
| cursor.directory missing servers | `.mcp.json` not at repo root | Confirm file on `master`, re-submit repo URL |
| Deeplink install wrong project | Hand-authored config | Use Connect page or `npx mushi-mushi setup --ide` |
| Smithery AUTHORIZE `oauth/resource_metadata_process_failed` | Upstream still raw `*.supabase.co` or hosted-mcp behaviors missing | Run `node scripts/aws-setup-hosted-mcp.mjs`, republish with `https://kensaur.us/mushi-mushi/hosted-mcp/`, AUTHORIZE → Connect |
| Smithery release URL missing `/mcp` | Bad paste in web UI | Republish via CLI with full `/functions/v1/mcp` URL |
| Smithery stuck on old deployment setup URL | Stale `48cf9eda…` connection | After worker + successful publish, use latest release’s setup link; or delete/recreate server in Smithery UI |

---

## See also

- [`packages/mcp/README.md`](../../packages/mcp/README.md) — full MCP tool catalog and env reference
- [`apps/docs/content/quickstart/mcp.mdx`](../../apps/docs/content/quickstart/mcp.mdx) — public quickstart
- [`apps/docs/content/quickstart/incident-loop.mdx`](../../apps/docs/content/quickstart/incident-loop.mdx) — vibe-coder incident loop narrative
