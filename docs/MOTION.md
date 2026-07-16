# Mushi Motion Constitution

Rules for uplifting the **existing** design system. Apply on every surface
(core tokens, web widget, admin console, docs landing).

## The six rules

1. **Never hijack global scroll.** No Lenis, ScrollSmoother, or ScrollTrigger
   pinning / scrub timelines that own the document.
2. **Scope every animation to a single component:** hover, focus, press,
   enter/exit, or state/layout change — never page-global.
3. **Prefer CSS transitions + declarative per-component APIs** over imperative
   scroll timelines.
4. **Only animate `transform` and `opacity`.** Respect `prefers-reduced-motion`.
5. **After each change, verify:** sticky headers, anchor links, modals, and
   nested scroll still work. On Capacitor, test scroll on a real device.
6. **Add one interaction at a time** and check the page before the next.

### Allowed layout exception

Disclosure panels may animate `grid-template-rows` (`0fr` → `1fr`) so height
easing stays correct. Do not use that pattern for page chrome or scroll.

**Meter exception:** progress / quota bars may animate `width` (or prefer
`transform: scaleX`) when the fill percentage is data-driven. Keyboard inset
on the web widget may animate `bottom` / `top` / `max-height` for IME layout.
SVG rings may animate `stroke-dashoffset`. Admin shell sidebar may animate
`width` on collapse (paired with existing spring chrome).

## Token SSOT

| Token | Source | Notes |
|-------|--------|-------|
| Stamp ease | `MUSHI_MOTION.easeStamp` / `--ease-stamp` | Kinetics-aligned soft back-out |
| Durations | `MUSHI_DURATION` / `--duration-*` | instant 120 · fast 200 · base 220 · panel 300 · slow 420 · ring 700 |

Admin CSS mirrors these in `apps/admin/src/styles/theme-tokens.css`.
The web widget reads them from `@mushi-mushi/core` inside Shadow DOM CSS.

## Library matrix

| Library | Allowed? | Use for |
|---------|----------|---------|
| Kinetics easings (as tokens) | Yes — keep | `--ease-stamp` / `easeStamp` |
| CSS transitions / `@keyframes` | Yes | Hover, focus, press, loaders, tooltips |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | Yes | Tailwind v4 enter/exit utilities |
| [Auto-Animate](https://auto-animate.formkit.com/) | Yes | List/chip DOM add/remove/move only |
| [Motion](https://motion.dev/) / framer-motion | Yes | Component enter/exit, `whileInView`, overlays |
| Lenis / ScrollSmoother / ScrollTrigger pin | **No** | — |
| Colorion toggles / loaders / tooltips | Curate 1 each | Copy patterns into tokens — do not dump libraries |

## Surfaces

- **Core** — `packages/core/src/design-tokens.ts`
- **Web widget** — `packages/web/src/styles.ts` (Shadow DOM)
- **Admin** — `theme-tokens.css`, `components.css`, `lib/motion-tokens.ts`
- **Docs landing** — native scroll + Motion `whileInView` / CSS only

## Verification checklist

- [ ] No `landing-lenis` (or equivalent) on `documentElement`
- [ ] Sticky headers still stick
- [ ] Hash / TOC anchors jump correctly
- [ ] Modals and drawers open/close without trapping scroll incorrectly
- [ ] Nested scroll (tables, code blocks, widget body) still scrolls
- [ ] OS `prefers-reduced-motion: reduce` disables enter animations
