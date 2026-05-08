/**
 * FILE: apps/admin/src/components/PageHero.tsx
 * PURPOSE: "Decide → Act → Verify" hero strip rendered above the fold on
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
 *          Wave S (2026-04-23) — initial 3-tile hero introduction.
 *          Wave U (2026-05-07) — operator feedback rebuild:
 *            • Whole hero is now collapsible (mirrors Pipeline Pulse), with
 *              localStorage persistence so the choice sticks across reloads.
 *            • Bezel-less single-card visual: tiles are flush sections of
 *              one container instead of three separate cards floating in
 *              a 3-column grid. Animated marching-dot arrows flow between
 *              D → A → V so the page reads as a single decision narrative
 *              rather than three unrelated boxes.
 *            • Each tile is click-to-expand — the headline + summary stay
 *              compact by default, and operators reveal secondary CTAs,
 *              full detail strings, and any optional accessory content
 *              by toggling the per-tile chevron.
 *
 *          Design principles:
 *          - No hard-coded copy — every tile's body comes from a typed
 *            prop so pages stay the source of truth on their own metrics.
 *          - Degrades gracefully: if Act is null (no next-best-action),
 *            the tile renders a calm "all clear" affordance rather than
 *            a dead button.
 *          - Respects admin mode: beginner sees simpler, one-liner
 *            callouts; Advanced gets the full 3-tile flowing layout.
 *          - Accessibility: each tile is a landmark `<section>` with an
 *            explicit heading, and the primary CTA is focusable first
 *            in tab order inside Act. The collapse + per-tile expand
 *            buttons are real `<button>`s with `aria-expanded`.
 */

import { useEffect, useState, type ReactNode } from 'react'
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

const SEVERITY_STYLE: Record<
  Severity,
  { ring: string; bg: string; text: string; dot: string; flow: string }
> = {
  ok:      { ring: 'border-ok/40',      bg: 'bg-ok-muted/15',      text: 'text-ok',     dot: 'bg-ok',     flow: 'var(--color-ok)' },
  info:    { ring: 'border-info/40',    bg: 'bg-info-muted/15',    text: 'text-info',   dot: 'bg-info',   flow: 'var(--color-info)' },
  warn:    { ring: 'border-warn/40',    bg: 'bg-warn/10',          text: 'text-warn',   dot: 'bg-warn',   flow: 'var(--color-warn)' },
  crit:    { ring: 'border-err/40',     bg: 'bg-err/10',           text: 'text-err',    dot: 'bg-err',    flow: 'var(--color-danger)' },
  neutral: { ring: 'border-edge',       bg: 'bg-surface-raised/40', text: 'text-fg',    dot: 'bg-fg-muted', flow: 'var(--color-fg-muted)' },
}

const ACTION_TONE: Record<PageAction['tone'], { ring: string; bg: string; flow: string }> = {
  plan:  { ring: 'border-info/40',  bg: 'bg-info-muted/15', flow: 'var(--color-info)' },
  do:    { ring: 'border-brand/40', bg: 'bg-brand/10',      flow: 'var(--color-brand)' },
  check: { ring: 'border-warn/40',  bg: 'bg-warn/10',       flow: 'var(--color-warn)' },
  act:   { ring: 'border-ok/40',    bg: 'bg-ok-muted/15',   flow: 'var(--color-ok)' },
  idle:  { ring: 'border-edge',     bg: 'bg-surface-raised/40', flow: 'var(--color-fg-muted)' },
}

// Persisted hero collapse state — same pattern Pipeline Pulse uses so
// the operator's choice ("I'm in heads-down mode, hide the chrome") sticks
// across reloads. Hero collapse is per-scope so a noisy page (e.g. /reports)
// can stay open while a quiet one (/billing) is collapsed.
const HERO_COLLAPSE_KEY = 'mushi:pageHero:collapsed:v1'

