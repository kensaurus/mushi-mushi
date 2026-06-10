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
import { OperatorTraceBadge } from './OperatorTraceLog'
import type { OperatorTraceLine } from './operatorTrace'

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
  neutral: 'text-fg-muted',
}

const SEVERITY_DOT: Record<HeroSeverity, string> = {
  ok: 'bg-ok',
  info: 'bg-info',
  warn: 'bg-warn',
  crit: 'bg-err',
  neutral: 'bg-fg-faint',
}

const ACTION_TEXT: Record<PageAction['tone'], string> = {
  plan: 'text-info',
  do: 'text-brand',
  check: 'text-warn',
  act: 'text-ok',
  idle: 'text-fg-muted',
}

const ACTION_DOT: Record<PageAction['tone'], string> = {
  plan: 'bg-info',
  do: 'bg-brand',
  check: 'bg-warn',
  act: 'bg-ok',
  idle: 'bg-fg-faint',
}

const ACTION_CHIP: Record<PageAction['tone'], string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Act',
  idle: '—',
}

const ACTION_BG: Record<PageAction['tone'], string> = {
  plan: 'bg-info-muted/15',
  do: 'bg-brand/10',
  check: 'bg-warn/10',
  act: 'bg-ok-muted/15',
  idle: 'bg-surface-raised/40',
}

// Per-node accent colors — map to CSS custom properties so they stay
// in sync with light/dark theme rather than burning in a fixed hex.
const NODE_ACCENT_HEX = {
  decide: 'var(--color-info)',
  act:    'var(--color-brand)',
  verify: 'var(--color-ok)',
} as const

const KIND_BADGE: Record<'decide' | 'act' | 'verify', string> = {
  decide: 'bg-info/15 text-info border border-info/35',
  act:    'bg-brand/15 text-brand border border-brand/35',
  verify: 'bg-ok-muted/20 text-ok border border-ok/35',
}

// ─── Shared body layout (mirrors PipelineStatusRibbon tile rhythm) ───

/** Right-aligned metric — larger mono numerics for scan-friendly counts. */
function HeroMetric({
  value,
  toneClass,
  title,
}: {
  value: string
  toneClass: string
  title?: string
}) {
  const trimmed = value.trim()
  const numericLeading = /^[\d]/.test(trimmed) || /^[\d.,]+/.test(trimmed)
  const sizeClass = numericLeading
    ? 'text-base font-bold tracking-tight'
    : 'text-xs font-semibold tracking-normal'

  return (
    <span
      title={title}
      className={`ml-auto shrink-0 max-w-[55%] truncate text-right font-mono tabular-nums leading-none ${sizeClass} ${toneClass}`}
    >
      {value}
    </span>
  )
}

/** Headline + optional metric — stacked so long copy never fights for width. */
function HeroStatBlock({
  dotClass,
  dotPulse = false,
  label,
  labelClass = 'text-fg',
  value,
  valueClass,
  labelTitle,
}: {
  dotClass: string
  dotPulse?: boolean
  label: string
  labelClass?: string
  value?: string
  valueClass: string
  labelTitle?: string
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-start gap-1.5 min-w-0">
        <span
          aria-hidden
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} ${dotPulse ? 'motion-safe:animate-pulse' : ''}`}
        />
        <p
          className={`min-w-0 flex-1 text-xs font-semibold leading-snug line-clamp-1 ${labelClass}`}
          title={labelTitle ?? label}
        >
          {label}
        </p>
      </div>
      {value != null && value !== '' && (
        <p
          className={`pl-3 text-2xs font-mono tabular-nums leading-snug line-clamp-1 ${valueClass}`}
          title={value}
        >
          {value}
        </p>
      )}
    </div>
  )
}

function HeroStatRow({
  dotClass,
  dotPulse = false,
  label,
  labelClass = 'text-fg',
  value,
  valueClass,
  labelTitle,
}: {
  dotClass: string
  dotPulse?: boolean
  label: string
  labelClass?: string
  value?: string
  valueClass: string
  labelTitle?: string
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} ${dotPulse ? 'motion-safe:animate-pulse' : ''}`}
      />
      <span
        className={`min-w-0 flex-1 text-xs font-medium leading-tight truncate ${labelClass}`}
        title={labelTitle ?? label}
      >
        {label}
      </span>
      {value != null && value !== '' && (
        <HeroMetric value={value} toneClass={valueClass} title={value} />
      )}
    </div>
  )
}

// ─── Common shell ─────────────────────────────────────────────────────

