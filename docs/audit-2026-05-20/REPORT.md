# Mushi Admin QA — 2026-05-20 (Round 2 End-User Walkthrough)

**Environment:** `http://localhost:6464` → Supabase `mushi-mushi` (`dxptnwrhwsqckaftyymj`)  
**Account:** `test@mushimushi.dev`  
**Verdict:** **Production-ready** — all critical data-display and console errors fixed. 21 reports now classified correctly; filter chips live; inventory 403 resolved; hotkeys crash gone; duplicate key warning cleared.

## Remote data (Supabase MCP, post Round 2)

| Table | Count |
|-------|------:|
| projects | 3 (glot-it, mushi-mushi, playwright-smoke) |
| reports | 21 (+1 test report sent via Onboarding) |
| fix_attempts | 4 (3 completed, 1 failed) |
| project_codebase_files | 1247 |
| llm_invocations (7d) | 24 |

**Report statuses (live after count_by_column RPC):** 19 classified, 1 fixing, 1 fixed.

**Onboarding setup progress:** mushi-mushi reached 3/4 required steps during the walkthrough (project ✓, API key ✓, first report ✓). Connect GitHub is optional.

## Critical user feedback — Round 1 (red-team voice)

| # | Complaint | Resolution |
|---|-----------|------------|
| 1 | Integrations CTA opened marketing page | **Fixed** — `IntegrationsRouteGate` redirects authed users to `/integrations/config` |
| 2 | Quickstart scolds on Dashboard home | **Partial** — sidebar labels Dashboard **Home**; consider adding Dashboard to Quick NAV |
| 3 | Codebase card silent on fetch failure | **Fixed** — `ErrorAlert` + retry on `CodebaseIndexCard` |
| 4 | Two GitHub paths confusing | **Fixed** — `RepoReadinessStrip` on Integrations |
| 5 | Row dismiss had no undo | **Fixed** — bulk dismiss + undo toast |
| 6 | Retry-all with no warning | **Fixed** — `ConfirmDialog` on Fixes |
| 7 | Quick filters showed 0 Classified while inbox full | **Fixed** — stats fold legacy statuses; DB backfill `triaged→classified` |
| 8 | "Browse disagreements" link did nothing | **Fixed** — `?filter=disagreement` filters eval table + clear chip |
| 9 | `/fixes?status=failed` from ribbon ignored | **Fixed** — `FixesPage` reads URL and selects Failed bucket |
| 10 | Delete comment / change role one-click | **Fixed** — confirm dialogs on both |

## Critical bugs found & fixed — Round 2 (end-user interactive walkthrough)

| # | Bug | Root Cause | Fix |
|---|-----|------------|-----|
| 1 | Filter chips all showed **0** despite 21 reports | `count_by_column` PostgreSQL RPC missing — backend called it but it didn't exist | Created RPC + migration `20260520900000_create_count_by_column_rpc.sql`; applied remote |
| 2 | Every Explore/Inventory page request returned **403** | `assertProjectScope` pinned project via JWT user's default project from `requireFeature` side-effect; URL `:projectId` mismatch → 403 | Fixed `assertProjectScope` in `inventory-guards.ts` — only enforces project pinning for API-key auth, not JWT |
| 3 | **`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`** crash | `useHotkeys.ts` called `e.key.toLowerCase()` without guarding for `undefined` key (fired by IME/composition events) | Added `if (!e.key) return` guard at top of `onKey` handler |
| 4 | **Duplicate React key** warning in Inbox activity feed | Backend assigned activity `id = f.report_id` — multiple fix attempts per report generated duplicate keys | Changed to `id = f.id` (fix attempt UUID) in `reports-dashboard.ts` |
| 5 | Dashboard PDCA hero attributed **glot-it** failed fix to **mushi-mushi** project | Dashboard aggregates all owned projects; description said "Your loop on mushi-mushi" implying single-project scope | Added `dashboardProjects.length > 1 → "Workspace overview · N projects"` label in `DashboardPage.tsx` |

