# 0003. Feed gradient custom properties through `bg-(image:--var)`

Status: Accepted            Date: 2026-08-19

## Context

The admin console's expressive control set paints its primary and accent
buttons with brand gradient tokens (`--gradient-brand`, `--gradient-accent`)
so a white-label override cascades automatically. The obvious way to consume a
custom property in Tailwind is `bg-[var(--gradient-brand)]`.

In Tailwind v4 the square-bracket form is **typed as a color** and compiles to
`background-color: var(--gradient-brand)`. A gradient is not a valid color, so
the browser drops the declaration and the element paints no background at all.
The button keeps its near-white `text-brand-fg`, and the result is white text
on the bare page — about 1.3:1, effectively invisible.

This shipped undetected. The class string reads as correct, and it passes lint,
typecheck, `check:design-tokens`, and the raw-`var()` audits; only rendering
reveals it. It was found when the primary "Sign in" CTA was reported as a
blank grey slab.

## Decision

Gradient custom properties are consumed through the data-type-hinted form,
`bg-(image:--gradient-brand)`, which compiles to `background-image`. Every such
utility also carries a flat `bg-brand` / `bg-accent` underneath so the control
stays legible if the gradient token is ever absent.
`scripts/check-gradient-utilities.mjs` (wired into `pnpm check:design`) fails
the build on the square-bracket form.

## Rejected alternatives

- **`bg-[var(--gradient-brand)]`** — the intuitive syntax, and what we shipped.
  Rejected: compiles to `background-color`, renders nothing. This is the whole
  reason the ADR exists.
- **`style={{ backgroundImage: 'var(--gradient-brand)' }}`** — works, but moves
  a themed value out of the utility layer into inline styles, where the design
  audits cannot see it.
- **A hand-written `.btn-primary` CSS class** — works, but reintroduces the
  bespoke-CSS layer the component set exists to replace.
- **Drop gradients, use flat `bg-brand`** — simplest and immune to the trap.
  Rejected as a product-visual decision, not a technical one; the flat fill is
  kept as the fallback instead.

## Consequences

Any new gradient-backed utility must use the parenthesis form; the guard makes
the failure mode a red build instead of an invisible control. The trap is
Tailwind-v4-specific — revisit if a future version types
`bg-[var(--x)]` by resolved value rather than by syntax.
