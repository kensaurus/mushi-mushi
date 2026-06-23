# SDK + Admin UI Unification — Product Decisions (Jun 2026)

Recorded answers for Phase C open questions in the [SDK UI unification plan](../execplans/). These are **defaults for implementation** until product explicitly revises them.

## 1. FAB shape policy

**Decision:** Shared **52px** footprint from `MUSHI_GEOMETRY.fabSize`; **shape diverges by platform**.

| Platform | Size | Shape | Rationale |
|----------|------|-------|-----------|
| Web widget | 52px | Square stamp (`border-radius: control`) | Editorial hanko affordance in Shadow DOM |
| React Native | 52px | Circle (`borderRadius: size/2`) | Material/iOS FAB convention + thumb reach |

Do not change web to a circle without a major widget version bump.

## 2. BetaBanner vs SDK banner

**Decision: Option B — intentional divergence.**

- **Admin `BetaBanner`** (`bg-lime-muted`) is an **operator-console-only** beta strip. It dogfoods the *report flow* via `reportMushiBug()`, not the customer-facing `MushiBannerConfig` variants (`neon` / `brand` / `subtle`).
- **Customer SDK** defaults to configurable banner modes documented in Projects → SDK config.
- SdkInstallCard preview uses `getWidgetPreviewTokens()` from `@mushi-mushi/web` so operators see **runtime palette**, not admin lime.

## 3. RN parity scope (2026 H2)

**Shipped in this pass:**

| Feature | Web | RN | Notes |
|---------|-----|-----|-------|
| Banner launcher | ✅ | ✅ | `MushiBanner` when `trigger: 'banner'` |
| Assistant Ask tab | ✅ | ✅ | Config `assistant.enabled`; sheet tab |
| FAB geometry | ✅ | ✅ | `MUSHI_GEOMETRY.fabSize` |
| Intent step | ✅ | ⏸ | Deferred — RN keeps category → description |
| Screenshot preview parity | ✅ | ⚠️ | RN has thumbnail; markup tools web-only |
| 10 panel steps | ✅ | 3 tabs | By design until RN sheet v2 |

**Not in scope:** Full web step parity, element picker, roadmap/leaderboard tabs on RN.

## 4. Detail route posture

**Decision:** **Yes** — compact one-row `PagePosture` on `/reports/:id`.

- Slot: status + severity badges + inline `FixCiFeedback` when a fix PR exists.
- `DispatchPreflightBanner` stays in the posture slot when dispatch is eligible (same priority row via flex-wrap).
- `RecommendedAction` remains primary work UI below posture (not duplicated in posture).

## 5. Tester portal

**Unchanged:** No unify with operator `@theme` per [`tester-portal-design.md`](./tester-portal-design.md).

## 6. DTCG / Style Dictionary timing

**Decision:** Incremental now, pipeline later.

1. **Now:** `packages/brand/tokens/brand.tokens.json` (W3C DTCG 2025.10) as documented primitive source; `design-tokens.ts` + `editorial.css` remain build outputs until Style Dictionary v5 wiring lands.
2. **Later:** Style Dictionary job generates `editorial.css` + TS exports from the JSON file; delete hand-maintained duplicates in one migration PR.
