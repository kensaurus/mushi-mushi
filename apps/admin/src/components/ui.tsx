/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Shared UI primitives for the admin dashboard.
 *          Compact, dark-themed, data-dense design system components.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode, ReactEventHandler, SelectHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath } from '../lib/pdca'
import { pctToneClass } from '../lib/tokens'
import { PAGE_FLOW_LINKS, flowLinkBlurb, resolveFlowPath, type PageFlowLink } from '../lib/pageLinks'
import { navIconForPath } from '../lib/pageNavIcons'
import { HelpBulletList, HelpRichText } from './HelpRichText'
import { HelpSection } from './HelpSection'
import { ConfigHelp } from './ConfigHelp'
import { CopyViewLinkButton } from './CopyViewLinkButton'
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconEye,
  IconSparkle,
  IconTerminal,
  IconArrowRight,
} from './icons'
import { statDestinationLabel } from '../lib/statCardLinks'
import { usePageHelpRegister } from '../lib/pageHelpContext'
import { isPageHelpRead, markPageHelpRead, PAGEHELP_READ_EVENT } from '../lib/pageHelpRead'

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
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:transition-all motion-safe:duration-150 hover:border-edge hover:-translate-y-px hover:shadow-raised motion-safe:active:translate-y-0 motion-safe:active:scale-[0.995] motion-safe:active:shadow-card'
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

/* ── DetailRows (key/value rows inside a card — denser than DefinitionChips) ─

   Use for the metadata "field: value" blocks that previously rendered as
   a bare `<dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">` with
   labels in `text-fg-muted` and values in arbitrary classes. That pattern
   left text floating with no visual hierarchy — a UX failure flagged on
   /integrations (Codebase indexing card) where Repo / Branch / Indexed
   files / Last sweep / Last error all blended together regardless of how
   important the data was.

   Differences from existing primitives:
   - `DefinitionChips` (above) renders one bordered card per cell — too
     heavy for use inside another card (card-on-card layering).
   - `Field` is a vertical detail-page primitive (label above value,
     `mb-2`) — too tall for a stack of 5+ technical attributes.
   - `DetailRows` is one bordered container with internal dividers.
     Each row puts a `text-3xs` uppercase label on the left and the
     value on the right with optional tone color (status), mono font
     (URLs/hashes), or full-width wrap (errors / long descriptions).
   - Tones (`ok`, `warn`, `danger`, `info`) tint the value to match
     status meaning — green file count vs red error vs amber warning.
*/

export type DetailRowTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'muted'

export interface DetailRowItem {
  label: string
  value: ReactNode
  /** Color emphasis on the value (not the label). Use for status data
   *  like indexed-file counts ('ok' when > 0, 'warn' when 0) or error
   *  rows ('danger'). Defaults to neutral fg color. */
  tone?: DetailRowTone
  /** Render value in JetBrains-Mono — for URLs, IDs, hashes, branch
   *  names, file paths. Defaults to false (sans). */
  mono?: boolean
  /** Tooltip on the label — for explaining technical metadata
   *  ("indexed_files = chunks pgvector returned for this repo"). */
  hint?: string
  /** When true, the value flows on its own line below the label
   *  (full width). Use for long values like errors, multi-line URLs,
   *  or descriptions that don't fit the inline row width. */
  wrap?: boolean
  /** Show a copy affordance next to the value. Useful for IDs, repo
   *  URLs, webhook secrets. */
  copyable?: boolean
  /** Optional key when `label` is reused (rare). Defaults to `label`. */
  key?: string
}

interface DetailRowsProps {
  items: DetailRowItem[]
  className?: string
  /** Compact padding — for very dense metadata strips. Defaults to
   *  comfortable padding that breathes inside a 12-16rem card. */
  dense?: boolean
}

const DETAIL_ROW_TONE: Record<DetailRowTone, string> = {
  neutral: 'text-fg',
  ok:      'text-ok',
  warn:    'text-warn',
  danger:  'text-danger',
  info:    'text-info',
  muted:   'text-fg-secondary',
}

