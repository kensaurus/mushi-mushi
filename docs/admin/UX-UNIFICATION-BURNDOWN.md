# Admin Console UX Unification Burndown

> Living burndown for Design System v2 chrome budget, snapshot strips, and responsive tab patterns.
> Updated after Rewards rollout (Jun 2026).

## Canonical pattern (target state)

```
PageHeaderBar
PagePosture (2 rows Quick/Beginner · 3 Advanced)
  ├─ priority 0  — *StatusBanner
  ├─ priority 20 — *SnapshotStrip (MetricStrip + statTooltips)
  └─ priority 30 — *Guide (collapsed when banner covers same story)
SegmentedControl / scrollable tabs
Primary work UI
```

## Adoption matrix

| Route | PagePosture | Snapshot strip | Mode UX | Tabs | Notes |
|-------|-------------|----------------|---------|------|-------|
| `/rewards` | Yes | `RewardsSnapshotStrip` | `useRewardsUx` | Scrollable `SegmentedControl` | Reference impl |
| `/settings` | Yes | Full + `SettingsCompactSnapshot` | `useSettingsUx` | `SegmentedControl` | Beginner compact snapshot |
| `/connect` | Yes | `ConnectSnapshotStrip` | `useConnectUx` | N/A (sections) | `xl:grid-cols-2` body |
| `/qa-coverage` | Yes | `QaCoverageSnapshotStrip` | `useQaCoverageUx` | — | PageHero advanced-only |
| `/fixes` | Yes | `FixesSnapshotStrip` | `useFixesUx` | `SegmentedControl` | Guide overview-only |
| `/reports` | Yes | `ReportsKpiStrip` | — | — | Guide hidden when banner active |
| `/inbox` | Yes | Inline grid (→ strip P1) | `useInboxUx` | `SegmentedControl` | Priority card deduped |
| `/health` | Yes | Inline grid (→ strip P1) | `useHealthUx` | `SegmentedControl` | Snapshot moved above tabs |
| `/mcp` | Yes | Inline grid (→ strip P1) | `useMcpUx` | `SegmentedControl` | Needs-attention card removed |
| `/repo` | Yes | `RepoSnapshotStrip` | `useRepoUx` | `SegmentedControl` | |
| `/dashboard` | Phase B | `KpiRow` | `useDashboardUx` | — | SetupChecklist budget |
| `/judge` | Phase B | Inline | `useJudgeUx` | — | |
| `/drift` | Phase B | Inline | `useDriftUx` | URL tabs | |
| `/graph` | Phase C | — | `useGraphUx` | Fluid canvas | Skip posture cap |
| `/explore` | Phase C | — | `useExploreUx` | Fluid atlas | |
| `/inventory` | Phase C | — | `useOnboardingUx` | Internal tabs | |
| `/billing` | Phase B | Inline | `useBillingUx` | — | |
| `/cost` | Phase B | Inline | `useCostUx` | — | |
| Workspace misc | Phase C | Partial | Various | — | Audit, compliance, SSO |

## Burndown by priority

### P0 — Chrome budget (first viewport) ✅ shipped Jun 2026

| Surface | Fix | Status |
|---------|-----|--------|
| `/fixes` | `PagePosture` | Done |
| `/reports` | `PagePosture` + guide dedupe | Done |
| `/inbox` | `PagePosture` + priority card dedupe | Done |
| `/health` | `PagePosture` + snapshot above tabs | Done |
| `/mcp` | `PagePosture` + remove duplicate card | Done |
| `/repo` | `PagePosture` | Done |

Shared helper: `apps/admin/src/lib/pagePostureHelpers.ts`

### P1 — Snapshot primitive consolidation