function readCollapsedScopes(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(HERO_COLLAPSE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeCollapsedScopes(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HERO_COLLAPSE_KEY, JSON.stringify(state))
  } catch {
    // private mode etc. — non-fatal.
  }
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

  // Per-scope collapse, per-tile expand. The tile-level state is in-memory
  // only — operators expand "Act" to grab a secondary CTA, not as a long-
  // lived preference, so we don't burn a localStorage write on it.
  const [collapsedScopes, setCollapsedScopes] = useState<Record<string, boolean>>(readCollapsedScopes)
  const collapsed = collapsedScopes[scope] ?? false
  const [expandedTile, setExpandedTile] = useState<'decide' | 'act' | 'verify' | null>(null)

  useEffect(() => {
    writeCollapsedScopes(collapsedScopes)
  }, [collapsedScopes])

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

  const decideFlow = SEVERITY_STYLE[severity].flow
  const actFlow = act ? ACTION_TONE[act.tone].flow : ACTION_TONE.idle.flow

  function toggleCollapsed() {
    setCollapsedScopes((prev) => ({ ...prev, [scope]: !collapsed }))
  }

  function toggleTile(tile: 'decide' | 'act' | 'verify') {
    setExpandedTile((prev) => (prev === tile ? null : tile))
  }

  // Collapsed: single-pill summary. Mirrors Pipeline Pulse's collapsed
  // state — the loudest signal (Decide severity) tints the dot, the worst
  // headline carries on the right, and a click expands back to full.
  if (collapsed) {
    return (
      <section
        role="banner"
        aria-label={`${title} hero (collapsed)`}
        data-scope={scope}
        data-collapsed="true"
        className="mb-3"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-controls={`hero-${scope}-tiles`}
          className={`group flex items-center gap-2.5 w-full rounded-sm border ${style.ring} bg-surface-raised/40 px-2.5 py-1.5 text-left motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
          title="Decide → Act → Verify · click to expand"
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
          <span className="text-3xs font-medium text-fg-secondary uppercase tracking-wider shrink-0">
            Decide → Act → Verify
          </span>
          <span className={`text-2xs font-medium truncate ${style.text}`}>
            {decide.label}
          </span>
          {decide.metric && (
            <>
              <span aria-hidden className="text-fg-faint shrink-0">·</span>
              <span className="text-2xs font-mono tabular-nums text-fg-secondary shrink-0">{decide.metric}</span>
            </>
          )}
          {act && (
            <>
              <span aria-hidden className="text-fg-faint shrink-0">·</span>
              <span className="text-2xs text-fg-muted truncate">{act.title}</span>
            </>
          )}
          <span aria-hidden className="ml-auto text-2xs text-fg-muted shrink-0 group-hover:text-fg motion-safe:transition-colors">
            Expand ▾
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      role="banner"
      aria-label={`${title} hero`}
      data-scope={scope}
      data-hero-variant="decide-act-verify"
      data-collapsed="false"
      className="mb-5 rounded-lg border border-edge bg-surface-raised/40 overflow-hidden"
    >
      {/* Header strip — title + collapse toggle. Stays tight (~28px) so the
          hero's vertical footprint barely grows from the previous version. */}
      <header className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-edge-subtle/50">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
          <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint">
            Decide → Act → Verify
          </span>
          {kicker && (
            <>
              <span aria-hidden className="text-fg-faint">·</span>
              <span className="text-2xs text-fg-muted truncate">{kicker}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={true}
          aria-controls={`hero-${scope}-tiles`}
          className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          title="Collapse Decide → Act → Verify"
        >
          Collapse <span aria-hidden>▴</span>
        </button>
      </header>

      {/* Tiles + flow arrows. Bezel-less: tiles are flush sections of the
          parent container, separated only by an animated arrow channel.
          Stacks vertically on narrow viewports (the arrows rotate to flow
          downward) so the layout stays readable below md. */}
      <div
        id={`hero-${scope}-tiles`}
        className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr]"
      >
        <DecideTile
          decide={decide}
          accessory={decideAccessory}
          expanded={expandedTile === 'decide'}
          onToggle={() => toggleTile('decide')}
        />
        <FlowArrow color={decideFlow} />
        <ActTile
          action={act}
          expanded={expandedTile === 'act'}
          onToggle={() => toggleTile('act')}
        />
        <FlowArrow color={actFlow} />
        <VerifyTile
          verify={verify}
          expanded={expandedTile === 'verify'}
          onToggle={() => toggleTile('verify')}
        />
      </div>
    </section>
  )
}

// ─── FlowArrow ──────────────────────────────────────────────────────────
//
// The "bezel-less ReactFlow" feel without pulling in the @xyflow/react
// dependency: a horizontal channel with a marching-dots animation that
// reads as flowing data and a chunky arrowhead at the end. CSS-only,
// respects `prefers-reduced-motion` (the marching pauses), and inherits
// its tint from the upstream tile's severity so a danger Decide bleeds
// red into the channel toward Act — visually wiring the cause to the
// recommended action.
//
// On md+ viewports the channel is horizontal (D→A→V); below md the grid
// collapses to single-column and the arrow rotates 90° to flow downward.

function FlowArrow({ color }: { color: string }) {
  return (
    <div
      aria-hidden="true"
      className="hidden md:flex items-center justify-center px-2 motion-safe:[--mushi-flow-anim:flow-march_1.4s_linear_infinite]"
      style={{ ['--mushi-flow-color' as string]: color }}
    >
      <span className="flow-arrow-channel" />
      <span className="flow-arrow-head" />
    </div>
  )
}

// ─── Tiles ──────────────────────────────────────────────────────────────

interface TileToggleProps {
  expanded: boolean
  onToggle: () => void
}

function TileChevron({ expanded, onToggle, label }: TileToggleProps & { label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label} for more detail`}
      title={expanded ? `Collapse ${label}` : `Show more about ${label}`}
      className="ml-auto inline-flex items-center justify-center h-4 w-4 rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <span aria-hidden className={`inline-block motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}>
        ▾
      </span>
    </button>
  )
}

function DecideTile({
  decide,
  accessory,
  expanded,
  onToggle,
}: {
  decide: PageHeroDecide
  accessory?: ReactNode
  expanded: boolean
  onToggle: () => void
}) {
  const style = SEVERITY_STYLE[decide.severity ?? 'neutral']
  return (
    <article
      aria-labelledby="hero-decide"
      className={`relative ${style.bg} p-3.5`}
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
        <h3 id="hero-decide" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Decide
        </h3>
        <TileChevron expanded={expanded} onToggle={onToggle} label="Decide" />
      </header>
      <p className={`text-xs font-medium ${style.text}`}>{decide.label}</p>
      {decide.metric && (
        <p className="mt-1 text-2xl font-semibold text-fg tabular-nums leading-tight">
          {decide.metric}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-muted leading-snug">{decide.summary}</p>
      {expanded && (
        <div className="mt-2.5 space-y-2 border-t border-edge-subtle/60 pt-2.5">
          {accessory ? (
            accessory
          ) : (
            <p className="text-2xs text-fg-faint leading-relaxed">
              No additional context published for this scope. Pages can supply
              a sparkline, trend, or extra metric via the
              <code className="mx-1 font-mono text-fg-muted">decideAccessory</code>
              prop.
            </p>
          )}
          <p className="text-3xs font-mono text-fg-faint">
            severity: <span className="text-fg-muted">{decide.severity ?? 'neutral'}</span>
          </p>
        </div>
      )}
      {!expanded && accessory && <div className="mt-2.5">{accessory}</div>}
    </article>
  )
}

function ActTile({
  action,
  expanded,
  onToggle,
}: {
  action: PageAction | null
  expanded: boolean
  onToggle: () => void
}) {
  if (!action) {
    return (
      <article
        aria-labelledby="hero-act"
        className="relative bg-surface-raised/40 p-3.5"
      >
        <header className="flex items-center gap-2 mb-1.5">
          <span className="text-ok" aria-hidden="true">✓</span>
          <h3 id="hero-act" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
            Act
          </h3>
          <TileChevron expanded={expanded} onToggle={onToggle} label="Act" />
        </header>
        <p className="text-xs font-medium text-fg">All clear</p>
        <p className="mt-1 text-xs text-fg-muted leading-snug">
          Nothing actionable here right now. The next ingest will refresh this tile.
        </p>
        {expanded && (
          <div className="mt-2.5 space-y-1 border-t border-edge-subtle/60 pt-2.5">
            <p className="text-2xs text-fg-faint leading-relaxed">
              When the rule engine identifies a next-best-action for this scope,
              the primary CTA appears here. Until then, this tile reads as a
              calm receipt that the page is nominal.
            </p>
          </div>
        )}
      </article>
    )
  }

  const tone = ACTION_TONE[action.tone]
  // Default-collapsed tile shows primary + first secondary CTA.
  // Expanded tile shows ALL secondary CTAs + the rule reason in full.
  const visibleSecondaries = expanded
    ? (action.secondary ?? [])
    : (action.secondary ?? []).slice(0, 1)
  return (
    <article
      aria-labelledby="hero-act"
      className={`relative ${tone.bg} p-3.5`}
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span aria-hidden="true">→</span>
        <h3 id="hero-act" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Act
        </h3>
        <TileChevron expanded={expanded} onToggle={onToggle} label="Act" />
      </header>
      <p className="text-xs font-medium text-fg leading-snug">{action.title}</p>
      {action.reason && (
        <p className="mt-1 text-xs text-fg-muted leading-snug">{action.reason}</p>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {action.primary && <HeroCta cta={action.primary} variant="primary" />}
        {visibleSecondaries.map((s, i) => (
          <HeroCta key={i} cta={s} variant="ghost" />
        ))}
      </div>
      {expanded && action.secondary && action.secondary.length > 1 && (
        <p className="mt-2 text-3xs text-fg-faint">
          Showing {action.secondary.length} secondary action
          {action.secondary.length === 1 ? '' : 's'}.
        </p>
      )}
    </article>
  )
}

function VerifyTile({
  verify,
  expanded,
  onToggle,
}: {
  verify: PageHeroVerify
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <article
      aria-labelledby="hero-verify"
      className="relative bg-surface-raised/40 p-3.5"
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span className="text-fg-muted" aria-hidden="true">◎</span>
        <h3 id="hero-verify" className="text-2xs uppercase tracking-wider text-fg-faint font-semibold">
          Verify
        </h3>
        <TileChevron expanded={expanded} onToggle={onToggle} label="Verify" />
      </header>
      <p className="text-xs font-medium text-fg">{verify.label}</p>
      <p
        className={`mt-1 text-xs text-fg-muted font-mono leading-snug ${expanded ? 'break-all' : 'truncate'}`}
        title={verify.detail}
      >
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
      {expanded && (
        <div className="mt-2.5 space-y-1 border-t border-edge-subtle/60 pt-2.5">
          <p className="text-3xs text-fg-faint leading-relaxed">
            Verification is the receipt for the most recent Act. Open the
            evidence link to confirm the action landed where the rule
            promised it would.
          </p>
        </div>
      )}
    </article>
  )
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