interface NodeShellProps {
  /** Tile identity, used for `aria-labelledby` + analytics scope. */
  scope: string
  kind: 'decide' | 'act' | 'verify'
  eyebrow: 'Status' | 'Next step' | 'Evidence'
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
  operatorTrace?: OperatorTraceLine[]
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
  operatorTrace,
}: NodeShellProps) {
  const headingId = `hero-${scope}-${kind}`
  const borderHex = NODE_ACCENT_HEX[kind]

  return (
    <article
      aria-labelledby={headingId}
      data-hero-tile={kind}
      data-hero-expanded={expanded ? 'true' : 'false'}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      className={[
        'group/hero relative flex h-full w-full flex-col overflow-hidden rounded-md px-3 py-2 text-xs pointer-events-auto cursor-pointer',
        'motion-safe:transition-[box-shadow] motion-safe:duration-200',
        bgClass,
        expanded ? 'ring-1 ring-inset shadow-md' : 'shadow-sm hover:shadow-md',
      ].join(' ')}
      style={{
        borderLeft: `3px solid ${borderHex}`,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!bg-transparent !border-none !w-2 !h-2 !-left-px"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!bg-transparent !border-none !w-2 !h-2 !-right-px"
      />
      {/* Edge anchor — small dot flush with the border */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2 z-[1] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-surface)]"
        style={{ backgroundColor: accentHex }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 z-[1] h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-surface)]"
        style={{ backgroundColor: accentHex }}
      />

      <header className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-3xs font-bold leading-none ${KIND_BADGE[kind]}`}
        >
          {kind === 'decide' ? 'S' : kind === 'act' ? 'N' : 'E'}
        </span>
        <span
          className="relative inline-block h-1.5 w-1.5 shrink-0 rounded-full"
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
          className="text-2xs font-medium uppercase tracking-wider text-fg-secondary"
        >
          {eyebrow}
        </h3>
        {operatorTrace && operatorTrace.length > 0 && (
          <OperatorTraceBadge lines={operatorTrace} />
        )}
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

      <div className="mt-1 flex-1 min-h-0 overflow-hidden">{children}</div>

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
        eyebrow="Status"
      bgClass={SEVERITY_BG[decide.severity]}
      accentHex={accent}
      pulse={decide.severity === 'crit' || decide.severity === 'warn'}
      expanded={node.expanded}
      onToggle={node.onToggle}
      operatorTrace={node.operatorTrace}
      expandedSlot={
        <p className="text-3xs text-fg-faint italic">
          Operator trace below ↓
        </p>
      }
    >
      <HeroStatBlock
        dotClass={SEVERITY_DOT[decide.severity]}
        dotPulse={decide.severity === 'crit' || decide.severity === 'warn'}
        label={decide.label}
        labelClass="text-fg"
        value={decide.metric}
        valueClass={SEVERITY_TEXT[decide.severity]}
        labelTitle={decide.label}
      />
      <p className="mt-1 text-2xs text-fg-muted leading-snug line-clamp-2">{decide.summary}</p>
      {!node.expanded && (node.accessory as ReactNode | undefined) && (
        <div className="mt-1">{node.accessory as ReactNode}</div>
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
        eyebrow="Next step"
        bgClass={ACTION_BG.idle}
        accentHex={accent}
        glyph={<span className="text-ok">✓</span>}
        expanded={node.expanded}
        onToggle={node.onToggle}
        operatorTrace={node.operatorTrace}
        expandedSlot={<p className="text-3xs text-fg-faint italic">Operator trace below ↓</p>}
      >
        <HeroStatRow
          dotClass={ACTION_DOT.idle}
          label="All clear"
          value="0"
          valueClass={ACTION_TEXT.act}
        />
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
      eyebrow="Next step"
      bgClass={ACTION_BG[action.tone]}
      accentHex={accent}
      glyph={<span style={{ color: accent }}>→</span>}
      pulse={action.tone === 'check' || action.tone === 'do'}
      expanded={node.expanded}
      onToggle={node.onToggle}
      operatorTrace={node.operatorTrace}
      expandedSlot={<p className="text-3xs text-fg-faint italic">Operator trace below ↓</p>}
    >
      <HeroStatBlock
        dotClass={ACTION_DOT[action.tone]}
        dotPulse={action.tone === 'check' || action.tone === 'do'}
        label={action.title}
        labelClass="text-fg"
        value={ACTION_CHIP[action.tone]}
        valueClass={ACTION_TEXT[action.tone]}
        labelTitle={action.title}
      />
      {action.reason && (
        <p className="mt-1 text-2xs text-fg-muted leading-snug line-clamp-2">{action.reason}</p>
      )}
      {node.expanded && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {action.primary && <HeroCta cta={action.primary} variant="primary" />}
          {visibleSecondaries.map((s, i) => (
            <HeroCta key={i} cta={s} variant="ghost" />
          ))}
        </div>
      )}
    </NodeShell>
  )
}

export const HeroActNode = memo(ActInner)

// ─── Verify ───────────────────────────────────────────────────────────

function VerifyInner({ data }: NodeProps) {
  const node = data as HeroVerifyNodeData
  const accent = HERO_SEVERITY_HEX.ok
  return (
    <NodeShell
      scope={node.scope}
      kind="verify"
      eyebrow="Evidence"
      bgClass="bg-ok-muted/10"
      accentHex={accent}
      glyph={<span className="text-ok">◎</span>}
      expanded={node.expanded}
      onToggle={node.onToggle}
      operatorTrace={node.operatorTrace}
      expandedSlot={<p className="text-3xs text-fg-faint italic">Operator trace below ↓</p>}
    >
      <HeroStatBlock
        dotClass="bg-ok/80"
        label={node.verify.label}
        labelClass="text-fg"
        value={node.verify.detail}
        valueClass={node.verify.detail === 'no reports yet' ? 'text-warn' : 'text-fg-muted'}
        labelTitle={node.verify.label}
      />
      {node.verify.to && (
        <div className={`flex flex-wrap items-center gap-2 ${node.expanded ? 'mt-1.5' : 'mt-1'}`}>
          <Link
            data-hero-verify
            to={node.verify.to}
            onClick={(e) => e.stopPropagation()}
            className="nodrag inline-flex items-center gap-1 rounded-sm border border-edge bg-surface-overlay/80 px-2 py-0.5 text-2xs font-medium text-fg-secondary hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
          >
            Open evidence <span aria-hidden="true">→</span>
          </Link>
          {node.expanded && node.verify.secondaryTo && node.verify.secondaryLabel && (
            <Link
              to={node.verify.secondaryTo}
              onClick={(e) => e.stopPropagation()}
              className="nodrag inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
            >
              {node.verify.secondaryLabel}
            </Link>
          )}
        </div>
      )}
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
