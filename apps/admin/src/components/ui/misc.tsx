import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pctToneClass } from '../../lib/tokens';
import { Btn } from './forms';
import { Card } from './layout';
import { RelativeTime } from './metrics';
import { shouldTooltipNowrap, tooltipLayoutClasses } from './tooltip-layout';


/* ── FilterChip ─────────────────────────────────────────────────────────── */

export type FilterChipTone = 'default' | 'brand' | 'ok' | 'warn' | 'danger' | 'info'

interface FilterChipProps {
  label: string
  /** Live count shown next to the label — skipped when undefined so the
   *  chip can be used as a plain toggle (e.g. "Only mine"). */
  count?: number | null
  active: boolean
  onClick: () => void
  tone?: FilterChipTone
  /** Optional hover tooltip. */
  hint?: string
  /** Icon rendered left of the label. */
  icon?: ReactNode
}

const CHIP_ACTIVE: Record<FilterChipTone, string> = {
  default: 'bg-surface-overlay text-fg border-fg-faint/40',
  brand:   'bg-brand/15 text-brand border-brand/40',
  ok:      'bg-ok-muted text-ok border-ok/40',
  warn:    'bg-warn-muted text-warn border-warn/40',
  danger:  'bg-danger-muted/50 text-danger-foreground border-danger/40',
  info:    'bg-info-muted text-info border-info/40',
}

const CHIP_IDLE: Record<FilterChipTone, string> = {
  default: 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/60 border-edge/60',
  brand:   'text-fg-secondary hover:text-brand hover:bg-brand/10 border-edge/60',
  ok:      'text-fg-secondary hover:text-ok hover:bg-ok-muted/60 border-edge/60',
  warn:    'text-fg-secondary hover:text-warn hover:bg-warn-muted/60 border-edge/60',
  danger:  'text-fg-secondary hover:text-danger hover:bg-danger/10 border-edge/60',
  info:    'text-fg-secondary hover:text-info hover:bg-info-muted/60 border-edge/60',
}

/**
 * Pill-shaped toggle button for a single-value filter. Stackable with
 * siblings to form a horizontal chip rail (e.g. the Reports quick filter
 * row showing "All · New 12 · Triaged 3 · …").
 *
 * Use `tone` to match the underlying semantic — warn for "needs
 * triage", ok for "resolved", danger for "failed". `active=true` locks
 * the chip into the tone colour so the user always sees which filter
 * is on, even at a glance.
 */
