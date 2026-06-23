/**
 * FILE: apps/admin/src/components/PageHero.tsx
 * PURPOSE: Decide → Act → Verify hero strip for Advanced-mode PDCA pages.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PageAction } from './PageActionBar'
import { useAdminMode } from '../lib/mode'
import { HeroFlow } from './hero-flow/HeroFlow'
import type { HeroActIdle, HeroSeverity } from './hero-flow/heroFlow.data'
import type { DavEvidence } from '../lib/davManifest'
import { useDavSpotlight } from '../lib/useDavSpotlight'
import { HeroDetailPanel } from './hero-flow/HeroDetailPanel'
import { buildOperatorTrace, type OperatorTraceLine } from './hero-flow/operatorTrace'
import { heroMetricChips } from '../lib/pageHeroSnapshot'

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
  /** data-dav-anchor value of the on-page element that corresponds to this
   *  tile's state (e.g. `'health:decide'`). When set, clicking the tile
   *  scrolls to `[data-dav-anchor="<anchor>"]` and outlines it. */
  anchor?: string
  /** Structured live data rendered in the detail panel when the tile is
   *  expanded. When absent the panel falls back to `metric` + `summary`. */
  evidence?: DavEvidence
  /** configDocs IDs that are currently unset or misconfigured and are
   *  blocking or degrading this tile's state. Each ID resolves to a
   *  `ConfigDoc` whose label, summary, and lineage are shown in a
   *  callout box so the operator knows exactly what to fill in. */
  missingConfigIds?: string[]
  /** Extra lines merged into the operator trace (jobs, API receipts, etc.). */
  debugLines?: OperatorTraceLine[]
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
  /** data-dav-anchor value for the on-page element this verify tile points to. */
  anchor?: string
  /** Structured live data for the detail panel (usually `kind: 'last-event'`). */
  evidence?: DavEvidence
  /** configDocs IDs blocking the verification step. */
  missingConfigIds?: string[]
  debugLines?: OperatorTraceLine[]
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
   *  with PageActionBar. Pass `null` (or omit entirely) to render the
   *  calm "nothing to do" affordance — many pages have no rule-engine
   *  next-best-action and want the placid Act tile by default. */
  act?: PageAction | null
  /** Contextual calm copy for the Act tile when `act` is null. */
  actIdle?: HeroActIdle
  /** data-dav-anchor value for the Act tile's on-page element. */
  actAnchor?: string
  /** Structured evidence for the Act tile detail panel
   *  (usually `kind: 'rule-trace'`). */
  actEvidence?: DavEvidence
  /** configDocs IDs blocking the Act tile. */
  actMissingConfigIds?: string[]
  /** Extra debug lines for the Act tile operator trace. */
  actDebugLines?: OperatorTraceLine[]
  verify: PageHeroVerify
  /** Optional chart/KPI sparkline shown to the right of Decide in a
   *  full-width layout (keeps the hero interesting when there IS a
   *  trending metric worth showing). */
  decideAccessory?: ReactNode
  /** Fired when the advanced-mode collapse toggle changes (per scope). */
  onCollapsedChange?: (collapsed: boolean) => void
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
  ok:      { ring: 'border-ok/40',      bg: 'bg-ok-muted',      text: 'text-ok-foreground',     dot: 'bg-ok' },
  info:    { ring: 'border-info/40',    bg: 'bg-info-muted',    text: 'text-info-foreground',   dot: 'bg-info' },
  warn:    { ring: 'border-warn/40',    bg: 'bg-warn-muted',    text: 'text-warning-foreground', dot: 'bg-warn' },
  crit:    { ring: 'border-err/40',     bg: 'bg-danger-muted',  text: 'text-danger-foreground', dot: 'bg-err' },
  neutral: { ring: 'border-edge',       bg: 'bg-surface-raised', text: 'text-fg',    dot: 'bg-fg-muted' },
}

