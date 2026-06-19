import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { META_CHIP_TONE } from '../../lib/tokens';
import { IconAlertTriangle, IconBell, IconCheck, IconEye, IconTerminal, IconArrowRight } from '../icons';
import { statDestinationLabel } from '../../lib/statCardLinks';
import { InfoHint, MetricHelpTrigger } from './fields';
import { Card } from './layout';
import { Tooltip } from './misc';
import { Modal } from '../Modal';


/* ── RelativeTime (humanised time + ISO tooltip) ────────────────────────── */

const RTF = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null

export function formatRelative(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  const diffSec = (date.getTime() - Date.now()) / 1000
  const abs = Math.abs(diffSec)
  if (!RTF) return date.toLocaleString()
  if (abs < 60) return RTF.format(Math.round(diffSec), 'second')
  if (abs < 3600) return RTF.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return RTF.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 604800) return RTF.format(Math.round(diffSec / 86400), 'day')
  if (abs < 2_592_000) return RTF.format(Math.round(diffSec / 604800), 'week')
  if (abs < 31_536_000) return RTF.format(Math.round(diffSec / 2_592_000), 'month')
  return RTF.format(Math.round(diffSec / 31_536_000), 'year')
}

export function RelativeTime({ value, className = '' }: { value: string | Date; className?: string }) {
  const date = typeof value === 'string' ? new Date(value) : value
  return (
    <Tooltip content={date.toLocaleString()}>
      <span className={`cursor-help ${className}`}>{formatRelative(date)}</span>
    </Tooltip>
  )
}

/** Compact staleness chip — same relative formatter as RelativeTime, tuned for dense rows/cards. */
export function AgeChip({
  at,
  className = '',
  title,
}: {
  at: string | Date | null | undefined
  className?: string
  title?: string
}) {
  if (at == null) return null
  const date = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(date.getTime())) return null
  return (
    <Tooltip content={title ?? date.toLocaleString()}>
      <span className={`text-2xs text-fg-faint tabular-nums ${className}`}>{formatRelative(date)}</span>
    </Tooltip>
  )
}

