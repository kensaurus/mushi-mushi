/**
 * FILE: apps/admin/src/components/integrations/cardChrome.ts
 * PURPOSE: Shared chrome for the channel / tracker cards (Slack, Discord,
 *          Teams, Linear). The parent <Panel> owns the frame and the dividers
 *          between cards, so a card draws no border or background of its own —
 *          the old `rounded-xl border bg-surface` root stacked a second outline
 *          inside the panel's `divide-x` and painted a grey (surface, L=0.965)
 *          slab inside a white (surface-raised) panel in light mode.
 */

/** Card root — padding and rhythm only. */
export const INTEGRATION_CARD = 'min-w-0 space-y-4 p-4'

/** Header row — actions wrap under the title instead of truncating it. */
export const INTEGRATION_CARD_HEADER = 'flex flex-wrap items-start justify-between gap-x-4 gap-y-2'

/** Logo + title block. The logo is a bare mark, not a tinted tile. */
export const INTEGRATION_CARD_IDENTITY = 'flex min-w-0 items-start gap-2.5'

/** Title and status line. Status wraps; it is the only place the state is explained. */
export const INTEGRATION_CARD_TITLE = 'text-sm font-semibold text-fg'
export const INTEGRATION_CARD_STATUS_OK = 'text-xs text-ok-foreground text-pretty'
export const INTEGRATION_CARD_STATUS_IDLE = 'text-xs text-fg-muted text-pretty'

/** Secondary info block ("What you'll receive", setup steps) — a divider, not a nested box. */
export const INTEGRATION_CARD_NOTE = 'space-y-1 border-t border-edge-subtle pt-3 text-xs text-fg-muted'