// Persisted hero collapse state — same pattern Pipeline Pulse uses so
// the operator's choice ("I'm in heads-down mode, hide the chrome") sticks
// across reloads. Hero collapse is per-scope so a noisy page (e.g. /reports)
// can stay open while a quiet one (/billing) is collapsed.
const HERO_COLLAPSE_KEY = 'mushi:pageHero:collapsed:v1'

/** Workhorse list pages — start collapsed so triage tables get vertical space. */
const DEFAULT_COLLAPSED_SCOPES = new Set([
  'reports', 'fixes', 'inventory', 'inbox',
  // Config / exploration pages — DAV hero collapsed by default (triage/health stay expanded).
  'query', 'graph', 'explore', 'qa-coverage', 'storage', 'onboarding', 'feedback',
  'projects', 'feature-board', 'queue', 'anti-gaming', 'integrations', 'compliance',
])

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

/** Live metric chips for the snapshot header — avoids truncating backend strings. */
function HeroSnapshotMeta({ metric, kicker }: { metric?: string; kicker?: string }) {
  const chips = heroMetricChips(metric)
  if (chips.length === 0 && !kicker) return null
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip}
          className="inline-flex shrink-0 items-center rounded border border-edge-subtle bg-surface-overlay px-1.5 py-0.5 text-3xs font-mono tabular-nums leading-none text-fg-secondary"
        >
          {chip}
        </span>
      ))}
      {kicker && (
        <>
          {chips.length > 0 && <span aria-hidden className="text-fg-faint">·</span>}
          <span className="text-2xs text-fg-muted shrink-0">{kicker}</span>
        </>
      )}
    </>
  )
}

/**
 * Render the 3-tile hero. Beginners collapse it to a single friendlier
 * pill (they still get the global NextBestAction strip above the layout
 * — stacking a second tile hero for them is noisy).
 */
