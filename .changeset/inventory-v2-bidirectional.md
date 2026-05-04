---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react": minor
"@mushi-mushi/inventory-schema": minor
"eslint-plugin-mushi-mushi": minor
"@mushi-mushi/mcp-ci": minor
---

Mushi v2 + v2.1 — bidirectional inventory + agentic-failure gates + passive SDK discovery.

Mushi now models the **positive** side of your app (user stories, pages, elements, actions) alongside the negative reports it has always tracked, then verifies the two stay in sync via five pre-release gates and a synthetic monitor. New in v2.1: the SDK can passively discover routes / testids / outbound APIs and Claude drafts the inventory.yaml for you, so most teams will never hand-author one.

**SDK (`@mushi-mushi/web` + `@mushi-mushi/core` + `@mushi-mushi/react`)**
- New `capture.discoverInventory` config (off by default) — `Mushi.init({ capture: { discoverInventory: { enabled: true, captureDomSummary: true, throttleMs: 60_000, routeTemplates: ['/practice/[id]', '/tags/[slug]'], userIdSource: 'auto' } } })`. The SDK observes navigation, picks out `data-testid` attributes, the most prominent heading, and the recent network paths captured for repro, then POSTs a sparse, PII-safe payload to `/v1/sdk/discovery`. User identifiers are SHA-256 hashed in the browser; query string values are dropped (only the keys are kept).
- New public types: `MushiDiscoverInventoryConfig`, `MushiDiscoveryEventPayload`.
- New API client method: `postDiscoveryEvent`.

**`@mushi-mushi/inventory-schema` (new package, 0.1.0)**
- Zod + JSON-Schema source-of-truth for `inventory.yaml` v2 (`schema_version: 2.0`). Used by the admin ingester, the CI gate runner, the LLM proposer, and the GitHub Action.
- Exports: `validateInventoryYaml`, `validateInventoryObject`, `inventorySchema`, `inventoryJsonSchema`, plus the per-node Zod schemas (`appSchema`, `pageSchema`, `actionSchema`, `userStorySchema`, `apiDepSchema`, `dbDepSchema`, `testRefSchema`).

**`eslint-plugin-mushi-mushi` (new package, 0.1.0)**
- Two rules wired into the v2 gate suite:
  - `mushi-mushi/no-dead-handler` — flags onClick / form submit handlers that never call any inventory `backend` API.
  - `mushi-mushi/no-mock-leak` — flags `mockReturnValue` / `vi.fn()` shapes left in production code paths.
- Ships a `recommended` config preset.

**`@mushi-mushi/mcp-ci` (0.2.2 → 0.3.0)**
- Five new commands (also exposed via the `mushi-mushi-gates` GitHub Action):
  - `gates` — runs the v2 pre-release gates against a project and posts a composite GitHub status check.
  - `discover-api` — emits an OpenAPI / inventory contract doc from the project's current inventory snapshot.
  - `discovery-status` — prints a human-readable summary of routes / events / users / freshness from the SDK's discovery stream.
  - `propose` — kicks the LLM proposer for a project and waits for the draft to land.
  - `auth-bootstrap` — refreshes the crawler's authenticated session by running the `inventory.yaml` `auth.scripted` block via Playwright (used by the new `@mushi-mushi/inventory-auth-runner` service).
- New action inputs / outputs documented in `packages/mcp-ci/README.md`; the GitHub Action `action.yml` exposes the new commands directly.
