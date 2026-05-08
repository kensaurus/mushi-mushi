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
 *          Wave V (2026-05-08) — ReactFlow lane rebuild:
 *            • Replaces the 5-column flex grid + CSS-channel `<FlowArrow />`
 *              with a real `<HeroFlow />` ReactFlow canvas (3 custom
 *              nodes + 2 gradient bezier edges), so the hero shares the
 *              dashboard's flow vocabulary and severity colour bleeds
 *              through the edges visually.
 *            • Beginner mode + collapsed advanced mode are unchanged.
 *              Public API (props) is unchanged so all 11 consumer pages
 *              keep working without edits.
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
import type { PageAction } from './PageActionBar'
import { useAdminMode } from '../lib/mode'
import { HeroFlow } from './hero-flow/HeroFlow'
import type { HeroSeverity } from './hero-flow/heroFlow.data'

type Severity = HeroSeverity

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

// Severity tokens used by the *beginner* one-line summary card +
// collapsed advanced strip. Both surfaces only need the dot, a soft tint,
// a foreground class for the headline, and a border colour for the
// outer ring — no edge "flow" colour because they don't render edges.
// The expanded advanced render delegates colour entirely to HeroFlow,
// which keeps its own SVG-friendly hex tokens.
const SEVERITY_STYLE: Record<
  Severity,
  { ring: string; bg: string; text: string; dot: string }
> = {
  ok:      { ring: 'border-ok/40',      bg: 'bg-ok-muted/15',      text: 'text-ok',     dot: 'bg-ok' },
  info:    { ring: 'border-info/40',    bg: 'bg-info-muted/15',    text: 'text-info',   dot: 'bg-info' },
  warn:    { ring: 'border-warn/40',    bg: 'bg-warn/10',          text: 'text-warn',   dot: 'bg-warn' },
  crit:    { ring: 'border-err/40',     bg: 'bg-err/10',           text: 'text-err',    dot: 'bg-err' },
  neutral: { ring: 'border-edge',       bg: 'bg-surface-raised/40', text: 'text-fg',    dot: 'bg-fg-muted' },
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
      data-hero-variant="decide-act-verify-flow"
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
          aria-controls={`hero-${scope}-flow`}
          className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          title="Collapse Decide → Act → Verify"
        >
          Collapse <span aria-hidden>▴</span>
        </button>
      </header>

      {/* ReactFlow lane: 3 custom nodes (Decide / Act / Verify) connected
          by 2 gradient bezier edges. Severity drives the source colour;
          action tone drives the middle; the right edge fades to neutral
          since Verify is "the receipt", not a state. Same flow primitives
          as the dashboard PdcaFlow so the two surfaces feel like one
          system. md+ shows the lane horizontally; below md the canvas
          still works (the user can scroll horizontally inside the
          fixed-width canvas viewport — no wrapping logic needed). */}
      <div id={`hero-${scope}-flow`}>
        <HeroFlow
          scope={scope}
          decide={{
            label: decide.label,
            metric: decide.metric,
            summary: decide.summary,
            severity: decide.severity ?? 'neutral',
          }}
          act={{ action: act }}
          verify={{
            label: verify.label,
            detail: verify.detail,
            to: verify.to,
            secondaryTo: verify.secondaryTo,
            secondaryLabel: verify.secondaryLabel,
          }}
          expandedTile={expandedTile}
          onToggleTile={toggleTile}
          decideAccessory={decideAccessory}
        />
      </div>
    </section>
  )
}
