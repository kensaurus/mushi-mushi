# Admin Console UX Unification Burndown

> Living burndown for Design System v2 chrome budget, snapshot strips, and responsive tab patterns.
> Updated Jul 1 2026 after Phase 6 admin burndown (human alerts + guide liveData + brand token pipeline).

## Canonical pattern (target state)

```
PageHeaderBar
PagePosture (2 rows Quick/Beginner · 3 Advanced)
  ├─ priority 0  — *StatusBanner
  ├─ priority 20 — *SnapshotStrip (MetricStrip + statTooltips)
  └─ priority 30 — *Guide / *Readout (collapsed when banner covers same story)
SegmentedControl / scrollable tabs
Primary work UI
```

## Adoption matrix (operator routes)

| Route | PagePosture | Snapshot strip | Mode UX | Tabs | Notes |
|-------|-------------|----------------|---------|------|-------|
| `/` dashboard | Yes | `KpiRow` | `useDashboardUx` | — | Insight banner + loop readout |
| `/reports` | Yes | `ReportsKpiStrip` | — | — | Guide hidden when banner active |
| `/inbox` | Yes | `InboxSnapshotStrip` | `useInboxUx` | Scrollable | Overview uses `EmptySectionMessage` + clear chips (matches Actions tab); no editorial empty under snapshot chrome; judge cards sync with `/inbox/stats` |
| `/fixes` | Yes | `FixesSnapshotStrip` | `useFixesUx` | Scrollable | Guide overview-only |
| `/repo` | Yes | `RepoSnapshotStrip` | `useRepoUx` | Scrollable | |
| `/health` | Yes | `HealthSnapshotStrip` | `useHealthUx` | Scrollable | Snapshot above tabs |
| `/mcp` | Yes | `McpSnapshotStrip` | `useMcpUx` | Scrollable | Agent help / MCP console; sidebar quickstart label |
| `/mcp/manual` | — | — | — | — | Legacy alias → redirects to `/mcp` |
| `/connect` | Yes | `ConnectSnapshotStrip` | `useConnectUx` | N/A | Reference impl — `ConnectStudio` + `FilterChip`/`SegmentedControl` |
| `/qa-coverage` | Yes | `QaCoverageSnapshotStrip` | `useQaCoverageUx` | — | PageHero advanced-only |
| `/rewards` | Yes | `RewardsSnapshotStrip` | `useRewardsUx` | Scrollable | Reference impl |
| `/settings` | Yes | `SettingsCompactSnapshot` | `useSettingsUx` | Scrollable | Needs-attention card removed |
| `/projects` | Yes | `ProjectsSnapshotStrip` | — | — | Guide dedupe via posture |
| `/billing` | Yes | `BillingSnapshotStrip` | `useBillingUx` | — | |
| `/cost` | Yes | `CostSnapshotStrip` | `useCostUx` | — | |
| `/judge` | Yes | `JudgeSnapshotStrip` | `useJudgeUx` | — | |
| `/drift` | Yes | `DriftSnapshotStrip` | `useDriftUx` | URL tabs | |
| `/code-health` | Yes | readout | — | — | |
| `/query` | Yes | `QuerySnapshotStrip` | — | — | |
| `/audit` | Yes | `AuditSnapshotStrip` | — | Scrollable | |
| `/lessons` | Yes | `LessonsSnapshotStrip` | — | — | |
| `/compliance` | Yes | `ComplianceSnapshotStrip` | — | — | |
| `/sso` | Yes | `SsoSnapshotStrip` | — | — | Guide in posture |
| `/queue` (DLQ) | Yes | `QueueSnapshotStrip` | — | — | |
| `/prompt-lab` | Yes | `PromptLabSnapshotStrip` | — | Custom stages | Guide dedupe |
| `/skills` | Yes | `SkillsSnapshotStrip` | `useSkillsUx` | Scrollable tabs | Endpoint readout on Sources; drawer on mobile |
| `/marketplace` | Yes | `MarketplaceSnapshotStrip` | — | Scrollable | Priority card removed |
| `/anomalies` | Yes | `AnomaliesSnapshotStrip` | `useAnomaliesUx` | Scrollable | Guide dedupe |
| `/experiments` | Yes | `ExperimentsSnapshotStrip` | — | Scrollable | |
| `/feedback` | Yes | `FeedbackSnapshotStrip` | — | Scrollable | |
| `/storage` | Yes | `StorageSnapshotStrip` | — | Scrollable | Critical-only banner |
| `/research` | Yes | `ResearchSnapshotStrip` | — | Scrollable | Priority card removed |
| `/iterate` | Yes | `IterateSnapshotStrip` | — | Scrollable | |
| `/intelligence` | Yes | `IntelligenceSnapshotStrip` | — | Scrollable | |
| `/notifications` | Yes | `NotificationsSnapshotStrip` | — | Scrollable | Priority card removed |
| `/releases` | Yes | `ReleasesSnapshotStrip` | — | Scrollable | Priority card removed |
| `/fullstack-audit` | Yes | — | — | — | Readout in posture |
| `/content` | Yes | — | — | — | Readout in posture |
| `/feature-board` | Yes | `FeatureBoardSnapshotStrip` | — | Scrollable filter | |
| `/anti-gaming` | Yes | — | — | — | Banner-only posture |
| `/users` | Yes | `UsersSnapshotStrip` | — | — | Readout in posture |
| `/organization/members` | Yes | `MembersSnapshotStrip` | — | Scrollable | Banner + readout |
| `/integrations` | Yes | — | — | — | Banner + provenance readout |
| `/graph` | Yes | inline Section | `useGraphUx` | Scrollable | Readout on overview tab |
| `/explore` | Yes | inline Section | `useExploreUx` | Scrollable dual rail | Guide dedupe |
| `/inventory` | Yes | — | `useOnboardingUx` | Primary + Advanced | 7 tabs grouped |
| `/onboarding` | Yes | inline | `useOnboardingUx` | — | Setup readout |
| `/setup-copilot` | Yes | — | — | — | Readout in posture |