export function FilterChip({ label, count, active, onClick, tone = 'default', hint, icon }: FilterChipProps) {
  const classes = active ? CHIP_ACTIVE[tone] : CHIP_IDLE[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${classes}`}
    >
      {icon && <span aria-hidden className="inline-flex items-center">{icon}</span>}
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          className={`inline-flex min-w-[1rem] justify-center rounded-full px-1 font-mono text-3xs font-semibold leading-tight ${
            active ? 'bg-fg/10' : 'bg-surface-raised/70'
          }`}
          aria-label={`${count} results`}
        >
          {count > 999 ? '999+' : count}
        </span>
      )}
    </button>
  )
}

/* ── Breadcrumbs ────────────────────────────────────────────────────────── */

export interface BreadcrumbItem {
  /** Display label. Kept short — a breadcrumb is a trail, not a sentence. */
  label: string
  /** Destination route. Omit for the current page (rendered plain text). */
  to?: string
  /** Optional tooltip shown on hover, e.g. the full report title when the
   *  label is a truncated id. */
  hint?: string
}

/**
 * Thin, single-line breadcrumb trail intended for detail pages. Sits above
 * the page title so users always know which list they came from and can
 * walk back one click at a time — important on deep links from Slack /
 * email where the browser back-button takes you out of the SPA.
 *
 * Design notes:
 *   - Uses `›` (U+203A) separator instead of `/` — reads faster and avoids
 *     visual collision with URL paths shown nearby (e.g. branch names).
 *   - Leaf item (current page) is rendered as plain text with aria-current
 *     so screen readers don't mis-read it as an active link.
 *   - Truncates each item independently with min-w-0 so a long title in
 *     one slot doesn't push the rest off-screen.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items.length) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-2xs text-fg-muted">
      <ol className="flex items-center gap-1 min-w-0 flex-wrap">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  title={item.hint}
                  className="truncate max-w-[16rem] hover:text-fg-secondary motion-safe:transition-colors focus-visible:outline-none focus-visible:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={`truncate max-w-[24rem] ${isLast ? 'text-fg-secondary' : ''}`}
                  title={item.hint}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden className="text-fg-faint">›</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ── Skeleton placeholder ──────────────────────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`motion-safe:animate-pulse rounded-sm bg-surface-overlay/50 ${className}`} />
  )
}

/* ── ResultChip — persistent inline feedback for Test/Run/Trigger ───────────
 *
 * After clicking a "Test" or "Run" or "Trigger" button, the user needs a
 * sticky receipt: did it work, when did it run, what was the response.
 * Toasts disappear; this stays put next to the button until the next run.
 *
 * Tones map directly to status semantics so the chip can be passed a single
 * tone prop and never needs to think about colour. microinteraction.
 */

export type ResultChipTone = 'idle' | 'running' | 'success' | 'error' | 'info'

interface ResultChipProps {
  tone: ResultChipTone
  children: ReactNode
  /** Optional ISO timestamp, rendered as relative time after the message. */
  at?: string | null
  className?: string
}

const RESULT_CHIP_CLS: Record<ResultChipTone, string> = {
  idle: 'border-edge-subtle bg-surface-overlay/60 text-fg-muted',
  running: 'border-info/35 bg-info/15 text-info font-medium',
  success: 'border-ok/35 bg-ok/15 text-ok font-medium',
  error: 'border-danger/35 bg-danger-muted/50 text-danger-foreground font-medium',
  info: 'border-brand/35 bg-brand-subtle text-brand font-medium',
}

const RESULT_CHIP_GLYPH: Record<ResultChipTone, string> = {
  idle: '·',
  running: '…',
  success: '✓',
  error: '✕',
  info: 'i',
}

export function ResultChip({ tone, children, at, className = '' }: ResultChipProps) {
  const isRunning = tone === 'running'
  return (
    <span
      role="status"
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs leading-tight motion-safe:animate-mushi-fade-in ${RESULT_CHIP_CLS[tone]} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-3xs font-bold ${
          isRunning ? 'motion-safe:animate-spin' : ''
        }`}
      >
        {isRunning ? '↻' : RESULT_CHIP_GLYPH[tone]}
      </span>
      <span className="min-w-0 truncate">{children}</span>
      {at && (
        <span className="text-fg-faint ml-0.5">
          · <RelativeTime value={at} />
        </span>
      )}
    </span>
  )
}

/* ── Pct — color-graded percentage number ───────────────────────────────
 *
 * Replaces the `{value.toFixed(1)}%` sprawl across Health / Judge / Billing
 * with a single primitive that picks a semantic text colour from the value
 * itself. Two flavours:
 *
 *   <Pct value={errorPct} direction="lower-better" />  // 0.9 % → green
 *   <Pct value={successPct} direction="higher-better" /> // 99 % → green
 *
 * By convention `value` is already in 0–100 space so the component doesn't
 * have to guess at fractions vs percentages. Pass `fraction` when your input
 * is a 0–1 ratio so we save callers the `* 100` dance.
 *
 * Accepts an optional `hint` that becomes a native tooltip — critical for
 * progressive disclosure where the number itself is terse but the full
 * semantic ("Rolling 7 d error rate across all LLM calls") lives in the
 * hover card.
 */

interface PctProps {
  value: number | null | undefined
  /** `higher-better` (default) for success/quality. `lower-better` for error rate. */
  direction?: 'higher-better' | 'lower-better'
  /** Digits after the decimal point. Default 1 for sub-percent precision. */
  precision?: number
  /** Pre-scale the input from 0–1 to 0–100 (e.g. Judge avg_score). */
  fraction?: boolean
  /** Native tooltip — tooltip content visible on hover/focus. */
  hint?: string
  className?: string
}

export function Pct({
  value,
  direction = 'higher-better',
  precision = 1,
  fraction = false,
  hint,
  className = '',
}: PctProps) {
  const pct = value == null || Number.isNaN(value) ? null : fraction ? value * 100 : value
  const toneClass = pctToneClass(pct, direction)
  const display = pct == null ? '—' : `${pct.toFixed(precision)}%`
  return (
    <span
      className={`font-mono tabular-nums ${toneClass} ${className}`}
      title={hint}
      aria-label={hint ? `${display}, ${hint}` : undefined}
    >
      {display}
    </span>
  )
}

