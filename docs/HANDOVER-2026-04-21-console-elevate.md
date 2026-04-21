# Handover — Console elevate, 2026-04-21

> Picking this up? Read this top to bottom (≈3 min). This release is the **console-elevation pass** requested by an end user: (1) a real global search, (2) stripping the "Wave" product-timeline jargon that was leaking into user-facing copy, (3) a proper React Flow visualisation for the PDCA loop, and (4) a responsive-table primitive so dense data fits the viewport. All four ship together because they share a single theme: the admin console should read like a product, not like our release notebook.

---

## TL;DR

- **Command palette (⌘/Ctrl+K).** New `CommandPalette` (built on [`cmdk`](https://cmdk.paco.me)) mounted in `Layout.tsx`. Combines static route navigation (23 routes + keyword aliases: type "bugs" → Reports, "pr" → Fixes, "spam" → Anti-Gaming), quick actions (jump to new/critical filters, switch admin mode), and a debounced live API search over `/v1/admin/reports?q=` and `/v1/admin/fixes?q=` (new backend support — see below). Recents persist in `localStorage`. Desktop + mobile header both carry a `SearchButton` trigger that advertises the shortcut.
- **"Wave" vocabulary stripped repo-wide.** Users saw phantom "Wave E" / "Wave L" / "Wave N" references in panel copy, JSDoc, migrations, README and docs. That was engineering-internal release-train vocabulary leaking into product surfaces. Replaced end-to-end via a line-scoped codemod (`scripts/strip-wave-vocabulary.mjs`, dry-run default). Renamed `docs/HANDOVER-wave-{i,j,k,l}-2026-04-20.md` to date-themed slugs and fixed every internal link. Legitimate English idioms ("hand-wave") and stable storage keys were deliberately left untouched.
- **PDCA loop as a live React Flow canvas.** New `apps/admin/src/components/pdca-flow/` with four files — `PdcaFlow`, `PdcaStepNode`, `PdcaGradientEdge`, `pdcaFlow.data.ts`. Two variants: `live` (dashboard cockpit at `sm+`, replaces `<PdcaCockpit>`) and `onboarding` (first-run explainer embedded on `OnboardingPage`). Fixed diamond topology (P → D → C → A → loop back to P), gradient edges with dashed marching-ants animation on the current-focus stage, pan/zoom disabled by default. Narrow-viewport users still see the stacked `PdcaCockpit` fallback. The `FirstRunTour` Plan stop anchor now matches either layout.
- **Responsive table primitive.** New `ResponsiveTable` wrapper + `useTableDensity()` hook persist a per-user "comfy / compact" row-density preference in `localStorage` (`mushi:table-density:v1`). Horizontal overflow renders edge-fade scroll shadows via CSS `mask-image`, computed on scroll + resize via `ResizeObserver`. Opt-in `stickyFirstColumn` pins the primary identifier while the rest scrolls. Adopted in `ReportsTable` (sticky first column), `JudgePage` (3 leaderboards), and `CompliancePage` (evidence + DSAR) with a `TableDensityToggle` surfaced in the Compliance page header.

## Build / lint / typecheck

- `pnpm --filter @mushi-mushi/admin typecheck` — green.
- One new runtime dependency: `cmdk@^1.1.1` (≈10 KB gzipped). React Flow (`@xyflow/react`) was already present.
- `pnpm install` committed to `pnpm-lock.yaml`.

---

## What changed where

### New files

| File | Purpose |
|---|---|
| `apps/admin/src/components/CommandPalette.tsx` | `cmdk`-powered global palette with static + live results |
| `apps/admin/src/components/SearchButton.tsx` | Header trigger advertising ⌘K / Ctrl+K |
| `apps/admin/src/lib/searchIndex.ts` | Static route list + keyword aliases for the palette |
| `apps/admin/src/lib/useCommandPalette.ts` | Zustand-free singleton open-state hook via `useSyncExternalStore` |
| `apps/admin/src/components/pdca-flow/PdcaFlow.tsx` | React Flow canvas with `live` / `onboarding` variants |
| `apps/admin/src/components/pdca-flow/PdcaStepNode.tsx` | Custom node: letter badge + title + live count + bottleneck |
| `apps/admin/src/components/pdca-flow/PdcaGradientEdge.tsx` | Bezier edge with source→target gradient + animated focus state |
| `apps/admin/src/components/pdca-flow/pdcaFlow.data.ts` | Node/edge factories, fixed positions, hex colour map |
| `apps/admin/src/components/ResponsiveTable.tsx` | `ResponsiveTable` + `TableDensityToggle` primitives |
| `apps/admin/src/lib/useTableDensity.ts` | Shared comfy/compact preference (module-level store, `localStorage`) |
| `scripts/strip-wave-vocabulary.mjs` | Line-scoped codemod for removing "Wave" vocabulary |
| `docs/HANDOVER-2026-04-21-console-elevate.md` | This file |

### Files modified (high-traffic)

| File | What changed |
|---|---|
| `apps/admin/src/components/Layout.tsx` | Mounts `<CommandPalette>`, wires ⌘K/Ctrl+K via `useHotkeys`, adds `<SearchButton>` to both desktop and mobile sub-headers |
| `apps/admin/src/pages/DashboardPage.tsx` | `<PdcaFlow variant="live">` at `sm+`, stacked `<PdcaCockpit>` fallback on narrow viewports |
| `apps/admin/src/pages/OnboardingPage.tsx` | Embeds `<PdcaFlow variant="onboarding">` above the setup checklist |
| `apps/admin/src/components/FirstRunTour.tsx` | Plan-stop anchor matches either `[data-tour-id="pdca-flow"]` or the cockpit fallback |
| `apps/admin/src/components/reports/ReportsTable.tsx` | Wrapped in `<ResponsiveTable stickyFirstColumn>` |
| `apps/admin/src/pages/JudgePage.tsx` | Three leaderboards migrated to `<ResponsiveTable>` |
| `apps/admin/src/pages/CompliancePage.tsx` | Evidence + DSAR tables wrapped; header exposes `<TableDensityToggle>` |
| `apps/admin/src/index.css` | Adds `.cmdk-*` item styles, `.responsive-table-*` scroll-shadow + density tokens |
| `apps/admin/package.json` | + `cmdk@^1.1.1` |
| `packages/server/supabase/functions/api/index.ts` | `/v1/admin/fixes` now accepts `?q=` for palette live search (ILIKE on `summary`, `rationale`, `branch`) |

### "Wave" strip scope

Repo-wide: `apps/admin`, `packages/server`, `packages/sdk`, `apps/docs`, `docs/`, root `README.md`, `HANDOVER.md`, `scripts/`, and SQL migration comments. The codemod is line-scoped (patterns only activate on lines that contain the word "wave") so the blast radius is bounded to our own vocabulary. `apps/docs/app/layout.tsx` retains the `v0-8-0-wave-c` localStorage key on purpose — renaming it would silently re-surface the release banner for existing users.

---

## Design decisions worth flagging

- **Search UX: `cmdk` over a hand-rolled palette.** `cmdk` is the Radix-team companion to `@radix-ui/react-dialog`; it owns arrow-key scroll, filter scoring, and the `data-selected` contract. Writing that ourselves was a week of edge cases (IME composition, screen readers, type-ahead debouncing). One small dep, zero regressions.
- **Singleton store, not Context.** `useCommandPalette` is a module-level store read via `useSyncExternalStore`. No provider means the palette can be opened from anywhere — header button, hotkey, deep inside a page — without plumbing a context through the tree.
- **PDCA flow is narrative, not exploratory.** Pan/zoom/drag are off; React Flow's attribution is hidden via `proOptions`. The diagram is a fixed-topology loop diagram, not a canvas editor — users don't need to reorganise the stages. Turning on `interactive` in `PdcaFlow` props flips zoom + select on for future placements.
- **Responsive-table adoption is incremental.** The primitive is additive: existing table markup (`<table>` + `<thead>` + `<tbody>`) passes through unchanged. Migrating a page is a three-line diff (import + wrap + close). We shipped three adopters (`Reports`, `Judge`, `Compliance`) to prove the pattern; future tables should follow when they touch dense data or overflow-prone columns.
- **Density persists globally.** A per-user choice — not per-page. Pick compact once on Reports; every table across the app follows. Preference lives in `localStorage` and is shared via a module-level subscriber set so density changes propagate live across mounted tables.

---

## Testing notes

- `pnpm --filter @mushi-mushi/admin typecheck` — passes.
- Manual smoke paths worth running before shipping:
  1. Open palette with ⌘K on macOS, Ctrl+K on Linux/Windows. Type "bugs" → Reports appears top of list. Type "pr" → Fixes appears. Hit Enter → navigates.
  2. Type a word from a real report description (≥ 2 chars). Live results appear under a "Reports" group within ≈ 250 ms.
  3. On the Dashboard (desktop) the PDCA flow renders as a horizontal diamond; the stage flagged as the focus has a marching-ants edge leading out.
  4. On narrow viewports (mobile emulation) the Dashboard swaps to the stacked `PdcaCockpit`; the FirstRunTour still highlights it on the Plan stop.
  5. Reports table on a narrow window: first column stays pinned while the rest scrolls; edge-fade appears on the scrollable side.
  6. Compliance page: toggle Comfortable / Compact in the page header — Evidence and DSAR tables re-render; preference survives a reload.
- No new unit tests shipped. Two candidates if coverage matters later: `searchIndex.routeHaystack` (pure), and `pdcaFlow.data` factory builders (deterministic).

---

## Backwards-compatibility

- All route paths, API shapes, and local-storage keys except the ones listed here are untouched.
- New `localStorage` keys introduced: `mushi:table-density:v1`, `mushi:palette:recent:v1`. Both are additive; deleting them returns the app to defaults.
- Renamed `docs/HANDOVER-wave-*.md` files: old paths will 404 if someone bookmarked them. `README.md`, `HANDOVER.md`, and docs cross-links are updated to the new slugs.
