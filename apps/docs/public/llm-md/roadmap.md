# Roadmap

Source: https://kensaur.us/mushi-mushi/docs/roadmap

---
title: Roadmap
description: Where Mushi Mushi is headed — upcoming SDK platforms, diagnosis speed targets, and console features, updated as work lands.
---

# Roadmap

Mushi is built in the open. [VISION.md](https://github.com/kensaurus/mushi-mushi/blob/master/VISION.md) documents the full architectural target — code catches up release by release.

  **Currently shipping:** v1.25.x (Wave D complete; Wave E in progress). See the [Changelog](/changelog) for what landed.

## Live boards

- **[Open issues](https://github.com/kensaurus/mushi-mushi/issues)** — file a bug, feature request, or RFC. Active work is tracked here.
- **[Discussions](https://github.com/kensaurus/mushi-mushi/discussions)** — design conversation, Q&A, show-and-tell.

## Release waves

| Wave | Theme | Status |
| --- | --- | --- |
| **A** | Vision air-gap, MCP correctness, RAG, sandbox | ✅ Shipped |
| **B** | WASM SLM classifier, real-time collab, AG-UI, fine-tuning pipeline | ✅ Shipped |
| **C** | Mobile parity (RN + iOS + Android + Flutter + Capacitor), A2A protocol, SOC 2 readiness, data residency pinning, BYOK, BYO storage | ✅ Shipped |
| **D** | Plugin marketplace GA, docs site, Mushi Cloud GA, multi-repo coordinated fixes, PDCA console enhancements, QA coverage stories, SDK install & upgrade one-click, Skill-driven triage, Codebase Atlas | ✅ Shipped |
| **E** | v1.0.0 cross-platform stable API, Launch Week, frictionless onboarding, self-hosting one-click | 🔄 In-flight |

## Wave E details (in-flight)

| Feature | Status | Notes |
| --- | --- | --- |
| `@mushi-mushi/*` 1.0.0 stable API locks | 🔄 In-flight | Coordinated 1.0 across all 0.x packages (capacitor, node, vue, svelte, angular) |
| Frictionless onboarding | 🔄 In-flight | GitHub/Google OAuth signup, auto-provisioned project+key; **`mushi login` device flow shipped** (Jul 2026) |
| Self-hosting one-click | 🔄 In-flight | Railway / Render deploy button, `MUSHI_INIT_*` headless bootstrap |
| Launch Week | ⏭ Next | Public Show HN + Product Hunt + Reddit coordinated launch |

## Agent fixes you can trust (October 2026)

| Feature | Status | Notes |
| --- | --- | --- |
| [Agent PR review](/concepts/agent-pr-review) | ✅ Shipped | Claude Opus reviews every cloud-agent pull request on your own key; a **hold** blocks merging from Mushi |
| Review follow-ups | ✅ Shipped | A "fix first" pull request goes back to a new agent once, with the findings |
| Spend-down safety stop | ✅ Shipped | Spend-down pauses an app whose agent pull requests review poorly; 7-day scoreboard per key |
| All-apps AI keys | ✅ Shipped | One key you own serves every app in the organizations you own ([BYOK](/security/byok)) |
| [CI runners](/operating/ci-runners) | ✅ Shipped | `/ci` shows where tests run and why a fix waits; a stopped test machine is never called a failed fix; `mushi runner add` |
| Verified merge | 🔄 In progress | An agent pull request merges on its own only with proof: a test that fails without the fix and passes with it, no weakened tests, a small diff, and two AI reviews that can stop it. Off by default |
| Run Mushi on your own machines | ⏭ Planned | A local-only mode with a self-test that proves nothing leaves your network (`mushi local verify`) |

## Wave D highlights (shipped)

- **One-click SDK install & upgrade** — `npx mushi-mushi` + `npm create mushi-mushi` wizard, SDK upgrade PRs from the Connect hub
- **Skill-driven triage** — `skill-sync`, `classify-report` Stage 2, pipeline runs, kenji skills integration
- **Codebase Atlas (`/explore`)** — semantic codebase search, ask, tour, and knowledge surface
- **sdk-versions-cron** — daily npm sync keeps SDK freshness chips accurate
- **Backend drift scanner** — daily schema snapshot diff, `gate_findings` of type `schema_drift`
- **MCP tool surface** — `@mushi-mushi/mcp`, `mcp:read` + `mcp:write` scopes, 10 feature groups (see [`@mushi-mushi/mcp`](/sdks/mcp) for the current, catalog-sourced tool count)

## Completed highlights (Wave C, v0.8.0)

- **Native SDKs** — iOS (Swift), Android (Kotlin) and Flutter implementations in the repo, plus the Capacitor plugin on npm. The three native SDKs are previews: publishing to CocoaPods / SwiftPM release tags, Maven Central and pub.dev is still open
- **A2A discovery** — `a2a-push-notify` edge function; agents can subscribe to Mushi events as A2A peers
- **SOC 2 readiness module** — retention policies, DSAR, RLS coverage snapshots, quarterly evidence pack
- **Data residency** — US / EU / JP region pinning at project creation
- **BYO storage** — S3, Cloudflare R2, GCS, MinIO, or Supabase Storage per project
- **BYOK** — project-scoped Anthropic + OpenAI keys via Supabase Vault
- **PDCA runner** — closed-loop iteration engine: fix → judge → promote, visible in the Iterate console page
- **Drift scanner** — `drift-walker` + `contract-graph-builder` detect API contract drift against live routes
- **QA coverage stories** — define and schedule user-story tests from the admin console

See [VISION.md](https://github.com/kensaurus/mushi-mushi/blob/master/VISION.md) (positioning constitution) and [Concepts → Architecture](/concepts/architecture) for the architectural target.