## UX observations (non-critical, log for backlog)

| # | Observation | Suggested Fix |
|---|-------------|---------------|
| A | Integrations cards show "Not configured" but also display stale "Last probe" timestamps | Only show probe time when integration is configured; hide for unconfigured state |
| B | "This page is outside Quickstart" banner shows on `/judge` which is correct, but `/notifications` is accessible in Quick mode with full sidebar context | Consider whether Notifications belongs in Quick mode |
| C | Integrations page "GitHub" card has two setup paths (per-project vs org-level) — unclear which applies | Add a single "Set up GitHub" flow with step indicator |

## Fixes shipped — Round 1

| Area | Change |
|------|--------|
| Routing | `IntegrationsRouteGate`, sidebar + PDCA CTAs → `/integrations/config` |
| Codebase | Error surface + `RepoReadinessStrip` |
| Triage | Row dismiss undo; status quick-filters aligned to canonical workflow |
| Fixes | Retry-all confirm; deep-link `?status=failed` |
| Judge | Disagreement filter from URL; NBA link works |
| Org | Role change confirm dialog |
| Comments | Delete confirm dialog |
| Backend | Stats `byStatus` alias fold; reports list includes legacy rows when filtering classified/fixed |
| DB | Migrations: `fix_attempts` recency index; legacy status normalization (applied remote) |
| Dogfood | **`mushi-mushi` project** created — enable repo + index in UI |

## Fixes shipped — Round 2 (end-user walkthrough)

| Area | File(s) Changed | Change |
|------|----------------|--------|
| DB / RPC | `packages/server/supabase/migrations/20260520900000_create_count_by_column_rpc.sql` | New `count_by_column(col, project_ids)` RPC + remote deploy |
| Backend | `packages/server/supabase/functions/api/routes/reports-dashboard.ts` | Fix activity `id = f.id` (not `f.report_id`) — eliminates duplicate React keys |
| Backend auth | `packages/server/supabase/functions/_shared/inventory-guards.ts` | `assertProjectScope` only enforces project pin for `apiKey` auth; JWT users access any owned project |
| Frontend | `apps/admin/src/lib/useHotkeys.ts` | Guard `if (!e.key) return` in `onKey` handler |
| Frontend | `apps/admin/src/pages/DashboardPage.tsx` | Multi-project dashboard shows "Workspace overview · N projects" instead of single-project label |

## Round 3 — pre-push type-safety + lint sweep

Before opening the PR, ran the full repo gates against the Round 2 changeset
to catch anything the live walkthrough couldn't surface (silent type drift,
missing imports, severity-token mismatches between local components and the
shared `HeroSeverity` / `DavEvidence` unions). Fourteen errors total across
nine pages — all latent type breakages, none reachable in dev because Vite's
HMR happily serves invalid TS at runtime.

