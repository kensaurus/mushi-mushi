/**
 * FILE: apps/admin/src/components/hero-flow/HeroNodes.tsx
 * PURPOSE: Custom React Flow node components for the per-page hero lane:
 *          DecideNode (severity-tinted, big metric), ActNode (action-tone
 *          tinted, primary CTA), VerifyNode (neutral, evidence link).
 *
 *          All three share a common shell — header eyebrow, severity dot,
 *          chevron toggle — so the hero reads as three siblings with
 *          consistent rhythm rather than three different cards.
 *
 *          Interaction model:
 *            • Body click toggles the per-tile "expanded" state (held by
 *              the parent <HeroFlow />, threaded in via node data).
 *            • CTAs / evidence links use `nodrag` + `stopPropagation` so
 *              they don't bubble into the body toggle, and so React Flow
 *              doesn't intercept their click as a pan attempt.
 *            • A `data-hero-primary` / `data-hero-secondary` attribute
 *              is preserved on the Act CTA so the existing Playwright
 *              dead-button sweep continues to work without changes.
 */
import { memo, type MouseEvent, type ReactNode } from 'react'

import { Link } from 'react-router-dom'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

import { Btn } from '../ui'
import type { PageAction } from '../PageActionBar'
import {
  HERO_ACTION_TONE_HEX,
  HERO_SEVERITY_HEX,
  type HeroActNodeData,
  type HeroDecideNodeData,
  type HeroSeverity,
  type HeroVerifyNodeData,
} from './heroFlow.data'

// ─── Severity tokens (for tint backgrounds — hex tokens drive SVG only)

const SEVERITY_BG: Record<HeroSeverity, string> = {
  ok: 'bg-ok-muted/15',
  info: 'bg-info-muted/15',
  warn: 'bg-warn/10',
  crit: 'bg-err/10',
  neutral: 'bg-surface-raised/40',
}

const SEVERITY_TEXT: Record<HeroSeverity, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  crit: 'text-err',
  neutral: 'text-fg',
}

const ACTION_BG: Record<PageAction['tone'], string> = {
  plan: 'bg-info-muted/15',
  do: 'bg-brand/10',
  check: 'bg-warn/10',
  act: 'bg-ok-muted/15',
  idle: 'bg-surface-raised/40',
}

// Per-node hex used for unique left-border accent and ring on expand.
const NODE_ACCENT_HEX = {
  decide: '#60a5fa',
  act: '#f5b544',
  verify: '#94a3b8',
} as const

// ─── Common shell ─────────────────────────────────────────────────────

interface NodeShellProps {
  /** Tile identity, used for `aria-labelledby` + analytics scope. */
  scope: string
  kind: 'decide' | 'act' | 'verify'
  eyebrow: 'Decide' | 'Act' | 'Verify'
  /** Background tint class. */
  bgClass: string
  /** Foreground accent for the eyebrow dot + ring colour. */
  accentHex: string
  /** Small status glyph rendered next to the eyebrow ("✓", "→", "◎"). */
  glyph?: ReactNode
  /** Pulse the dot when true (used for crit Decide / failing Act). */
  pulse?: boolean
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  /** Slot rendered when expanded — kept inside the same node so React
   *  Flow's layout doesn't shift on toggle. */
  expandedSlot?: ReactNode
}

