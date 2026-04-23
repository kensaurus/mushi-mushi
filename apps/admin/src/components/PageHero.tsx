/**
 * FILE: apps/admin/src/components/PageHero.tsx
 * PURPOSE: "Decide / Act / Verify" hero strip rendered above the fold on
 *          every Advanced PDCA page. Charts now move below the fold —
 *          this hero surfaces the three things a human actually needs:
 *
 *              1. DECIDE — "what's the state?" (one headline number +
 *                 a one-liner telling the operator whether it's nominal)
 *              2. ACT — "what should I do next?" (primary CTA driven by
 *                 useNextBestAction, identical rule the PageActionBar
 *                 already computes for the same scope)
 *              3. VERIFY — "how do I know the action worked?" (deeplinks
 *                 to the evidence: logs, deltas, proof-of-life)
 *
 *          Wave S (2026-04-23) — direct answer to the user's ask:
 *            "restructure IA so each page opens with a 3-tile Decide /
 *             Act / Verify hero instead of charts-first".
 *
 *          Design principles:
 *          - No hard-coded copy — every tile's body comes from a typed
 *            prop so pages stay the source of truth on their own metrics.
 *          - Degrades gracefully: if Act is null (no next-best-action),
 *            the tile renders a calm "all clear" affordance rather than
 *            a dead button.
 *          - Respects admin mode: beginner sees simpler, one-liner
 *            callouts; Advanced gets the full 3-tile layout. This keeps
 *            the hero useful for both audiences without two components.
 *          - Accessibility: each tile is a landmark `<section>` with an
 *            explicit heading, and the primary CTA is focusable first
 *            in tab order inside Act.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Btn } from './ui'
import type { PageAction } from './PageActionBar'
import { useAdminMode } from '../lib/mode'

type Severity = 'ok' | 'info' | 'warn' | 'crit' | 'neutral'

export interface PageHeroDecide {
  /** One-word status ("Healthy", "Drift", "Blocked"). */
  label: string
  /** Big number / ratio ("12 / 57 green", "72%"). Optional but strongly
   *  recommended — the whole point of the tile is to put the most
   *  relevant metric in the operator's face. */
  metric?: string
  /** One sentence explaining the number. */
  summary: string
  severity?: Severity
}

export interface PageHeroVerify {
  /** Short title for the tile ("Latest run", "Last audit"). */
  label: string
  /** Short descriptor — timestamp, hash, ID. */
  detail: string
  /** Deep-link to the evidence (logs, trace, diff). */
  to?: string
  /** Optional secondary link. */
  secondaryTo?: string
  secondaryLabel?: string
}

interface PageHeroProps {
  /** The scope slug — must match PageActionBar for telemetry. */
  scope: string
  /** Overall page title (falls back to PageHeader when embedded). */
  title: string
  /** Short kicker / eyebrow to orient the operator. */
  kicker?: string
  decide: PageHeroDecide
  /** Action tile body — reuses PageAction so the rule engine is shared
   *  with PageActionBar. Pass null to render the calm "nothing to do"
   *  affordance. */
  act: PageAction | null
  verify: PageHeroVerify
  /** Optional chart/KPI sparkline shown to the right of Decide in a
   *  full-width layout (keeps the hero interesting when there IS a
   *  trending metric worth showing). */
  decideAccessory?: ReactNode
}

const SEVERITY_STYLE: Record<Severity, { ring: string; bg: string; text: string; dot: string }> = {
  ok:      { ring: 'border-ok/40',   bg: 'bg-ok-muted/20',   text: 'text-ok',     dot: 'bg-ok' },
  info:    { ring: 'border-info/40', bg: 'bg-info-muted/20', text: 'text-info',   dot: 'bg-info' },
  warn:    { ring: 'border-warn/40', bg: 'bg-warn/10',       text: 'text-warn',   dot: 'bg-warn' },
  crit:    { ring: 'border-err/40',  bg: 'bg-err/10',        text: 'text-err',    dot: 'bg-err' },
  neutral: { ring: 'border-edge',    bg: 'bg-surface-raised/40', text: 'text-fg', dot: 'bg-fg-muted' },
}

/**
 * Render the 3-tile hero. Beginners collapse it to a single friendlier
 * pill (they still get the global NextBestAction strip above the layout
 * — stacking a second tile hero for them is noisy).
 */
