# Mushi Design System (cross-surface)

> Living governance doc for the three intentional visual identities and the
> shared primitive source of truth. Companion burndown:
> [`docs/plan-uiux-unification.md`](./plan-uiux-unification.md).

## North star

Enhance the existing system — do not replace it. Operator console (amber/zinc),
editorial/marketing/docs (washi/vermillion), and the SDK widget (washi/vermillion
hex) stay visually distinct. What is unified: **primitive tokens**, **scales**,
and **guardrails**.

## Three identities

| Identity | Surface | Theme attribute | Token entry |
|----------|---------|-----------------|-------------|
| Operator | `apps/admin` console | `html[data-theme]` | `@theme` in `apps/admin/src/styles/theme-tokens.css` |
| Editorial | docs, marketing-ui, testers, admin public pages | `data-mushi-theme` / Nextra `.dark` | `--mushi-*` from `@mushi-mushi/brand/editorial.css` |
| Widget | `@mushi-mushi/web` + `@mushi-mushi/react-native` | JS `getTheme()` | `@mushi-mushi/core` `design-tokens.ts` |

Product decisions (FAB shape, BetaBanner vs SDK banner, RN parity):  
[`docs/admin/SDK-UI-UNIFICATION-DECISIONS.md`](./admin/SDK-UI-UNIFICATION-DECISIONS.md).

## Token ownership

```
packages/brand/tokens/brand.tokens.json   ← DTCG SSOT (edit here)
        │
        ▼  pnpm build:brand-tokens
packages/brand/src/editorial.css          ← --mushi-* for public surfaces
packages/brand/src/tokens.generated.ts    ← TS snapshot (+ BRAND_WIDGET_PALETTE_LIGHT)
        │
        ├─ apps/docs, packages/marketing-ui, apps/testers
        ├─ apps/admin editorial bridge (--color-editorial-*)
        └─ packages/core/src/design-tokens.ts  (must stay parity-checked)
```

**Who owns what**

| Change | Owner path | Gate |
|--------|------------|------|
| New primitive color / scale | `brand.tokens.json` → rebuild | `check:brand-tokens-fresh` + `check:token-parity` |
| Operator semantic token | `theme-tokens.css` | `check:design-tokens` |
| Widget visual change | `core/design-tokens.ts` + `web/styles.ts` | `no-raw-hex-in-widget` + web tests |
| Chip / status recipes | `apps/admin/src/lib/chipTone.ts` | `check:chip-contrast` |

## Scales (shared vocabulary)

| Scale | Brand CSS | Core TS | Admin |
|-------|-----------|---------|-------|
| Spacing | `--mushi-space-*` | `MUSHI_SPACING` | Tailwind spacing + density |
| Radius | `--mushi-radius-*` | `MUSHI_RADIUS` | `--radius-*` |
| Type size | `--mushi-text-*` | `MUSHI_TYPE` | `--text-2xs`…`--text-display` |
| Elevation | `--mushi-elevation-*` | (widget shadows) | `--shadow-card/raised` |
| Z-index | `--mushi-z-*` | `MUSHI_Z` | `--z-sticky`…`--z-toast` |
| Motion | `--mushi-ease-stamp`, `--mushi-duration-*` | `MUSHI_MOTION` / `MUSHI_DURATION` | `--ease-stamp`, `--duration-*` |

## Component catalogs

| Surface | Primitives | Notes |
|---------|------------|-------|
| Admin | `apps/admin/src/components/ui/*` via `ui.tsx` barrel | Prefer `Btn`, `Modal`, `Drawer`, `CHIP_TONE`, `PageHeaderBar` + `PagePosture` |
| Admin page order | [`page-scaffold.ts`](../apps/admin/src/components/ui/page-scaffold.ts) | Canonical Page* set |
| Admin recipes | [`_design-system-README.md`](../apps/admin/src/design-system/_design-system-README.md) | Posture slots |
| Docs | [`docs/docs-site/COMPONENT-REGISTRY.md`](./docs-site/COMPONENT-REGISTRY.md) + TOKEN-CONTRACT | `--mushi-*` only |
| Marketing | `packages/marketing-ui` | Token-driven; no own palette |
| Widget | Shadow DOM classes in `packages/web/src/styles.ts` | Hex only via core |

## ESLint rule graduation

Rules live in `packages/eslint-plugin-mushi-mushi`.

1. **New rule** ships as `warn` in `recommended` (or admin-only) for one release.
2. After debt is cleared, promote to `error` in `recommended` and/or admin config.
3. Domain exceptions use `// mushi-mushi-allowlist: <reason>` on the preceding line.

`recommended` currently includes: dead-handler, mock-leak, raw-palette, text-3xs floor,
hand-rolled dialog/tablist, missing posture, legacy shadcn, accent-for-selection,
raw-hex-in-widget, card-elevated allowlist, raw-semantic-on-muted, raw-css-var-text.

## Adopting a new surface

1. Depend on `@mushi-mushi/brand` (editorial) and/or `@mushi-mushi/core` (widget).
2. Wire `eslint-plugin-mushi-mushi` `recommended` in the package eslint config.
3. Add the package path to `scripts/check-design-tokens.mjs` scan roots if it uses Tailwind semantic classes.
4. Do **not** invent a fourth palette — extend `brand.tokens.json`.

## Verification

```bash
pnpm check:design          # tokens + brand freshness + parity + motion + chip + audits
pnpm --filter @mushi-mushi/admin lint typecheck
pnpm --filter @mushi-mushi/web test
pnpm --filter @mushi-mushi/docs lint
```

Visual regression: Playwright dogfood specs  
`examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts` and  
`examples/e2e-dogfood/tests/admin-visual-regression.spec.ts`  
(no Storybook/Chromatic in-repo by design — extend Playwright baselines first).

## Voice

Public marketing: [`docs/marketing/VOICE.md`](./marketing/VOICE.md) + `pnpm check:public-voice`.  
Console microcopy: prefer `apps/admin/src/lib/copy.ts`; `pnpm check:console-voice` bans VOICE.md corporate lexicon in admin TSX strings.