/** Thin horizontal bar for confidence, spend share, coverage %, etc. */
export function MiniInlineBar({
  value,
  max = 100,
  className = '',
  barClassName = 'bg-brand',
  trackClassName = 'bg-surface-overlay',
  widthClass = 'w-12',
  'aria-label': ariaLabel,
}: {
  value: number
  max?: number
  className?: string
  barClassName?: string
  trackClassName?: string
  widthClass?: string
  'aria-label'?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={`h-1 ${widthClass} rounded-full overflow-hidden ${trackClassName} ${className}`.trim()}
      role={ariaLabel ? 'meter' : undefined}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Elapsed wall time between two ISO timestamps (e.g. fix dispatch → complete). */
export function formatDurationBetween(start: string | Date, end: string | Date): string {
  const a = typeof start === 'string' ? new Date(start) : start
  const b = typeof end === 'string' ? new Date(end) : end
  const ms = Math.max(0, b.getTime() - a.getTime())
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h`
  const days = Math.round(hr / 24)
  return `${days}d`
}

export type PipelineStageState = 'pending' | 'active' | 'done' | 'failed'

export interface PipelineStripProps {
  stages: Array<{ label: string; state: PipelineStageState }>
  /** Tighter layout for fix cards and table rows. */
  compact?: boolean
  className?: string
}

const PIPELINE_DOT: Record<PipelineStageState, string> = {
  pending: 'bg-surface-overlay border border-edge-subtle',
  active: 'bg-info border-info ring-2 ring-info/30 motion-safe:animate-pulse',
  done: 'bg-ok border-ok',
  failed: 'bg-danger border-danger',
}

/**
 * Lightweight 5-stage pipeline strip (Report → Dispatch → PR → Judge → Ship).
 * Prefer this over per-card React Flow when rendering long fix lists.
 */
export function PipelineStrip({ stages, compact = false, className = '' }: PipelineStripProps) {
  if (stages.length === 0) return null
  const dot = compact ? 'h-2 w-2' : 'h-2.5 w-2.5'
  const gap = compact ? 'gap-0.5' : 'gap-1'
  return (
    <div
      role="list"
      aria-label="Fix pipeline stages"
      className={`flex items-center ${gap} ${className}`.trim()}
    >
      {stages.map((stage, i) => (
        <div key={`${stage.label}-${i}`} role="listitem" className="flex items-center gap-0.5 min-w-0">
          {i > 0 && (
            <span
              aria-hidden
              className={`shrink-0 ${compact ? 'w-2' : 'w-3'} h-px ${
                stage.state === 'failed' || stages[i - 1]?.state === 'failed'
                  ? 'bg-danger/40'
                  : stages[i - 1]?.state === 'done'
                    ? 'bg-ok/50'
                    : 'bg-edge-subtle'
              }`}
            />
          )}
          <Tooltip content={`${stage.label}: ${stage.state}`}>
            <span className="inline-flex flex-col items-center gap-0.5 min-w-0">
              <span className={`rounded-full border shrink-0 ${dot} ${PIPELINE_DOT[stage.state]}`} />
              {!compact && (
                <span className="text-3xs text-fg-faint truncate max-w-[3.5rem]">{stage.label}</span>
              )}
            </span>
          </Tooltip>
        </div>
      ))}
    </div>
  )
}

/* ── RecommendedAction (status-aware suggestion card) ──────────────────── */

interface RecommendedActionCta {
  label: string
  onClick?: () => void
  href?: string
  to?: string
  disabled?: boolean
}

/** Compact key/value chip rendered under the recommendation title. Used by
 *  the "A fix is in progress" path to surface when/elapsed/model/files
 *  without forcing the user to scroll to FixProgressStream below. */
export interface RecommendedActionMeta {
  label: string
  value: string
  tone?: 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
}

/** Inline recovery action — used by skipped/failed fix paths to deep-link
 *  the user to /integrations or /settings with a single click. Distinct
 *  from the primary `cta` so we can render multiple (Enable + Retry). */
export interface RecommendedActionInlineAction {
  label: string
  to?: string
  href?: string
  onClick?: () => void
  tone?: 'primary' | 'ghost' | 'danger'
}

interface RecommendedActionProps {
  title: string
  description?: string
  cta?: RecommendedActionCta
  tone?: 'urgent' | 'info' | 'success' | 'neutral'
  meta?: RecommendedActionMeta[]
  actions?: RecommendedActionInlineAction[]
}

const RECOMMENDED_TONES = {
  urgent:  'border-danger/30 bg-surface-raised',
  info:    'border-info/30 bg-surface-raised',
  success: 'border-ok/30 bg-surface-raised',
  neutral: 'border-edge bg-surface-raised',
} as const

const RECOMMENDED_ACCENTS = {
  urgent: 'text-danger-foreground',
  info: 'text-info-foreground',
  success: 'text-ok-foreground',
  neutral: 'text-fg-muted',
} as const

const CTA_BTN_CLASS =
  'shrink-0 inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

function RecommendedActionCtaEl({ cta }: { cta: RecommendedActionCta }) {
  if (cta.to) {
    return (
      <Link to={cta.to} className={CTA_BTN_CLASS} aria-disabled={cta.disabled}>
        {cta.label}
      </Link>
    )
  }
  if (cta.href) {
    return (
      <a
        href={cta.href}
        target={cta.href.startsWith('http') ? '_blank' : undefined}
        rel={cta.href.startsWith('http') ? 'noopener noreferrer' : undefined}
        className={CTA_BTN_CLASS}
      >
        {cta.label}
      </a>
    )
  }
  return (
    <button type="button" onClick={cta.onClick} disabled={cta.disabled} className={CTA_BTN_CLASS}>
      {cta.label}
    </button>
  )
}

const META_CHIP_TONES: Record<NonNullable<RecommendedActionMeta['tone']>, string> = META_CHIP_TONE

const INLINE_ACTION_TONES: Record<NonNullable<RecommendedActionInlineAction['tone']>, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-hover',
  ghost: 'bg-surface-overlay text-fg-secondary hover:text-fg hover:bg-surface-raised border border-edge',
  danger: 'bg-danger-muted/50 text-danger-foreground hover:bg-danger-muted/70 border border-danger/30',
}

function InlineActionEl({ action }: { action: RecommendedActionInlineAction }) {
  const cls = `inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-sm motion-safe:transition-colors ${INLINE_ACTION_TONES[action.tone ?? 'ghost']}`
  if (action.to) {
    return <Link to={action.to} className={cls}>{action.label}</Link>
  }
  if (action.href) {
    return (
      <a
        href={action.href}
        target={action.href.startsWith('http') ? '_blank' : undefined}
        rel={action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
        className={cls}
      >
        {action.label}
      </a>
    )
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  )
}

export function RecommendedAction({
  title,
  description,
  cta,
  tone = 'info',
  meta,
  actions,
}: RecommendedActionProps) {
  return (
    <div className={`flex items-start gap-3 rounded-md border p-3 mb-3 ${RECOMMENDED_TONES[tone]}`}>
      <div className={`mt-0.5 shrink-0 ${RECOMMENDED_ACCENTS[tone]}`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-fg leading-tight">{title}</p>
        {description && (
          <p className="text-xs text-fg-muted mt-1 max-w-2xl leading-relaxed text-pretty wrap-break-word">
            {description}
          </p>
        )}
        {meta && meta.length > 0 && (
          <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Status details">
            {meta.map((m, i) => (
              <li
                key={`${m.label}-${i}`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-2xs ${META_CHIP_TONES[m.tone ?? 'neutral']}`}
              >
                <span className="font-medium uppercase tracking-wide text-2xs opacity-70">{m.label}</span>
                <span className="font-mono">{m.value}</span>
              </li>
            ))}
          </ul>
        )}
        {actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {actions.map((a, i) => (
              <InlineActionEl key={`${a.label}-${i}`} action={a} />
            ))}
          </div>
        )}
      </div>
      {cta && <RecommendedActionCtaEl cta={cta} />}
    </div>
  )
}

