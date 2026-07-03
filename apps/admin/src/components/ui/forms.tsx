import React, { useState, useEffect, forwardRef } from 'react';
import type { ReactNode, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Card, LabelHelp } from './layout';
import { CHIP_TONE } from '../../lib/chipTone'


/* ── FilterSelect ───────────────────────────────────────────────────────── */

interface FilterSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly string[]
  /** Override auto-generated id; defaults to filter-{slugified-label}. */
  id?: string
}

/** Compact filter-bar select chrome — matches FilterSelect. */
export const FILTER_SELECT_CLASS =
  'bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary hover:border-edge focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150'

export function FilterSelect({ label, options, id, className = '', ...rest }: FilterSelectProps) {
  const selectId = id ?? `filter-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <label className="inline-flex flex-col gap-0.5">
      <span className="sr-only">{label}</span>
      <select
        id={selectId}
        aria-label={label}
        {...rest}
        className={`${FILTER_SELECT_CLASS} ${className}`}
      >
        <option value="">All {label}</option>
        {options.filter(Boolean).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>
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
  /** Allow segments to wrap on narrow viewports instead of overflowing. */
  wrap?: boolean
  /** Horizontal scroll strip for many tabs — keeps one row on narrow viewports. */
  scrollable?: boolean
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
  wrap = false,
  scrollable = false,
  className = '',
}: SegmentedControlProps<T>) {
  const track = (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? label}
      className={`${wrap ? 'flex flex-wrap' : scrollable ? 'inline-flex flex-nowrap' : 'inline-flex'} items-center gap-0.5 rounded-md border border-edge-subtle bg-surface-raised p-0.5 ${className}`}
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
            className={`${SEGMENT_SIZE[size]} rounded-sm motion-safe:transition-[background-color,color,box-shadow,transform] motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:active:scale-[0.97] ${
              active
                ? 'bg-brand text-brand-fg shadow-card'
                : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/50 hover:-translate-y-px'
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

  if (!label) {
    if (scrollable) {
      return (
        <div className="max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
          {track}
        </div>
      )
    }
    return track
  }
  return (
    <div className={`inline-flex max-w-full items-center gap-1.5 ${scrollable ? 'overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]' : ''}`}>
      <span className="shrink-0 text-3xs uppercase tracking-wider text-fg-faint">{label}</span>
      {track}
    </div>
  )
}

/* ── Btn (primary / ghost / danger / success variants) ──────────────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual intent.
   *  - `primary`: default brand action.
   *  - `ghost`:   neutral secondary actions (Refresh, Back, View details).
   *  - `cancel`:  dismiss / cancel / close — red affordance (not destructive-primary).
   *  - `danger`:  destructive / irreversible (Delete, Reject, Revoke,
   *               Disconnect, Uninstall, Flag, Dismiss report).
   *  - `success`: forward / un-blocking action (Start triage, Complete,
   *               Approve, Retry — anything that progresses the user
   *               through their workflow). Mirrors the `ok` semantic
   *               token so tone is consistent with PageHero severity
   *               and SidebarHealthDot.
   */
  variant?: 'primary' | 'ghost' | 'cancel' | 'danger' | 'success'
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
  'motion-safe:transition-[background-color,border-color,color,box-shadow,transform] motion-safe:duration-150 motion-safe:active:scale-[0.97]'

const BTN_SIZES = {
  sm: 'px-2 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
} as const

const BTN_VARIANTS = {
  primary:
    'bg-brand text-brand-fg shadow-card hover:bg-brand-hover hover:shadow-raised hover:-translate-y-px',
  ghost:
    'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-edge hover:-translate-y-px',
  cancel:
    `${CHIP_TONE.danger} border-danger/40 hover:bg-danger-muted hover:border-danger/50 hover:-translate-y-px`,
  danger:
    `${CHIP_TONE.dangerSubtle} hover:bg-danger-muted/80 hover:border-danger/40 hover:-translate-y-px`,
  success:
    `${CHIP_TONE.okSubtle} hover:bg-ok-muted/80 hover:border-ok/40 hover:-translate-y-px`,
}

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

function BtnSpinner({ size }: { size: 'sm' | 'md' | 'icon' }) {
  const dim = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'
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

/** Icon-only refresh — page headers and setup banners. */
export function RefreshIconButton({
  onClick,
  loading,
  disabled,
  label = 'Refresh',
  className = '',
}: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading || undefined}
      title={label}
      className={`inline-flex items-center justify-center h-8 w-8 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? (
        <BtnSpinner size="icon" />
      ) : (
        <svg
          viewBox="0 0 16 16"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M1.5 8A6.5 6.5 0 0 1 14 5.5" />
          <path d="M14.5 8A6.5 6.5 0 0 1 2 10.5" />
          <polyline points="12 3.5 14 5.5 12 7.5" />
          <polyline points="4 8.5 2 10.5 4 12.5" />
        </svg>
      )}
    </button>
  )
}

/* ── Form-control state matrix (Input / SelectField / Textarea share these)
 *  default → hover → focus-visible → invalid → disabled, always with the
 *  brand ring at 60% opacity for AAA-friendly contrast on dark surfaces. */

/** Shared focus ring for ad-hoc inputs that bypass `<Input />`. */
export const FIELD_FOCUS =
  'focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40'

const FIELD_BASE =
  'w-full bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg ' +
  'placeholder:text-fg-faint hover:border-edge ' +
  `${FIELD_FOCUS} ` +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/40 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'motion-safe:transition-colors motion-safe:duration-150'

const FIELD_LABEL = 'text-xs text-fg-muted mb-1 block font-medium'
const FIELD_ERROR = 'mt-1 text-2xs text-danger'
const FIELD_WARN = 'mt-1 text-2xs text-warn'

/* ── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Inline error message rendered below the field. Setting this also
   *  flips `aria-invalid` so the brand ring becomes a danger ring. */
  error?: string
  /** Short hover-only hint (legacy). Renders an italic "i" next to the
   *  label that shows the string in a single-line Tooltip. Use `helpId`
   *  for anything longer than ~10 words. */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. When set, the "i" icon
   *  opens a click-to-explain popover with the dictionary entry's full
   *  5-section card. Wins over `tooltip` if both are provided. */
  helpId?: string
  /** Pure validator from `lib/validators.ts`. Runs on blur (not on every
   *  keystroke — that's a known UX anti-pattern), and re-runs on change
   *  ONLY after the field has been blurred once, so the user gets live
   *  correctness feedback while editing without being yelled at the
   *  moment the cursor lands. The explicit `error` prop still wins —
   *  callers can use it for server-side validation that happens after
   *  Save and shouldn't be silently overwritten. */
  validate?: (value: string) => { message: string; severity?: 'error' | 'warn' } | null
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, className = '', id, error, tooltip, helpId, validate, onBlur, onChange, type, ...rest },
  ref,
) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const [touched, setTouched] = useState(false)
  const [localResult, setLocalResult] = useState<{ message: string; severity?: 'error' | 'warn' } | null>(null)
  const [reveal, setReveal] = useState(false)
  const value = (rest.value ?? '') as string

  // Re-validate on `value` change AFTER the field has been blurred once,
  // so live edits clear the error as soon as the user types something
  // valid. Before blur, suppress validation entirely — premature errors
  // are the #1 form-validation UX complaint.
  useEffect(() => {
    if (!touched || !validate) return
    setLocalResult(validate(typeof value === 'string' ? value : String(value)))
  }, [value, touched, validate])

  // The visible message: explicit `error` prop > local async validator.
  const visibleError = error ?? (localResult?.severity !== 'warn' ? localResult?.message : undefined)
  const visibleWarn = !visibleError && localResult?.severity === 'warn' ? localResult.message : undefined

  // Reveal-toggle: only renders for password inputs. We swap the rendered
  // `type` between 'password' and 'text' rather than touching the prop on
  // the DOM node directly so React's controlled-input bookkeeping stays
  // happy. Right-padded so the eye button never overlaps the value.
  const isPassword = type === 'password'
  const renderedType = isPassword && reveal ? 'text' : type
  const inputClassName = `${FIELD_BASE} ${isPassword ? 'pr-9' : ''} ${className}`

  return (
    <label className="block">
      {label && (
        <span className={`${FIELD_LABEL} flex items-center gap-1`}>
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
        </span>
      )}
      <span className={isPassword ? 'relative block' : undefined}>
        <input
          ref={ref}
          id={inputId}
          type={renderedType}
          aria-invalid={visibleError ? true : undefined}
          className={inputClassName}
          {...rest}
          onBlur={(e) => {
            if (!touched) setTouched(true)
            if (validate) setLocalResult(validate(e.target.value))
            onBlur?.(e)
          }}
          onChange={(e) => {
            onChange?.(e)
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={(e) => {
              // The Input is wrapped in a <label>, so an unhandled click on
              // this button would bubble up and re-target the input (label
              // semantics). preventDefault + stopPropagation keeps the
              // toggle local to the eye button.
              e.preventDefault()
              e.stopPropagation()
              setReveal((v) => !v)
            }}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-fg-faint hover:text-fg-muted focus-visible:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm motion-safe:transition-colors"
          >
            {reveal ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </span>
      {visibleError && <p className={FIELD_ERROR}>{visibleError}</p>}
      {visibleWarn && <p className={FIELD_WARN}>{visibleWarn}</p>}
    </label>
  )
})

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: ReactNode
  error?: string
  /** Short hover-only hint (legacy). Renders an italic "i" next to the
   *  label. */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. When set, opens the rich
   *  click-to-explain popover. Wins over `tooltip`. */
  helpId?: string
}

export function SelectField({ label, children, className = '', error, tooltip, helpId, ...rest }: SelectFieldProps) {
  return (
    <label className="block">
      {label && (
        <span className={`${FIELD_LABEL} flex items-center gap-1`}>
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
        </span>
      )}
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
  /** Short hover-only hint (legacy). */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
}

export function Checkbox({ label, checked, onChange, disabled, tooltip, helpId }: CheckboxProps) {
  return (
    <label className={`group inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-safe:transition-colors"
      />
      <span className="inline-flex items-center gap-1 text-xs text-fg-secondary group-hover:text-fg select-none motion-safe:transition-colors">
        {label}
        <LabelHelp helpId={helpId} tooltip={tooltip} />
      </span>
    </label>
  )
}

/* ── Toggle ────────────────────────────────────────────────────────────── */

interface ToggleProps {
  label?: string
  /** Accessible name when the toggle is used without a visible `label`. */
  ariaLabel?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  /** Short hover-only hint (legacy). */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
}

export function Toggle({ label, ariaLabel, checked, onChange, disabled, tooltip, helpId }: ToggleProps) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onChange?.(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${checked ? 'bg-brand border-brand/60' : 'bg-surface-raised border-edge hover:border-edge'}`}
      >
        <span
          className={`pointer-events-none inline-flex items-center justify-center h-4 w-4 rounded-full bg-fg shadow-card motion-safe:transition-transform motion-safe:duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`}
          aria-hidden="true"
        />
      </button>
      {label && (
        <span className="inline-flex items-center gap-1 text-xs text-fg-secondary select-none">
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
        </span>
      )}
    </label>
  )
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  /** Short hover-only hint (legacy). */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
  /** Same blur-then-live validation contract as `<Input validate={…} />`.
   *  See InputProps.validate for the full rationale. */
  validate?: (value: string) => { message: string; severity?: 'error' | 'warn' } | null
}

export function Textarea({ label, className = '', id, error, tooltip, helpId, validate, onBlur, ...rest }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const [touched, setTouched] = useState(false)
  const [localResult, setLocalResult] = useState<{ message: string; severity?: 'error' | 'warn' } | null>(null)
  const value = (rest.value ?? '') as string

  useEffect(() => {
    if (!touched || !validate) return
    setLocalResult(validate(typeof value === 'string' ? value : String(value)))
  }, [value, touched, validate])

  const visibleError = error ?? (localResult?.severity !== 'warn' ? localResult?.message : undefined)
  const visibleWarn = !visibleError && localResult?.severity === 'warn' ? localResult.message : undefined

  return (
    <label className="block">
      {label && (
        <span className={`${FIELD_LABEL} flex items-center gap-1`}>
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
        </span>
      )}
      <textarea
        id={textareaId}
        aria-invalid={visibleError ? true : undefined}
        className={`${FIELD_BASE} resize-y min-h-20 ${className}`}
        {...rest}
        onBlur={(e) => {
          if (!touched) setTouched(true)
          if (validate) setLocalResult(validate(e.target.value))
          onBlur?.(e)
        }}
      />
      {visibleError && <p className={FIELD_ERROR}>{visibleError}</p>}
      {visibleWarn && <p className={FIELD_WARN}>{visibleWarn}</p>}
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

/**
 * Editorial empty state — the "hero" variant: dashed-border card, branded
 * 44px icon stamp, and a large serif title. Use this for full-page or
 * full-card empty states where the missing data deserves a moment of
 * attention (e.g. /reports with no reports yet, /audit with no entries,
 * /health with no LLM calls). Callers MUST pass an explicit `icon` —
 * the editorial treatment without one would render a stranded icon box.
 *
 * For compact/inline empty states inside tables, sub-sections, or stacked
 * cards, use the `EmptyState` wrapper below instead — it auto-falls back
 * to a minimal, icon-less, small-text variant when `icon` is omitted.
 */
export function EditorialEmptyState({ title, description, action, hints, icon }: EmptyStateProps) {
  return (
    <Card className="p-6 text-left border-dashed">
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 grid h-11 w-11 place-items-center rounded-sm border border-brand/30 bg-brand/10 font-mono text-brand shadow-[inset_0_-3px_0_var(--color-brand)]"
        >
          {icon}
        </div>
      )}
      <p className="font-serif text-xl leading-tight tracking-[-0.03em] text-fg">{title}</p>
      {description && (
        <p className="text-fg-muted text-xs mt-2 max-w-prose leading-relaxed text-pretty wrap-break-word">
          {description}
        </p>
      )}
      {hints && hints.length > 0 && (
        <ul className="mt-3 inline-block text-left font-mono text-2xs text-fg-faint space-y-0.5">
          {hints.map((hint) => (
            <li key={hint} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="text-brand">/</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/**
 * Compact empty state — the original minimal variant: plain card, no icon
 * block, small muted title. Designed for inline contexts like an empty
 * table body, a sub-section inside a larger Card, or a stacked list where
 * an editorial hero would be visually overpowering. This is the variant
 * `EmptyState` falls back to when no `icon` is provided.
 */
function CompactEmptyState({ title, description, action, hints }: EmptyStateProps) {
  return (
    <Card className="p-6 text-left border-dashed">
      <p className="text-fg-muted text-sm">{title}</p>
      {description && (
        <p className="text-fg-muted text-xs mt-2 max-w-prose leading-relaxed text-pretty wrap-break-word">
          {description}
        </p>
      )}
      {hints && hints.length > 0 && (
        <ul className="mt-3 inline-block text-left font-mono text-2xs text-fg-faint space-y-0.5">
          {hints.map((hint) => (
            <li key={hint} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="text-brand">/</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/**
 * Smart empty-state wrapper. Routes to the editorial hero variant when an
 * `icon` is provided (explicit opt-in: "this empty state deserves the
 * spotlight") and falls back to the compact, minimal variant otherwise —
 * preserving the long-standing "no icon = no icon box" behavior that 20+
 * inline call sites (CompliancePage residency/DSAR/policy lists,
 * AntiGamingPage device/event lists, MarketplacePage filters, etc.) rely
 * on for density. Callers that want the editorial card without an icon
 * can still call `EditorialEmptyState` directly and pass an explicit
 * `icon` node.
 */
export function EmptyState(props: EmptyStateProps) {
  if (props.icon) {
    return <EditorialEmptyState {...props} />
  }
  return <CompactEmptyState {...props} />
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
