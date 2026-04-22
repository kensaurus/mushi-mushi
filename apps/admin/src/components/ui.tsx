/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Shared UI primitives for the admin dashboard.
 *          Compact, dark-themed, data-dense design system components.
 */

import React, { useState, useRef, useEffect } from 'react'
import type { ReactNode, ReactEventHandler, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath } from '../lib/pdca'

/* ── Badge ──────────────────────────────────────────────────────────────── */

interface BadgeProps {
  children: ReactNode
  className?: string
  title?: string
}

export function Badge({ children, className = '', title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs leading-tight font-medium ${className}`}
    >
      {children}
    </span>
  )
}

/* ── Card ───────────────────────────────────────────────────────────────── */

interface CardProps {
  children: ReactNode
  className?: string
  interactive?: boolean
  elevated?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  title?: string
}

export function Card({ children, className = '', interactive, elevated, onClick, title }: CardProps) {
  // When the card has an onClick handler we promote it to button semantics so
  // the keyboard story is honest — a div with a click handler isn't reachable.
  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
        },
      }
    : {}
  const interactiveCls =
    interactive || onClick
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:transition-all motion-safe:duration-150 hover:border-edge hover:-translate-y-px hover:shadow-raised'
      : ''
  if (elevated) {
    return (
      <div
        className={`card-elevated ${interactiveCls} ${className}`}
        onClick={onClick}
        title={title}
        {...interactiveProps}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      className={`bg-surface-raised/50 border border-edge-subtle rounded-md shadow-card ${interactiveCls} ${interactive || onClick ? 'hover:bg-surface-overlay' : ''} ${className}`}
      onClick={onClick}
      title={title}
      {...interactiveProps}
    >
      {children}
    </div>
  )
}

/* ── Section (labeled card for detail views) ────────────────────────────── */

interface SectionProps {
  title: string
  children: ReactNode
  className?: string
  action?: ReactNode
  icon?: ReactNode
}

export function Section({ title, children, className = '', action, icon }: SectionProps) {
  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-secondary uppercase tracking-wider">
          {icon && <span className="text-fg-muted shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
          <span>{title}</span>
        </h3>
        {action}
      </div>
      {children}
    </Card>
  )
}

/* ── Field (label + value pair) ─────────────────────────────────────────── */

interface FieldProps {
  label: string
  value: string
  mono?: boolean
  tooltip?: string
  copyable?: boolean
  valueClassName?: string
  /**
   * Force prose rendering (max-w-prose, paragraph splitting, word-safe
   * wrapping). When undefined, Field auto-detects: values longer than
   * ~140 chars or containing a newline render as prose. Short labels like
   * "Visual" or "95%" stay on one line.
   */
  longForm?: boolean
}

// Heuristic: if the value looks like long-form prose, route it to
// LongFormText instead of `break-all` — the latter shreds natural English
// mid-word (e.g. "Starte\nd") which is never what we want for user-written
// descriptions.
function looksLikeProse(value: string) {
  return value.length > 140 || /\n/.test(value)
}

export function Field({ label, value, mono, tooltip, copyable, valueClassName = '', longForm }: FieldProps) {
  const useProse = longForm ?? (!mono && looksLikeProse(value))
  return (
    <div className="mb-2 last:mb-0">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium">
        {label}
        {tooltip && <InfoHint content={tooltip} />}
      </span>
      <div className="flex items-start gap-1.5 mt-0.5">
        {useProse ? (
          <LongFormText value={value} className={valueClassName} />
        ) : (
          // `wrap-break-word` = overflow-wrap: break-word — only breaks words
          // that actually overflow, not normal English mid-syllable. Never use
          // `break-all` for user copy.
          <p className={`text-sm text-fg wrap-break-word ${mono ? 'font-mono' : ''} ${valueClassName}`}>{value}</p>
        )}
        {copyable && <CopyButton value={value} className="shrink-0" />}
      </div>
    </div>
  )
}

/* ── LongFormText (prose rendering for descriptions, rationales, intents) ─ */

/**
 * Optimised for readability of paragraph-length user copy:
 *   - `max-w-prose` caps lines around 65ch — the research-backed optimal
 *     reading length (NN/g, Baymard). Without this, wide cards stretch
 *     lines past 100ch and reading accuracy collapses.
 *   - `leading-relaxed` (1.625) gives sentences breathing room.
 *   - `whitespace-pre-wrap` preserves user-entered line breaks.
 *   - `wrap-break-word` wraps only when a token would overflow, never
 *     mid-syllable like `break-all` does.
 *   - Double newlines become true <p> paragraphs so a long rationale
 *     isn't one unbroken block.
 */
interface LongFormTextProps {
  value: string
  className?: string
}

export function LongFormText({ value, className = '' }: LongFormTextProps) {
  const paragraphs = value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const base = 'text-sm text-fg leading-relaxed max-w-prose whitespace-pre-wrap wrap-break-word'
  if (paragraphs.length <= 1) {
    return <p className={`${base} ${className}`}>{value}</p>
  }
  return (
    <div className={`max-w-prose space-y-2 ${className}`}>
      {paragraphs.map((para, i) => (
        <p key={i} className={base}>{para}</p>
      ))}
    </div>
  )
}

/* ── Callout (emphasized block: summaries, notes) ─────────────────────── */

type CalloutTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'

const CALLOUT_TONE: Record<CalloutTone, string> = {
  neutral: 'border-l-2 border-edge-subtle bg-surface-overlay/35',
  info:    'border-l-2 border-info/55 bg-info-muted/12',
  ok:      'border-l-2 border-ok/50 bg-ok-muted/10',
  warn:    'border-l-2 border-warn/50 bg-warn-muted/12',
  danger:  'border-l-2 border-danger/45 bg-danger-muted/10',
}

interface CalloutProps {
  children: ReactNode
  tone?: CalloutTone
  label?: string
  icon?: ReactNode
  className?: string
}

export function Callout({ children, tone = 'neutral', label, icon, className = '' }: CalloutProps) {
  return (
    <div className={`rounded-md border border-edge-subtle/80 px-2.5 py-2 ${CALLOUT_TONE[tone]} ${className}`}>
      {label && (
        <div className="mb-1.5 flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-fg-muted">
          {icon && <span className="text-fg-muted shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
          <span>{label}</span>
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* ── DefinitionChips (label + value cells for triage metadata) ────────── */

export interface DefinitionChipItem {
  label: string
  value: ReactNode
  hint?: string
}

export function DefinitionChips({ items, className = '' }: { items: DefinitionChipItem[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <ul
      className={`mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-x-2 ${className}`}
      aria-label="Key attributes"
    >
      {items.map((item) => (
        <li
          key={item.label}
          className="flex min-w-0 flex-col rounded-sm border border-edge-subtle bg-surface-overlay/25 px-2 py-1.5"
        >
          <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint" title={item.hint}>
            {item.label}
          </span>
          <div className="mt-0.5 min-w-0 text-sm text-fg wrap-break-word [&_.inline-flex]:max-w-full">
            {item.value}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ── InfoHint (i icon that reveals a tooltip) ──────────────────────────── */

export function InfoHint({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={content}
        className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 cursor-help"
      >
        <span aria-hidden="true" className="leading-none italic font-serif">i</span>
      </button>
    </Tooltip>
  )
}

/* ── CopyButton ─────────────────────────────────────────────────────────── */

export function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard write can fail in insecure contexts (http://) or when the user
      // denies permission — silently no-op rather than throw, matching CommandPalette
      // pattern. The user will see the unchanged icon and try again.
    }
  }
  return (
    <Tooltip content={copied ? 'Copied' : 'Copy to clipboard'}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 motion-safe:transition-colors ${className}`}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          {copied ? (
            <polyline points="3,8.5 6.5,12 13,4.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="5" y="5" width="8.5" height="8.5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </svg>
      </button>
    </Tooltip>
  )
}

/* ── CodeValue (monospace technical string with code-block chrome) ──────── */

/**
 * Semantic <code> block for rendering URLs, IDs, session tokens, hashes,
 * and other technical strings that look like noise when rendered as plain
 * prose. Gives the value:
 *   - A tinted surface background so it visually separates from surrounding
 *     label text (users scan "this is data, not copy").
 *   - JetBrains-Mono font + `text-fg` full-contrast colour so characters
 *     like `l`/`1`/`I` and `0`/`O` are distinguishable.
 *   - `wrap-anywhere` so very long strings (JWTs, data-URLs) wrap inside
 *     the card without forcing horizontal scroll or ellipsis truncation.
 *   - Optional accent tone — `url` greens the protocol hint like devtools,
 *     `id` uses the soft brand tint. Adding a new tone is a single-line
 *     change in TONES below.
 *   - Built-in copy affordance.
 *
 * Defaults intentionally show the full value — truncation belongs in list
 * views, not detail pages where the user came specifically to read the data.
 */
type CodeValueTone = 'neutral' | 'id' | 'url' | 'hash'

const CODE_TONES: Record<CodeValueTone, string> = {
  neutral: 'text-fg',
  id:      'text-brand',
  url:     'text-info',
  hash:    'text-accent',
}

interface CodeValueProps {
  value: string
  tone?: CodeValueTone
  copyable?: boolean
  className?: string
  /** When true the <code> is rendered inline (no fill, no padding). Useful
   *  for embedding a single token inside a sentence, e.g. "branch `fix/123`
   *  opened". Detail-page callers should leave this false. */
  inline?: boolean
}

export function CodeValue({ value, tone = 'neutral', copyable = true, className = '', inline }: CodeValueProps) {
  const baseFont = `font-mono text-[0.8125rem] leading-relaxed ${CODE_TONES[tone]}`
  if (inline) {
    return (
      <code className={`${baseFont} px-1 py-0.5 rounded-sm bg-surface-overlay/50 border border-edge-subtle wrap-anywhere ${className}`}>
        {value}
      </code>
    )
  }
  return (
    <div className={`group/code inline-flex max-w-full items-start gap-1.5 ${className}`}>
      <code
        className={`${baseFont} block w-full rounded-sm bg-surface-overlay/60 border border-edge-subtle px-2 py-1 wrap-anywhere`}
      >
        {value}
      </code>
      {copyable && <CopyButton value={value} className="mt-0.5 shrink-0" />}
    </div>
  )
}

/* ── IdField (UUID / hash / session id with copy + full-value tooltip) ─── */

interface IdFieldProps {
  label: string
  value: string
  prefixLength?: number
  tooltip?: string
  /** Render the full value as a code block instead of a truncated prefix.
   *  Use on detail pages where the ID is evidence the user came to see;
   *  keep the default truncated form for tables and list rows. */
  full?: boolean
  /** Accent tone when `full` is set (defaults to `id` — soft brand tint). */
  tone?: CodeValueTone
}

export function IdField({ label, value, prefixLength = 12, tooltip, full, tone = 'id' }: IdFieldProps) {
  if (full) {
    return (
      <div className="mb-2 last:mb-0">
        <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
          {label}
          {tooltip && <InfoHint content={tooltip} />}
        </span>
        <CodeValue value={value} tone={tone} />
      </div>
    )
  }
  const display = value.length > prefixLength ? `${value.slice(0, prefixLength)}…` : value
  return (
    <div className="mb-2 last:mb-0">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium">
        {label}
        {tooltip && <InfoHint content={tooltip} />}
      </span>
      <div className="flex items-center gap-1 mt-0.5">
        <Tooltip content={value}>
          <span className="text-sm font-mono text-fg-secondary cursor-help">{display}</span>
        </Tooltip>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

/* ── RelativeTime (humanised time + ISO tooltip) ────────────────────────── */

const RTF = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null

function formatRelative(input: string | Date): string {
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

/* ── RecommendedAction (status-aware suggestion card) ──────────────────── */

interface RecommendedActionCta {
  label: string
  onClick?: () => void
  href?: string
  to?: string
  disabled?: boolean
}

interface RecommendedActionProps {
  title: string
  description?: string
  cta?: RecommendedActionCta
  tone?: 'urgent' | 'info' | 'success' | 'neutral'
}

const RECOMMENDED_TONES = {
  urgent:  'border-danger/30 bg-danger-muted/15',
  info:    'border-info/30 bg-info-muted/15',
  success: 'border-ok/30 bg-ok-muted/15',
  neutral: 'border-edge bg-surface-raised/40',
} as const

const RECOMMENDED_ACCENTS = {
  urgent: 'text-danger',
  info: 'text-info',
  success: 'text-ok',
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

export function RecommendedAction({ title, description, cta, tone = 'info' }: RecommendedActionProps) {
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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

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
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-6"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            aria-label="Close"
            className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
            </svg>
          </button>
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-sm shadow-raised"
          />
        </div>
      )}
    </>
  )
}

/* ── StatCard ───────────────────────────────────────────────────────────── */

interface StatCardProps {
  label: string
  value: number | string
  accent?: string
  delta?: { value: string; positive?: boolean }
}

export function StatCard({ label, value, accent, delta }: StatCardProps) {
  return (
    <Card elevated className="px-3 py-2.5">
      <div className="text-2xs text-fg-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className={`text-xl font-semibold font-mono stat-value ${accent ?? 'text-fg'}`}>
          {value}
        </div>
        {delta && (
          <span className={`text-3xs font-medium font-mono ${delta.positive ? 'text-ok' : 'text-danger'}`}>
            {delta.positive ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
    </Card>
  )
}

/* ── PageHeader ─────────────────────────────────────────────────────────── */

interface PageHeaderProps {
  title: string
  description?: string
  children?: ReactNode
  /** Override the leading chip slot. Pass an explicit chip (e.g. a custom
   *  <PdcaContextHint stage="…" />) to override the URL-derived default, or
   *  pass `null` to suppress the chip entirely on pages that aren't part of
   *  the PDCA loop (login, settings, etc.). Leave undefined to inherit the
   *  default URL-driven chip — that's the path almost every page should take. */
  contextChip?: ReactNode | null
  /** Project name to anchor the page in the user's reality
   *  (e.g. `Reports · glot-it`). Pass `null` or omit to keep the bare title.
   * every PDCA page surfaces the active project so the user
   *  can tell which app a bug came from without scanning the switcher. */
  projectScope?: string | null
}

export function PageHeader({ title, description, children, contextChip, projectScope }: PageHeaderProps) {
  // `undefined` = render the auto URL-derived stage chip; `null` = explicitly
  // suppressed; anything else = caller-provided chip. This keeps the audit
  // invariant ("every PDCA page shows its stage above the title") without
  // forcing every page to import PdcaContextHint manually.
  const chip = contextChip === undefined ? <AutoPdcaChip /> : contextChip
  return (
    <div className="flex items-start justify-between mb-5 gap-3">
      <div className="min-w-0">
        {chip && <div className="mb-1.5">{chip}</div>}
        <h2 className="text-base font-semibold text-fg">
          {title}
          {projectScope && (
            <>
              <span className="mx-1.5 text-fg-faint" aria-hidden="true">·</span>
              <span className="font-mono text-fg-secondary">{projectScope}</span>
            </>
          )}
        </h2>
        {description && (
          <p className="text-xs text-fg-muted mt-1.5 max-w-2xl leading-relaxed text-pretty">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

/**
 * URL-derived PDCA stage chip rendered inline (rather than re-using
 * `<PdcaContextHint />`) to sidestep the circular import that would arise if
 * ui.tsx imported a component which itself imports Tooltip from ui.tsx. The
 * styling stays in lock-step with `PdcaContextHint` because both surfaces
 * read from the shared `PDCA_STAGES` map.
 */
function AutoPdcaChip() {
  const { pathname } = useLocation()
  const chip = chipForPath(pathname)
  if (!chip) return null
  const meta = chip === 'overview' ? PDCA_OVERVIEW_CHIP : PDCA_STAGES[chip]
  const ariaLabel = chip === 'overview'
    ? `Overview: ${meta.hint}`
    : `PDCA stage: ${meta.label}. ${meta.hint}`
  return (
    <Tooltip content={meta.hint}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs uppercase tracking-wider cursor-help ${meta.tintBg} ${meta.tintBorder} ${meta.text}`}
        aria-label={ariaLabel}
      >
        <span
          className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm font-semibold text-[9px] ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {meta.letter}
        </span>
        {meta.label}
      </span>
    </Tooltip>
  )
}

/* ── PageHelp (collapsible "About this page") ──────────────────────────── */

interface PageHelpProps {
  title: string
  whatIsIt: string
  useCases?: string[]
  howToUse?: string
  /** Force-override the default-open behaviour. Leave unset for the
   *  default "open until the user dismisses it once" UX. */
  defaultOpen?: boolean
}

const PAGEHELP_DISMISS_PREFIX = 'mushi:pagehelp:dismissed:'
const PAGEHELP_VISITED_FLAG = 'mushi:visited'

function readPageHelpDismissed(title: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PAGEHELP_DISMISS_PREFIX + title) === '1'
  } catch {
    return false
  }
}

function writePageHelpDismissed(title: string, dismissed: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (dismissed) {
      window.localStorage.setItem(PAGEHELP_DISMISS_PREFIX + title, '1')
    } else {
      window.localStorage.removeItem(PAGEHELP_DISMISS_PREFIX + title)
    }
  } catch {
    // localStorage is best-effort; private-mode browsers throw on write.
  }
}

/** Returning users (anyone who has visited the admin before) shouldn't be
 *  bombarded with help disclosures on every page. We mark the visit on first
 *  page-help mount and use it to flip the default from open -> closed for
 * subsequent sessions on pages they haven't explicitly opened. . */
function isReturningUser(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PAGEHELP_VISITED_FLAG) === '1'
  } catch {
    return false
  }
}

function markVisited() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PAGEHELP_VISITED_FLAG, '1')
  } catch {
    /* best effort */
  }
}

export function PageHelp({ title, whatIsIt, useCases, howToUse, defaultOpen }: PageHelpProps) {
  // Default-open only for first-ever visits (a single global flag, not per
  // page) — the audit found existing per-title-only logic hammered returning
  // users with re-opened help on every new page they navigated to.
  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen !== undefined) return defaultOpen
    if (readPageHelpDismissed(title)) return false
    return !isReturningUser()
  })

  useEffect(() => {
    markVisited()
  }, [])

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    const next = e.currentTarget.open
    setOpen(next)
    writePageHelpDismissed(title, !next)
  }

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className="group mb-4 rounded-md border border-edge-subtle bg-surface-raised/30 open:bg-surface-raised/50"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-fg-muted hover:text-fg-secondary motion-safe:transition-colors">
        <svg
          className="h-3 w-3 text-fg-faint motion-safe:transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg
          className="h-3.5 w-3.5 text-fg-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
        </svg>
        <span className="font-medium">{title}</span>
      </summary>
      <div className="max-w-3xl space-y-2.5 border-t border-edge-subtle px-3 py-2.5 text-2xs leading-relaxed text-fg-secondary text-pretty">
        <div>
          <p className="mb-1 font-medium text-fg-muted uppercase tracking-wider text-3xs">What it is</p>
          <p>{whatIsIt}</p>
        </div>
        {useCases && useCases.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-fg-muted uppercase tracking-wider text-3xs">When to use it</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {useCases.map((u, i) => <li key={i}>{u}</li>)}
            </ul>
          </div>
        )}
        {howToUse && (
          <div>
            <p className="mb-1 font-medium text-fg-muted uppercase tracking-wider text-3xs">How to use it</p>
            <p>{howToUse}</p>
          </div>
        )}
      </div>
    </details>
  )
}

/* ── FilterSelect ───────────────────────────────────────────────────────── */

interface FilterSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly string[]
}

export function FilterSelect({ label, options, ...rest }: FilterSelectProps) {
  return (
    <select
      {...rest}
      className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150"
    >
      <option value="">All {label}</option>
      {options.filter(Boolean).map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}

/* ── SegmentedControl (brand-pill radio group) ─────────────────────────── */

export interface SegmentedControlOption<T extends string> {
  id: T
  label: string
  count?: number | string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (next: T) => void
  /** Optional tiny prefix label rendered to the left of the track. */
  label?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

const SEGMENT_SIZE = {
  sm: 'px-1.5 py-0.5 text-2xs',
  md: 'px-2 py-1 text-2xs font-medium',
} as const

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  const track = (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? label}
      className={`inline-flex items-center gap-0.5 rounded-md border border-edge-subtle bg-surface-raised/50 p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={`${SEGMENT_SIZE[size]} rounded-sm motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
              active
                ? 'bg-brand text-brand-fg'
                : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/50'
            }`}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={`ml-1 font-mono ${active ? 'text-brand-fg/80' : 'text-fg-faint'}`}>
                {opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  if (!label) return track
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-3xs uppercase tracking-wider text-fg-faint">{label}</span>
      {track}
    </div>
  )
}

/* ── Btn (primary / ghost / danger variants) ────────────────────────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
  /** When true, swaps the leading area for a spinner and disables the
   *  button. Use this instead of toggling text manually so loading state
   *  is consistent across the app. */
  loading?: boolean
  /** Optional icon rendered before children. Sized to match the variant. */
  leadingIcon?: ReactNode
}

const BTN_BASE =
  'inline-flex items-center justify-center font-medium rounded-sm ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-all motion-safe:duration-150 motion-safe:active:scale-[0.97]'

const BTN_SIZES = {
  sm: 'px-2 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
} as const

const BTN_VARIANTS = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-card hover:shadow-raised',
  ghost: 'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-edge',
  danger: 'bg-danger-muted text-danger hover:bg-danger-muted/80 border border-danger/30 hover:border-danger/40',
} as const

export function Btn({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  loading,
  leadingIcon,
  disabled,
  ...rest
}: BtnProps) {
  const isDisabled = disabled || loading
  return (
    <button
      className={`${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <BtnSpinner size={size} /> : leadingIcon}
      {children}
    </button>
  )
}

function BtnSpinner({ size }: { size: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  return (
    <svg
      className={`motion-safe:animate-spin ${dim}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

/* ── Form-control state matrix (Input / SelectField / Textarea share these)
 *  default → hover → focus-visible → invalid → disabled, always with the
 *  brand ring at 60% opacity for AAA-friendly contrast on dark surfaces. */

const FIELD_BASE =
  'w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg ' +
  'placeholder:text-fg-faint hover:border-edge ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/40 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'motion-safe:transition-colors motion-safe:duration-150'

const FIELD_LABEL = 'text-xs text-fg-muted mb-1 block font-medium'
const FIELD_ERROR = 'mt-1 text-2xs text-danger'

/* ── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Inline error message rendered below the field. Setting this also
   *  flips `aria-invalid` so the brand ring becomes a danger ring. */
  error?: string
}

export function Input({ label, className = '', id, error, ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="block">
      {label && <span className={FIELD_LABEL}>{label}</span>}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`${FIELD_BASE} ${className}`}
        {...rest}
      />
      {error && <p className={FIELD_ERROR}>{error}</p>}
    </label>
  )
}

/* ── Select (form variant) ──────────────────────────────────────────────── */

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: ReactNode
  error?: string
}

export function SelectField({ label, children, className = '', error, ...rest }: SelectFieldProps) {
  return (
    <label className="block">
      {label && <span className={FIELD_LABEL}>{label}</span>}
      <select
        aria-invalid={error ? true : undefined}
        className={`${FIELD_BASE} ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error && <p className={FIELD_ERROR}>{error}</p>}
    </label>
  )
}

/* ── Checkbox ──────────────────────────────────────────────────────────── */

interface CheckboxProps {
  label: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}

export function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  return (
    <label className={`group inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-safe:transition-colors"
      />
      <span className="text-xs text-fg-secondary group-hover:text-fg select-none motion-safe:transition-colors">{label}</span>
    </label>
  )
}

/* ── Toggle ────────────────────────────────────────────────────────────── */

interface ToggleProps {
  label?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${checked ? 'bg-brand border-brand/60' : 'bg-surface-raised border-edge hover:border-edge'}`}
      >
        <span
          className={`pointer-events-none inline-flex items-center justify-center h-4 w-4 rounded-full bg-fg shadow-card motion-safe:transition-transform motion-safe:duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`}
          aria-hidden="true"
        />
      </button>
      {label && <span className="text-xs text-fg-secondary select-none">{label}</span>}
    </label>
  )
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, className = '', id, error, ...rest }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="block">
      {label && <span className={FIELD_LABEL}>{label}</span>}
      <textarea
        id={textareaId}
        aria-invalid={error ? true : undefined}
        className={`${FIELD_BASE} resize-y min-h-20 ${className}`}
        {...rest}
      />
      {error && <p className={FIELD_ERROR}>{error}</p>}
    </label>
  )
}

/* ── EmptyState ─────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  /** Status line — short statement of what the user is looking at right now. */
  title: string
  /** Learning cue — explain why this is empty + what the user can do. */
  description?: string
  /** Primary action ("direct path") — Btn or Link styled component. */
  action?: ReactNode
  /**
   * Optional inline learning cues. Rendered as a tight bullet list under the
   * description so the user can see "what should I try?" without navigating
   * away. Follows the third leg of NN/G's empty-state guidelines (status +
   * learning cue + direct path).
   */
  hints?: string[]
  /** Optional small icon glyph rendered above the title. */
  icon?: ReactNode
}

export function EmptyState({ title, description, action, hints, icon }: EmptyStateProps) {
  return (
    <Card className="p-6 text-center">
      {icon && <div aria-hidden="true" className="mx-auto mb-2 text-fg-faint">{icon}</div>}
      <p className="text-fg-muted text-sm">{title}</p>
      {description && (
        <p className="text-fg-faint text-xs mt-1 max-w-prose mx-auto leading-relaxed text-pretty wrap-break-word">
          {description}
        </p>
      )}
      {hints && hints.length > 0 && (
        <ul className="mt-2 inline-block text-left text-2xs text-fg-faint space-y-0.5">
          {hints.map((hint) => (
            <li key={hint} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="text-fg-faint">·</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/* ── Loading (spinner + text) ──────────────────────────────────────────── */

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-fg-muted text-sm py-4" role="status">
      <svg className="motion-safe:animate-spin h-4 w-4 text-fg-faint" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
      </svg>
      <span>{text}</span>
    </div>
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
  running: 'border-info/30 bg-info-muted/30 text-info',
  success: 'border-ok/30 bg-ok-muted/30 text-ok',
  error: 'border-danger/30 bg-danger-muted/30 text-danger',
  info: 'border-info/30 bg-info-muted/30 text-info',
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
        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
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

/* ── Tooltip ───────────────────────────────────────────────────────────── */

interface TooltipProps {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 400)
  }
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setVisible(false)
  }

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`absolute ${positions[side]} z-50 px-2 py-1 text-2xs font-medium text-fg bg-surface-overlay border border-edge-subtle rounded-sm shadow-raised whitespace-nowrap pointer-events-none tooltip-enter`}
        >
          {content}
        </span>
      )}
    </span>
  )
}

/* ── Kbd (keyboard shortcut badge) ─────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-3xs font-mono font-medium text-fg-faint bg-surface-root border border-edge rounded-sm">
      {children}
    </kbd>
  )
}

/* ── ErrorAlert ────────────────────────────────────────────────────────── */

interface ErrorAlertProps {
  message?: string
  onRetry?: () => void
}

export function ErrorAlert({ message = 'Something went wrong. Please try again.', onRetry }: ErrorAlertProps) {
  return (
    <Card className="p-4 border-danger/30 bg-danger-muted/10">
      <p className="text-sm text-danger">{message}</p>
      {onRetry && (
        <Btn variant="ghost" size="sm" className="mt-2" onClick={onRetry}>Retry</Btn>
      )}
    </Card>
  )
}

/* ── Divider ───────────────────────────────────────────────────────────── */

export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-edge-subtle ${className}`} />
}