**Skipped by design:** `/login`, `/reset-password`, `/cli-auth`, public pages, `/reports/:id`, detail routes, auth bridges (`/docs-bridge`, `/accept-invite`), setup gate, tester portal.

## Burndown by priority

### P0 — Chrome budget ✅

All core loop routes ship `PagePosture` with guide/banner dedupe. Shared helper: `apps/admin/src/lib/pagePostureHelpers.ts`.

### P1 — Snapshot primitive consolidation ✅

All hand-rolled StatCard grids extracted to `*SnapshotStrip` + `MetricStrip` (Inbox, Health, MCP, Judge, Cost, Releases, Intelligence, Notifications, Users, FeatureBoard, Members, Billing, Projects, Dashboard KpiRow).

### P2 — Responsive tabs ✅

| Surface | Fix | Status |
|---------|-----|--------|
| `/health` | Scrollable `SegmentedControl` | ✅ |
| `/explore` | Primary + understand/map sub-rails, scrollable | ✅ |
| `/inventory` | Primary (stories/tree/gates) + Advanced overflow group | ✅ |
| Tab-heavy Phase C pages | `scrollable` on `SegmentedControl` | ✅ |

### P3 — Content dedupe ✅

Status banner replaces duplicate "Needs attention" / priority cards on: Settings, MCP, Inbox, Marketplace, Notifications, PromptLab, Releases, Research, Anomalies, Projects (guide hide when banner active).

### P4 — Guardrails ✅

- [x] ESLint `no-hand-rolled-tablist` (warn) — `eslint-plugin-mushi-mushi`
- [x] ESLint `no-missing-page-posture` (warn) — admin `eslint.config.js`
- [x] PR checklist: PagePosture on new worklist pages — `.github/PULL_REQUEST_TEMPLATE.md`
- [x] Posture slot recipes — `apps/admin/src/design-system/page-posture-recipes.ts` + Vitest catalog
- [x] Playwright: chrome row count ≤ budget per mode — `examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts`

### P7 — Shell chrome (Jul 3 2026)

Operator shell (`Layout.tsx` sidebar + sub-header) — distinct from page-level PagePosture burndown above.

