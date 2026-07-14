# Admin design-system reference

Authoritative catalog for Design System v2 primitives used in the operator console.

## Three-layer token model

| Layer | Source | Consumed by |
|-------|--------|-------------|
| **Primitives (DTCG)** | [`packages/brand/tokens/brand.tokens.json`](../../../packages/brand/tokens/brand.tokens.json) → `pnpm build:brand-tokens` → [`packages/brand/src/editorial.css`](../../../packages/brand/src/editorial.css) + `tokens.generated.ts` | Public/marketing (`--mushi-*`), docs, editorial pages |
| **Semantic (`@theme`)** | [`apps/admin/src/index.css`](../index.css) → [`styles/theme-tokens.css`](../styles/theme-tokens.css) (+ modes / ask-mushi / components partials) — oklch color roots, spacing, type scale | Operator console Tailwind utilities (`bg-surface`, `text-fg-muted`, …) |
| **Component recipes** | [`lib/chipTone.ts`](../lib/chipTone.ts), [`lib/tokens.ts`](../lib/tokens.ts), [`lib/motion-tokens.ts`](../lib/motion-tokens.ts) | Badges, banners, posture chips, viz runtime |

**Rule of thumb:** never hand-roll `bg-*-muted text-*` or opacity chips (`bg-ok/15 text-ok`) — use `CHIP_TONE.*`, `statusChipTone()`, or `runStatusChipTone()`. ESLint enforces muted pairings via `mushi-mushi/no-raw-semantic-on-muted`; CI also runs `scripts/audit-chip-contrast.mjs --strict` (muted + opacity). Prefer `editorial-*` utilities over raw `var(--mushi-*)` in operator TSX.

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
- ESLint `mushi-mushi/no-text-3xs-on-interactive` — error (12px floor on buttons/links)
- `node scripts/audit-chip-contrast.mjs --strict` — CI gate for muted **and** opacity chip contrast drift
- `node scripts/check-design-tokens.mjs` — unknown roots, hex, raw `var(--mushi-*)` in operator TSX, theme pairs
- `node scripts/audit-admin-hint-duplication.mjs` — PageHeaderBar hint dedupe audit
- Playwright `admin-chrome-budget.spec.ts` — posture row budget + contrast spot-checks (`/health`, `/reports`, `/marketplace`)

See also: `docs/admin/UX-UNIFICATION-BURNDOWN.md` (chrome wave — closed); this token/CSS debt pass is the follow-on.
