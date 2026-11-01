# Admin design-system reference

Authoritative catalog for Design System v2 primitives used in the operator console.

## Three-layer token model

| Layer | Source | Consumed by |
|-------|--------|-------------|
| **Primitives (DTCG)** | [`packages/brand/tokens/brand.tokens.json`](../../../packages/brand/tokens/brand.tokens.json) → `pnpm build:brand-tokens` → [`packages/brand/src/editorial.css`](../../../packages/brand/src/editorial.css) + `tokens.generated.ts` | Public/marketing (`--mushi-*`), docs, editorial pages |
| **Semantic (`@theme`)** | [`apps/admin/src/index.css`](../index.css) → [`styles/theme-tokens.css`](../styles/theme-tokens.css) (+ modes / ask-mushi / components partials) — oklch color roots, spacing, type scale | Operator console Tailwind utilities (`bg-surface`, `text-fg-muted`, …) |
| **Component recipes** | [`lib/chipTone.ts`](../lib/chipTone.ts), [`lib/tokens.ts`](../lib/tokens.ts), [`lib/motion-tokens.ts`](../lib/motion-tokens.ts) | Badges, banners, posture chips, viz runtime |

### Rules from the 2026-09-23 consolidation pass (each one shipped a visible bug)

| Rule | Canonical form | Why | Enforced by |
|------|----------------|-----|-------------|
| One filled CTA | `<Btn>` (`primary`) or `btnClass()` from [`lib/btnRecipe.ts`](../lib/btnRecipe.ts) for a `<Link>`/`<a>` | A violet `accent` Save sat next to a vermillion one; ~15 flat hand-rolled twins drifted in padding | `check:hand-rolled-cta`, `btn-gradient.test.ts` |
| Disabled filled button = neutral well | `disabled:bg-surface-overlay` (in the recipe) | Brand fill at 40% opacity read as salmon / lavender | `btn-gradient.test.ts` |
| Mix colours in **oklab** | `color-mix(in oklab, …)` / `color-mix(in_oklab,…)` | `in oklch` swings a brand tint toward the neutrals' hue 285 → lavender | `check:design-tokens` |
| Class roots must exist exactly | e.g. `text-fg-muted`, never `text-fg-tertiary` | Unknown roots render nothing; the old check accepted any first-segment match | `check:design-tokens` |
| Brand copy on a brand wash | `text-brand-foreground` | Light-mode vermillion is ~4:1 on white, lower on its own wash | `check:chip-contrast` |
| One surface per nesting level | A card inside a `Panel`/grid that draws dividers has no border or fill of its own ([`integrations/cardChrome.ts`](../components/integrations/cardChrome.ts)) | `bg-surface` (0.965) inside a white panel read as grey "bleeding" + double outlines | review |
| No grey wells inside cards | Rows sit on the card surface; a note is a divider or left rule | `bg-surface-overlay/NN` washes were the darkest grey in the light ramp | review |
| Help / guide chrome is neutral | `bg-chrome` / `border-chrome-border` | The `ok` success green was used as decoration | `guideSurfaces.test.ts` |
| One base display per class list | `hidden xl:inline-flex` **or** `inline-flex` | Both set `display`; `inline-flex` won and header badges never hid | `check:display-conflict` |
| Panel-header "see all" = plain link | `PANEL_HEADER_LINK` in `lib/chipTone.ts` | Brand pills read as a second primary button | review |
| Top-bar controls share one height | `HEADER_CONTROL_BASE` (h-8) in `ui/chrome.tsx` | Search, switchers, version pill and icons were 24–34px with four treatments | review |
| Inline code follows the theme | `.mushi-code-inline`; multi-line code/logs keep the dark `.mushi-code-block` | Terminal-black URL chips inside white cards | review |

Escape hatch for every script gate: `// mushi-mushi-allowlist: <reason>` on the line (or the line above), reviewed like any other change.