| Surface | Violation | Fix | Effort |
|---------|-----------|-----|--------|
| `/inbox` | Hand-rolled `grid` KPIs | `InboxSnapshotStrip` + `MetricStrip` | M |
| `/health` | 6-col hand grid | `HealthSnapshotStrip` | M |
| `/mcp` | 6-col hand grid | `McpSnapshotStrip` (extract) | M |
| `/judge` | Inline KPIs | `JudgeSnapshotStrip` | M |
| `/dashboard` | `KpiRow` ad-hoc | Align with `MetricStrip` cols | M |

### P2 — Responsive tabs

| Surface | Violation | Fix | Effort |
|---------|-----------|-----|--------|
| `/health` | Many tabs | Scrollable `SegmentedControl` | S |
| `/settings` | 5+ tabs | Already `SegmentedControl` | — |
| `/explore` | 10 URL tabs | Overflow + scroll strip | L |
| `/inventory` | 7 internal tabs | Group "Advanced" overflow | L |

### P3 — Content dedupe

| Surface | Violation | Fix |
|---------|-----------|-----|
| `/settings` | Status banner + "Needs attention" card | Hide card when banner visible |
| `/mcp` | Status banner + priority card | Same |
| `/inbox` | Critical banner + overview priority card | Hide card when banner critical |
| Layout | `NextBestAction` + page danger banner | Cross-layer priority (future) |

### P4 — Guardrails

- [ ] ESLint `no-hand-rolled-tablist` (warn)
- [ ] PR checklist: PagePosture on new worklist pages
- [ ] Storybook: posture slot recipes
- [ ] Playwright: chrome row count ≤ budget per mode

## Verification

```bash
cd apps/admin
pnpm typecheck
pnpm test
pnpm lint:tokens
```

Manual: each P0 route at 390 / 768 / 1280 px in Beginner mode — max 2 chrome rows before work UI.

---

## Full route inventory (operator console)

**Legend:** PP = PagePosture · SS = dedicated SnapshotStrip · MU = *ModeUx hook

| Route | PP | SS | MU | Phase | Notes |
|-------|----|----|-----|-------|-------|
| `/` dashboard | — | partial | yes | B | SetupChecklist + KpiRow budget |
| `/reports` | yes | KPI strip | — | — | Dogfood banner outside posture |
| `/inbox` | yes | inline | yes | P1 strip | |
| `/fixes` | yes | yes | yes | — | |
| `/repo` | yes | yes | yes | — | |
| `/health` | yes | inline | yes | P1 strip | PageHero advanced-only |
| `/mcp` | yes | inline | yes | P1 strip | |
| `/connect` | yes | yes | yes | — | |
| `/qa-coverage` | yes | yes | yes | — | |
| `/rewards` | yes | yes | yes | — | Reference |
| `/settings` | yes | yes | yes | P3 dedupe | |
| `/projects` | — | — | — | C | SdkInstallCard heavy |
| `/judge` | — | inline | yes | B | |
| `/drift` | — | inline | yes | B | URL tabs |
| `/code-health` | — | inline | — | B | |
| `/fullstack-audit` | — | — | — | C | |
| `/explore` | — | — | yes | C | Fluid atlas |
| `/graph` | — | — | yes | C | Canvas |
| `/inventory` | — | — | yes | C | 7 internal tabs |
| `/skill-pipelines` | — | — | — | C | React Flow |
| `/billing` | — | inline | yes | B | |
| `/cost` | — | inline | yes | B | |
| `/releases` | — | — | — | C | |
| `/integrations` | — | — | — | C | |
| `/compliance` | — | — | — | C | |
| `/audit` | — | — | — | C | Log table |
| `/notifications` | — | — | — | C | |
| `/lessons` | — | — | — | C | |
| `/intelligence` | — | — | — | C | |
| `/anomalies` | — | — | — | C | |
| `/dlq` | — | — | — | C | |
| `/storage` | — | — | — | C | |
| `/sso` | — | — | — | C | |
| `/onboarding` | — | — | yes | C | Wizard |
| `/setup-copilot` | — | — | — | C | |
| `/reports/:id` | — | — | — | skip | Detail surface |
| Public/auth pages | — | — | — | skip | No operator chrome |

