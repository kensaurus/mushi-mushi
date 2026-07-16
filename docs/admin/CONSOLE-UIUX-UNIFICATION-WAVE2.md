# Console UI/UX Unification — Wave 2 (Connect, Chrome & Systemic Coherence)

> **Status: CLOSED (Jul 2026) — Phases F–J + Phase K finish landed.** Extends
> [`docs/plan-uiux-unification.md`](../plan-uiux-unification.md) (Phases A–E closed).
> Wave 2 is phases **F–J** plus **Phase K** (finish-to-100% for deferred items):
> broken-CSS hotfixes, Connect/chrome flagship layout, systemic chip-tone/contrast
> codemods, raw-control migration, CI polish, and the satellite-surface closeout.

**Preservation:** enhance, do not strip. No feature/route/prop removal. Keep
I/O + business logic identical unless a row says otherwise. Three brand
identities stay separate (operator / editorial / SDK widget).

**Verify after each phase:**

```bash
pnpm --filter @mushi-mushi/admin lint typecheck test
pnpm check:design
```

---

## Phase F — Hotfix broken CSS (P0/P1)

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| F1 | `CodeHealthPage.tsx`, `FullStackAuditPage.tsx`, `ExploreDomainsPanel.tsx` | Corrupted `border-warn/25ing-foreground` → `CHIP_TONE.warnSubtle` | [x] |
| F2 | `McpSetupPanel.tsx` | Invalid `border-danger/25-foreground` → `CHIP_TONE.dangerSubtle` / `okSubtle` | [x] |
| F3 | `CliAuthPage.tsx`, `ProjectCreatedSuccessPanel.tsx` | Undefined `warning` token → `warn` / `warn-muted` / `warning-foreground` | [x] |

---

## Phase G — Flagship: Connect + app chrome

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| G1 | `SdkInstallCard.tsx` | Viewport `lg:grid-cols-2` → named `@container/sdk` + `@2xl/sdk:grid-cols-2` | [x] |
| G2 | `ConnectPage.tsx` | Asymmetric `xl:grid-cols-[1.4fr_0.85fr]` so SDK card gets readable width | [x] |
| G3 | `SdkInstallConfigurator.tsx` | Selected chips → `SELECTED_TONE` / `SELECTED_TONE_IDLE` | [x] |
| G4 | `Layout.tsx` desktop header | `flex-wrap` chrome row + VersionBadge `min-w-0` + status chip `xl` only | [x] |
| G5 | `ReportEvidence.tsx` / `SkillPipelinesPage.tsx` | Nested viewport-grid squeeze siblings | [x] |

---

## Phase H — Systemic tokens + guardrails

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| H1 | `chipTone.ts` | Add `SELECTED_TONE`, `SELECTED_TONE_IDLE`, `HEADER_BADGE_TONE` | [x] |
| H2 | CHIP_TONE.*Subtle call sites | Strip redundant appended `border border-*/NN` (~30 files) | [x] |
| H3 | ESLint | `no-redundant-border-on-chip-tone` rule in recommended | [x] |
| H4 | Header Badge severity ternaries | Delegate to `HEADER_BADGE_TONE` (~13 pages) | [x] |
| H5 | `audit-chip-contrast.mjs` | Covers opacity + muted; tester portal **included** (Phase K removed exclusion) | [x] |
| H6 | Low-contrast sites | Migrated Fix/Discord/Teams/PromptLab/FeatureBoard/Login/Onboarding + tester (K) | [x] |
| H7 | `_design-system-README.md` | Container-query grid convention + SELECTED_TONE docs | [x] |

---

## Phase I — Raw controls + scaffold

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| I1 | Slack/Discord/Teams/CodebaseIndex cards | `Btn` / `Input` / `SelectField` / `Toggle` / `FilterChip` | [x] |
| I2 | `ProjectBillingCard`, `QueryPage`, `InboxPage`, `FixBulkActionBar` | SegmentedControl / FilterChip / Btn | [x] |
| I3 | `ActivityPage`, `OverviewPage` | `PageHeaderBar` + `PagePosture` | [x] |
| I4 | `FeatureBoardPage` `prompt()` | Modal + Input ship-note flow | [x] |
| I5 | `PlatformIntegrationCard` overflow menu | Raw `<button>` → `Btn` (Phase K) | [x] |
| I6 | `TesterLayout` mobile nav | Hand-rolled overlay → `Drawer` (Phase K) | [x] |

---

## Phase J — Polish + CI

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| J1 | Dense forms (`ByokPanel`, Login) | Type-ramp lift on intro / interactive links | [x] |
| J2 | `GraphPage` / `GraphCanvas` | Theme-safe `readVizToken` edge labels; `100dvh` | [x] |
| J3 | `PublicHomePage` | All `var(--mushi-*)` / paper `color-mix` → named `editorial-*` (Phase K) | [x] |
| J4 | CI | `pnpm check:chrome-budget` added to `check:design` (CI already runs it) | [x] |
| J5 | PR checklist / parent plan | Wave 2 items in `.github/PULL_REQUEST_TEMPLATE.md` + doc link | [x] |

---

## Phase K — Finish to 100% (deferred closeout)

| ID | Surface | Fix | Done |
|----|---------|-----|------|
| K1 | `HealthPage` LLM row + `PublicHomePage` sticky nav | `flex-wrap` + `min-w-0` so chrome degrades instead of overflowing | [x] |
| K2 | `audit-chip-contrast.mjs` | Removed `tester/` directory skip; gate covers satellite portal | [x] |
| K3 | `TesterAppsPage` / `TesterWalletPage` / `TesterSettingsPage` | Semantic-on-tint → `CHIP_TONE` / `SELECTED_TONE` | [x] |
| K4 | `PlatformIntegrationCard` + `TesterLayout` | Overflow `Btn`; mobile nav `Drawer` | [x] |
| K5 | `theme-tokens.css` + `PublicHomePage` | Named editorial paper-surface / ink-emphasis tokens; 0 raw `--mushi-*` in page | [x] |

**Optional long-tail (outside Wave 2 scope):** remaining raw-`<button>` hits under `check:raw-button-in-pages` on non-flagship surfaces.

---

## Related

- [`docs/plan-uiux-unification.md`](../plan-uiux-unification.md) — Phases A–E
- [`docs/admin/UX-UNIFICATION-BURNDOWN.md`](./UX-UNIFICATION-BURNDOWN.md) — closed chrome wave
- [`apps/admin/src/design-system/_design-system-README.md`](../../apps/admin/src/design-system/_design-system-README.md)
- [`apps/admin/src/lib/chipTone.ts`](../../apps/admin/src/lib/chipTone.ts)