function NodeShell({
  scope,
  kind,
  eyebrow,
  bgClass,
  accentHex,
  glyph,
  pulse,
  expanded,
  onToggle,
  children,
  expandedSlot,
}: NodeShellProps) {
  const headingId = `hero-${scope}-${kind}`
  const borderHex = NODE_ACCENT_HEX[kind]

  return (
    <article
      aria-labelledby={headingId}
      data-hero-tile={kind}
      className={[
        'group/hero relative flex h-full w-full flex-col rounded-md px-3 py-2.5 text-xs pointer-events-auto',
        'motion-safe:transition-all motion-safe:duration-200',
        bgClass,
        expanded
          ? 'shadow-md scale-[1.01]'
          : 'shadow-sm hover:shadow-md hover:scale-[1.005]',
      ].join(' ')}
      style={{
        borderLeft: `3px solid ${borderHex}`,
        borderTop: `1px solid ${borderHex}30`,
        borderRight: `1px solid ${borderHex}30`,
        borderBottom: `1px solid ${borderHex}30`,
        ...(expanded
          ? { boxShadow: `0 0 0 2px ${accentHex}40, 0 4px 12px ${accentHex}15` }
          : {}),
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!bg-transparent !border-none !w-1.5 !h-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!bg-transparent !border-none !w-1.5 !h-1.5"
      />

      <header className="flex items-center gap-1.5">
        <span
          className="relative inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: accentHex }}
          aria-hidden="true"
        >
          {pulse && (
            <span
              className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
              style={{ backgroundColor: accentHex }}
              aria-hidden="true"
            />
          )}
        </span>
        <h3
          id={headingId}
          className="text-2xs uppercase tracking-wider font-semibold"
          style={{ color: borderHex }}
        >
          {eyebrow}
        </h3>
        {glyph && (
          <span aria-hidden="true" className="text-2xs text-fg-muted">
            {glyph}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${eyebrow}` : `Expand ${eyebrow} for more detail`}
          title={expanded ? `Collapse ${eyebrow}` : `Show more about ${eyebrow}`}
          className="nodrag ml-auto inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span
            aria-hidden
            className={`inline-block text-xs motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
      </header>

      <div className="mt-1 flex-1 min-h-0">{children}</div>

      {expanded && expandedSlot && (
        <div className="mt-2 border-t border-edge-subtle/60 pt-2 text-2xs text-fg-faint leading-relaxed">
          {expandedSlot}
        </div>
      )}
    </article>
  )
}

// ─── Decide ───────────────────────────────────────────────────────────

function DecideInner({ data }: NodeProps) {
  const node = data as HeroDecideNodeData
  const { decide } = node
  const accent = HERO_SEVERITY_HEX[decide.severity]
  return (
    <NodeShell
      scope={node.scope}
      kind="decide"
      eyebrow="Decide"
      bgClass={SEVERITY_BG[decide.severity]}
      accentHex={accent}
      pulse={decide.severity === 'crit' || decide.severity === 'warn'}
      expanded={node.expanded}
      onToggle={node.onToggle}
      expandedSlot={
        <>
          {(node.accessory as ReactNode | undefined) ?? (
            <p>
              No additional context published for this scope. Pages can supply a sparkline,
              trend, or extra metric via the <code className="font-mono text-fg-muted">decideAccessory</code> prop.
            </p>
          )}
          <p className="mt-1 text-3xs font-mono text-fg-faint">
            severity: <span className="text-fg-muted">{decide.severity}</span>
          </p>
        </>
      }
    >
      <p
        className={`text-xs font-medium leading-tight truncate ${SEVERITY_TEXT[decide.severity]}`}
        title={decide.label}
      >
        {decide.label}
      </p>
      {decide.metric && (
        <p className="mt-1 text-xl font-semibold text-fg tabular-nums leading-tight">
          {decide.metric}
        </p>
      )}
      <p className="mt-1 text-2xs text-fg-muted leading-snug line-clamp-2">{decide.summary}</p>
      {!node.expanded && (node.accessory as ReactNode | undefined) && (
        <div className="mt-1.5">{node.accessory as ReactNode}</div>
      )}
    </NodeShell>
  )
}

export const HeroDecideNode = memo(DecideInner)

// ─── Act ──────────────────────────────────────────────────────────────

function ActInner({ data }: NodeProps) {
  const node = data as HeroActNodeData
  const action = node.act.action
  if (!action) {
    const accent = HERO_ACTION_TONE_HEX.act
    return (
      <NodeShell
        scope={node.scope}
        kind="act"
        eyebrow="Act"
        bgClass={ACTION_BG.idle}
        accentHex={accent}
        glyph={<span className="text-ok">✓</span>}
        expanded={node.expanded}
        onToggle={node.onToggle}
        expandedSlot={
          <p>
            When the rule engine identifies a next-best-action for this scope, the primary CTA
            appears here. Until then, this tile reads as a calm receipt that the page is nominal.
          </p>
        }
      >
        <p className="text-xs font-medium text-fg leading-tight">All clear</p>
        <p className="mt-1 text-2xs text-fg-muted leading-snug line-clamp-2">
          Nothing actionable here right now. The next ingest will refresh this tile.
        </p>
      </NodeShell>
    )
  }

  const accent = HERO_ACTION_TONE_HEX[action.tone]
  const visibleSecondaries = node.expanded
    ? (action.secondary ?? [])
    : (action.secondary ?? []).slice(0, 1)

  return (
    <NodeShell
      scope={node.scope}
      kind="act"
      eyebrow="Act"
      bgClass={ACTION_BG[action.tone]}
      accentHex={accent}
      glyph={<span style={{ color: accent }}>→</span>}
      pulse={action.tone === 'check' || action.tone === 'do'}
      expanded={node.expanded}
      onToggle={node.onToggle}
      expandedSlot={
        action.secondary && action.secondary.length > 1 ? (
          <p>
            Showing {action.secondary.length} secondary action
            {action.secondary.length === 1 ? '' : 's'}.
          </p>
        ) : (
          <p>
            Tone: <span className="text-fg-muted font-mono">{action.tone}</span>. The rule
            engine recomputes this CTA on every page reload — open the action and the system
            verifies it landed.
          </p>
        )
      }
    >
      <p className="text-xs font-medium text-fg leading-snug line-clamp-2">{action.title}</p>
      {action.reason && (
        <p className="mt-0.5 text-2xs text-fg-muted leading-snug line-clamp-2">{action.reason}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {action.primary && <HeroCta cta={action.primary} variant="primary" />}
        {visibleSecondaries.map((s, i) => (
          <HeroCta key={i} cta={s} variant="ghost" />
        ))}
      </div>
    </NodeShell>
  )
}

export const HeroActNode = memo(ActInner)

// ─── Verify ───────────────────────────────────────────────────────────

function VerifyInner({ data }: NodeProps) {
  const node = data as HeroVerifyNodeData
  const accent = HERO_SEVERITY_HEX.neutral
  return (
    <NodeShell
      scope={node.scope}
      kind="verify"
      eyebrow="Verify"
      bgClass="bg-surface-raised/40"
      accentHex={accent}
      glyph={<span className="text-fg-muted">◎</span>}
      expanded={node.expanded}
      onToggle={node.onToggle}
      expandedSlot={
        <p>
          Verification is the receipt for the most recent Act. Open the evidence link to
          confirm the action landed where the rule promised it would.
        </p>
      }
    >
      <p className="text-xs font-medium text-fg leading-tight truncate" title={node.verify.label}>
        {node.verify.label}
      </p>
      <p
        className={`mt-1 text-2xs font-mono leading-snug text-fg-muted ${node.expanded ? 'break-all' : 'truncate'}`}
        title={node.verify.detail}
      >
        {node.verify.detail}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {node.verify.to && (
          <Link
            data-hero-verify
            to={node.verify.to}
            onClick={(e) => e.stopPropagation()}
            className="nodrag inline-flex items-center gap-1 rounded-sm bg-brand/90 px-2.5 py-1 text-2xs font-semibold text-brand-fg hover:bg-brand motion-safe:transition-colors shadow-sm"
          >
            Open evidence <span aria-hidden="true">→</span>
          </Link>
        )}
        {node.verify.secondaryTo && node.verify.secondaryLabel && (
          <Link
            to={node.verify.secondaryTo}
            onClick={(e) => e.stopPropagation()}
            className="nodrag inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
          >
            {node.verify.secondaryLabel}
          </Link>
        )}
      </div>
    </NodeShell>
  )
}

export const HeroVerifyNode = memo(VerifyInner)

// ─── HeroCta — shared CTA renderer for the Act node ───────────────────
//
// Mirrors the original PageHero's HeroCta verbatim so the
// `data-hero-primary` / `data-hero-secondary` test hooks stay intact and
// the Playwright dead-button sweep doesn't need updating.

function HeroCta({
  cta,
  variant,
}: {
  cta: NonNullable<PageAction['primary']>
  variant: 'primary' | 'ghost'
}) {
  const testHook =
    variant === 'primary' ? { 'data-hero-primary': true } : { 'data-hero-secondary': true }
  const stop = (e: MouseEvent) => e.stopPropagation()
  if (cta.kind === 'link') {
    if (variant === 'primary') {
      return (
        <Link
          {...testHook}
          to={cta.to}
          onClick={stop}
          className="nodrag inline-flex items-center gap-1 rounded-sm bg-brand px-3 py-1.5 text-2xs font-bold text-brand-fg hover:bg-brand-hover shadow-sm shadow-brand/25 motion-safe:transition-all hover:shadow-md hover:shadow-brand/30"
        >
          {cta.label} <span aria-hidden="true">→</span>
        </Link>
      )
    }
    return (
      <Link
        {...testHook}
        to={cta.to}
        onClick={stop}
        className="nodrag inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
      >
        {cta.label}
      </Link>
    )
  }
  return (
    <span className="nodrag" onClick={stop}>
      <Btn size="sm" variant={variant} onClick={cta.onClick} disabled={cta.disabled} {...testHook}>
        {cta.label}
      </Btn>
    </span>
  )
}