/* ── Abbr ─────────────────────────────────────────────────────────────── */

interface AbbrProps {
  /** Short form shown inline (e.g. "Crit", "BYOK", "p95"). */
  children: ReactNode
  /** Full form shown on hover/focus. Keep concise — this is a title, not a
   *  doc page. Rendered by the browser so it also works on iOS long-press. */
  title: string
  className?: string
}

/**
 * Progressive-disclosure helper: render a short abbreviation and let the
 * browser's native `title` attribute reveal the full form on hover/long-
 * press. Uses the semantic `<abbr>` element so screen readers announce
 * the expansion, and adds a subtle dotted underline as the only reliable
 * "hint that hover does something" across browsers. Keep titles under
 * ~80 chars — longer strings get truncated on mobile.
 */
export function Abbr({ children, title, className = '' }: AbbrProps) {
  return (
    <abbr
      title={title}
      className={`underline decoration-dotted decoration-fg-faint/50 underline-offset-2 cursor-help ${className}`}
    >
      {children}
    </abbr>
  )
}

/* ── Tooltip ───────────────────────────────────────────────────────────── */

type TooltipSide = 'top' | 'bottom' | 'left' | 'right' | 'auto'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: TooltipSide
  /** When omitted, plain strings wrap once they exceed ~48 chars or read like sentences. */
  nowrap?: boolean
  /** Render in document.body so tips escape overflow:hidden ancestors (e.g. React Flow). */
  portal?: boolean
  /** Extra classes applied to the anchor wrapper span — use `w-full` or `flex` to prevent
   *  the default `inline-flex` from collapsing children that rely on `w-full` to fill
   *  their parent's width (e.g. RecencyHeatLabel inside a flex-col container). */
  className?: string
}

const TOOLTIP_SURFACE =
  'px-3 py-2.5 text-2xs text-fg bg-surface-raised border border-edge rounded-md shadow-lg pointer-events-none tooltip-enter'

const TOOLTIP_VIEWPORT_PAD = 12
const TOOLTIP_GAP = 8

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}

function resolveTooltipSide(
  preferred: TooltipSide,
  anchor: DOMRect,
  tipW: number,
  tipH: number,
): 'top' | 'bottom' | 'left' | 'right' {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const space = {
    top: anchor.top - TOOLTIP_VIEWPORT_PAD,
    bottom: vh - anchor.bottom - TOOLTIP_VIEWPORT_PAD,
    left: anchor.left - TOOLTIP_VIEWPORT_PAD,
    right: vw - anchor.right - TOOLTIP_VIEWPORT_PAD,
  }

  const fits = (side: 'top' | 'bottom' | 'left' | 'right') => {
    if (side === 'top') return space.top >= tipH + TOOLTIP_GAP
    if (side === 'bottom') return space.bottom >= tipH + TOOLTIP_GAP
    if (side === 'left') return space.left >= tipW + TOOLTIP_GAP
    return space.right >= tipW + TOOLTIP_GAP
  }

  if (preferred === 'auto') {
    /** Sidebar chrome (~240px) — prefer opening tips into the main canvas. */
    const inLeftChrome = anchor.right <= 280
    const ranked: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; score: number }> = [
      { side: 'top', score: space.top },
      { side: 'bottom', score: space.bottom },
      { side: 'right', score: space.right + (inLeftChrome ? 10_000 : 0) },
      { side: 'left', score: space.left },
    ]
    const viable = ranked.filter((c) => fits(c.side)).sort((a, b) => b.score - a.score)
    if (viable[0]) return viable[0].side
    return ranked.sort((a, b) => b.score - a.score)[0]?.side ?? 'top'
  }

  if (preferred === 'top' && !fits('top') && fits('bottom')) return 'bottom'
  if (preferred === 'bottom' && !fits('bottom') && fits('top')) return 'top'
  if (preferred === 'left' && !fits('left') && fits('right')) return 'right'
  if (preferred === 'right' && !fits('right') && fits('left')) return 'left'

  if (preferred === 'top' || preferred === 'bottom') return preferred
  return preferred
}