export function DetailRows({ items, className = '', dense }: DetailRowsProps) {
  if (items.length === 0) return null
  const padCls = dense ? 'px-2 py-1' : 'px-2.5 py-1.5'
  return (
    <dl
      className={`divide-y divide-edge-subtle/45 rounded-md border border-edge-subtle/55 bg-surface-overlay/25 overflow-hidden ${className}`}
    >
      {items.map((item) => {
        const valueToneCls = DETAIL_ROW_TONE[item.tone ?? 'neutral']
        const valueFontCls = item.mono ? 'font-mono' : ''
        const valueTextCls = `text-2xs leading-snug wrap-break-word ${valueFontCls} ${valueToneCls}`
        const copyable = item.copyable && typeof item.value === 'string'
        return (
          <div
            key={item.key ?? item.label}
            className={`${padCls} ${item.wrap ? 'flex flex-col gap-0.5' : 'flex items-start justify-between gap-3'}`}
          >
            <dt
              className="text-3xs font-medium uppercase tracking-wider text-fg-faint shrink-0"
              title={item.hint}
            >
              {item.label}
            </dt>
            <dd className={`${item.wrap ? 'min-w-0' : 'min-w-0 text-right'} ${valueTextCls} ${copyable ? 'inline-flex items-baseline gap-1.5 justify-end' : ''}`}>
              {item.value}
              {copyable && <CopyButton value={item.value as string} className="shrink-0" />}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/* ── InfoHint (i icon that reveals a tooltip) ──────────────────────────── */

export function InfoHint({ content }: { content: string }) {
  return (
    <Tooltip content={content} side="auto" portal nowrap={content.length > 48}>
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

/**
 * Two modes for one icon-only copy primitive:
 *
 *   - `value` mode (default): we own the clipboard write + the 1.5s
 *     "✓ Copied" pulse. Used wherever the surrounding code doesn't
 *     need to show its own feedback (most inline code values).
 *
 *   - `onCopy + copied` mode: the parent already manages a copied
 *     boolean (because it pairs the button with a toast / banner /
 *     parent-controlled affordance) and just wants the visual chip.
 *     Replaces the dozens of bespoke "Copy / Copied!" text buttons
 *     scattered across SDK install / onboarding / setup gate, so the
 *     glyph-only language is consistent app-wide.
 *
 * The button is purely 16×16 chrome with a tooltip — no text label,
 * no `<Btn>` wrapper — to keep tight inline density next to code
 * blocks and key-reveal cards.
 */
type CopyButtonProps = {
  className?: string
  /** Override the default tooltip ("Copy to clipboard"). Use when the
   *  thing being copied has a name ("Copy snippet", "Copy API key"). */
  label?: string
  /** Override the post-copy tooltip ("Copied"). */
  copiedLabel?: string
  /** Optional sizing knob for callers in tight rows; defaults to "sm"
   *  (16x16 hit target, 11x11 glyph) which matches the original icon. */
  size?: 'sm' | 'md'
  /** Forwarded onto the underlying <button>. Several legacy callsites
   *  asserted on a Playwright `data-testid` (e.g. `mcp-snippet-copy`) so
   *  we forward it explicitly rather than spreading the rest of the
   *  HTMLButton props (which would force a noisy union). */
  'data-testid'?: string
} & (
  | { value: string; onCopy?: undefined; copied?: undefined }
  | { onCopy: () => void; copied: boolean; value?: undefined }
)

export function CopyButton(props: CopyButtonProps) {
  const { className = '', label = 'Copy to clipboard', copiedLabel = 'Copied', size = 'sm' } = props
  const [internalCopied, setInternalCopied] = useState(false)
  // Branch on the discriminator: in `value` mode we own the timer; in
  // `onCopy` mode we trust the parent's `copied` boolean and just render.
  const copied = 'value' in props && props.value !== undefined ? internalCopied : props.copied!
  const handle = async () => {
    if ('value' in props && props.value !== undefined) {
      try {
        await navigator.clipboard.writeText(props.value)
        setInternalCopied(true)
        setTimeout(() => setInternalCopied(false), 1500)
      } catch {
        // Clipboard write can fail in insecure contexts (http://) or when
        // the user denies permission — silently no-op rather than throw,
        // matching CommandPalette pattern. The user will see the unchanged
        // icon and try again.
      }
    } else {
      props.onCopy()
    }
  }
  const dims = size === 'md' ? { box: 'h-7 w-7', glyph: 14 } : { box: 'h-5 w-5', glyph: 11 }
  return (
    <Tooltip content={copied ? copiedLabel : label}>
      <button
        type="button"
        onClick={handle}
        aria-label={copied ? copiedLabel : label}
        data-testid={props['data-testid']}
        // The post-copy state nudges the colour to `text-ok` so the
        // confirmation reads as success without forcing the user to
        // hover for the tooltip — important on long forms where the
        // button can be far below the focus point.
        className={`inline-flex ${dims.box} items-center justify-center rounded-sm ${
          copied
            ? 'text-ok hover:text-ok'
            : 'text-fg-faint hover:text-fg-muted hover:bg-surface-overlay'
        } focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 motion-safe:transition-colors ${className}`}
      >
        <svg
          width={dims.glyph}
          height={dims.glyph}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
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
  info: 'border-info/30 bg-info/5 text-fg',
  warn: 'border-warn/30 bg-warn/5 text-fg',
  ok: 'border-ok/30 bg-ok/5 text-fg',
}

type MetricIcon = (props: { size?: number; className?: string }) => ReactNode

const METRIC_SECTION_META: Record<
  MetricTooltipSectionKind,
  { Icon: MetricIcon; chipClass: string }
> = {
  shows: {
    Icon: IconEye,
    chipClass: 'border-info/35 bg-info/10 text-info',
  },
  counted: {
    Icon: IconTerminal,
    chipClass: 'border-brand/35 bg-brand/10 text-brand',
  },
  takeaway: {
    Icon: IconSparkle,
    chipClass: 'border-ok/35 bg-ok/10 text-ok',
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
      <Tooltip content={content} side="auto" nowrap={false} portal>
        <button
          type="button"
          aria-label="About this metric"
          onClick={stopNav}
          onMouseDown={stopNav}
          className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 cursor-help"
        >
          <span aria-hidden="true" className="leading-none italic font-serif">i</span>
        </button>
      </Tooltip>
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
          <span className="flex-1 min-w-0 font-medium uppercase tracking-wide">
            <StatCardSwapLine
              primary={label}
              secondary={`Go to ${destination}`}
              secondaryClassName="text-brand font-semibold normal-case tracking-normal"
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
        <div className={`text-xl font-semibold font-mono stat-value stat-card-value ${accent ?? 'text-fg'}`}>
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
    <div className="mb-5 w-full min-w-0 space-y-1.5">
      {chip && <div>{chip}</div>}
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-fg leading-snug">
          {title}
          {projectScope && (
            <>
              <span className="mx-1.5 text-fg-faint" aria-hidden="true">·</span>
              <span className="font-mono text-fg-secondary">{projectScope}</span>
            </>
          )}
        </h2>
        {(children || showCopyLink) && (
          <div className="flex items-center gap-2 shrink-0">
            {showCopyLink && <CopyViewLinkButton />}
            {children}
          </div>
        )}
      </div>
      {description && (
        <p className="w-full max-w-none text-xs text-fg-muted leading-relaxed text-pretty text-balance">
          {description}
        </p>
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

export interface PageHelpBannerProps {
  title: string
  whatIsIt: string
  useCases?: string[]
  howToUse?: string
  /** Force-override the default-open behaviour. Leave unset for the
   *  default "open until the user dismisses it once" UX. */
  defaultOpen?: boolean
  /** Cross-page navigation chips (plain-language). */
  relatedLinks?: PageFlowLink[]
  /** When set, loads defaults from `PAGE_FLOW_LINKS` unless `relatedLinks` is provided. */
  flowPath?: string
}

/** @deprecated Use PageHelpBannerProps — kept for call-site ergonomics. */
type PageHelpProps = PageHelpBannerProps

/* ── PageRelatedLinks — "where to go next" chips ───────────────────────── */

export function PageRelatedLinks({ links, className = '' }: { links: PageFlowLink[]; className?: string }) {
  if (links.length === 0) return null
  return (
    <nav
      aria-label="Related pages"
      className={`grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 ${className}`}
    >
      {links.map((link) => {
        const NavIcon = navIconForPath(link.to)
        const blurb = flowLinkBlurb(link)
        return (
          <Link
            key={link.to + link.label}
            to={link.to}
            title={blurb ? `${link.label} — ${blurb}` : link.label}
            className="group/link flex min-w-0 w-full items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-overlay/60 px-3 py-2.5 motion-safe:transition-all motion-safe:duration-150 hover:border-brand/45 hover:bg-brand-muted/25 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.99]"
          >
            {NavIcon ? (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-muted/25 text-brand motion-safe:transition-colors group-hover/link:bg-brand-muted/40" aria-hidden="true">
                <NavIcon size={15} />
              </span>
            ) : (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-muted/20 text-brand/80" aria-hidden="true">→</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-fg-secondary motion-safe:transition-colors group-hover/link:text-fg">
                {link.label}
              </span>
              {blurb ? (
                <span className="mt-0.5 block text-3xs leading-snug text-fg-muted text-pretty line-clamp-3 group-hover/link:text-fg-secondary">
                  {blurb}
                </span>
              ) : null}
            </span>
          </Link>
        )
      })}
    </nav>
  )
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

/** Top-of-page "About this page" banner — yellow until read, green after. */
export function PageHelpBanner({
  title,
  whatIsIt,
  useCases,
  howToUse,
  defaultOpen,
  relatedLinks,
  flowPath,
}: PageHelpBannerProps) {
  const { pathname } = useLocation()
  const routeKey = resolveFlowPath(flowPath ?? pathname)
  const resolvedLinks = relatedLinks ?? PAGE_FLOW_LINKS[routeKey] ?? []
  const [isRead, setIsRead] = useState(() => isPageHelpRead(routeKey))

  useEffect(() => {
    setIsRead(isPageHelpRead(routeKey))
    const onRead = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail === routeKey) setIsRead(true)
    }
    window.addEventListener(PAGEHELP_READ_EVENT, onRead)
    return () => window.removeEventListener(PAGEHELP_READ_EVENT, onRead)
  }, [routeKey])

  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen !== undefined) return defaultOpen
    if (readPageHelpDismissed(title)) return false
    if (!isPageHelpRead(routeKey)) return true
    return !isReturningUser()
  })

  useEffect(() => {
    markVisited()
  }, [])

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    const next = e.currentTarget.open
    setOpen(next)
    writePageHelpDismissed(title, !next)
    // Auto-open unread panels: mark read when the user collapses after skimming.
    if (!next && !isPageHelpRead(routeKey)) {
      markPageHelpRead(routeKey)
      setIsRead(true)
    }
  }

  const surfaceClass = isRead
    ? 'border-ok/40 bg-ok/5 open:border-ok/50 open:bg-ok/10'
    : 'border-warn/40 bg-warn/10 open:border-warn/50 open:bg-warn/15'
  const iconClass = isRead
    ? 'bg-ok-muted/30 text-ok'
    : 'bg-warn-muted/30 text-warn'
  const statusLabel = isRead ? 'Read' : 'New'

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className={`group mb-4 w-full min-w-0 rounded-lg border motion-safe:transition-colors motion-safe:duration-150 ${surfaceClass}`}
    >
      <summary className="flex w-full cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-fg-muted hover:bg-surface-overlay/30 hover:text-fg motion-safe:transition-all motion-safe:duration-150 motion-safe:active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
        <svg
          className="h-3 w-3 shrink-0 text-fg-faint motion-safe:transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${iconClass}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
            <path d="M10 2.5V5.5h3" />
            <path d="M5 8h6M5 10.5h4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="font-medium text-fg-secondary group-open:text-fg">{title}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-3xs font-medium ${isRead ? 'bg-ok-muted/30 text-ok' : 'bg-warn-muted/30 text-warn'}`}
        >
          {statusLabel}
        </span>
        <span className="ml-auto hidden text-3xs text-fg-faint sm:inline">{open ? 'Click to collapse' : 'Click to expand'}</span>
      </summary>
      <div className={`w-full min-w-0 border-t px-3 py-3 sm:px-4 ${isRead ? 'border-ok/20' : 'border-warn/20'}`}>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 md:grid-cols-2">
          <HelpSection tone="info" title="What it is" className="md:col-span-2">
            <HelpRichText text={whatIsIt} />
          </HelpSection>
          {useCases && useCases.length > 0 && (
            <HelpSection tone="tip" title="When to use it">
              <HelpBulletList items={useCases} />
            </HelpSection>
          )}
          {howToUse && (
            <HelpSection tone="steps" title="How to use it">
              <HelpRichText text={howToUse} />
            </HelpSection>
          )}
          {resolvedLinks.length > 0 && (
            <HelpSection tone="nav" title="Related pages" className="md:col-span-2">
              <PageRelatedLinks links={resolvedLinks} />
            </HelpSection>
          )}
        </div>
      </div>
    </details>
  )
}

/** Registers page help with Layout; banner renders at the top via `<RoutePageHelp />`. */
export function PageHelp(props: PageHelpProps) {
  const register = usePageHelpRegister()
  const { title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath } = props

  useEffect(() => {
    register({ title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath })
    return () => register(null)
  }, [register, title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath])

  return null
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
            className={`${SEGMENT_SIZE[size]} rounded-sm motion-safe:transition-all motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:active:scale-[0.97] ${
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

  if (!label) return track
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-3xs uppercase tracking-wider text-fg-faint">{label}</span>
      {track}
    </div>
  )
}

/* ── Btn (primary / ghost / danger / success variants) ──────────────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual intent.
   *  - `primary`: default brand action.
   *  - `ghost`:   neutral / cancel / read-only.
   *  - `danger`:  destructive / irreversible (Delete, Reject, Revoke,
   *               Disconnect, Uninstall, Flag, Cancel-subscription).
   *  - `success`: forward / un-blocking action (Start triage, Complete,
   *               Approve, Retry — anything that progresses the user
   *               through their workflow). Mirrors the `ok` semantic
   *               token so tone is consistent with PageHero severity
   *               and SidebarHealthDot.
   */
  variant?: 'primary' | 'ghost' | 'danger' | 'success'
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
  primary:
    'bg-brand text-brand-fg shadow-card hover:bg-brand-hover hover:shadow-raised hover:-translate-y-px',
  ghost:
    'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-edge hover:-translate-y-px',
  danger:
    'bg-danger-muted text-danger border border-danger/30 hover:bg-danger-muted/80 hover:border-danger/40 hover:-translate-y-px',
  success:
    'bg-ok-muted text-ok border border-ok/30 hover:bg-ok-muted/80 hover:border-ok/40 hover:-translate-y-px',
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

export function Input({ label, className = '', id, error, tooltip, helpId, validate, onBlur, onChange, type, ...rest }: InputProps) {
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
    <Card className="p-6 text-center border-dashed">
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

type TooltipSide = 'top' | 'bottom' | 'left' | 'right' | 'auto'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: TooltipSide
  /** When false, wraps are allowed — use under narrow headers where long tips would clip. */
  nowrap?: boolean
  /** Render in document.body so tips escape overflow:hidden ancestors (e.g. React Flow). */
  portal?: boolean
}

const TOOLTIP_SURFACE =
  'px-3 py-2 text-2xs text-fg bg-surface-overlay border border-edge-subtle rounded-md shadow-raised pointer-events-none tooltip-enter'

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
    const ranked: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; score: number }> = [
      { side: 'top', score: space.top },
      { side: 'bottom', score: space.bottom },
      { side: 'right', score: space.right },
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
  side = 'top',
  nowrap = true,
  portal = false,
}: TooltipProps) {
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
    const tipW = tip?.offsetWidth ?? 288
    const tipH = tip?.offsetHeight ?? 96
    const { left, top } = computeTooltipPortalPosition(anchor, tipW, tipH, side)
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
    const raf = requestAnimationFrame(() => updatePortalPosition())
    const reposition = () => updatePortalPosition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [visible, portal, content, updatePortalPosition])

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  const wrapClass = nowrap ? 'whitespace-nowrap' : 'whitespace-normal text-left leading-snug'
  const widthClass = nowrap
    ? 'max-w-[min(20rem,calc(100vw-2rem))]'
    : 'min-w-[13rem] w-max max-w-[min(26rem,calc(100vw-1.5rem))]'
  const tooltipNode = visible ? (
    <span
      ref={portal ? tooltipRef : undefined}
      role="tooltip"
      style={portal ? portalStyle : undefined}
      className={
        portal
          ? `${TOOLTIP_SURFACE} ${widthClass} ${wrapClass}`
          : `absolute ${positions[side === 'auto' ? 'top' : side]} z-[100] ${TOOLTIP_SURFACE} ${widthClass} ${wrapClass}`
      }
    >
      {content}
    </span>
  ) : null

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
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
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-3xs font-mono font-medium text-fg-faint bg-surface-root border border-edge rounded-sm">
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
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger text-xs font-bold"
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
