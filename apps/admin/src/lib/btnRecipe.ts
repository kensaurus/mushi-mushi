/**
 * FILE: apps/admin/src/lib/btnRecipe.ts
 * PURPOSE: The one button recipe. <Btn> renders it; `btnClass()` hands the
 *          same string to elements that must not be a <button> (a router
 *          <Link>, an <a>, a toast action).
 *
 *          Lives in lib/ beside chipTone.ts so lib modules (toast, tokens) can
 *          use it without importing components — and so ui/forms → layout →
 *          metrics → forms stops being a cycle for anyone who needs it.
 *
 *          Before this, ~15 call sites hand-rolled `bg-brand text-brand-fg
 *          px-2.5 py-1 …`: a flat, differently padded twin of the gradient Btn,
 *          often in the same row as the real one.
 */

import { CHIP_TONE } from './chipTone'

/**
 * Visual intent.
 *  - `primary`: the one filled CTA (Save, Connect, Post, Sign in). There is
 *               deliberately no second filled hue: the same action must look
 *               the same in every card.
 *  - `ghost`:   neutral secondary actions (Refresh, Back, View details).
 *  - `cancel`:  dismiss / cancel / close — red affordance (not destructive-primary).
 *  - `danger`:  destructive / irreversible (Delete, Reject, Revoke,
 *               Disconnect, Uninstall, Flag, Dismiss report).
 *  - `success`: forward / un-blocking action (Start triage, Complete,
 *               Approve, Retry — anything that progresses the user
 *               through their workflow). Mirrors the `ok` semantic
 *               token so tone is consistent with PageHero severity
 *               and SidebarHealthDot.
 */
export type BtnVariant = 'primary' | 'ghost' | 'cancel' | 'danger' | 'success'
export type BtnSize = 'sm' | 'md'

const BTN_BASE =
  'inline-flex items-center justify-center font-medium rounded-sm ' +
  'disabled:cursor-not-allowed disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-[transform,opacity] motion-safe:duration-150 motion-safe:active:scale-[0.97]'

const BTN_SIZES: Record<BtnSize, string> = {
  sm: 'px-2 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
}

// Expressive control set (2026-07 expressive pass): the primary action is a
// brand gradient with a hover glow ring; secondary variants keep their tonal
// identity but gain a matching glow on hover. All effects route through
// --gradient-*/--shadow-*-glow tokens (theme-tokens.css), which are derived
// from the semantic brand/danger/ok oklch tokens — so white-label overrides
// and light/dark theme swaps cascade through automatically.
const BTN_VARIANTS: Record<BtnVariant, string> = {
  // `bg-(image:--var)`, NOT `bg-[var(--var)]`. In Tailwind v4 the square-
  // bracket form is typed as a *color* and compiles to `background-color:
  // var(--gradient-brand)` — an invalid color, so the declaration is dropped
  // and the button paints nothing. That left the primary CTA (Sign in, Save,
  // Dispatch fix) as near-white text on the bare page. The parenthesis form
  // with an `image:` hint is the documented way to feed a gradient custom
  // property to a background utility, and compiles to `background-image`.
  // Keep `bg-brand` underneath so the button still has a solid, legible fill
  // if the gradient token is ever missing.
  // Disabled is a neutral well, not the brand fill at 40% opacity: faded
  // vermillion read as salmon (and the old accent variant as lavender), so
  // one "Save" looked like three different buttons across a single page.
  // The transparent border is always there so the disabled edge adds no
  // layout shift; disabled, it turns visible so the well keeps its shape on
  // a white card (overlay L=0.95 vs card L=0.995 alone is too faint).
  primary:
    'border border-transparent bg-brand bg-(image:--gradient-brand) text-brand-fg shadow-card hover:shadow-brand-glow hover:-translate-y-px ' +
    'disabled:bg-surface-overlay disabled:bg-none disabled:text-fg-faint disabled:shadow-none disabled:border-edge-subtle',
  // Outlined / tinted variants keep their shape when disabled and simply fade.
  ghost:
    'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-brand/40 hover:shadow-brand-glow-sm hover:-translate-y-px disabled:opacity-50',
  cancel:
    `${CHIP_TONE.danger} border-danger/40 hover:bg-danger-muted hover:border-danger/50 hover:-translate-y-px disabled:opacity-50`,
  danger:
    `${CHIP_TONE.dangerSubtle} hover:bg-danger-muted/80 hover:border-danger/40 hover:shadow-glow-danger hover:-translate-y-px disabled:opacity-50`,
  success:
    `${CHIP_TONE.okSubtle} hover:bg-ok-muted/80 hover:border-ok/40 hover:shadow-glow-ok hover:-translate-y-px disabled:opacity-50`,
}

/**
 * Btn's exact class string. Use it for a <Link>/<a> that is visually a
 * button instead of hand-rolling `bg-brand text-brand-fg px-2.5 py-1 …`.
 */
export function btnClass(variant: BtnVariant = 'primary', size: BtnSize = 'md'): string {
  return `${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]}`
}
