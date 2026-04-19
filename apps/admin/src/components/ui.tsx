/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Shared UI primitives for the admin dashboard.
 *          Compact, dark-themed, data-dense design system components.
 */

import React, { useState, useRef, useEffect } from 'react'
import type { ReactNode, ReactEventHandler, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

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
  if (elevated) {
    return (
      <div
        className={`card-elevated ${interactive || onClick ? 'hover:brightness-110 motion-safe:transition-all motion-safe:duration-150' : ''} ${className}`}
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
      className={`bg-surface-raised/50 border border-edge-subtle rounded-md shadow-card ${interactive || onClick ? 'hover:bg-surface-overlay motion-safe:transition-colors motion-safe:duration-150' : ''} ${className}`}
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
}

export function Field({ label, value, mono, tooltip, copyable, valueClassName = '' }: FieldProps) {
  return (
    <div className="mb-2 last:mb-0">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium">
        {label}
        {tooltip && <InfoHint content={tooltip} />}
      </span>
      <div className="flex items-start gap-1.5 mt-0.5">
        <p className={`text-sm text-fg break-all ${mono ? 'font-mono' : ''} ${valueClassName}`}>{value}</p>
        {copyable && <CopyButton value={value} />}
      </div>
    </div>
  )
}

/* ── InfoHint (i icon that reveals a tooltip) ───────────────────────────── */

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

/* ── IdField (UUID / hash / session id with copy + full-value tooltip) ─── */

interface IdFieldProps {
  label: string
  value: string
  prefixLength?: number
  tooltip?: string
}

export function IdField({ label, value, prefixLength = 12, tooltip }: IdFieldProps) {
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
        {description && <p className="text-xs text-fg-muted mt-1 leading-snug">{description}</p>}
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
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
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

export function PageHelp({ title, whatIsIt, useCases, howToUse, defaultOpen }: PageHelpProps) {
  // First-time visitors should see the page context unfolded — the audit
  // found that having every disclosure collapsed by default hid the entire
  // value-prop of each page. Once the user dismisses it, the choice is
  // persisted per-title across sessions so power users aren't pestered.
  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen !== undefined) return defaultOpen
    return !readPageHelpDismissed(title)
  })

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
      <div className="space-y-2.5 border-t border-edge-subtle px-3 py-2.5 text-2xs leading-relaxed text-fg-secondary">
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
      className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150"
    >
      <option value="">All {label}</option>
      {options.filter(Boolean).map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}

/* ── Btn (primary / ghost / danger variants) ────────────────────────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

export function Btn({ variant = 'primary', size = 'md', children, className = '', ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center font-medium rounded-sm disabled:opacity-40 disabled:pointer-events-none motion-safe:transition-all motion-safe:duration-150 motion-safe:active:scale-[0.97]'
  const sizes = {
    sm: 'px-2 py-1 text-xs gap-1.5',
    md: 'px-3 py-1.5 text-sm gap-2',
  }
  const variants = {
    primary: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-sm hover:shadow-md',
    ghost: 'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-edge-subtle',
    danger: 'bg-danger-muted text-danger hover:bg-danger-muted/80 border border-danger/20',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/* ── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function Input({ label, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="block">
      {label && <span className="text-xs text-fg-muted mb-1 block">{label}</span>}
      <input
        id={inputId}
        className={`w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40 motion-safe:transition-colors motion-safe:duration-150 ${className}`}
        {...rest}
      />
    </label>
  )
}

/* ── Select (form variant) ──────────────────────────────────────────────── */

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: ReactNode
}

export function SelectField({ label, children, className = '', ...rest }: SelectFieldProps) {
  return (
    <label className="block">
      {label && <span className="text-xs text-fg-muted mb-1 block">{label}</span>}
      <select
        className={`w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150 ${className}`}
        {...rest}
      >
        {children}
      </select>
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
    <label className={`inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus:ring-1 focus:ring-brand/40"
      />
      <span className="text-xs text-fg-secondary select-none">{label}</span>
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
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border border-edge motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${checked ? 'bg-brand' : 'bg-surface-raised'}`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-fg shadow-sm motion-safe:transition-transform motion-safe:duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
      {label && <span className="text-xs text-fg-secondary select-none">{label}</span>}
    </label>
  )
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, className = '', id, ...rest }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="block">
      {label && <span className="text-xs text-fg-muted mb-1 block">{label}</span>}
      <textarea
        id={textareaId}
        className={`w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40 motion-safe:transition-colors motion-safe:duration-150 resize-y min-h-20 ${className}`}
        {...rest}
      />
    </label>
  )
}

/* ── EmptyState ─────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card className="p-8 text-center">
      <p className="text-fg-muted text-sm">{title}</p>
      {description && <p className="text-fg-faint text-xs mt-1">{description}</p>}
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
