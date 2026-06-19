/**
 * Outcome-first copy for workflow surfaces (hero lane, guides).
 * Centralises banned meta-phrases ("Next step", "tap to learn more").
 */

/** Advanced-mode hero tile eyebrows — outcome-first, not process labels. */
export const HERO_EYEBROWS = {
  decide: 'Now',
  act: 'Do this',
  verify: 'Proof',
} as const

/** Beginner-mode hero — shorter, same intent. */
export const HERO_EYEBROWS_BEGINNER = {
  decide: 'State',
  act: 'Action',
  verify: 'Check',
} as const

export const GUIDE_CLEAR_WHEN_LABEL = 'Clear when'

/** Collapsed guide affordance — no "tap to learn more". */
export const GUIDE_EXPAND_HINT = 'Details'

/** Act node when no action is queued. */
export const HERO_ACT_IDLE = 'Nothing needs your attention on this page right now.'

/** Handoff flash after completing an action. */
export function heroHandoffDone(label: string): string {
  return `Done — ${label}`
}