export function PageHero({
  scope,
  title,
  kicker,
  decide,
  act: actProp,
  actIdle,
  actAnchor,
  actEvidence,
  actMissingConfigIds,
  actDebugLines,
  verify,
  decideAccessory,
  onCollapsedChange,
}: PageHeroProps) {
  const { isAdvanced } = useAdminMode()
  const severity = decide.severity ?? 'neutral'
  const style = SEVERITY_STYLE[severity]
  // Normalise the optional `act` prop to a strict `PageAction | null`
  // before threading it into HeroFlow / HeroDetailPanel / operatorTrace,
  // all of which were authored against the original `PageAction | null`
  // shape and have no `undefined` branch. Pages may now omit `act`
  // entirely (treated as "nothing to do") or pass `null` explicitly.
  const act: PageAction | null = actProp ?? null

  // Per-scope collapse, per-tile expand. The tile-level state is in-memory
  // only — operators expand "Act" to grab a secondary CTA, not as a long-
  // lived preference, so we don't burn a localStorage write on it.
  const [collapsedScopes, setCollapsedScopes] = useState<Record<string, boolean>>(readCollapsedScopes)
  const collapsed = collapsedScopes[scope] ?? DEFAULT_COLLAPSED_SCOPES.has(scope)
  const [expandedTile, setExpandedTile] = useState<'decide' | 'act' | 'verify' | null>(null)
  const { spotlight, clearSpotlight } = useDavSpotlight()
  // Ref to the hero section so the detail panel's "Show on page" button
  // can focus back into it after spotlight is cleared.
  const heroRef = useRef<HTMLElement>(null)

  useEffect(() => {
    writeCollapsedScopes(collapsedScopes)
  }, [collapsedScopes])

  useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  const operatorTraces = useMemo(
    () => ({
      decide: buildOperatorTrace({
        scope,
        tile: 'decide',
        decide,
        evidence: decide.evidence,
        anchor: decide.anchor,
      }),
      act: buildOperatorTrace({
        scope,
        tile: 'act',
        action: act,
        evidence: actEvidence,
        anchor: actAnchor,
        extraDebugLines: actDebugLines,
      }),
      verify: buildOperatorTrace({
        scope,
        tile: 'verify',
        verify,
        evidence: verify.evidence,
        anchor: verify.anchor,
      }),
    }),
    [scope, decide, act, actEvidence, actAnchor, actDebugLines, verify],
  )

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
    const isExpanding = expandedTile !== tile
    setExpandedTile(isExpanding ? tile : null)

    if (isExpanding) {
      // Fire spotlight on the on-page anchor for this tile.
      const anchor =
        tile === 'decide' ? decide.anchor
        : tile === 'act'  ? actAnchor
        :                   verify.anchor
      if (anchor) spotlight(anchor)
    } else {
      clearSpotlight()
    }
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
          className={`group flex items-center gap-2.5 w-full rounded-sm bg-surface-overlay px-2.5 py-1.5 text-left motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
          title="Expand page snapshot"
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
          <span className="text-3xs font-medium text-fg-secondary uppercase tracking-wider shrink-0">
            Snapshot
          </span>
          <span className={`text-2xs font-medium truncate ${style.text}`}>
            {decide.label}
          </span>
          <HeroSnapshotMeta metric={decide.metric} />
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
      ref={heroRef}
      role="banner"
      aria-label={`${title} hero`}
      data-scope={scope}
      data-hero-variant="decide-act-verify-flow"
      data-collapsed="false"
      className={[
        'mb-5 w-full overflow-visible rounded-md bg-surface-raised border border-edge-subtle shadow-card',
        'hero-snapshot-shell',
        severity === 'crit' ? 'hero-snapshot-shell--crit' : severity === 'warn' ? 'hero-snapshot-shell--warn' : '',
      ].join(' ')}
    >
      {/* Header strip — title + collapse toggle. Stays tight (~28px) so the
          hero's vertical footprint barely grows from the previous version. */}
      <header className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-edge-subtle/25">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} />
          <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint shrink-0">
            Snapshot
          </span>
          <HeroSnapshotMeta metric={decide.metric} kicker={kicker} />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={true}
          aria-controls={`hero-${scope}-flow`}
          className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          title="Collapse page hero"
        >
          Collapse <span aria-hidden>▴</span>
        </button>
      </header>

      {/* ReactFlow lane: 3 custom nodes (Decide / Act / Verify) connected
          by 2 gradient bezier edges. */}
      <div id={`hero-${scope}-flow`} className="w-full px-1 pb-1">
        <HeroFlow
          scope={scope}
          decide={{
            label: decide.label,
            metric: decide.metric,
            summary: decide.summary,
            severity: decide.severity ?? 'neutral',
            anchor: decide.anchor,
            evidence: decide.evidence,
            missingConfigIds: decide.missingConfigIds,
            debugLines: decide.debugLines,
          }}
          act={{
            action: act,
            idle: actIdle,
            anchor: actAnchor,
            evidence: actEvidence,
            missingConfigIds: actMissingConfigIds,
            debugLines: actDebugLines,
          }}
          verify={{
            label: verify.label,
            detail: verify.detail,
            to: verify.to,
            secondaryTo: verify.secondaryTo,
            secondaryLabel: verify.secondaryLabel,
            anchor: verify.anchor,
            evidence: verify.evidence,
            missingConfigIds: verify.missingConfigIds,
            debugLines: verify.debugLines,
          }}
          expandedTile={expandedTile}
          onToggleTile={toggleTile}
          decideAccessory={decideAccessory}
          operatorTraces={operatorTraces}
        />
      </div>

      {/* Detail panel — rendered below the ReactFlow lane when a tile is
          expanded. Lives outside the canvas so it can have variable height
          and full-width layout without fighting ReactFlow's fixed-size nodes. */}
      {expandedTile && (
        <HeroDetailPanel
          tile={expandedTile}
          scope={scope}
          decide={decide}
          action={act}
          actEvidence={actEvidence}
          actAnchor={actAnchor}
          actMissingConfigIds={actMissingConfigIds}
          actDebugLines={actDebugLines}
          verify={verify}
          onSpotlight={spotlight}
          onClose={() => toggleTile(expandedTile)}
        />
      )}
    </section>
  )
}
