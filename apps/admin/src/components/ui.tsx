/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Shared UI primitives for the admin dashboard.
 *          Compact, dark-themed, data-dense design system components.
 */

import { useState, useRef, useEffect } from 'react'
import type { ReactNode, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'

/* ── Badge ──────────────────────────────────────────────────────────────── */

interface BadgeProps {
  children: ReactNode
  className?: string
}

export function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs leading-tight font-medium ${className}`}>
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
}

export function Card({ children, className = '', interactive, elevated }: CardProps) {
  if (elevated) {
    return (
      <div className={`card-elevated ${interactive ? 'hover:brightness-110 motion-safe:transition-all motion-safe:duration-150' : ''} ${className}`}>
        {children}
      </div>
    )
  }
  return (
    <div className={`bg-surface-raised/50 border border-edge-subtle rounded-md shadow-card ${interactive ? 'hover:bg-surface-overlay motion-safe:transition-colors motion-safe:duration-150' : ''} ${className}`}>
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
}

export function Section({ title, children, className = '', action }: SectionProps) {
  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">{title}</h3>
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
}

export function Field({ label, value, mono }: FieldProps) {
  return (
    <div className="mb-1.5 last:mb-0">
      <span className="text-2xs text-fg-faint">{label}</span>
      <p className={`text-sm text-fg-secondary break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
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
