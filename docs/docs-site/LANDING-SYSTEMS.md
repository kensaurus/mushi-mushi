# Landing systems — intentional split

> Decision recorded Jul 2026 as part of [`docs/plan-uiux-unification.md`](../plan-uiux-unification.md) Phase D.

## Decision

**Keep two landing implementations** for now; do not force a single Hero.

| Surface | Implementation | Consumer |
|---------|----------------|----------|
| Docs site home | `apps/docs/components/landing/*` (cinematic / scroll stages) | Nextra MDX index |
| Admin public home + marketing embeds | `packages/marketing-ui` (`Hero`, `ClosingCta`, canvas, connect) | `PublicHomePage`, docs `/connect` |

## Why

- Docs landing is scroll-cinematic and MDX-coupled; marketing-ui Hero is reusable SPA/section chrome.
- Both already share the **same copy north-star** (enforced by `check:positioning`) and `--mushi-*` tokens.
- Converging layouts would be a large visual rewrite with high regression risk and little brand-consistency gain.

## Rules for contributors

1. Do **not** invent a third hero. Extend one of the two trees.
2. Shared copy constants come from `@mushi-mushi/brand` / `landing-copy.ts` — never fork the H1.
3. Prefer `marketing-ui` for any new **admin public** or **connect** surface.
4. Prefer `apps/docs/components/landing` for docs-only cinematic sections.
5. If a layout block is needed on both, extract into `packages/marketing-ui` first.

## Related

- Motion constitution: [`docs/MOTION.md`](../MOTION.md)
- Design system SSOT: [`docs/DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md)
- Landing anti-slop history: [`apps/docs/plan-antislop.md`](../../apps/docs/plan-antislop.md)

## `/connect` shell

Docs `/connect` (`apps/docs/app/connect`) intentionally renders **outside** the default Nextra article chrome so the Connect studio can use full viewport + marketing-ui CSS. Keep that unless product asks for sidebar parity.
