# Docs Site Token Contract

This document explains **how colours and typography work** on the public docs site so contributors do not introduce drift.

## Three layers (read bottom-up)

```
┌─────────────────────────────────────────┐
│  Your component (TSX or globals.css)    │
├─────────────────────────────────────────┤
│  apps/docs/lib/viz-tokens.ts (diagrams) │
├─────────────────────────────────────────┤
│  packages/brand/src/editorial.css       │  ← source of truth today
│  (--mushi-paper, --mushi-vermillion, …)│
└─────────────────────────────────────────┘
```

Future: `packages/brand/tokens/brand.tokens.json` will generate `editorial.css` via Style Dictionary (see [SDK-UI-UNIFICATION-DECISIONS.md](../admin/SDK-UI-UNIFICATION-DECISIONS.md) §6).

---

## Rules

### Do use

| Need | Use |
|------|-----|
| Page background / text | `var(--mushi-paper)`, `var(--mushi-ink)`, `var(--mushi-ink-muted)` |
| Borders / rules | `var(--mushi-rule)` |
| Brand accent (CTAs, selection) | `var(--mushi-vermillion)` + wash/ink variants |
| Success / low risk | `var(--mushi-jade)`, `var(--mushi-jade-wash)` |
| Medium / warning | `var(--mushi-viz-warn)`, `var(--mushi-viz-wash-warn)` |
| Diagram colours | `VIZ.*` from `lib/viz-tokens.ts` |
| Tailwind semantic classes (preferred in TSX) | `text-mushi-ink`, `text-mushi-ink-muted`, `border-mushi-rule`, `bg-mushi-paper-wash`, `text-mushi-vermillion` — defined in `apps/docs/app/globals.css` `@theme inline` |
| Nextra theme bridge | `var(--nextra-border)`, `var(--nextra-bg)` sparingly |

### Do not use

| Forbidden | Why |
|-----------|-----|
| `--docs-*` variables | Retired alias — CI fails if reintroduced |
| Tailwind palette (`bg-gray-500`, `text-amber-900`, …) | ESLint + `check-design-tokens.mjs` |
| Raw hex in components (`#10b981`) | Use `VIZ` semantic colours |
| Admin `@theme` tokens (`bg-surface`, `text-fg`) | Admin console only — docs does not load admin CSS |

### Acceptable exceptions

- **CSS var fallbacks** in legacy inline styles: `var(--mushi-vermillion, #e03c2c)` — prefer removing fallback once `editorial.css` is always loaded
- **Screenshot viewport chrome** `#0e0d0b` in `.docs-screenshot__viewport` — intentional letterbox
- **`// mushi-mushi-allowlist:`** comment for one-off third-party brand colours (rare on docs)

---

## Dark mode

Nextra toggles `.dark` on `<html>`. [`apps/docs/app/globals.css`](../../apps/docs/app/globals.css) mirrors brand dark tokens onto `.dark`.

Brand package also defines `[data-mushi-theme="dark"]` — docs use the Nextra bridge, not `data-mushi-theme`.

---

## Typography

- Display: `var(--mushi-font-display)` on `main` headings (set in globals.css)
- Mono: `var(--mushi-font-mono)` for commands, eyebrows, diagram labels
- Minimum visible size: **11px** in diagram labels; **12px** for interactive UI (`check-design-tokens.mjs` type floor)

---

## Nextra primary colour

Docs retint Nextra’s primary hue to vermillion via `--nextra-primary-*` overrides in `globals.css`. This keeps search, links, and theme chrome on-brand without forking Nextra.

---

## Verification

```bash
node scripts/check-design-tokens.mjs   # palette + --docs-* + type floor
cd apps/docs && pnpm lint              # mushi-mushi/no-raw-palette-color
```

When in doubt, grep an existing component in the same category (hero, diagram, hub) and match its pattern.
