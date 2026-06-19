import { useState } from 'react';
import type { ReactNode } from 'react';
import { IconInfo } from '../icons';
import { LabelHelp } from './layout';
import { Tooltip } from './misc';


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
  neutral: 'border-l-2 border-edge-subtle bg-surface-overlay',
  info:    'border-l-2 border-info/55 bg-info-muted',
  ok:      'border-l-2 border-ok/50 bg-ok-muted',
  warn:    'border-l-2 border-warn/50 bg-warn-muted',
  danger:  'border-l-2 border-danger/45 bg-danger-muted',
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

/* ── InfoHint (metric help trigger) ─────────────────────────────────────── */

/** Shared trigger for StatCard / form metric tooltips — info glyph, readable contrast. */
export function MetricHelpTrigger({
  content,
  ariaLabel = 'About this metric',
  nowrap,
}: {
  content: ReactNode
  ariaLabel?: string
  /** When omitted, Tooltip auto-picks based on plain-string length / shape. */
  nowrap?: boolean
}) {
  return (
    <Tooltip content={content} side="auto" portal nowrap={nowrap}>
      <button
        type="button"
        aria-label={ariaLabel}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-info/80 hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35 cursor-help motion-safe:transition-[color,background-color]"
      >
        <IconInfo size={13} aria-hidden className="shrink-0" />
      </button>
    </Tooltip>
  )
}

export function InfoHint({ content }: { content: string }) {
  return <MetricHelpTrigger content={content} ariaLabel={content} />
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
