/**
 * FILE: apps/admin/src/components/PageActionBar.tsx
 * PURPOSE: Advanced-mode per-page primary/secondary action strip driven by
 *          live counts via `useNextBestAction`; collapses to "all clear" when idle.
 */

type PageActionTone = 'plan' | 'do' | 'check' | 'act' | 'idle'

export interface PageAction {
  tone: PageActionTone
  /** One-line verb-led headline ("Remediate 3 WARN controls"). */
  title: string
  /** Optional reason under the headline (1 sentence, from live data). */
  reason?: string
  /** Primary CTA — either a link to the queue/filter that acts on `title`,
   *  or an inline button firing a callback. */
  primary?:
    | { kind: 'link'; to: string; label: string }
    | { kind: 'button'; label: string; onClick: () => void; disabled?: boolean }
  /** Secondary actions rendered as ghost buttons; keep to ≤ 2. */
  secondary?: ReadonlyArray<
    | { kind: 'link'; to: string; label: string }
    | { kind: 'button'; label: string; onClick: () => void; disabled?: boolean }
  >
}