function computeTooltipPortalPosition(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TooltipSide,
): { left: number; top: number; resolvedSide: 'top' | 'bottom' | 'left' | 'right' } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const resolvedSide = resolveTooltipSide(preferred, anchor, tipW, tipH)

  let left = 0
  let top = 0

  switch (resolvedSide) {
    case 'top':
      top = anchor.top - TOOLTIP_GAP - tipH
      left = anchor.left + anchor.width / 2 - tipW / 2
      break
    case 'bottom':
      top = anchor.bottom + TOOLTIP_GAP
      left = anchor.left + anchor.width / 2 - tipW / 2
      break
    case 'left':
      left = anchor.left - TOOLTIP_GAP - tipW
      top = anchor.top + anchor.height / 2 - tipH / 2
      break
    case 'right':
      left = anchor.right + TOOLTIP_GAP
      top = anchor.top + anchor.height / 2 - tipH / 2
      break
  }

  if (resolvedSide === 'top' || resolvedSide === 'bottom') {
    left = clamp(left, TOOLTIP_VIEWPORT_PAD, vw - tipW - TOOLTIP_VIEWPORT_PAD)
    top = clamp(top, TOOLTIP_VIEWPORT_PAD, vh - tipH - TOOLTIP_VIEWPORT_PAD)
  } else {
    top = clamp(top, TOOLTIP_VIEWPORT_PAD, vh - tipH - TOOLTIP_VIEWPORT_PAD)
    left = clamp(left, TOOLTIP_VIEWPORT_PAD, vw - tipW - TOOLTIP_VIEWPORT_PAD)
  }

  return { left, top, resolvedSide }
}