/* ── ImageZoom (click-to-zoom modal for screenshots) ───────────────────── */

interface ImageZoomProps {
  src: string
  alt: string
  thumbClassName?: string
}

export function ImageZoom({ src, alt, thumbClassName = '' }: ImageZoomProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative block overflow-hidden rounded-sm border border-edge cursor-zoom-in focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${thumbClassName}`}
        aria-label={`Open ${alt} full-size`}
      >
        <img src={src} alt={alt} className="block w-full object-contain" />
        <span className="absolute inset-0 flex items-center justify-center bg-overlay/60 opacity-0 group-hover:opacity-100 motion-safe:transition-opacity text-2xs text-fg font-medium">
          Click to enlarge
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={alt}
        hideCloseButton
        size="full"
        className="max-w-[95vw] border-0 bg-transparent shadow-none"
        bodyClassName="p-0 flex items-center justify-center"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
            <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
          </svg>
        </button>
        <img
          src={src}
          alt={alt}
          className="max-h-[90vh] max-w-[95vw] object-contain rounded-sm shadow-raised"
        />
      </Modal>
    </>
  )
}

/* ── Sparkline ──────────────────────────────────────────────────────────── */

interface SparklineProps {
  /** Ordered time series, oldest → newest. A single point renders a flat
   *  line — the consumer is expected to pass a sensible sampling window
   *  (e.g. 14 daily buckets for a 14-day StatCard). */
  values: number[]
  /** CSS color. Defaults to currentColor so the chart inherits the
   *  StatCard's accent tone (text-ok / text-danger / text-brand). */
  color?: string
  /** Filled area under the curve adds weight without clutter. Defaults
   *  true — it reads as "trend" rather than "noise line". */
  filled?: boolean
  /** Optional accessible label. Falls back to a generic description. */
  ariaLabel?: string
  /** Grid dimensions in px. Height stays small so sparklines fit inside
   *  dense admin cards without pushing content. */
  width?: number
  height?: number
}

/**
 * Minimal SVG sparkline. Deliberately dependency-free — Recharts is
 * overkill for a 14-point line and its `<ResponsiveContainer>` imposes
 * a noticeable mount cost per card when you've got six StatCards on
 * one page.
 *
 * The curve is normalised to the full value range so tiny deltas (e.g.
 * "error rate went from 2 to 4") still show as a visible swing.
 */
export function Sparkline({
  values,
  color,
  filled = true,
  ariaLabel,
  width = 80,
  height = 20,
}: SparklineProps) {
  if (!values || values.length === 0) {
    return <span aria-hidden className="inline-block" style={{ width, height }} />
  }

  const n = values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = n > 1 ? width / (n - 1) : 0

  const points = values.map((v, i) => {
    const x = n > 1 ? i * stepX : width / 2
    // Invert Y because SVG y grows downward but the human-eye reading
    // is "higher value = higher on the chart".
    const y = height - ((v - min) / range) * (height - 2) - 1
    return [x, y] as const
  })

  const path = points
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(' ')

  const areaPath = filled
    ? `${path} L ${points[points.length - 1][0].toFixed(2)} ${height} L ${points[0][0].toFixed(2)} ${height} Z`
    : null

  const stroke = color ?? 'currentColor'
  const trend = values[n - 1] - values[0]
  const label =
    ariaLabel ??
    `Trend over last ${n} points: ${trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'}`

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="shrink-0"
      preserveAspectRatio="none"
    >
      {areaPath && (
        <path d={areaPath} fill={stroke} opacity={0.12} />
      )}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      {/* End-dot anchors the eye to the current value. */}
      <circle
        cx={points[n - 1][0]}
        cy={points[n - 1][1]}
        r={1.5}
        fill={stroke}
      />
    </svg>
  )
}