**Rule of thumb:** never hand-roll `bg-*-muted text-*` or opacity chips (`bg-ok/15 text-ok`) — use `CHIP_TONE.*`, `statusChipTone()`, or `runStatusChipTone()`. For soft selected/pressed chips use `SELECTED_TONE` / `SELECTED_TONE_IDLE` (not `bg-brand/12 text-brand border border-brand/28`). Header PageHeaderBar severity Badge fallbacks use `HEADER_BADGE_TONE.brand` / `.neutral`. ESLint enforces muted pairings via `mushi-mushi/no-raw-semantic-on-muted` and redundant borders via `mushi-mushi/no-redundant-border-on-chip-tone`; CI also runs `scripts/audit-chip-contrast.mjs --strict` (muted + opacity). Prefer `editorial-*` utilities over raw `var(--mushi-*)` in operator TSX.

### Container-query responsive grids (Wave 2)

Reusable cards that split into columns must respond to **their own width**, not the viewport — otherwise nesting a `lg:grid-cols-2` card inside a page-level `xl:grid-cols-2` squeezes content to ~¼ width on wide screens.

```tsx
<div className="@container/sdk">
  <div className="grid gap-4 @2xl/sdk:grid-cols-2">…</div>
</div>
```

- Put `@container/{name}` on a **wrapper**; put `@*\/{name}:grid-cols-*` on the **child grid**.
- Prefer named containers when nesting.
- Ban nesting a viewport `md:/lg:/xl:grid-cols-*` inside another at an equal-or-smaller breakpoint.

Editorial (`data-mushi-theme`) and operator (`data-theme`) stacks stay intentionally separate. The SDK widget uses [`packages/core/src/design-tokens.ts`](../../../packages/core/src/design-tokens.ts).

Regenerate editorial primitives:

```bash
pnpm build:brand-tokens
```

## PagePosture slot recipes

Vitest-rendered recipes live in `page-posture-recipes.ts` (Storybook-equivalent — no separate Storybook app in this package).

| Recipe ID | Reference route | Slots |
|-----------|-----------------|-------|
| `status-only` | `/anti-gaming` | Status banner |
| `status-snapshot` | `/audit` | Banner → SnapshotStrip |
| `status-snapshot-guide` | `/rewards` | Banner → SnapshotStrip → Guide/Readout |

### Canonical page order

```
PageHeaderBar
PagePosture (≤2 rows Beginner · ≤3 Advanced)
SegmentedControl (scrollable when 4+ tabs)
Primary work UI
```

### Guardrails

- ESLint `mushi-mushi/no-hand-rolled-tablist` — warn on `role="tablist"` in `*Page.tsx`
- ESLint `mushi-mushi/no-missing-page-posture` — warn when operator pages omit `PagePosture`
- ESLint `mushi-mushi/no-raw-semantic-on-muted` — error on WCAG-failing chip pairings
- ESLint `mushi-mushi/no-redundant-border-on-chip-tone` — warn when appending `border` onto CHIP_TONE recipes
- ESLint `mushi-mushi/no-text-3xs-on-interactive` — error (12px floor on buttons/links)
- ESLint `mushi-mushi/no-allowlist-jsx-textnode` — error (`// mushi-mushi-allowlist` as JSX child text; use `{/* … */}` or attribute-line `//`)
- `node scripts/audit-chip-contrast.mjs --strict` — CI gate for muted **and** opacity chip contrast drift
- `node scripts/check-design-tokens.mjs` — unknown roots, hex, raw `var(--mushi-*)` in operator TSX, theme pairs
- `node scripts/audit-admin-hint-duplication.mjs` — PageHeaderBar hint dedupe audit
- Playwright [`examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts`](../../../examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts) — posture row budget + contrast spot-checks (`/health`, `/reports`, `/marketplace`)
- Playwright [`examples/e2e-dogfood/tests/admin-visual-regression.spec.ts`](../../../examples/e2e-dogfood/tests/admin-visual-regression.spec.ts) — visual baseline (extend before adding Storybook/Chromatic)
- Cross-surface governance: [`docs/DESIGN-SYSTEM.md`](../../../docs/DESIGN-SYSTEM.md)
- Open burndown: [`docs/plan-uiux-unification.md`](../../../docs/plan-uiux-unification.md)
- Wave 2 Connect/chrome: [`docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md`](../../../docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md)

See also: `docs/admin/UX-UNIFICATION-BURNDOWN.md` (chrome wave — closed); this token/CSS debt pass is the follow-on.