export function Tooltip({
  content,
  children,
  side = 'auto',
  nowrap,
  portal = true,
  className,
}: TooltipProps) {
  const resolvedNowrap = shouldTooltipNowrap(content, nowrap)
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({})

  const updatePortalPosition = useCallback(() => {
    const el = anchorRef.current
    const tip = tooltipRef.current
    if (!el) return
    const anchor = el.getBoundingClientRect()
    const tipW = tip?.offsetWidth ?? 0
    const tipH = tip?.offsetHeight ?? 0
    const { left, top } = computeTooltipPortalPosition(
      anchor,
      tipW || 200,
      tipH || 40,
      side,
    )
    setPortalStyle({
      position: 'fixed',
      left,
      top,
      zIndex: 10_000,
    })
  }, [side])

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setVisible(true)
    }, 400)
  }
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setVisible(false)
  }

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  useLayoutEffect(() => {
    if (!visible || !portal) return
    updatePortalPosition()
    const raf1 = requestAnimationFrame(() => {
      updatePortalPosition()
      requestAnimationFrame(updatePortalPosition)
    })
    const reposition = () => updatePortalPosition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    const tip = tooltipRef.current
    let ro: ResizeObserver | undefined
    if (tip && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(reposition)
      ro.observe(tip)
    }
    return () => {
      cancelAnimationFrame(raf1)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      ro?.disconnect()
    }
  }, [visible, portal, content, updatePortalPosition])

  const resolvedSide =
    side === 'auto' ? 'top' : side

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  const layoutClass = tooltipLayoutClasses(resolvedNowrap)
  const tooltipNode = visible ? (
    <span
      ref={portal ? tooltipRef : undefined}
      role="tooltip"
      style={portal ? portalStyle : undefined}
      className={
        portal
          ? `${TOOLTIP_SURFACE} ${layoutClass}`
          : `absolute ${positions[resolvedSide]} z-[100] ${TOOLTIP_SURFACE} ${layoutClass}`
      }
    >
      {content}
    </span>
  ) : null

  return (
    <span
      ref={anchorRef}
      className={`relative inline-flex${className ? ` ${className}` : ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {portal && tooltipNode && typeof document !== 'undefined'
        ? createPortal(tooltipNode, document.body)
        : tooltipNode}
    </span>
  )
}

/* ── Data cells (tables: models, tokens, money) ───────────────────────── */

/** Monospace pill for model ids, operation names, paths — keeps technical text grounded. */
export function CodeChip({
  children,
  className = '',
  title,
  maxWidthClass = 'max-w-[10rem]',
}: {
  children: ReactNode
  className?: string
  title?: string
  maxWidthClass?: string
}) {
  return (
    <code
      title={title}
      className={`inline-block truncate rounded-sm border border-edge-subtle bg-surface-overlay/70 px-1.5 py-0.5 font-mono text-2xs leading-snug text-fg-secondary ${maxWidthClass} ${className}`}
    >
      {children}
    </code>
  )
}

export function TokenIn({
  value,
  className = '',
}: {
  value: number | null | undefined
  className?: string
}) {
  const n = value ?? 0
  return (
    <span
      className={`inline-flex min-w-[3rem] justify-end tabular-nums text-2xs font-medium text-ok ${className}`}
      title="Input tokens"
    >
      {n.toLocaleString()}
    </span>
  )
}

export function TokenOut({
  value,
  className = '',
}: {
  value: number | null | undefined
  className?: string
}) {
  const n = value ?? 0
  return (
    <span
      className={`inline-flex min-w-[3rem] justify-end tabular-nums text-2xs font-medium text-danger ${className}`}
      title="Output tokens"
    >
      {n.toLocaleString()}
    </span>
  )
}

export function UsdAmount({
  value,
  digits = 4,
  className = '',
}: {
  value: number
  digits?: number
  className?: string
}) {
  return (
    <span className={`tabular-nums text-2xs font-semibold text-fg ${className}`}>
      ${Number(value).toFixed(digits)}
    </span>
  )
}

export function DataTableHead({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      className={`px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-muted ${alignClass} ${className}`}
    >
      {children}
    </th>
  )
}

export function DataTableCell({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <td className={`px-3 py-1.5 align-middle ${alignClass} ${className}`}>
      {children}
    </td>
  )
}

/* ── Kbd (keyboard shortcut badge) ─────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-2xs font-mono font-medium text-fg-secondary bg-surface-overlay border border-edge rounded-sm">
      {children}
    </kbd>
  )
}

/* ── ErrorAlert ────────────────────────────────────────────────────────── */

interface ErrorAlertProps {
  /**
   * Short label that names *what* failed (e.g. "Couldn't create project").
   * Renders bold above the longer `message`. Optional so the legacy
   * single-message call sites keep working unchanged.
   */
  title?: string
  message?: string
  /**
   * Stable error code from the API (e.g. `NO_ORGANIZATION`). Surfaced as a
   * monospace caption so users can quote it in bug reports — beta users
   * who hit a rough edge are far more likely to ping the maintainer with
   * something we can grep for if the code is visible inline rather than
   * buried in DevTools network panel.
   */
  code?: string
  onRetry?: () => void
  /**
   * Inline recovery affordances rendered next to "Retry". Each entry
   * becomes a small ghost button that runs `onClick`. Use this for
   * context-aware paths out of the error (e.g. `NO_ORGANIZATION` →
   * "Create a team", `FORBIDDEN` → "Switch team"). Callers wire the
   * navigation themselves via `useNavigate` so this component stays
   * router-agnostic.
   */
  actions?: Array<{
    label: string
    onClick: () => void
  }>
  children?: React.ReactNode
}

export function ErrorAlert({
  title,
  message = 'Something went wrong. Please try again.',
  code,
  onRetry,
  actions,
  children,
}: ErrorAlertProps) {
  return (
    <div role="alert" aria-live="polite">
    <Card
      className="p-4 border-danger/30 bg-danger-muted/10"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger-muted/50 text-danger-foreground text-xs font-bold"
        >
          !
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {title && <h4 className="text-sm font-semibold text-danger">{title}</h4>}
          <p className="text-sm text-danger leading-relaxed">{message}</p>
          {code && (
            <p className="font-mono text-3xs uppercase tracking-wider text-danger/70">
              code: {code}
            </p>
          )}
          {children}
          {(onRetry || (actions && actions.length > 0)) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {onRetry && (
                <Btn variant="ghost" size="sm" onClick={onRetry}>Retry</Btn>
              )}
              {actions?.map((a, i) => (
                <Btn
                  key={`${a.label}-${i}`}
                  variant="ghost"
                  size="sm"
                  onClick={a.onClick}
                >
                  {a.label}
                </Btn>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
    </div>
  )
}

/* ── Divider ───────────────────────────────────────────────────────────── */

export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-edge-subtle ${className}`} />
}