/* ── MetricTooltip (structured StatCard help) ──────────────────────────── */

export type MetricTooltipCalloutTone = 'info' | 'warn' | 'ok'

export type MetricTooltipSectionKind = 'shows' | 'counted' | 'takeaway'

export interface MetricTooltipSection {
  label: string
  body: string
  /** Visual grouping — defaults from label when omitted. */
  kind?: MetricTooltipSectionKind
}

export interface MetricTooltipData {
  sections: MetricTooltipSection[]
  callout?: { tone?: MetricTooltipCalloutTone; text: string }
}

const METRIC_CALLOUT_CLASS: Record<MetricTooltipCalloutTone, string> = {
  info: 'border-info/30 bg-surface-raised text-fg',
  warn: 'border-warn/30 bg-surface-raised text-fg',
  ok: 'border-ok/30 bg-surface-raised text-fg',
}

type MetricIcon = (props: { size?: number; className?: string }) => ReactNode

const METRIC_SECTION_META: Record<
  MetricTooltipSectionKind,
  { Icon: MetricIcon; chipClass: string }
> = {
  shows: {
    Icon: IconEye,
    chipClass: 'border-info/35 bg-info-muted text-info-foreground',
  },
  counted: {
    Icon: IconTerminal,
    chipClass: 'border-brand/35 bg-brand-subtle text-brand',
  },
  takeaway: {
    Icon: IconCheck,
    chipClass: 'border-ok/35 bg-ok-muted text-ok-foreground',
  },
}

const METRIC_CALLOUT_ICON: Record<MetricTooltipCalloutTone, MetricIcon> = {
  info: IconBell,
  warn: IconAlertTriangle,
  ok: IconCheck,
}

function resolveMetricSectionKind(section: MetricTooltipSection): MetricTooltipSectionKind {
  if (section.kind) return section.kind
  const label = section.label.toLowerCase()
  if (label.includes('count')) return 'counted'
  if (label.includes('take')) return 'takeaway'
  return 'shows'
}

function MetricSectionHeader({ section }: { section: MetricTooltipSection }) {
  const kind = resolveMetricSectionKind(section)
  const { Icon, chipClass } = METRIC_SECTION_META[kind]
  return (
    <div
      className={`mb-1.5 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-3xs font-semibold uppercase tracking-wider ${chipClass}`}
    >
      <Icon size={11} className="shrink-0 opacity-90" />
      <span>{section.label}</span>
    </div>
  )
}

export function MetricTooltipContent({ data }: { data: MetricTooltipData }) {
  const calloutTone = data.callout?.tone ?? 'info'
  const CalloutIcon = METRIC_CALLOUT_ICON[calloutTone]
  return (
    <div className="space-y-0 text-left font-normal py-0.5">
      {data.sections.map((section, index) => (
        <div
          key={`${section.kind ?? section.label}-${index}`}
          className={index > 0 ? 'mt-2.5 border-t border-edge-subtle pt-2.5' : undefined}
        >
          <MetricSectionHeader section={section} />
          <p className="text-2xs font-normal leading-relaxed text-fg-secondary">{section.body}</p>
        </div>
      ))}
      {data.callout ? (
        <div
          className={`mt-2.5 flex items-start gap-2 rounded-sm border px-2 py-1.5 ${METRIC_CALLOUT_CLASS[calloutTone]}`}
        >
          <CalloutIcon size={12} className={`mt-0.5 shrink-0 ${calloutTone === 'warn' ? 'text-warn' : calloutTone === 'ok' ? 'text-ok' : 'text-info'}`} />
          <p className="text-2xs font-normal leading-relaxed">{data.callout.text}</p>
        </div>
      ) : null}
    </div>
  )
}

/* ── StatCard ───────────────────────────────────────────────────────────── */

