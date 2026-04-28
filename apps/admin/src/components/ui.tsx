/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Shared UI primitives for the admin dashboard.
 *          Compact, dark-themed, data-dense design system components.
 */

import React, { useState, useRef, useEffect } from 'react'
import type { ReactNode, ReactEventHandler, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath } from '../lib/pdca'
import { pctToneClass } from '../lib/tokens'
import { ConfigHelp } from './ConfigHelp'
import { CopyViewLinkButton } from './CopyViewLinkButton'

/* ── LabelHelp ──────────────────────────────────────────────────────────────
 *
 * Tiny shared helper used by every form primitive below. Picks the right help
 * affordance for a label given the two opt-in props every primitive now
 * accepts:
 *
 *   - `helpId`  → rich click-to-open <ConfigHelp> popover (5-section card,
 *                 dictionary-backed, also feeds docs/CONFIG_REFERENCE.md).
 *   - `tooltip` → legacy short-string hover tooltip via <InfoHint>. Kept for
 *                 backwards compatibility with the dozens of existing call
 *                 sites that pass a one-line hint inline.
 *
 * `helpId` wins when both are set — the dictionary entry's `summary` already
 * powers the trigger's hover preview, so showing both would duplicate the
 * one-liner. */
function LabelHelp({ helpId, tooltip }: { helpId?: string; tooltip?: string }) {
  if (helpId) return <ConfigHelp helpId={helpId} />
  if (tooltip) return <InfoHint content={tooltip} />
  return null
}

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

/**
 * Freshness metadata accepted by `<Section>` and rendered through
 * `<FreshnessPill>`. Pages typically forward `usePageData`'s
 * `lastFetchedAt`, `isValidating`, and `useRealtimeReload`'s `channelState`.
 *
 * Wave T.1 (2026-04-23): Sections that show live data win a tiny "Updated
 * 4 s ago" pill in the top-right that pulses while a background refetch is
 * in flight and turns red when realtime drops — gives users a constant
 * trust signal that the page isn't lying about its data.
 */
export interface SectionFreshness {
  /** ISO timestamp of the last successful data fetch, or null until first
   *  load resolves. */
  at: string | null
  /** True while a background refetch is in flight (post-first-load). */
  isValidating?: boolean
  /** Realtime channel state — `dropped` adds a red ring + screen-reader
   *  warning so users know stale data is possible. */
  channel?: 'idle' | 'live' | 'dropped'
}

interface SectionProps {
  title: string
  children: ReactNode
  className?: string
  action?: ReactNode
  icon?: ReactNode
  /** Optional freshness pill rendered top-right. Pages opt in by passing
   *  `lastFetchedAt`/`isValidating` from `usePageData` plus the realtime
   *  channel state. */
  freshness?: SectionFreshness
}

export function Section({ title, children, className = '', action, icon, freshness }: SectionProps) {
  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-secondary uppercase tracking-wider min-w-0">
          {icon && <span className="text-fg-muted shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
          <span className="truncate">{title}</span>
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {freshness && <FreshnessPill {...freshness} />}
          {action}
        </div>
      </div>
      {children}
    </Card>
  )
}

/* ── FreshnessPill — "Updated 4 s ago" trust signal ─────────────────────── */

interface FreshnessPillProps extends SectionFreshness {
  className?: string
}

/**
 * Top-right chip that gives every section an "I'm not lying" receipt:
 *
 *   - Renders `Updated <relative-time>` so users always know the age of
 *     the data on screen. No timestamp = neutral "Loading…".
 *   - `motion-safe:animate-pulse` on the dot while `isValidating` so a
 *     background refetch is visible without flashing the panel.
 *   - Red ring + assertive aria-live when the realtime channel has
 *     dropped, so users know the live affordance has gone silent and
 *     the data may already be stale.
 *
 * Cheap to render; safe to mount on every Section. Use directly via the
 * `<Section freshness={...}>` prop, or render inline next to bespoke
 * headers (e.g. KpiRow on Dashboard which is a grid, not a Section).
 */
