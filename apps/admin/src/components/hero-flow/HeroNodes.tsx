/**
 * FILE: apps/admin/src/components/hero-flow/HeroNodes.tsx
 * PURPOSE: Custom React Flow nodes for the page hero lane (Decide → Act → Verify).
 *          Fused instrument-strip styling, dominant numerics, chip deep-links,
 *          and PDCA-style microinteractions (count pulse, hover focus, press).
 */
import { memo, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

import { Link } from 'react-router-dom'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

import { Btn } from '../ui'
import { IconArrowRight, IconCheck, IconInfo } from '../icons'
import type { PageAction } from '../PageActionBar'
import {
  HERO_ACT_IDLE,
  HERO_EYEBROWS,
  HERO_EYEBROWS_BEGINNER,
} from '../../lib/guideCopy'
import { useAdminMode } from '../../lib/mode'
import { usePrevious } from '../flow-primitives/usePrevious'
import { StageHealthRing } from '../flow-primitives/StageHealthRing'
import {
  HERO_ACTION_TONE_HEX,
  HERO_SEVERITY_HEX,
  type HeroActNodeData,
  type HeroDecideNodeData,
  type HeroSeverity,
  type HeroVerifyNodeData,
} from './heroFlow.data'
import { useHeroFlow, type HeroTileId } from './HeroFlowContext'
import { chipLinkForText, parseDecideMetric } from './heroMetricDisplay'

// ─── Semantic tokens ───────────────────────────────────────────────────

const SEVERITY_TEXT: Record<HeroSeverity, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  crit: 'text-err',
  neutral: 'text-fg-muted',
}

const SEVERITY_GLOW: Record<HeroSeverity, string> = {
  ok: '',
  info: '',
  warn: 'hero-node-severity-warn',
  crit: 'hero-node-severity-crit',
  neutral: '',
}

const NODE_KIND_ICON: Record<HeroTileId, typeof IconInfo> = {
  decide: IconInfo,
  act: IconArrowRight,
  verify: IconCheck,
}

const CTA_PRIMARY: Record<PageAction['tone'], string> = {
  do: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-md shadow-brand/35 border border-brand/50',
  check: 'bg-warn text-warn-fg hover:brightness-105 shadow-md shadow-warn/35 border border-warn/55',
  plan: 'bg-info text-info-fg hover:brightness-105 shadow-md shadow-info/30 border border-info/50',
  act: 'bg-ok text-ok-fg hover:brightness-105 shadow-md shadow-ok/30 border border-ok/50',
  idle: 'bg-surface-overlay text-fg-muted border border-edge',
}

const CTA_DANGER =
  'bg-danger text-danger-fg hover:brightness-105 shadow-md shadow-danger/35 border border-danger/55 font-bold'

function ctaPrimaryClass(tone: PageAction['tone'], title?: string): string {
  if (title && /\bfail(ed|ure)?s?\b|\berror\b|\bblocked\b|\bbroken\b/i.test(title)) {
    return CTA_DANGER
  }
  return CTA_PRIMARY[tone]
}

function nodeKindLabel(kind: HeroTileId, beginner: boolean): string {
  const labels = beginner ? HERO_EYEBROWS_BEGINNER : HERO_EYEBROWS
  return labels[kind]
}

const SEVERITY_CHIP: Record<HeroSeverity, string> = {
  ok: 'bg-surface-overlay text-fg-secondary border-edge hover:border-ok/40',
  info: 'bg-surface-overlay text-fg-secondary border-edge hover:border-info/40',
  warn: 'bg-surface-overlay text-fg-secondary border-warn/35 hover:border-warn/55 hover:bg-warn/10',
  crit: 'bg-surface-overlay text-fg-secondary border-danger/35 hover:border-danger/55 hover:bg-danger/10',
  neutral: 'bg-surface-overlay text-fg-secondary border-edge',
}

// ─── Metric display ────────────────────────────────────────────────────