interface StatCardProps {
  label: string
  value: number | string
  accent?: string
  delta?: { value: string; positive?: boolean }
  /** Optional trend series — rendered as a right-aligned sparkline that
   *  inherits the card's accent color. Pass a short, evenly-sampled
   *  series (e.g. 14 daily points). Omit to render the legacy card. */
  trend?: number[]
  /** Short context line under the value (counts, ranges, status). */
  detail?: string
  /** Hover tooltip for the metric. Appears on the label pill so a user
   *  can learn "what does p95 mean in this context?" without leaving. */
  hint?: string
  /** Long-form explanation for the (i) icon — structured sections or plain text. */
  tooltip?: string | MetricTooltipData
  /** When set, the whole card links to this route (info icon still opens tooltip). */
  to?: string
  /** Override hover CTA copy (defaults to "Go to {destination}"). */
  linkLabel?: string
}

function StatCardSwapLine({
  primary,
  secondary,
  primaryClassName = '',
  secondaryClassName = 'text-brand',
  variant = 'label',
}: {
  primary: ReactNode
  secondary: ReactNode
  primaryClassName?: string
  secondaryClassName?: string
  /** Detail line swaps slightly later so the label leads. */
  variant?: 'label' | 'detail'
}) {
  const lineClass = variant === 'detail' ? 'stat-card-swap-line stat-card-swap-line--detail' : 'stat-card-swap-line'
  return (
    <span className={`${lineClass} ${primaryClassName}`}>
      <span className="stat-card-swap-primary truncate">{primary}</span>
      <span className={`stat-card-swap-secondary truncate ${secondaryClassName}`}>{secondary}</span>
    </span>
  )
}

function StatCardHelp({ tooltip, hint }: { tooltip?: string | MetricTooltipData; hint?: string }) {
  const stopNav = (e: React.MouseEvent | React.FocusEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  if (tooltip) {
    const content =
      typeof tooltip === 'string' ? (
        <span className="whitespace-pre-wrap font-normal leading-relaxed">{tooltip}</span>
      ) : (
        <MetricTooltipContent data={tooltip} />
      )
    return (
      <span onClick={stopNav} onMouseDown={stopNav}>
        <MetricHelpTrigger content={content} ariaLabel="About this metric" nowrap={false} />
      </span>
    )
  }
  if (hint) return <InfoHint content={hint} />
  return null
}

export function StatCard({ label, value, accent, delta, trend, detail, hint, tooltip, to, linkLabel }: StatCardProps) {
  const help = tooltip ?? hint
  const destination = to ? (linkLabel ?? statDestinationLabel(to)) : null
  const inner = (
    <>
      <div className="text-2xs text-fg-muted mb-1 flex items-center gap-1 min-w-0">
        {to && destination ? (
          <span className="flex-1 min-w-0 font-medium">
            <StatCardSwapLine
              primary={label}
              secondary={`Go to ${destination}`}
              secondaryClassName="text-brand font-semibold"
            />
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
        {help ? <StatCardHelp tooltip={tooltip} hint={hint} /> : null}
        {to ? (
          <IconArrowRight size={12} className="stat-card-arrow ml-auto shrink-0 text-brand" />
        ) : null}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className={`text-xl font-semibold stat-value stat-card-value ${accent ?? 'text-fg'} ${
            typeof value === 'string' && /^[\d.,]+/.test(value.trim())
              ? 'font-mono tabular-nums'
              : 'font-sans tracking-tight'
          }`}
        >
          {value}
        </div>
        {delta && (
          <span className={`text-3xs font-medium font-mono ${delta.positive ? 'text-ok' : 'text-danger'}`}>
            {delta.positive ? '↑' : '↓'} {delta.value}
          </span>
        )}
        {trend && trend.length > 1 && (
          <span className={`ml-auto ${accent ?? 'text-fg-secondary'}`} aria-hidden>
            <Sparkline values={trend} width={64} height={18} />
          </span>
        )}
      </div>
      {detail ? (
        to ? (
          <div className="mt-1 text-3xs leading-snug">
            <StatCardSwapLine
              variant="detail"
              primary={detail}
              secondary="Open page →"
              primaryClassName="text-fg-faint"
              secondaryClassName="text-brand/80 font-medium"
            />
          </div>
        ) : (
          <p className="mt-1 text-3xs text-fg-faint leading-snug">{detail}</p>
        )
      ) : to ? (
        <p className="stat-card-cta-hint mt-1 text-3xs leading-snug">
          <span className="text-brand/70 font-medium">Open page →</span>
        </p>
      ) : null}
    </>
  )

  if (to) {
    return (
      <Card elevated className="stat-card-link px-3 py-2.5">
        <Link
          to={to}
          aria-label={`${label} — go to ${destination}`}
          className="group/stat relative z-[1] block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          {inner}
        </Link>
      </Card>
    )
  }

  return (
    <Card elevated className="px-3 py-2.5">
      {inner}
    </Card>
  )
}