export function FreshnessPill({ at, isValidating, channel, className = '' }: FreshnessPillProps) {
  const dropped = channel === 'dropped'
  const dotClass = dropped
    ? 'bg-danger'
    : isValidating
    ? 'bg-info motion-safe:animate-pulse'
    : channel === 'live'
    ? 'bg-ok'
    : 'bg-fg-faint'
  const ringClass = dropped
    ? 'ring-1 ring-danger/40 border-danger/40'
    : isValidating
    ? 'border-info/30'
    : 'border-edge-subtle'
  const label = dropped
    ? 'Realtime channel dropped — data may be stale'
    : isValidating
    ? 'Refreshing data…'
    : at
    ? `Updated ${formatRelative(at)}`
    : 'Awaiting first data'
  return (
    <span
      role="status"
      aria-live={dropped ? 'assertive' : 'polite'}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface-overlay/40 px-1.5 py-0.5 text-3xs leading-tight text-fg-faint ${ringClass} ${className}`}
    >
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {at ? (
        <span className="tabular-nums">
          <RelativeTime value={at} className="cursor-default" />
        </span>
      ) : (
        <span>{isValidating ? 'Loading…' : '—'}</span>
      )}
    </span>
  )
}

/* ── Field (label + value pair) ─────────────────────────────────────────── */

interface FieldProps {
  label: string
  value: string
  mono?: boolean
  tooltip?: string
  /** Optional id into `apps/admin/src/lib/configDocs.ts`. When set, an
   *  italic "i" sits next to the label and opens the rich 5-section help
   *  popover. Wins over `tooltip` when both are provided. */
  helpId?: string
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

// Recognise URLs, UUIDs, JWT-ish tokens, long hex hashes. When `mono` is
// set we upgrade these to `CodeValue` so the row gets a real code-block
// surface (tinted background, JetBrains-Mono, copy affordance) rather
// than a bare `<p class="font-mono">` that previously used `break-all`.
const UUID_RE   = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const HEX_RE    = /^[0-9a-fA-F]{16,}$/
const JWT_RE    = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
function looksLikeCodeValue(value: string): 'url' | 'id' | 'hash' | null {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) return 'url'
  if (UUID_RE.test(trimmed)) return 'id'
  if (JWT_RE.test(trimmed)) return 'hash'
  if (HEX_RE.test(trimmed)) return 'hash'
  return null
}

export function Field({ label, value, mono, tooltip, helpId, copyable, valueClassName = '', longForm }: FieldProps) {
  const useProse = longForm ?? (!mono && looksLikeProse(value))
  const codeTone = mono ? looksLikeCodeValue(value) : null
  return (
    <div className="mb-2 last:mb-0">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium">
        {label}
        <LabelHelp helpId={helpId} tooltip={tooltip} />
      </span>
      <div className="flex items-start gap-1.5 mt-0.5">
        {useProse ? (
          <LongFormText value={value} className={valueClassName} />
        ) : codeTone ? (
          // Mono data that looks like a URL/UUID/hash gets the code-block
          // chrome automatically — the previous `<p class="font-mono break-all">`
          // was unreadable once values went past a few chars.
          <CodeValue value={value} tone={codeTone} copyable={copyable ?? true} className={valueClassName} />
        ) : (
          // `wrap-break-word` = overflow-wrap: break-word — only breaks words
          // that actually overflow, not normal English mid-syllable. Never use
          // `break-all` for user copy.
          <p className={`text-sm text-fg wrap-break-word ${mono ? 'font-mono' : ''} ${valueClassName}`}>{value}</p>
        )}
        {copyable && !codeTone && <CopyButton value={value} className="shrink-0" />}
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
  /** Colour emphasis. `fg` (default) = body-text contrast for descriptions.
   *  `muted` fades to `text-fg-secondary` for supporting copy (footnotes,
   *  secondary paragraphs) without dropping below AA contrast. */
  tone?: 'fg' | 'muted'
  /** Optional max-width override in Tailwind syntax (e.g. `max-w-2xl`).
   *  Defaults to `max-w-prose` (~65ch) which is research-backed optimal
   *  reading length. Wider blocks hurt scan accuracy. */
  maxWidth?: string
}

export function LongFormText({ value, className = '', tone = 'fg', maxWidth = 'max-w-prose' }: LongFormTextProps) {
  const paragraphs = value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const toneCls = tone === 'muted' ? 'text-fg-secondary' : 'text-fg'
  // `text-pretty` asks the browser to balance the last lines of every
  // paragraph so we don't end on a single orphan word. Safe to apply
  // unconditionally — browsers that don't support it simply ignore it.
  const base = `text-sm ${toneCls} leading-relaxed ${maxWidth} whitespace-pre-wrap wrap-break-word text-pretty`
  if (paragraphs.length <= 1) {
    return <p className={`${base} ${className}`}>{value}</p>
  }
  return (
    <div className={`${maxWidth} space-y-2 ${className}`}>
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
  /** Optional right-aligned action (link, button, badge). Sits on the same
   *  row as the label so calls like "Classification failed — Retry" fit
   *  without bespoke flex markup at the call site. */
  action?: ReactNode
  className?: string
}

export function Callout({ children, tone = 'neutral', label, icon, action, className = '' }: CalloutProps) {
  return (
    <div className={`rounded-md border border-edge-subtle/80 px-2.5 py-2 ${CALLOUT_TONE[tone]} ${className}`}>
      {(label || action) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label && (
            <div className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-fg-muted min-w-0">
              {icon && <span className="text-fg-muted shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
              <span className="truncate">{label}</span>
            </div>
          )}
          {action && <div className="shrink-0">{action}</div>}
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

interface DefinitionChipsProps {
  items: DefinitionChipItem[]
  className?: string
  /** Column count at the `sm:` breakpoint and above. Below that we always
   *  render 1 column so each row breathes on phones. `'auto'` lets the
   *  grid pack as many columns as fit (min cell width ~12rem). */
  columns?: 1 | 2 | 3 | 4 | 'auto'
  /** Compact padding + smaller label — for footers and dense metadata
   *  strips where the default airy cell would steal too much vertical
   *  space. */
  dense?: boolean
}

export function DefinitionChips({ items, className = '', columns = 2, dense }: DefinitionChipsProps) {
  if (items.length === 0) return null
  const colsCls =
    columns === 'auto'
      ? 'sm:[grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]'
      : columns === 1
      ? ''
      : columns === 2
      ? 'sm:grid-cols-2'
      : columns === 3
      ? 'sm:grid-cols-2 lg:grid-cols-3'
      : 'sm:grid-cols-2 lg:grid-cols-4'
  const cellCls = dense ? 'px-1.5 py-1' : 'px-2 py-1.5'
  // `text-3xs` (10px) is already the scale floor — going smaller hurts
  // a11y. The dense label instead recedes by dropping the "airy caption"
  // chrome (uppercase + tracking-wider), which in the default variant adds
  // ~2-3px of letterspacing and visually loudens the label. Normal-case +
  // tight tracking reads as a compact inline caption instead of a header.
  const labelCls = dense
    ? 'text-3xs font-medium tracking-normal text-fg-faint'
    : 'text-3xs font-medium uppercase tracking-wider text-fg-faint'
  const valueCls = dense ? 'mt-0.5 text-xs' : 'mt-0.5 text-sm'
  return (
    <ul
      className={`mb-2 grid grid-cols-1 gap-1.5 sm:gap-x-2 ${colsCls} ${className}`}
      aria-label="Key attributes"
    >
      {items.map((item) => (
        <li
          key={item.label}
          className={`flex min-w-0 flex-col rounded-sm border border-edge-subtle bg-surface-overlay/25 ${cellCls}`}
        >
          <span className={labelCls} title={item.hint}>
            {item.label}
          </span>
          <div className={`${valueCls} min-w-0 text-fg wrap-break-word [&_.inline-flex]:max-w-full`}>
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
  /** Render as a semantic `<pre><code>` block with `whitespace-pre-wrap`
   *  so line-breaks in the source are preserved (e.g. pasted curl commands,
   *  short SQL snippets, YAML fragments). Longer multi-line content should
   *  use `LogBlock` instead — it adds scrolling + max-height. */
  multiline?: boolean
}

export function CodeValue({ value, tone = 'neutral', copyable = true, className = '', inline, multiline }: CodeValueProps) {
  const baseFont = `font-mono text-[0.8125rem] leading-relaxed ${CODE_TONES[tone]}`
  if (inline) {
    return (
      <code className={`${baseFont} px-1 py-0.5 rounded-sm bg-surface-overlay/50 border border-edge-subtle wrap-anywhere ${className}`}>
        {value}
      </code>
    )
  }
  if (multiline) {
    return (
      <div className={`group/code relative max-w-full ${className}`}>
        <pre
          className={`${baseFont} w-full rounded-sm bg-surface-overlay/60 border border-edge-subtle px-2 py-1.5 pr-8 whitespace-pre-wrap wrap-anywhere`}
        >
          <code className="block min-w-0">{value}</code>
        </pre>
        {copyable && <CopyButton value={value} className="absolute right-1 top-1" />}
      </div>
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

/* ── LogBlock (multi-line code/log output with scroll + copy) ───────────── */

/**
 * Use for any block of technical output longer than a few lines:
 *   - Console logs, error stacks, webhook payloads, SQL results
 *   - curl examples, edge-function logs, diff hunks
 *
 * Renders a semantic `<pre><code>` so screen readers announce it as code,
 * wraps safely (`wrap-anywhere` + `whitespace-pre-wrap`) so long tokens
 * don't force horizontal scroll, caps height at `maxHeightClass` with
 * vertical scroll, and exposes copy + optional download action.
 *
 * Replaces the recurring `<pre class="... break-all">` pattern found across
 * NotificationsPage, AuditPage, McpPage, DispatchTable, FineTuningJobsCard,
 * CodebaseIndexCard, RevealedKeyCard. Those used character-level breaking
 * that was fine for single-line JWTs but shredded multi-line logs.
 */
type LogBlockTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'

const LOG_TONES: Record<LogBlockTone, string> = {
  neutral: 'bg-surface-overlay/60 border-edge-subtle text-fg',
  info:    'bg-info-muted/12 border-info/35 text-fg',
  ok:      'bg-ok-muted/10 border-ok/40 text-fg',
  warn:    'bg-warn-muted/12 border-warn/40 text-fg',
  danger:  'bg-danger-muted/10 border-danger/40 text-fg',
}

interface LogBlockProps {
  value: string
  tone?: LogBlockTone
  className?: string
  /** Tailwind max-height class. Defaults to `max-h-64` (~16rem) which is
   *  short enough to leave room for other content on detail pages but
   *  tall enough for a meaningful stack trace. */
  maxHeightClass?: string
  copyable?: boolean
  /** Optional label shown as a muted caption above the block. */
  label?: string
  /** Optional right-aligned actions (download, raw link). Sits next to
   *  the copy button. */
  action?: ReactNode
}

export function LogBlock({
  value,
  tone = 'neutral',
  className = '',
  maxHeightClass = 'max-h-64',
  copyable = true,
  label,
  action,
}: LogBlockProps) {
  const trimmed = value ?? ''
  return (
    <div className={`min-w-0 ${className}`}>
      {(label || action || copyable) && (
        <div className="mb-1 flex items-center justify-between gap-2">
          {label ? (
            <span className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">{label}</span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-1">
            {action}
            {copyable && <CopyButton value={trimmed} />}
          </div>
        </div>
      )}
      <pre
        className={`font-mono text-[0.78125rem] leading-relaxed rounded-sm border px-2 py-1.5 overflow-auto whitespace-pre-wrap wrap-anywhere ${maxHeightClass} ${LOG_TONES[tone]}`}
      >
        <code className="block min-w-0">{trimmed || '\u00A0'}</code>
      </pre>
    </div>
  )
}

/* ── IdField (UUID / hash / session id with copy + full-value tooltip) ─── */

interface IdFieldProps {
  label: string
  value: string
  prefixLength?: number
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
  /** Render the full value as a code block instead of a truncated prefix.
   *  Use on detail pages where the ID is evidence the user came to see;
   *  keep the default truncated form for tables and list rows. */
  full?: boolean
  /** Accent tone when `full` is set (defaults to `id` — soft brand tint). */
  tone?: CodeValueTone
}

export function IdField({ label, value, prefixLength = 12, tooltip, helpId, full, tone = 'id' }: IdFieldProps) {
  if (full) {
    return (
      <div className="mb-2 last:mb-0">
        <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
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
        <LabelHelp helpId={helpId} tooltip={tooltip} />
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
  /** Hover tooltip for the metric. Appears on the label pill so a user
   *  can learn "what does p95 mean in this context?" without leaving. */
  hint?: string
}

export function StatCard({ label, value, accent, delta, trend, hint }: StatCardProps) {
  return (
    <Card elevated className="px-3 py-2.5">
      <div className="text-2xs text-fg-muted mb-1 flex items-center gap-1" title={hint}>
        <span>{label}</span>
        {hint && <InfoHint content={hint} />}
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`text-xl font-semibold font-mono stat-value ${accent ?? 'text-fg'}`}>
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
  showCopyLink?: boolean
}

export function PageHeader({ title, description, children, contextChip, projectScope, showCopyLink = true }: PageHeaderProps) {
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
      {(children || showCopyLink) && (
        <div className="flex items-center gap-2 shrink-0">
          {showCopyLink && <CopyViewLinkButton />}
          {children}
        </div>
      )}
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

export function Input({ label, className = '', id, error, tooltip, helpId, validate, onBlur, onChange, ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const [touched, setTouched] = useState(false)
  const [localResult, setLocalResult] = useState<{ message: string; severity?: 'error' | 'warn' } | null>(null)
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

  return (
    <label className="block">
      {label && (
        <span className={`${FIELD_LABEL} flex items-center gap-1`}>
          {label}
          <LabelHelp helpId={helpId} tooltip={tooltip} />
        </span>
      )}
      <input
        id={inputId}
        aria-invalid={visibleError ? true : undefined}
        className={`${FIELD_BASE} ${className}`}
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
      {visibleError && <p className={FIELD_ERROR}>{visibleError}</p>}
      {visibleWarn && <p className={FIELD_WARN}>{visibleWarn}</p>}
    </label>
  )
}

/* ── Select (form variant) ──────────────────────────────────────────────── */

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
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  /** Short hover-only hint (legacy). */
  tooltip?: string
  /** Id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
}

export function Toggle({ label, checked, onChange, disabled, tooltip, helpId }: ToggleProps) {
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
    <Card className="p-6 text-center border-dashed">
      {icon && (
        <div
          aria-hidden="true"
          className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-sm border border-brand/30 bg-brand/10 font-mono text-brand shadow-[inset_0_-3px_0_var(--color-brand)]"
        >
          {icon}
        </div>
      )}
      <p className="font-serif text-xl leading-tight tracking-[-0.03em] text-fg">{title}</p>
      {description && (
        <p className="text-fg-muted text-xs mt-2 max-w-prose mx-auto leading-relaxed text-pretty wrap-break-word">
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
    <Card className="p-6 text-center">
      <p className="text-fg-muted text-sm">{title}</p>
      {description && (
        <p className="text-fg-muted text-xs mt-2 max-w-prose mx-auto leading-relaxed text-pretty wrap-break-word">
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
  danger:  'bg-danger/15 text-danger border-danger/40',
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
          className={`inline-flex min-w-[1rem] justify-center rounded-full px-1 font-mono text-[0.6rem] font-semibold leading-tight ${
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
