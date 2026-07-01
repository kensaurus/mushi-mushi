# Admin Console UX Wave 5 — Baseline Burndown

> **Status: complete (Jul 1 2026).** Cross-layer chrome dedupe shipped on all 44 operator list routes.
> Machine-readable audit (optional re-run): `node scripts/audit-admin-ux-wave5.mjs` → `docs/admin/UX-WAVE5-BASELINE.json`

## Summary

Design System v2 (PagePosture, snapshot strips) is adopted on 44/44 operator list routes.
Wave 5 removed **cross-layer duplication** not covered by posture row caps alone.

| Class | Pre-fix count | Wave | Status |
|-------|---------------|------|--------|
| Shell tautology (breadcrumb + header + PDCA) | All routes | 1 | ✅ |
| Hint stacking (description + help + snapshot hint) | ~30 routes | 1–2 | ✅ runtime dedupe in `PageHeaderBar` |
| Advanced PageHero + PagePosture triple stack | 8 routes | 2 | ✅ `hideOverviewChrome` in mode UX |
| SnapshotSectionHint under strips | 35+ components | 2 | ✅ deprecated no-op |
| Hover-only row actions | ~21 files | 2 | ✅ `action-reveal` CSS |
| Brand-color competition | QA, Dashboard, Settings | 2–3 | ✅ `text-link` tokens |

## Route checklist (44 operator list pages)

Legend: **P0** shell · **P1** primitives · **P2** page layout · **—** reference/minimal

| Route | P0 | P1 | P2 | Notes |
|-------|----|----|-----|-------|
| `/dashboard` | ✅ | ✅ | ✅ | PdcaFlow hidden when insight banner; `text-link` reports CTA |
| `/reports` | ✅ | ✅ | ✅ | Triage guide dedupe; SavedViews `action-reveal` |
| `/inbox` | ✅ | ✅ | — | Guide hide when banner |
| `/fixes` | ✅ | ✅ | — | Posture reference |
| `/repo` | ✅ | ✅ | — | Snapshot links Advanced-only |
| `/health` | ✅ | ✅ | ✅ | No inline PageHero; posture ≤2 rows (Advanced) |
| `/connect` | ✅ | ✅ | ✅ | RelatedRail removed; section descriptions gated |
| `/qa-coverage` | ✅ | ✅ | ✅ | PageHero removed; posture ≤2 rows |
| `/rewards` | ✅ | — | — | Gold reference — regression anchor |
| `/settings` | ✅ | ✅ | ✅ | Tab intro gated; header description suppressed |
| `/projects` | ✅ | ✅ | — | |
| `/billing` | ✅ | ✅ | — | |
| `/cost` | ✅ | ✅ | — | |
| `/judge` | ✅ | ✅ | ✅ | PageHero gated via mode UX |
| `/drift` | ✅ | ✅ | ✅ | PageHero gated; hooks-order fix verified live |
| `/code-health` | ✅ | ✅ | — | |
| `/query` | ✅ | ✅ | — | |
| `/audit` | ✅ | ✅ | — | |
| `/lessons` | ✅ | ✅ | — | |
| `/compliance` | ✅ | ✅ | — | |
| `/sso` | ✅ | ✅ | — | |
| `/queue` | ✅ | ✅ | — | |
| `/prompt-lab` | ✅ | ✅ | — | |
| `/skills` | ✅ | ✅ | — | |
| `/marketplace` | ✅ | ✅ | — | |
| `/anomalies` | ✅ | ✅ | — | |
| `/experiments` | ✅ | ✅ | — | |
| `/feedback` | ✅ | ✅ | — | |
| `/storage` | ✅ | ✅ | — | |
| `/research` | ✅ | ✅ | — | |
| `/iterate` | ✅ | ✅ | — | |
| `/intelligence` | ✅ | ✅ | — | |
| `/notifications` | ✅ | ✅ | — | |
| `/releases` | ✅ | ✅ | — | |
| `/fullstack-audit` | ✅ | ✅ | — | |
| `/content` | ✅ | ✅ | — | |
| `/feature-board` | ✅ | ✅ | ✅ | PageHero removed |
| `/anti-gaming` | ✅ | ✅ | — | |
| `/users` | ✅ | ✅ | — | |
| `/organization/members` | ✅ | ✅ | — | |
| `/integrations` | ✅ | ✅ | — | |
| `/graph` | ✅ | ✅ | ✅ | SnapshotSectionHint → guide slot |
| `/explore` | ✅ | ✅ | ✅ | PageHero removed; posture ≤1 row when snapshot hidden |
| `/inventory` | ✅ | ✅ | ✅ | PageHero gated |
| `/onboarding` | ✅ | ✅ | ✅ | PageHero gated |
| `/setup-copilot` | ✅ | ✅ | — | |
| `/mcp` | ✅ | ✅ | — | |

