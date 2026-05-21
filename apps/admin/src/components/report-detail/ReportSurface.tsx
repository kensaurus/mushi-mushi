import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

const META_CHIP_BASE =
  'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-overlay/45 px-2 py-1 text-2xs'

/** Compact metadata chip — grounds floating label/value pairs in the report header. */
export function MetaChip({
  label,
  children,
  href,
  to,
  title,
}: {
  label: string
  children: ReactNode
  href?: string
  to?: string
  title?: string
}) {
  const inner = (
    <>
      <span className="shrink-0 text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</span>
      <span className="min-w-0 truncate text-fg-secondary">{children}</span>
    </>
  )
  const interactive = `${META_CHIP_BASE} hover:border-edge hover:bg-surface-overlay/70 motion-safe:transition-colors`
  if (to) {
    return (
      <Link to={to} className={interactive} title={title}>
        {inner}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={interactive} title={title}>
        {inner}
      </a>
    )
  }
  return (
    <span className={META_CHIP_BASE} title={title}>
      {inner}
    </span>
  )
}

type ContainedTone = 'neutral' | 'info' | 'muted' | 'warn'

const CONTAINED_TONE: Record<ContainedTone, string> = {
  neutral: 'border-edge-subtle/70 bg-surface-overlay/30',
  info: 'border-info/25 bg-info-muted/10',
  muted: 'border-edge-subtle/60 bg-surface-overlay/20',
  warn: 'border-warn/25 bg-warn-muted/10',
}

/** Bordered inner block — keeps prose and proof lines from floating on the page chrome. */
export function ContainedBlock({
  label,
  children,
  tone = 'neutral',
  className = '',
}: {
  label?: string
  children: ReactNode
  tone?: ContainedTone
  className?: string
}) {
  return (
    <div className={`rounded-md border px-2.5 py-2 ${CONTAINED_TONE[tone]} ${className}`}>
      {label && (
        <div className="mb-1 text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</div>
      )}
      {children}
    </div>
  )
}

/** One-line proof copy used inside PDCA cards and progress strips. */
export function InlineProof({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`rounded-sm border border-edge-subtle/55 bg-surface-overlay/35 px-2 py-1 text-2xs leading-snug text-fg-secondary ${className}`}
    >
      {children}
    </p>
  )
}

/** Row of link/action pills — for PR, trace, and routing links. */
export function ActionPillRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {children}
    </div>
  )
}

export function ActionPill({
  href,
  to,
  onClick,
  children,
  tone = 'neutral',
  className = '',
}: {
  href?: string
  to?: string
  onClick?: () => void
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'ok' | 'danger' | 'warn'
  className?: string
}) {
  const toneCls =
    tone === 'brand'
      ? 'border-brand/25 bg-brand/10 text-brand hover:bg-brand/15'
      : tone === 'ok'
        ? 'border-ok/25 bg-ok-muted/30 text-ok hover:bg-ok-muted/45'
        : tone === 'danger'
          ? 'border-danger/25 bg-danger-muted/20 text-danger hover:bg-danger-muted/30'
          : tone === 'warn'
            ? 'border-warn/25 bg-warn-muted/25 text-warn hover:bg-warn-muted/40'
            : 'border-edge-subtle bg-surface-overlay/40 text-fg-secondary hover:bg-surface-overlay/60'
  const cls = `inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-2xs font-medium underline-offset-2 hover:underline motion-safe:transition-colors ${toneCls} ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    )
  }
  if (to) return <Link to={to} className={cls}>{children}</Link>
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    )
  }
  return <span className={cls}>{children}</span>
}

type SignalTone = 'danger' | 'warn' | 'info' | 'accent' | 'brand' | 'neutral' | 'ok'

const SIGNAL_TONE: Record<SignalTone, string> = {
  danger: 'border-danger/30 bg-danger/12 text-danger',
  warn: 'border-warn/30 bg-warn/12 text-warn',
  info: 'border-info/25 bg-info-muted/40 text-info',
  accent: 'border-accent/30 bg-accent/12 text-accent',
  brand: 'border-brand/25 bg-brand/10 text-brand',
  neutral: 'border-edge-subtle bg-surface-overlay/40 text-fg-muted',
  ok: 'border-ok/25 bg-ok-muted/35 text-ok',
}

/** Compact signal pill for queue rows (blast radius, variants, tags). */
export function SignalChip({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: SignalTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-2xs font-medium tabular-nums ${SIGNAL_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/** Mini confidence meter for table cells and preview surfaces. */
export function ConfidenceMeter({
  confidence,
  className = '',
}: {
  confidence: number | null | undefined
  className?: string
}) {
  if (confidence == null) {
    return <span className="text-2xs text-fg-faint">—</span>
  }
  const pct = Math.round(Math.min(100, Math.max(0, confidence * 100)))
  const barTone = pct >= 85 ? 'bg-ok' : pct >= 70 ? 'bg-warn' : 'bg-danger'
  const textTone = pct >= 85 ? 'text-ok' : pct >= 70 ? 'text-warn' : 'text-danger'
  return (
    <div className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
      <span className={`text-2xs font-semibold font-mono tabular-nums ${textTone}`}>{pct}%</span>
      <div
        className="h-1 w-10 overflow-hidden rounded-full bg-surface-overlay/80"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Classification confidence ${pct} percent`}
      >
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
