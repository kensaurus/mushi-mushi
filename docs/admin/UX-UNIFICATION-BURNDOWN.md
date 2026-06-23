# Admin Console UX Unification Burndown

> Living burndown for Design System v2 chrome budget, snapshot strips, and responsive tab patterns.
> Updated after full operator-route posture pass (Jun 22 2026).

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

## Verification

```bash
cd apps/admin
pnpm typecheck
pnpm test
pnpm lint
pnpm lint:tokens
```

Manual: each operator route at 390 / 768 / 1280 px in Beginner mode — max 2 chrome rows before work UI.

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
