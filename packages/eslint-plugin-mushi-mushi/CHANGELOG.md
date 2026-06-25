# eslint-plugin-mushi-mushi

## 0.3.1

### Patch Changes

- 8544e22: Publish these packages with npm provenance attestations. They were the last four published packages still missing `publishConfig.provenance: true`, so their tarballs shipped without the Sigstore build-provenance signature every other `@mushi-mushi/*` package carries. Adding it brings them in line with the rest of the workspace and lets consumers verify them via `npm audit signatures`. No runtime or API changes.

## 0.3.0

### Minor Changes

- 90bc9d5: Add four design-system lint rules used by the console UX-unification pass:

  - `no-card-elevated-outside-allowlist` — flags gradient `card-elevated` / `<Card elevated>` on operational admin surfaces (use `variant="flat"` / `Panel`).
  - `no-accent-for-selection` — flags accent colour used for selection/active UI (use brand tokens / `<FilterChip tone="brand">`).
  - `no-legacy-shadcn-tokens` — flags legacy shadcn token names.
  - `no-raw-hex-in-widget` — flags raw hex literals in widget code (use design tokens / `safeWidgetHex`).

## 0.2.1

### Patch Changes

- 0c66aa9: Fix a real false positive in `no-mock-leak`, and wire the TS parser into
  `RuleTester` so the rules are actually exercised against TypeScript.
  - `no-mock-leak` no longer flags `import type { faker } from
'@faker-js/faker'`. Type-only imports are erased at compile time and
    never reach the runtime, so the rule's "no mocks in production"
    contract doesn't apply to them.
  - `RuleTester` now registers `@typescript-eslint/parser` so fixtures
    using TypeScript-only syntax (`as` casts, `satisfies`, generics, type
    annotations) parse instead of silently failing as "0 errors". Added
    TS-targeted regression cases.

## 0.2.0

### Minor Changes

- 5e04203: Mushi v2 + v2.1 — bidirectional inventory + agentic-failure gates + passive SDK discovery.

  Mushi now models the **positive** side of your app (user stories, pages, elements, actions) alongside the negative reports it has always tracked, then verifies the two stay in sync via five pre-release gates and a synthetic monitor. New in v2.1: the SDK can passively discover routes / testids / outbound APIs and Claude drafts the inventory.yaml for you, so most teams will never hand-author one.

  **SDK (`@mushi-mushi/web` + `@mushi-mushi/core` + `@mushi-mushi/react`)**
  - New `capture.discoverInventory` config (off by default) — `Mushi.init({ capture: { discoverInventory: { enabled: true, captureDomSummary: true, throttleMs: 60_000, routeTemplates: ['/practice/[id]', '/tags/[slug]'], userIdSource: 'auto' } } })`. The SDK observes navigation, picks out `data-testid` attributes, the most prominent heading, and the recent network paths captured for repro, then POSTs a sparse, PII-safe payload to `/v1/sdk/discovery`. User identifiers are SHA-256 hashed in the browser; query string values are dropped (only the keys are kept).
  - New public types: `MushiDiscoverInventoryConfig`, `MushiDiscoveryEventPayload`.
  - New API client method: `postDiscoveryEvent`.

  **`@mushi-mushi/inventory-schema` (new package, 0.1.0)**
  - Zod + JSON-Schema source-of-truth for `inventory.yaml` v2 (`schema_version: 2.0`). Used by the admin ingester, the CI gate runner, the LLM proposer, and the GitHub Action.
  - Exports: `parseInventory` (yaml string → typed inventory), `validateInventory` (already-parsed object → typed inventory), `inventorySchema`, `inventoryJsonSchema`, `computeStats`, plus the per-node Zod schemas (`appSchema`, `pageSchema`, `elementSchema`, `userStorySchema`, `apiDepSchema`, `dbDepSchema`, `testRefSchema`, `authConfigSchema`).

  **`eslint-plugin-mushi-mushi` (new package, 0.1.0)**
  - Two rules wired into the v2 gate suite (Gates 1 + 2):
    - `mushi-mushi/no-dead-handler` — flags JSX props matching `/^on[A-Z]/` (and same-named object properties) whose handler body is empty (`() => {}`), returns only `null` / `undefined`, contains only `console.log` / `console.warn` calls, or `throw new Error('not implemented')`. Unwraps `useCallback` / `useMemo`, ignores `*.stories.*` / `*.test.*` / `*.spec.*` by default, and accepts a `// mushi-mushi-allowlist: <reason>` opt-out comment.
    - `mushi-mushi/no-mock-leak` — flags imports of `@faker-js/faker` / `faker` / `msw` / `nock` / `axios-mock-adapter` from non-test paths, arrays of placeholder objects with names like `John Doe` / `Jane Doe` (≥2 entries, ≥50% of array), and stringly-typed `lorem ipsum` / `placeholder@example.com` content. Test paths (`__tests__/`, `tests/`, `*.test.*`, `*.spec.*`, `*.mock.*`, etc.) are ignored entirely.
  - Ships a `recommended` config preset that turns both rules on at `error`.

  **`@mushi-mushi/mcp-ci` (0.2.2 → 0.3.0)**
  - Five new commands (also exposed via the `mushi-mushi-gates` GitHub Action):
    - `gates` — runs the v2 pre-release gates against a project and posts a composite GitHub status check.
    - `discover-api` — emits an OpenAPI / inventory contract doc from the project's current inventory snapshot.
    - `discovery-status` — prints a human-readable summary of routes / events / users / freshness from the SDK's discovery stream.
    - `propose` — kicks the LLM proposer for a project and waits for the draft to land.
    - `auth-bootstrap` — refreshes the crawler's authenticated session by running the `inventory.yaml` `auth.scripted` block via Playwright (used by the new `@mushi-mushi/inventory-auth-runner` service).
  - New action inputs / outputs documented in `packages/mcp-ci/README.md`; the GitHub Action `action.yml` exposes the new commands directly.
