# Admin design-system reference

Authoritative catalog for Design System v2 primitives used in the operator console.

## Three-layer token model

| Layer | Source | Consumed by |
|-------|--------|-------------|
| **Primitives (DTCG)** | [`packages/brand/tokens/brand.tokens.json`](../../../../packages/brand/tokens/brand.tokens.json) → `pnpm build:brand-tokens` → [`packages/brand/src/editorial.css`](../../../../packages/brand/src/editorial.css) + `tokens.generated.ts` | Public/marketing (`--mushi-*`), docs, editorial pages |
| **Semantic (`@theme`)** | [`apps/admin/src/index.css`](../index.css) → [`styles/theme-tokens.css`](../styles/theme-tokens.css) (+ modes / ask-mushi / components partials) — oklch color roots, spacing, type scale | Operator console Tailwind utilities (`bg-surface`, `text-fg-muted`, …) |
| **Component recipes** | [`lib/chipTone.ts`](../lib/chipTone.ts), [`lib/actionIntent.ts`](../lib/actionIntent.ts), [`lib/tokens.ts`](../lib/tokens.ts), [`lib/motion-tokens.ts`](../lib/motion-tokens.ts) | Badges, banners, posture chips, action intents, viz runtime |

**Rule of thumb:** never hand-roll `bg-*-muted text-*`, opacity chips (`bg-ok/15 text-ok`) or a grey `bg-surface-overlay` chip. Use a tone from `CHIP_TONE` (`ok · warn · danger · info · accent · brand · medium · neutral`) through a primitive below. Each tone is a tinted fill + its `*-foreground` ink + `inset-ring inset-ring-<tone>-edge`. The ring is inset, so chips never grow. For soft selected/pressed chips use `SELECTED_TONE` / `SELECTED_TONE_IDLE`. Prefer `editorial-*` utilities over raw `var(--mushi-*)` in operator TSX.

### Chip, tag, count, banner and action primitives (2026-11-27, ADR 0071)

| You need | Use | Not |
|----------|-----|-----|
| A label, plan tag, "Beta", "you", "Local dev" | `<Badge tone="brand">Beta</Badge>` (defaults to `neutral`; `icon` for a leading glyph) | `<span className="bg-brand-subtle text-brand px-1">` |
| A bug severity | `<SeverityPill severity="critical" short />` → "▲ Crit" | tinted "Crit" text, colour alone |
| A run state (queued / running / succeeded / failed) | `<StatusPill status="passed" label="Succeeded" />` (signal kit) | `Badge className={runStatusChipTone(…)}` for a run |
| A count (sidebar, tab, "+3") | `<CountBadge count={n} tone="danger" label="3 failed fixes" />` | coloured digits |
| A keyboard shortcut | `<Kbd>Ctrl</Kbd><Kbd>K</Kbd>` | grey text |
| Tabs / views | `SegmentedControl`: selected = raised tile + accent edge | an accent wash on the label |
| A banner or note | `<Callout tone="info">` (tone edge, 2px leading bar, default icon) | `<p className="bg-info-muted …">` |
| A row or inline action | `<Btn intent="fix">Fix →</Btn>`, `intent="triage"`, `"primary"`, `"neutral"`, `"destructive"`; `btnClassName({ intent })` when it can't be a `Btn` | per-page `bg-brand text-brand-fg` pills |
| Freshness | `FreshnessPill` | — |

Intent → colour: `fix` = solid danger red (the Critical hue), `triage` = solid amber `warn-fill` with **dark** ink (white on yellow fails AA; this is the High hue), `primary` = brand, `neutral` = ghost, `destructive` = red confirm (never a row action). The map is in `lib/actionIntent.ts`, and `reportRowIntent(status)` picks one for a report row.

**Don't:** put text on a flat tint with no edge, append `border`/`ring-1` to a `CHIP_TONE` recipe, or mix your own `/50` alpha. A heat-map cell, a full-width diff line, or a preview of the host app's own palette may keep a fill; mark it `// mushi-mushi-allowlist: <reason>`.

Gates: `pnpm check:tinted-text` (`scripts/audit-tinted-text.mjs`, also in `lint:tokens` and `check:design`), ESLint `mushi-mushi/no-raw-semantic-on-muted` and `no-redundant-border-on-chip-tone`, `scripts/audit-chip-contrast.mjs --strict`. Contrast proof for every tone, edge and intent fill in dark / light / high contrast: `packages/server/src/__tests__/console-tone-contrast.test.ts`. Inventory and readability numbers: [`docs/design/tinted-text-inventory-2026-11-27.md`](../../../../docs/design/tinted-text-inventory-2026-11-27.md).

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

Editorial (`data-mushi-theme`) and operator (`data-theme`) stacks stay intentionally separate. The SDK widget uses [`packages/core/src/design-tokens.ts`](../../../../packages/core/src/design-tokens.ts).

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
- ESLint `mushi-mushi/no-redundant-border-on-chip-tone` — warn when appending `border` / `ring-1` onto CHIP_TONE recipes (they carry their inset ring edge)
- `node scripts/audit-tinted-text.mjs --strict` — CI gate: no text on a tinted fill without an edge (`pnpm check:tinted-text`)
- ESLint `mushi-mushi/no-text-3xs-on-interactive` — error (12px floor on buttons/links)
- ESLint `mushi-mushi/no-allowlist-jsx-textnode` — error (`// mushi-mushi-allowlist` as JSX child text; use `{/* … */}` or attribute-line `//`)
- `node scripts/audit-chip-contrast.mjs --strict` — CI gate for muted **and** opacity chip contrast drift
- `node scripts/check-design-tokens.mjs` — unknown roots, hex, raw `var(--mushi-*)` in operator TSX, theme pairs, and retired forms (`err`, `warning`, `warning-foreground`, `*-subtle`, `surface-2/3`, `fg-primary`, `duration-micro`, `text-label/body/title/heading/display`, the old `--z-*` names, bracketed z-index literals and bare z-index utilities above 50, hand-written keycap / overlay shadows; decision log in [`docs/design/housekeep-design-state-2026-10-16.md`](../../../../docs/design/housekeep-design-state-2026-10-16.md))
- Finding severity chips (error / warn / info) use `FindingSeverityBadge`; PR state chips use `prStateChipTone()` / `PR_STATE_TONE_KEY` from `lib/chipTone.ts`
- Stacking: Tailwind `z-0`…`z-50` inside the app shell, `z-(--z-toast | --z-alert | --z-top)` above it
- `node scripts/audit-admin-hint-duplication.mjs` — PageHeaderBar hint dedupe audit
- Playwright [`examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts`](../../../../examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts) — posture row budget + contrast spot-checks (`/health`, `/reports`, `/marketplace`)
- Playwright [`examples/e2e-dogfood/tests/admin-visual-regression.spec.ts`](../../../../examples/e2e-dogfood/tests/admin-visual-regression.spec.ts) — visual baseline (extend before adding Storybook/Chromatic)
- Cross-surface governance: [`docs/DESIGN-SYSTEM.md`](../../../../docs/DESIGN-SYSTEM.md)
- Open burndown: [`docs/plan-uiux-unification.md`](../../../../docs/plan-uiux-unification.md)
- Wave 2 Connect/chrome: [`docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md`](../../../../docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md)

See also: `docs/admin/UX-UNIFICATION-BURNDOWN.md` (chrome wave — closed); this token/CSS debt pass is the follow-on.