export function PageHero({ scope, title, kicker, decide, act, verify, decideAccessory }: PageHeroProps) {
  const { isAdvanced } = useAdminMode()
  const severity = decide.severity ?? 'neutral'
  const style = SEVERITY_STYLE[severity]

  if (!isAdvanced) {
    // Beginner: one-line summary card — no tile grid. The global NBA
    // strip already answers "what should I do next?".
    return (
      <section
        role="banner"
        aria-label={`${title} summary`}
        data-scope={scope}
        className={`mb-5 flex items-start gap-3 rounded-lg border ${style.ring} ${style.bg} px-4 py-3`}
      >
        <span className={`mt-1 inline-block h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0">
          {kicker && <p className="text-2xs uppercase tracking-wider text-fg-faint mb-0.5">{kicker}</p>}
          <p className="text-sm font-medium text-fg leading-tight">
            {decide.label}
            {decide.metric && (
              <>
                <span className="mx-2 text-fg-faint" aria-hidden="true">·</span>
                <span className="font-mono">{decide.metric}</span>
              </>
            )}
          </p>
          <p className="text-xs text-fg-muted mt-0.5">{decide.summary}</p>
        </div>
      </section>
    )
  }

  return (
    <section
      role="banner"
      aria-label={`${title} hero`}
      data-scope={scope}
      data-hero-variant="decide-act-verify"
      className="mb-5 grid grid-cols-1 md:grid-cols-3 gap-3"
    >
      <DecideTile decide={decide} accessory={decideAccessory} />
      <ActTile action={act} />
      <VerifyTile verify={verify} />
    </section>
  )
}

function DecideTile({ decide, accessory }: { decide: PageHeroDecide; accessory?: ReactNode }) {
  const style = SEVERITY_STYLE[decide.severity ?? 'neutral']
  return (
    <article
      aria-labelledby="hero-decide"
      className={`relative overflow-hidden rounded-lg border ${style.ring} ${style.bg} p-4`}
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
        <h3 id="hero-decide" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Decide
        </h3>
      </header>
      <p className={`text-xs font-medium ${style.text}`}>{decide.label}</p>
      {decide.metric && (
        <p className="mt-1 text-2xl font-semibold text-fg tabular-nums leading-tight">
          {decide.metric}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-muted leading-snug">{decide.summary}</p>
      {accessory && <div className="mt-3">{accessory}</div>}
    </article>
  )
}

function ActTile({ action }: { action: PageAction | null }) {
  if (!action) {
    return (
      <article
        aria-labelledby="hero-act"
        className="relative overflow-hidden rounded-lg border border-edge bg-surface-raised/40 p-4"
      >
        <header className="flex items-center gap-2 mb-1.5">
          <span className="text-ok" aria-hidden="true">✓</span>
          <h3 id="hero-act" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
            Act
          </h3>
        </header>
        <p className="text-xs font-medium text-fg">All clear</p>
        <p className="mt-1 text-xs text-fg-muted leading-snug">
          Nothing actionable here right now. The next ingest will refresh this tile.
        </p>
      </article>
    )
  }

  const tone = ACTION_TONE[action.tone]
  return (
    <article
      aria-labelledby="hero-act"
      className={`relative overflow-hidden rounded-lg border ${tone.ring} ${tone.bg} p-4`}
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span aria-hidden="true">→</span>
        <h3 id="hero-act" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Act
        </h3>
      </header>
      <p className="text-xs font-medium text-fg leading-snug">{action.title}</p>
      {action.reason && (
        <p className="mt-1 text-xs text-fg-muted leading-snug">{action.reason}</p>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {action.primary && <HeroCta cta={action.primary} variant="primary" />}
        {action.secondary?.slice(0, 1).map((s, i) => (
          <HeroCta key={i} cta={s} variant="ghost" />
        ))}
      </div>
    </article>
  )
}

function VerifyTile({ verify }: { verify: PageHeroVerify }) {
  return (
    <article
      aria-labelledby="hero-verify"
      className="relative overflow-hidden rounded-lg border border-edge bg-surface-raised/40 p-4"
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span className="text-fg-muted" aria-hidden="true">◎</span>
        <h3 id="hero-verify" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Verify
        </h3>
      </header>
      <p className="text-xs font-medium text-fg">{verify.label}</p>
      <p className="mt-1 text-xs text-fg-muted font-mono leading-snug truncate" title={verify.detail}>
        {verify.detail}
      </p>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {verify.to && (
          <Link
            data-hero-verify
            to={verify.to}
            className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors border border-edge"
          >
            Open evidence <span aria-hidden="true">→</span>
          </Link>
        )}
        {verify.secondaryTo && verify.secondaryLabel && (
          <Link
            to={verify.secondaryTo}
            className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
          >
            {verify.secondaryLabel}
          </Link>
        )}
      </div>
    </article>
  )
}

const ACTION_TONE: Record<PageAction['tone'], { ring: string; bg: string }> = {
  plan:  { ring: 'border-info/40',   bg: 'bg-info-muted/15' },
  do:    { ring: 'border-brand/40',  bg: 'bg-brand/10' },
  check: { ring: 'border-warn/40',   bg: 'bg-warn/10' },
  act:   { ring: 'border-ok/40',     bg: 'bg-ok-muted/15' },
  idle:  { ring: 'border-edge',      bg: 'bg-surface-raised/40' },
}

function HeroCta({
  cta,
  variant,
}: {
  cta: NonNullable<PageAction['primary']>
  variant: 'primary' | 'ghost'
}) {
  // Wave T (2026-04-23): `data-hero-primary` / `data-hero-secondary` hooks
  // are the single source of truth the Playwright dead-button sweep uses
  // to assert every Advanced page has exactly one primary CTA. Do not
  // rename without updating examples/e2e-dogfood/tests/hero-ctas.spec.ts.
  const testHook = variant === 'primary' ? { 'data-hero-primary': true } : { 'data-hero-secondary': true }
  if (cta.kind === 'link') {
    if (variant === 'primary') {
      return (
        <Link
          {...testHook}
          to={cta.to}
          className="inline-flex items-center gap-1 rounded-sm bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
        >
          {cta.label} <span aria-hidden="true">→</span>
        </Link>
      )
    }
    return (
      <Link
        {...testHook}
        to={cta.to}
        className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
      >
        {cta.label}
      </Link>
    )
  }
  return (
    <Btn size="sm" variant={variant} onClick={cta.onClick} disabled={cta.disabled} {...testHook}>
      {cta.label}
    </Btn>
  )
}