| Surface | Fix | Status |
|---------|-----|--------|
| Sidebar logo row + desktop sub-header | Shared `.chrome-top-row` + `--chrome-row-height` (2.5rem) | ✅ |
| Hidden-route hint (Quick/Beginner) | Shorter copy, `text-2xs`, `text-balance` | ✅ |
| PDCA stage badges (`STAGE_TONE`) | `CHIP_TONE.*Subtle` pairings | ✅ |
| Privacy / plan sidebar pills | `text-2xs` floor + `CHIP_TONE` on posture badge | ✅ |
| Header context switchers | `HeaderContextChip` primitive — Org + Project | ✅ |
| Project status chips | Moved outside switcher `<button>` (a11y) | ✅ |
| Sidebar micro footer | `--ui-pad`-scaled seg min + tighter track spacing | ✅ |
| Header toolbar icons | `h-8 w-8` tap targets (activity, hotkeys, Ask Mushi) | ✅ |
| Playwright shell guard | `examples/e2e-dogfood/tests/admin-shell-chrome.spec.ts` | ✅ |
| Static shell contract | `apps/admin/src/lib/shell-chrome-static.test.ts` + `appChrome.test.ts` | ✅ |

## Verification

```bash
cd apps/admin
pnpm typecheck
pnpm test
pnpm lint
pnpm lint:tokens
node scripts/audit-chip-contrast.mjs --strict
# Shell chrome alignment (requires auth env + running admin):
# cd examples/e2e-dogfood && npx playwright test admin-shell-chrome.spec.ts --project=chromium
```

Manual (localhost:6464): `/health`, `/drift`, `/code-health`, `/anomalies`, `/connect`, `/integrations`, `/settings` — expand feature guides; confirm live metric chips on `WorkflowStageRow`; warn/danger banners show primary CTA (not ghost-only). Phase 5 chrome dedupe Playwright-verified Jul 1 2026 — see [`UX-WAVE5-BASELINE.md`](./UX-WAVE5-BASELINE.md). Phase 6 human-alert flows — see `.cursor/burndown-state.md`.

---

## Full route inventory

**Legend:** PP = PagePosture · SS = dedicated SnapshotStrip · MU = *ModeUx hook

| Route | PP | SS | MU | Notes |
|-------|----|----|-----|-------|
| `/` | yes | KpiRow | yes | |
| `/reports` | yes | yes | — | |
| `/inbox` | yes | yes | yes | |
| `/fixes` | yes | yes | yes | |
| `/repo` | yes | yes | yes | |
| `/health` | yes | yes | yes | |
| `/connect` | yes | yes | yes | |
| `/qa-coverage` | yes | yes | yes | |
| `/rewards` | yes | yes | yes | |
| `/settings` | yes | yes | yes | |
| `/projects` | yes | yes | — | |
| `/billing` | yes | yes | yes | |
| `/cost` | yes | yes | yes | |
| `/judge` | yes | yes | yes | |
| `/drift` | yes | yes | yes | |
| `/code-health` | yes | inline | — | |
| `/query` | yes | yes | — | |
| `/audit` | yes | yes | — | |
| `/lessons` | yes | yes | — | |
| `/compliance` | yes | yes | — | |
| `/sso` | yes | yes | — | |
| `/queue` | yes | yes | — | |
| `/prompt-lab` | yes | yes | — | |
| `/skills` | yes | yes | `useSkillsUx` | |
| `/marketplace` | yes | yes | — | |
| `/anomalies` | yes | yes | yes | |
| `/experiments` | yes | yes | — | |
| `/feedback` | yes | yes | — | |
| `/storage` | yes | yes | — | |
| `/research` | yes | yes | — | |
| `/iterate` | yes | yes | — | |
| `/intelligence` | yes | yes | — | |
| `/notifications` | yes | yes | — | |
| `/releases` | yes | yes | — | |
| `/fullstack-audit` | yes | — | — | |
| `/content` | yes | — | — | |
| `/feature-board` | yes | yes | — | |
| `/anti-gaming` | yes | — | — | |
| `/users` | yes | yes | — | |
| `/organization/members` | yes | yes | — | |
| `/integrations` | yes | — | — | |
| `/graph` | yes | inline | yes | |
| `/explore` | yes | inline | yes | |
| `/inventory` | yes | — | yes | |
| `/onboarding` | yes | inline | yes | |
| `/setup-copilot` | yes | — | — | |
| `/reports/:id` | compact | — | — | Detail — ops posture (CI + dispatch) |
| Public/auth | — | — | — | No operator chrome |

**Coverage:** 44/44 operator list pages use `PagePosture` (excluding skipped auth/public routes). Detail routes use optional compact posture.

---

## Phase 2 — Cross-surface SDK unification (Jun 2026)

**Plan:** SDK UI unification burndown (Phase A–C + guardrails).