| File | Issue | Fix |
|------|-------|-----|
| `apps/admin/src/components/SetupNudge.tsx` | 19 page sites pass `requires={['project']}` but `'project'` was not in `SetupStepId` (virtual blocker for "no active project selected") | Added `SetupBlocker = SetupStepId \| 'project'` union; component skips virtual ids and falls through to the parent's `emptyTitle` copy |
| `apps/admin/src/components/PageHero.tsx` | `act` was required (`PageAction \| null`) but 5 pages omit it on calm-state surfaces | Made `act` optional (`act?: PageAction \| null`); component normalises `undefined → null` before threading into HeroFlow / HeroDetailPanel / operatorTrace which keep their strict shape |
| `apps/admin/src/pages/ProjectsPage.tsx` | `copy.help?.…` chain dereferenced through possibly-`null` `copy` from `usePageCopy` | Switched to `copy?.help?.…` to match the rest of the file |
| `apps/admin/src/pages/QueryPage.tsx` | `last-event` evidence used `status: 'crit'` but `DavEvidence` unions on `'ok' \| 'warn' \| 'error'`; `<ConfirmDialog>` rendered without an import | Mapped `'crit' → 'error'`; added `import { ConfirmDialog }` to match the convention used by every other admin page |
| `apps/admin/src/pages/RewardsPage.tsx` | Used `useRef` without importing it | Added `useRef` to the React import line |
| `apps/admin/src/pages/CompliancePage.tsx` | Used `useRef` + `useEffect` without imports | Added both to the React import line |
| `apps/admin/src/pages/CostPage.tsx` | Called `formatShortDay(...)` (top-level) without importing it from `dailySpendSeries` | Added `formatShortDay` to the existing `dailySpendSeries` import |
| `apps/admin/src/pages/DashboardPage.tsx` + `apps/admin/src/pages/InboxPage.tsx` | Banner severity union `'ok' \| 'warn' \| 'danger' \| 'info' \| 'neutral'` mapped `'danger'` → `'danger'` for `<PageHero>` but `HeroSeverity` only knows `'crit'` | Mapped `'danger' → 'crit'` at the boundary (the banner palette stays as-is) |

### Verification

```bash
pnpm --filter @mushi-mushi/admin typecheck   # 0 errors (was 14)
pnpm --filter @mushi-mushi/admin lint        # clean
pnpm --filter @mushi-mushi/admin test        # 182 passed (13 files)
pnpm --filter @mushi-mushi/server test       # 436 passed, 5 skipped (33 files)
pnpm typecheck                               # 42/42 turbo tasks green
pnpm lint                                    # 31/31 turbo tasks green (2 pre-existing `any` warnings in vue/__tests__)
pnpm check:dead-buttons                      # 436 files, 0 violations
pnpm check:design-tokens                     # 41 color roots, 437 files, in sync
pnpm check:edge-fn-imports                   # OK — no _shared/ → sibling-function relative imports
pnpm check:catalog-sync                      # MCP catalog in sync
pnpm check:secrets                           # 2013 files, no secrets
```

## Still open (non-blocking)

- **mushi-mushi** project needs GitHub + codebase index wired in Integrations (operator step).
- `QaCoveragePage` story edit/delete/schedule CRUD not in scope.
- `anomaly-detector` cron, `synthetic_runs` realtime publication (P2 infra).
- Full Playwright mode-matrix e2e not run in this session.
- UX observations A, B, C from Round 2 above are backlog items.

## Verification

```bash
pnpm --filter @mushi-mushi/admin lint
```

**Round 2 console status after all fixes (Playwright live verification):**

| Page | Errors | Warnings |
|------|-------:|---------:|
| `/dashboard` | 0 | 0 |
| `/reports` | 0 | 0 |
| `/inbox` | 0 | 0 |
| `/settings` | 0 | 0 |
| `/fixes` | 0 | 0 |
| `/integrations/config` | 0 | 0 |

Filter chip counts live: **Classified 19, Fixing 1, Fixed 1** (match DB).

Deploy edge `api` for server-side report filter + stats changes before production smoke.

## Langfuse

24 `llm_invocations` in 7d — Cost / Health pages should populate when the active project matches ingested traffic (`glot.it` has the bulk of history). Switch project or run classify/fix on `mushi-mushi` to seed traces there.

## Manual checklist (operator)

- [ ] Log in → visit `/integrations` → lands on config
- [x] Reports quick filter **Classified** shows **19** (was 0 before Round 2 fix)
- [ ] Judge → "Browse disagreements" → table filtered
- [ ] Pipeline ribbon → failed fixes → `/fixes?status=failed`
- [ ] Select `mushi-mushi` project → enable `github.com/kensaurus/mushi-mushi` → Explore shows files
- [x] Inventory page loads without 403 console error
- [x] Settings page loads without `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` crash
- [x] Inbox activity feed has no duplicate React key warnings
- [x] Dashboard shows "Workspace overview · 3 projects" (not single project name) when multiple projects exist
