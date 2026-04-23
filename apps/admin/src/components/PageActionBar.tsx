/**
 * FILE: apps/admin/src/components/PageActionBar.tsx
 * PURPOSE: Per-page "what do I do on this page right now?" strip rendered
 *          below PageHeader on every Advanced PDCA page.
 *
 *          Complements the global <NextBestAction> strip (beginner-only,
 *          whole-loop next step). This one is scope-aware — shown in Advanced
 *          mode, computes the primary + secondary action for the CURRENT
 *          page from live counts (WARN controls on /audit, fragile nodes
 *          on /graph, etc.). If the page has no actionable state, the strip
 *          collapses to a neutral "all clear" pill so the layout stays
 *          stable.
 *
 *          Wave R (2026-04-22) — Ask 1 / plan §Advanced mode usability.
 */
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAdminMode } from '../lib/mode'
import { Btn } from './ui'

export type PageActionTone = 'plan' | 'do' | 'check' | 'act' | 'idle'

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

const TONES: Record<PageActionTone, { ring: string; bg: string; chip: string; chipText: string; chipLabel: string }> = {
  plan:  { ring: 'border-info/40',   bg: 'bg-info-muted/15',     chip: 'bg-info-muted',       chipText: 'text-info',      chipLabel: 'Plan' },
  do:    { ring: 'border-brand/40',  bg: 'bg-brand/10',          chip: 'bg-brand/15',         chipText: 'text-brand',     chipLabel: 'Do' },
  check: { ring: 'border-warn/40',   bg: 'bg-warn/10',           chip: 'bg-warn-muted',       chipText: 'text-warn',      chipLabel: 'Check' },
  act:   { ring: 'border-ok/40',     bg: 'bg-ok-muted/15',       chip: 'bg-ok-muted',         chipText: 'text-ok',        chipLabel: 'Act' },
  idle:  { ring: 'border-edge',      bg: 'bg-surface-raised/40', chip: 'bg-surface-overlay',  chipText: 'text-fg-muted',  chipLabel: 'Idle' },
}

interface PageActionBarProps {
  /** The page key — used for analytics + default copy, must match the route slug. */
  scope: string
  /** The action to surface. Null = render a neutral "all clear" strip. */
  action: PageAction | null
  /** Extra content rendered to the right of the secondary CTAs (e.g. a "last
   *  updated" timestamp). Keep short. */
  trailing?: ReactNode
  /** Suppress the strip entirely — e.g. when a page has an even stronger
   *  hero CTA (Reports' FirstReportHero). */
  hidden?: boolean
}

/**
 * Renders the per-page action strip. No-op outside Advanced mode so beginner
 * users aren't shown two NBAs stacked.
 */
export function PageActionBar({ scope, action, trailing, hidden }: PageActionBarProps) {
  const { isAdvanced } = useAdminMode()
  if (hidden) return null
  if (!isAdvanced) return null

  if (!action) {
    const idle = TONES.idle
    return (
      <aside
        role="complementary"
        aria-label={`${scope} actions`}
        data-scope={scope}
        className={`mb-4 -mt-1 flex items-center gap-3 rounded-md border ${idle.ring} ${idle.bg} px-3 py-2`}
      >
        <span className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${idle.chip} ${idle.chipText}`}>
          <span aria-hidden="true">✓</span>
          All clear
        </span>
        <p className="text-xs text-fg-muted leading-tight">
          Nothing actionable here right now. Come back after the next ingest.
        </p>
        {trailing && <div className="ml-auto text-2xs text-fg-faint">{trailing}</div>}
      </aside>
    )
  }

  const tone = TONES[action.tone]
  return (
    <aside
      role="complementary"
      aria-label={`${scope} next best action`}
      data-scope={scope}
      className={`mb-4 -mt-1 flex items-start gap-3 rounded-md border ${tone.ring} ${tone.bg} px-3 py-2 motion-safe:animate-mushi-fade-in`}
    >
      <span className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${tone.chip} ${tone.chipText}`}>
        <span aria-hidden="true">→</span>
        {tone.chipLabel}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-fg leading-tight">{action.title}</p>
        {action.reason && (
          <p className="text-2xs text-fg-muted mt-0.5 leading-snug">{action.reason}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action.primary && <Cta cta={action.primary} variant="primary" />}
        {action.secondary?.map((s, i) => (
          <Cta key={i} cta={s} variant="ghost" />
        ))}
        {trailing && <span className="text-2xs text-fg-faint">{trailing}</span>}
      </div>
    </aside>
  )
}

function Cta({
  cta,
  variant,
}: {
  cta: NonNullable<PageAction['primary']>
  variant: 'primary' | 'ghost'
}) {
  if (cta.kind === 'link') {
    if (variant === 'primary') {
      return (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
        >
          {cta.label} <span aria-hidden="true">→</span>
        </Link>
      )
    }
    return (
      <Link
        to={cta.to}
        className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
      >
        {cta.label}
      </Link>
    )
  }
  return (
    <Btn size="sm" variant={variant} onClick={cta.onClick} disabled={cta.disabled}>
      {cta.label}
    </Btn>
  )
}