| Item | Status | Notes |
|------|--------|-------|
| `--color-surface-hover` + editorial bridge aliases | ✅ | `apps/admin/src/index.css` |
| Widget hex → `build-widget-theme.ts` + core tokens | ✅ | `packages/web/src/build-widget-theme.ts` |
| Assistant hub chip + i18n | ✅ | `packages/web/src/widget-render.ts` |
| Legacy shadcn codemod | ✅ | `border-edge-subtle`, `text-fg-muted`, … |
| SdkInstallCard preview tokens | ✅ | `getWidgetPreviewTokens()` |
| RN FAB size from `MUSHI_GEOMETRY` | ✅ | Circle shape documented |
| RN `MushiBanner` + assistant tab | ✅ | `packages/react-native/src/components/*` |
| Report detail compact posture | ✅ | `ReportDetailPage.tsx` |
| DTCG `brand.tokens.json` | ✅ | `packages/brand/tokens/` |
| ESLint `no-raw-hex-in-widget` + Playwright a11y spec | ✅ | See PR template SDK section |
| Admin `predev` rebuilds `@mushi-mushi/web` before Vite | ✅ | `apps/admin/package.json` |
| Vite watcher re-prebundles web dist on mid-session rebuild | ✅ | `apps/admin/vite-plugin-invalidate-web-dep.ts` |
| SdkInstallCard assistant hub chip in live preview | ✅ | Click mock trigger → panel shows Ask when enabled |
| Product decisions | ✅ | [`SDK-UI-UNIFICATION-DECISIONS.md`](./SDK-UI-UNIFICATION-DECISIONS.md) |

**Verify:** `node scripts/check-design-tokens.mjs`, `pnpm --filter @mushi-mushi/web test`, `pnpm --filter @mushi-mushi/admin lint`, `examples/e2e-dogfood/tests/sdk-widget-a11y.spec.ts` (with dogfood host running).

---

## Phase 5 — Cross-layer chrome dedupe (Jul 2026)

**Plan:** [`UX-WAVE5-BASELINE.md`](./UX-WAVE5-BASELINE.md) · audit script `scripts/audit-admin-ux-wave5.mjs`

| Item | Status | Notes |
|------|--------|-------|
| Breadcrumb ↔ PageHeaderBar dedupe (PDCA chip, project scope) | ✅ | `locationChrome.ts`, `ChromeBreadcrumb.tsx` |
| RoutePageHelp owns long copy — suppress inline `description` | ✅ | `PageHeaderBar.tsx` |
| Layout PageHero gated when posture status banner active | ✅ | `postureChromeStore.ts`, `PagePosture.tsx`, `Layout.tsx` |
| NextBestAction hidden when posture banner carries next step | ✅ | `NextBestAction.tsx` |
| `SnapshotSectionHint` deprecated → guide slot only | ✅ | `layout.tsx` (no-op) |
| Brand budget tokens (`text-link`, `action-reveal`) | ✅ | `index.css` |
| PageHero removed on posture-first routes (Explore, Health, QA, …) | ✅ | `*ModeUx.ts` flags |
| Settings hint dedupe template | ✅ | `SettingsPage.tsx`, `shouldHideConfigSnapshot` |
| Connect RelatedRail + section description dedupe | ✅ | `ConnectPage.tsx` |
| Playwright chrome budget → 44 routes | ✅ | `admin-chrome-budget.spec.ts` |
| Static hint-duplication audit | ✅ | `scripts/audit-admin-hint-duplication.mjs` |

**Playwright PDCA (localhost:6464, Jul 1 2026):** Manual headed verification of Wave 5 blast radius — dashboard (Advanced + Beginner), settings, connect, qa-coverage, explore, health, drift, feature-board. All PASS; posture rows ≤ budget; no inline PageHero on posture-first routes; breadcrumb without PDCA chip. Evidence: [`UX-WAVE5-BASELINE.md`](./UX-WAVE5-BASELINE.md) § Playwright PDCA + screenshots under `.playwright-mcp/admin-ux-wave5/`.

---

## Phase 6 — Human alerts + guide liveData + brand tokens (Jul 2026)

**Plan:** UX burndown finish (Tracks A–C) · machine state in `.cursor/burndown-state.md`

