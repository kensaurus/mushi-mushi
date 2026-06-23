# Docs Site Component Registry

Quick reference for authors and contributors editing `apps/docs`. Every component lives under [`apps/docs/components/`](../../apps/docs/components/) unless noted.

## How to use a component in MDX

**Option A — global registry (preferred for reusable blocks):**

Components exported from [`mdx-components.tsx`](../../apps/docs/mdx-components.tsx) are available in any MDX file without an import:

```mdx
<WhereToStartGrid />
<TroubleshootingAccordion />
```

**Option B — direct import (fine for one-off concept pages):**

```mdx
import { LoopComparison } from '../../components/LoopComparison'

<LoopComparison />
```

Both patterns are supported. Register new shared components in `mdx-components.tsx` so authors do not repeat imports.

---

## Component table

| Component | Purpose | Typical page |
|-----------|---------|--------------|
| `EditorialHero` | Landing/chapter hero — **the only H1** on marketing pages | `/`, concepts |
| `AdminDocHero` | Console screenshot/GIF hero from catalog | `/admin/*` |
| `OssTrustStrip` | Open-source trust bullets (license, self-host) | `/` |
| `WhereToStartGrid` | Three-path “where to start” decision grid | `/` |
| `QuickstartGrid` | Four platform install cards with commands | `/` |
| `Pillars` | Capture → Fix loop strip | `/` |
| `ComparisonTable` | Foil vs Mushi comparison | `/` |
| `DocScreenshot` | Screenshot with lightbox | Home, admin docs |
| `DocsMediaShowcase` | Animated tour + SDK dogfood + theme-aware stills | Home (`index.mdx`) after 60-second proof |
| `MigrationHub` | Filterable migration guide grid | `/migrations` |
| `MigrationChecklist` | Per-guide interactive checklist | `/migrations/*` |
| `EffortBadge` / `RiskBadge` | Migration effort/risk chips | Hub + guide headers |
| `SdkEnvMatrix` | Framework × env var table | `/quickstart` |
| `TroubleshootingAccordion` | FAQ accordion for install issues | `/quickstart` |
| `Playground` | StackBlitz embed | SDK quickstarts |
| `PricingEstimator` | Interactive pricing slider | `/pricing` |
| `EvolutionDiagram` | Closed-loop pipeline | `/concepts/closed-loop` |
| `LoopComparison` | SDLC vs cumulative selection | Concepts |
| `InventoryModelDiagram` / `GatesStrip` | Inventory model + gates | Concepts / inventory |
| `JudgeLoops` / `JudgeScoreBreakdown` / `FineTunePipeline` | Judge system visuals | Concepts / admin |
| `MultiRepoFlowDiagram` | Multi-repo fix coordination | `/concepts/multi-repo-fixes` |
| `SpecTracePipeline` | Spec traceability stages | Inventory concepts |
| `ConnectLanePicker` | Client + lane picker | **`/connect` page only** (marketing-ui) |

---

## Diagram building blocks

Shared primitives: [`diagram-primitives.tsx`](../../apps/docs/components/diagram-primitives.tsx)

| Export | Role |
|--------|------|
| `DiagramFigure` | Outer shell — **always** pass `ariaLabel` |
| `DiagramNode` | Pipeline node box |
| `DiagramHArrow` / `DiagramVArrow` | Connectors |
| `DiagramStep` | Numbered step row |

Colours: import `VIZ` from [`lib/viz-tokens.ts`](../../apps/docs/lib/viz-tokens.ts) — never raw Tailwind palette classes.

---

## Special route: `/connect`

Not MDX — React page at [`app/connect/page.tsx`](../../apps/docs/app/connect/page.tsx).

- Uses `@mushi-mushi/marketing-ui` + `@mushi-mushi/mcp/clients`
- **Placeholder keys only** on public docs; real mint happens in admin console
- Styled with `.mushi-connect-*` classes from marketing-ui CSS

Do not duplicate Connect UI in MDX; link to `/connect` or admin Connect hub doc.

---

## Adding a new component (checklist)

1. Create `apps/docs/components/YourComponent.tsx`
2. Use `--mushi-*` or `VIZ` tokens — see [TOKEN-CONTRACT.md](./TOKEN-CONTRACT.md)
3. Register in `mdx-components.tsx` if used on more than one page
4. Add `@source` coverage is automatic via `globals.css` (`components/**`)
5. Run `pnpm --filter @mushi-mushi/docs lint` and `node scripts/check-design-tokens.mjs`
6. Update this registry table