function HeroPrimaryMetric({
  value,
  unit,
  toneClass,
  pulseKey,
}: {
  value?: string
  unit?: string
  toneClass: string
  pulseKey?: string
}) {
  const prev = usePrevious(pulseKey)
  const [popping, setPopping] = useState(false)

  useEffect(() => {
    if (pulseKey == null || prev === undefined || prev === pulseKey) return
    setPopping(true)
    const t = setTimeout(() => setPopping(false), 480)
    return () => clearTimeout(t)
  }, [pulseKey, prev])

  if (!value && !unit) return null

  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      {value && (
        <span
          className={[
            'text-2xl font-bold tabular-nums tracking-tight leading-none',
            toneClass,
            popping ? 'hero-count-pop-animate' : '',
          ].join(' ')}
        >
          {value}
        </span>
      )}
      {unit && (
        <span className="text-2xs font-medium text-fg-muted truncate normal-case">
          {unit}
        </span>
      )}
    </div>
  )
}

function HeroMetricChips({
  chips,
  chipClass,
  scope,
}: {
  chips: string[]
  chipClass: string
  scope: string
}) {
  if (chips.length === 0) return null
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Key metrics">
      {chips.map((chip) => {
        const to = chipLinkForText(chip, scope)
        const inner = (
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-mono tabular-nums leading-none whitespace-nowrap motion-safe:transition-opacity ${chipClass}`}>
            {chip}
          </span>
        )
        return (
          <li key={chip}>
            {to ? (
              <Link
                to={to}
                onClick={(e) => e.stopPropagation()}
                className="nodrag block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── Node shell ────────────────────────────────────────────────────────

interface NodeShellProps {
  scope: string
  kind: HeroTileId
  accentHex: string
  severity?: HeroSeverity
  active?: boolean
  pulse?: boolean
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  expandedSlot?: ReactNode
  celebrate?: boolean
}

function NodeShell({
  scope,
  kind,
  accentHex,
  severity = 'neutral',
  active = false,
  pulse = false,
  expanded,
  onToggle,
  children,
  expandedSlot,
  celebrate = false,
}: NodeShellProps) {
  const { mode } = useAdminMode()
  const beginner = mode === 'beginner' || mode === 'quickstart'
  const flow = useHeroFlow()
  const headingId = `hero-${scope}-${kind}`
  const KindIcon = NODE_KIND_ICON[kind]
  const kindLabel = nodeKindLabel(kind, beginner)

  const isHovered = flow.hovered === kind
  const isFocused = flow.focused === kind
  const isDimmed = flow.hovered != null && flow.hovered !== kind
  const isGlowing = flow.clicked === kind

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      flow.moveFocus(-1)
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      flow.moveFocus(1)
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      data-hero-tile={kind}
      data-hero-expanded={expanded ? 'true' : 'false'}
      data-hero-active={active ? 'true' : 'false'}
      tabIndex={isFocused ? 0 : -1}
      onFocus={() => flow.setFocused(kind)}
      onMouseEnter={() => flow.setHovered(kind)}
      onMouseLeave={() => flow.setHovered(null)}
      onClick={() => {
        flow.pulseClick(kind)
        onToggle()
      }}
      onKeyDown={handleKeyDown}
      className={[
        'hero-node-shell group/hero relative flex h-full w-full flex-col overflow-hidden pl-3.5 pr-2.5 py-2 text-xs pointer-events-auto cursor-pointer',
        'motion-safe:transition-[transform,opacity] motion-safe:duration-200',
        SEVERITY_GLOW[severity],
        active ? 'hero-node-shell--active z-[2]' : 'z-[1]',
        expanded ? 'hero-node-shell--expanded' : '',
        isDimmed ? 'opacity-88' : '',
        isHovered ? 'hero-node-shell--hover' : '',
        isFocused ? 'hero-node-shell--focus' : '',
        isGlowing ? 'hero-node-shell--glow-up' : '',
        celebrate ? 'hero-node-shell--celebrate' : '',
      ].join(' ')}
      style={{ '--hero-accent': accentHex } as CSSProperties}
    >
      <span
        aria-hidden
        className="hero-node-accent pointer-events-none absolute left-[5px] top-2.5 bottom-2.5 w-[3px] rounded-full"
        style={{ backgroundColor: accentHex }}
      />
      <Handle type="target" position={Position.Left} id="in" className="!bg-transparent !border-none !w-1 !h-1 !left-0 !opacity-0" />
      <Handle type="source" position={Position.Right} id="out" className="!bg-transparent !border-none !w-1 !h-1 !right-0 !opacity-0" />

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-1.5 mb-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-sm border border-edge bg-surface-overlay px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-fg-secondary">
            <span className="inline-flex shrink-0" style={{ color: accentHex }} aria-hidden>
              <KindIcon size={11} />
            </span>
            <span>{kindLabel}</span>
          </span>
          <h3 id={headingId} className="sr-only">{kindLabel}</h3>
          {pulse && severity !== 'neutral' && (
            <StageHealthRing
              value={severity === 'crit' ? 0.25 : 0.55}
              color={accentHex}
              glyph={severity === 'crit' ? '!' : undefined}
              size={18}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${kindLabel}` : `Expand ${kindLabel} for more detail`}
            className="nodrag ml-auto inline-flex h-4 w-4 items-center justify-center rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-overlay motion-safe:transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <span aria-hidden className={`inline-block text-xs motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
        </header>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {children}
        </div>

        {expanded && expandedSlot && (
          <div className="mt-2 border-t border-edge-subtle/50 pt-2 text-2xs text-fg-faint leading-relaxed">
            {expandedSlot}
          </div>
        )}
      </div>
    </article>
  )
}

// ─── Decide ───────────────────────────────────────────────────────────

function DecideInner({ data }: NodeProps) {
  const node = data as HeroDecideNodeData
  const { decide } = node
  const accent = HERO_SEVERITY_HEX[decide.severity]
  const parsed = parseDecideMetric(decide.label, decide.metric)
  const prevSeverity = usePrevious(decide.severity)
  const [celebrate, setCelebrate] = useState(false)

  useEffect(() => {
    if (!prevSeverity) return
    if ((prevSeverity === 'warn' || prevSeverity === 'crit') && decide.severity === 'ok') {
      setCelebrate(true)
      const t = setTimeout(() => setCelebrate(false), 950)
      return () => clearTimeout(t)
    }
  }, [decide.severity, prevSeverity])

  return (
    <NodeShell
      scope={node.scope}
      kind="decide"
      accentHex={accent}
      severity={decide.severity}
      pulse={decide.severity === 'crit' || decide.severity === 'warn'}
      expanded={node.expanded}
      onToggle={node.onToggle}
      celebrate={celebrate}
      expandedSlot={node.expanded ? <p className="text-xs text-fg-secondary leading-snug">{decide.summary}</p> : undefined}
    >
      <p className="text-xs font-semibold text-fg leading-snug" title={decide.label}>
        {decide.label}
      </p>
      <HeroPrimaryMetric
        value={parsed.value}
        unit={parsed.unit}
        toneClass={SEVERITY_TEXT[decide.severity]}
        pulseKey={parsed.value ?? decide.metric}
      />
      {parsed.secondaryChips.length > 0 && (
        <HeroMetricChips
          chips={parsed.secondaryChips}
          chipClass={SEVERITY_CHIP[decide.severity]}
          scope={node.scope}
        />
      )}
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
    const idle = node.act.idle
    return (
      <NodeShell
        scope={node.scope}
        kind="act"
        accentHex={HERO_ACTION_TONE_HEX.idle}
        expanded={node.expanded}
        onToggle={node.onToggle}
      >
        <p className="text-xs font-semibold text-fg leading-snug line-clamp-1">
          {idle?.label ?? 'Nothing to do'}
        </p>
        <p className="mt-0.5 text-3xs text-fg-muted leading-snug line-clamp-2">
          {idle?.summary ?? HERO_ACT_IDLE}
        </p>
      </NodeShell>
    )
  }

  const accent = HERO_ACTION_TONE_HEX[action.tone]
  const visibleSecondaries = node.expanded ? (action.secondary ?? []) : []

  return (
    <NodeShell
      scope={node.scope}
      kind="act"
      accentHex={accent}
      active
      pulse={action.tone === 'check' || action.tone === 'do'}
      expanded={node.expanded}
      onToggle={node.onToggle}
    >
      <p className="text-xs font-semibold text-fg leading-snug line-clamp-2" title={action.title}>
        {action.title}
      </p>
      {action.reason && !node.expanded && (
        <p className="mt-0.5 text-3xs text-fg-muted leading-snug line-clamp-1">{action.reason}</p>
      )}
      {action.reason && node.expanded && (
        <p className="mt-0.5 text-3xs text-fg-muted leading-snug">{action.reason}</p>
      )}
      {action.primary && (
        <div className="mt-auto shrink-0 pt-2">
          <HeroCta cta={action.primary} variant="primary" tone={action.tone} actionTitle={action.title} fullWidth />
        </div>
      )}
      {node.expanded && visibleSecondaries.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
  const detailWarn = node.verify.detail.toLowerCase().includes('expiring')

  return (
    <NodeShell
      scope={node.scope}
      kind="verify"
      accentHex={accent}
      severity="ok"
      expanded={node.expanded}
      onToggle={node.onToggle}
    >
      <p className="text-xs font-semibold text-fg leading-snug line-clamp-1" title={node.verify.label}>
        {node.verify.label}
      </p>
      <p className={`mt-0.5 text-2xs font-mono tabular-nums leading-snug line-clamp-1 ${detailWarn ? SEVERITY_TEXT.warn : 'text-fg-muted'}`}>
        {node.verify.detail}
      </p>
      {node.verify.to && (
        <div className="mt-auto shrink-0 pt-1.5">
          <Link
            data-hero-verify
            to={node.verify.to}
            onClick={(e) => e.stopPropagation()}
            className="hero-proof-link nodrag inline-flex w-full items-center justify-center gap-1 rounded-sm border border-ok/40 bg-surface-overlay px-2.5 py-1 text-2xs font-semibold text-ok hover:bg-ok-muted motion-safe:transition-[transform,opacity]"
          >
            View proof <IconArrowRight size={11} aria-hidden className="motion-safe:transition-transform group-hover/hero:translate-x-0.5" />
          </Link>
        </div>
      )}
    </NodeShell>
  )
}

export const HeroVerifyNode = memo(VerifyInner)

// ─── CTA ─────────────────────────────────────────────────────────────

function HeroCta({
  cta,
  variant,
  tone = 'do',
  actionTitle,
  fullWidth = false,
}: {
  cta: NonNullable<PageAction['primary']>
  variant: 'primary' | 'ghost'
  tone?: PageAction['tone']
  actionTitle?: string
  fullWidth?: boolean
}) {
  const testHook =
    variant === 'primary' ? { 'data-hero-primary': true } : { 'data-hero-secondary': true }
  const stop = (e: MouseEvent) => e.stopPropagation()
  const widthClass = fullWidth ? 'hero-cta-primary--full justify-center' : ''

  if (cta.kind === 'link') {
    if (variant === 'primary') {
      return (
        <Link
          {...testHook}
          to={cta.to}
          onClick={stop}
          className={`hero-cta-primary nodrag items-center gap-1.5 rounded-sm px-3 py-1.5 text-2xs font-bold motion-safe:transition-[transform,opacity] hover:gap-2 ${widthClass} ${ctaPrimaryClass(tone, actionTitle ?? cta.label)}`}
        >
          <span className="truncate">{cta.label}</span>
          <IconArrowRight size={12} aria-hidden className="shrink-0 motion-safe:transition-transform group-hover:translate-x-0.5" />
        </Link>
      )
    }
    return (
      <Link
        {...testHook}
        to={cta.to}
        onClick={stop}
        className="nodrag inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-opacity"
      >
        {cta.label}
      </Link>
    )
  }
  return (
    <span className={`nodrag ${fullWidth ? 'block w-full' : ''}`} onClick={stop}>
      <Btn size="sm" variant={variant} onClick={cta.onClick} disabled={cta.disabled} {...testHook} className={fullWidth ? 'w-full' : undefined}>
        {cta.label}
      </Btn>
    </span>
  )
}