| Item | Status | Notes |
|------|--------|-------|
| Drift / Code health / Anomalies banners → `StatusBannerAction` | ✅ | `humanPageHints` fallbacks; `is*StatusBannerCritical()` on pages |
| Connect native CI copy (`SdkNativeConnectivityCard`) | ✅ | `sdkCiSecrets` headline + playbook; voice aligned with `SdkHealthSummary` |
| `humanAlertsBurndown.ts` — all rows `done` | ✅ | `apps/admin/src/lib/humanAlertsBurndown.ts` |
| DTCG `brand.tokens.json` → `editorial.css` | ✅ | `pnpm build:brand-tokens`; CI `check:brand-tokens-fresh` |
| `guideLiveOverlay.ts` — 17 overlay families | ✅ | health, judge, projects, qa, integrations, drift, code-health, anomalies, explore, onboarding, skills, rewards, sso, compliance, prompt-lab, reports, settings |
| Guide components wired to live stats | ✅ | All `liveData: 'done'` in `featureExplainBurndown.ts` |
| Vitest overlay coverage | ✅ | `guideLiveOverlay.test.ts` (18 cases) |

**Intentionally deferred:** auto-generating `packages/core/src/design-tokens.ts` from JSON; RN web-step parity per [`SDK-UI-UNIFICATION-DECISIONS.md`](./SDK-UI-UNIFICATION-DECISIONS.md).

**Verify:**

```bash
cd apps/admin && pnpm typecheck && pnpm test && pnpm lint && pnpm lint:tokens
rg 'variant="ghost"' apps/admin/src/components/{drift,code-health,anomalies}/   # expect 0
rg "liveData: 'partial'" apps/admin/src/lib/featureExplainBurndown.ts           # expect 0
node scripts/check-design-tokens.mjs
pnpm check:brand-tokens-fresh   # after committing packages/brand/src/editorial.css
```

Manual (localhost:6464): `/health`, `/drift`, `/code-health`, `/anomalies`, `/connect`, `/integrations`, `/settings` — expand feature guides; confirm live metric chips on `WorkflowStageRow`; warn/danger banners show primary CTA (not ghost-only).

---

## Phase 8 — Cross-surface token bridge (Jul 2026)

**Plan:** Mushi Console UX Audit · Connect pilot · operator/editorial bridge

| Item | Status | Notes |
|------|--------|-------|
| `ConnectLanePicker` `surface="operator"` + `data-connect-surface` CSS bridge | ✅ | `packages/marketing-ui`, `apps/admin/src/index.css` |
| `SectionAnchorNav` (SegmentedControl + beta offset + IO) | ✅ | `components/connect/SectionAnchorNav.tsx` |
| `JobStatusPill` primitive | ✅ | `components/ui/job-status-pill.tsx` |
| Extract `GithubConnectionCard`, `UpdateCenter`, `BumpPlanTable` | ✅ | `components/connect/*` |
| `ConnectPage` slim orchestrator + label alignment ("Bug capture") | ✅ | `pages/ConnectPage.tsx` |
| `SdkInstallCard` decomposed into `sdk-install/*` submodules | ✅ | 1374 → 310 LOC orchestrator |
| Codemod `text-[var(--color-*-foreground)]` → semantic utilities | ✅ | 10 files |
| ESLint `no-raw-css-var-text` (error) | ✅ | `eslint-plugin-mushi-mushi` |
| ESLint `no-hand-rolled-tablist` promoted to error | ✅ | `apps/admin/eslint.config.js` |
| CI `scripts/audit-raw-css-var-classes.mjs` | ✅ | root `package.json` script |
| Orphan connect chrome removed | ✅ | `ConnectHubGuide`, `ConnectActivationStrip`, `ConnectRelatedRail` deleted; `ConnectStepFlow` retained |
| Playwright `/connect` operator-surface regression | ✅ | `admin-chrome-budget.spec.ts` |
| McpPage secondary links → `LINK_ACCENT` / `Btn` | ✅ | brand budget per zone |
| Secondary inline links console-wide → accent hue | ✅ | 137 codemod hits · `scripts/codemod-link-accent.mjs` · `check:secondary-link-brand` |

**Verify:**

```bash
cd apps/admin && pnpm typecheck && pnpm test && pnpm lint && pnpm lint:tokens
node scripts/audit-raw-css-var-classes.mjs
node scripts/audit-secondary-link-brand.mjs
node scripts/check-design-tokens.mjs
```
