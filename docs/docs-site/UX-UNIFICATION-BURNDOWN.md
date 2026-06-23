# Docs Site UX Unification Burndown

> Living burndown for the public Nextra docs (`apps/docs`) — editorial brand, MDX components, and `/connect`.
> Updated Jun 22 2026 after full audit + implementation pass.

## What this site is

The docs at `docs.mushimushi.dev` (and `kensaur.us/mushi-mushi/docs/`) are **developer documentation**, not the admin console. They use:

- **Nextra v4** for navigation, search, and MDX pages
- **`@mushi-mushi/brand/editorial.css`** for washi/sumi/vermillion tokens
- **Custom React components** for heroes, diagrams, migration hub, and pricing

**Buyer:** solo vibe coder installing SDK or wiring MCP — journey order is Get started → SDKs → Operate → Extend → Reference ([`content/_meta.ts`](../../apps/docs/content/_meta.ts)).

---

## Canonical patterns (target state)

```
Page chrome (Nextra sidebar + optional TOC)
  ├─ Marketing block: EditorialHero | AdminDocHero
  ├─ Trust / decision: OssTrustStrip | WhereToStartGrid
  ├─ Interactive: MigrationHub | PricingEstimator | ConnectLanePicker (/connect)
  └─ Prose + diagrams (DiagramFigure + VIZ tokens)
```

| Pattern | When to use |
|---------|-------------|
| `EditorialHero` | Landing + concept chapter openers (single H1) |
| `AdminDocHero` | Console operator pages with screenshot catalog |
| `DiagramFigure` + `VIZ` | Architecture / pipeline diagrams (light + dark) |
| `--mushi-*` CSS vars | All colours in components |
| Direct MDX import OR `mdx-components.tsx` | Both allowed; prefer registry for reusable blocks |

---

## Burndown by priority

### P0 — Broken UX ✅

| Item | Fix | Status |
|------|-----|--------|
| `--docs-*` tokens undefined | Migrated to `--mushi-*` in OssTrustStrip, SdkEnvMatrix, TroubleshootingAccordion | ✅ |
| Dead `/sdks/skills` link | Added [`content/sdks/skills.mdx`](../../apps/docs/content/sdks/skills.mdx) + sidebar entry | ✅ |
| Diagrams missing accessible names | `DiagramFigure` + `role="img"` / `aria-label` on judge/inventory/multi-repo | ✅ |

### P1 — Consistency ✅

| Item | Fix | Status |
|------|-----|--------|
| Diagram primitive duplication | [`components/diagram-primitives.tsx`](../../apps/docs/components/diagram-primitives.tsx) | ✅ |
| Raw hex in MultiRepoFlow | Uses `VIZ.positive` / `VIZ.warn` / `VIZ.danger` / `VIZ.muted` | ✅ |
| MigrationBadges `amber-*` | Uses `--mushi-viz-warn` editorial tokens | ✅ |
| Orphan admin MDX routes | Added to [`content/admin/_meta.ts`](../../apps/docs/content/admin/_meta.ts): connect, code-health, fullstack-audit | ✅ |
| Connect copy button a11y | `aria-label` on copy buttons (focus ring already in marketing-ui CSS) | ✅ |

### P2 — Surface wiring ✅

| Item | Fix | Status |
|------|-----|--------|
| Orphan components wired | `WhereToStartGrid` on home; `SdkEnvMatrix` + `TroubleshootingAccordion` on quickstart hub | ✅ |
| Hover-only affordances | `[@media(hover:hover)]:group-hover` on MigrationHub cards; connect CTA | ✅ |
| MDX registry | EvolutionDiagram, LoopComparison, PricingEstimator, WhereToStartGrid, etc. in `mdx-components.tsx` | ✅ |

### P3 — Guardrails ✅

| Item | Fix | Status |
|------|-----|--------|
| ESLint `no-raw-palette-color` | Enabled in [`apps/docs/eslint.config.js`](../../apps/docs/eslint.config.js) | ✅ |
| CI palette + `--docs-*` ban | [`scripts/check-design-tokens.mjs`](../../scripts/check-design-tokens.mjs) scans `apps/docs/components` | ✅ |
| Playwright smoke | [`examples/e2e-dogfood/tests/docs-site-smoke.spec.ts`](../../examples/e2e-dogfood/tests/docs-site-smoke.spec.ts) | ✅ |

### P4 — Polish (open)

| Item | Notes | Status |
|------|-------|--------|
| Semantic Tailwind utilities | `@theme inline` maps `--mushi-*` → `text-mushi-ink`, `border-mushi-rule`, etc.; TroubleshootingAccordion migrated | ✅ |
| DTCG Style Dictionary | Wait for monorepo job; `brand.tokens.json` → `editorial.css` | Open |
| DocsMediaShowcase on landing | Placed on home after 60-second proof; `.docs-media-showcase` grid CSS | ✅ |

---

## Verification

```bash
cd apps/docs
pnpm install
pnpm typecheck
pnpm lint
pnpm build

# Monorepo token guard (includes docs components)
node scripts/check-design-tokens.mjs

# Playwright (static export — matches production)
cd apps/docs && pnpm build && npx serve@latest out -l 3001
MUSHI_DOCS_URL=http://127.0.0.1:3001 pnpm exec playwright test examples/e2e-dogfood/tests/docs-site-smoke.spec.ts
```

Manual: home, `/connect`, `/quickstart`, `/migrations` at **390 / 1024 / 1440** px, light + dark.

---

## Related docs

- [COMPONENT-REGISTRY.md](./COMPONENT-REGISTRY.md) — which component to use where
- [TOKEN-CONTRACT.md](./TOKEN-CONTRACT.md) — colour tokens for contributors
- [apps/docs/README.md](../../apps/docs/README.md) — local dev + Migration Hub conventions
- [docs/admin/UX-UNIFICATION-BURNDOWN.md](../admin/UX-UNIFICATION-BURNDOWN.md) — **admin console** (separate surface)