## Silent pain register — resolved

| ID | Pain | Fix | Verified |
|----|------|-----|----------|
| S13 | Breadcrumb + PageHeaderBar both show route + PDCA | `locationChrome.ts`; PDCA chip removed from breadcrumb | ✅ Playwright `/dashboard` |
| S3 | Settings 4–5 hint layers | `shouldHideConfigSnapshot`; tab intro gated | ✅ Playwright `/settings` — 2 posture rows, no header desc |
| S2 | PageHero + PagePosture + header on Explore/QA | `hideOverviewChrome` in mode UX | ✅ Playwright `/explore`, `/qa-coverage` — no PageHero |
| S6 | SnapshotSectionHint repeats guide | `SnapshotSectionHint` deprecated (returns null) | ✅ code + lint |
| S16 | Brand on links + NBA + status | NBA hidden when posture banner; `text-link` | ✅ Beginner `/dashboard` — NBA absent with banner |
| S15 | Hover-only SavedViews / Explore chat | `action-reveal` CSS | ✅ code audit |

## Playwright PDCA — localhost:6464 (Jul 1 2026)

**Scope:** Wave 5 blast radius — shell chrome, posture budget, PageHero removal, Settings/Connect outliers.
**Auth:** persisted magic-link session (`test@mushimushi.dev`) · **Viewport:** 1440×900 Advanced + Beginner spot-check.

| # | Journey | Result | Evidence |
|---|---------|--------|----------|
| 1 | `/dashboard` Advanced — breadcrumb, insight banner, no triple-stack | PASS | `.playwright-mcp/admin-ux-wave5/01-dashboard-1440.png` |
| 2 | `/settings` — ≤2 posture rows, no stacked tab intros | PASS | `02-settings-1440.png` |
| 3 | `/connect` — no RelatedRail, snapshot-only posture | PASS | `03-connect-1440.png` — 1 posture row |
| 4 | `/qa-coverage` — no PageHero, ≤2 posture rows | PASS | `04-qa-coverage-1440.png` |
| 5 | `/explore` — no PageHero, lean posture | PASS | `05-explore-1440.png` — 1 posture row |
| 6 | `/health` — no PageHero, warn banner + snapshot | PASS | `06-health-1440.png` — 2 posture rows |
| 7 | `/drift` — hooks fix, no error boundary | PASS | `07-drift-1440.png` — 2 posture rows, console clean |
| 8 | `/dashboard` Beginner — posture cap ≤2, NBA suppressed | PASS | `08-dashboard-beginner-1440.png` |
| 9 | `/feature-board` — no PageHero | PASS | 2 posture rows (DOM inspect) |

**Console:** clean on re-test routes after DriftPage hooks fix (transient HMR hook-order error during mid-edit reload only).
**Known non-blockers:** `402 Payment Required` on inventory pending-review API (quota/billing — unrelated to Wave 5 chrome).

### Full-route sweep (Jul 1 2026 — burndown-full)

Automated headed inspection of **all 47 operator routes** in **Advanced** and **Beginner** mode (1440×900):

| Check | Advanced | Beginner |
|-------|----------|----------|
| Error boundary / crash | 0 / 47 | 0 / 47 |
| Visible inline PageHero | 0 / 47 | 0 / 47 |
| Posture rows over cap (>3 / >2) | 0 / 47 | 0 / 47 |
| Console page errors per navigation | 0 / 47 | 0 / 47 |

Machine summary: [`UX-WAVE5-BASELINE.json`](./UX-WAVE5-BASELINE.json) (282 entries — 47 routes × beginner/advanced × 3 viewports; screenshots in `apps/admin/.playwright-mcp/admin-ux-wave5/`)

## Verification commands

```bash
cd apps/admin && pnpm typecheck && pnpm test && pnpm lint
node scripts/audit-admin-hint-duplication.mjs
node scripts/audit-admin-ux-wave5.mjs   # optional full 44-route JSON audit
cd examples/e2e-dogfood && npx playwright test admin-chrome-budget.spec.ts
```

**Parent burndown:** [`UX-UNIFICATION-BURNDOWN.md`](./UX-UNIFICATION-BURNDOWN.md) Phase 5.
