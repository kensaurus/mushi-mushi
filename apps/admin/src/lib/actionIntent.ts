/**
 * FILE: apps/admin/src/lib/actionIntent.ts
 * PURPOSE: One map from what an action does to how it looks (owner,
 *          2026-11-27: "fix could be a red button, triage could be a yellow
 *          button"). Row and inline actions pass an intent to `Btn`
 *          (`<Btn intent="fix">`) instead of picking classes per page.
 *
 * The hues are the severity hues (lib/chipTone.ts SEVERITY_TONE), so a
 * Critical bug's chip and its Fix button are the same red, and a High bug's
 * chip and its Triage button the same amber:
 *
 *   fix         solid danger red, light ink on red     (Fix →, Dispatch fix)
 *   triage      solid amber, DARK ink (white on yellow fails AA)  (Triage →)
 *   primary     the brand action (Open backlog, Open the worst, Save)
 *   neutral     secondary actions (View, Open, Details, Retry)
 *   destructive irreversible confirm (Delete, Revoke) — red fill, never a row action
 *
 * Contrast for every fill/ink pair: console-tone-contrast.test.ts (server suite).
 */

export type ActionIntent = 'fix' | 'triage' | 'primary' | 'neutral' | 'destructive'

/** Btn variant for each intent. `fix` and `triage` are their own variants. */
export const ACTION_INTENT_VARIANT = {
  fix: 'fix',
  triage: 'triage',
  primary: 'primary',
  neutral: 'ghost',
  destructive: 'destructive',
} as const satisfies Record<ActionIntent, string>

/** A report row's next move: Fix once Mushi has classified it, Triage while it is new, View when closed. */
export function reportRowIntent(status: string): ActionIntent {
  if (status === 'classified' || status === 'fixing') return 'fix'
  if (status === 'fixed' || status === 'verified' || status === 'resolved' || status === 'dismissed') return 'neutral'
  return 'triage'
}
