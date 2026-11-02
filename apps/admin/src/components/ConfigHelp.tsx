// mushi-ui: intentional overlay — not Modal/Drawer (reason: non-modal anchored popover with viewport flip + scroll; user keeps editing the form)
/**
 * FILE: apps/admin/src/components/ConfigHelp.tsx
 * PURPOSE: Click-to-open help popover for individual configuration controls.
 *          Sits next to a field label, looks like InfoHint (italic "i"), and
 *          opens a structured 5-section card sourced from the typed dictionary
 *          at `apps/admin/src/lib/configDocs.ts`.
 *
 *          The existing Tooltip primitive in `ui.tsx` is `whitespace-nowrap`
 *          and single-line — fine for a 6-word hint, useless for explaining
 *          "what does this slider do, what backend column it writes to,
 *          which edge function reads it, and when should I nudge it up vs
 *          down". `ConfigHelp` fills that gap.
 *
 *          Design choices, with reasoning:
 *
 *            1. CLICK to open (not hover). Hover-only popovers fail on touch,
 *               keep paragraph-length content out of reach, and break for
 *               keyboard-only users. The italic "i" trigger still renders a
 *               short hover preview from `summary` so mouse users get an
 *               instant peek without committing.
 *
 *            2. POPOVER, not modal. We use `role="dialog"` + `aria-modal="false"`
 *               (the WAI-ARIA APG "non-modal popover" pattern). The user can
 *               keep editing the page while the help card is open; clicking
 *               outside or pressing Esc closes it.
 *
 *            3. FOCUS goes into the popover on open and is RESTORED to the
 *               trigger on close. Without this, keyboard users open the help,
 *               press Esc, and lose their place in the form.
 *
 *            4. AUTO-FLIP placement (top vs bottom) based on viewport space.
 *               Avoids the popover clipping under the page chrome on the
 *               last field of a panel. No floating-ui dep — a single
 *               getBoundingClientRect on open is enough for our content size.
 *
 *            5. RESPECTS prefers-reduced-motion. The fade-in collapses to an
 *               instant show — matches the existing PageHero / ConfirmDialog
 *               motion contract in this admin.
 *
 *          This component reads from a STATIC dictionary (no network). If
 *          `helpId` doesn't resolve to an entry, it renders nothing and logs
 *          a dev-mode warning so the broken reference is visible during
 *          development without crashing production. The pre-commit guard
 *          `scripts/check-config-docs.mjs` enforces that every reference
 *          resolves before anything ships.
 */

import { DetailRows, type DetailRowItem } from './ui'
import { AnchoredPopoverPanel, useAnchoredPopover } from './ui/anchored-popover'
import { getConfigDoc } from '../lib/configDocs'
import { CONFIG_HELP_POPOVER_SHELL } from '../lib/pageHelpSurfaces'

interface ConfigHelpProps {
  /** Stable id matching an entry in `configDocs.ts`, e.g.
   *  `'settings.general.stage1_confidence_threshold'`. */
  helpId: string
  /** Optional override label. Defaults to the dictionary entry's `label`,
   *  which is what you want 99% of the time — the dictionary is the
   *  source of truth. Override only when the visible UI label is
   *  contextually shorter (e.g. "Threshold" inside a card already titled
   *  "Stage 1 fast filter"). */
  ariaLabel?: string
}

/** Radius / spacing tokens are kept local rather than reaching for shared
 *  classes — the popover has its own visual contract (slightly wider radius,
 *  shadow-overlay, etc.) and we want one place to tune it. */
const POPOVER_WIDTH = 320

export function ConfigHelp({ helpId, ariaLabel }: ConfigHelpProps) {
  const doc = getConfigDoc(helpId)
  // Placement, Escape / click-away and focus handling: ui/anchored-popover.
  const popover = useAnchoredPopover({ width: POPOVER_WIDTH })
  const { open, setOpen, close, triggerRef, popoverId, titleId } = popover

  if (!doc) {
    // Dev-mode warning so a broken helpId surfaces while you're working on
    // it; in prod we render nothing rather than break the page. The
    // pre-commit guard catches dangling ids before they ship.
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      console.warn(`[ConfigHelp] no dictionary entry for helpId="${helpId}"`)
    }
    return null
  }

  const summary = doc.summary

  return (
    // z-1 + shrink-0: next to a scrollable SegmentedControl the trigger was
    // covered and could not be clicked (/connect "Framework" help).
    <span className="relative z-1 inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        // Trigger label includes the field label so screen readers announce
        // the context, not just "info" floating on its own.
        aria-label={ariaLabel ?? `What does "${doc.label}" do?`}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        // Short hover preview = `summary`. Mouse users get a peek without
        // a click; keyboard users get the same via the focus ring + Enter.
        title={summary}
        // The trigger commonly sits inside a <label> wrapping a checkbox or
        // toggle. Per HTML5 spec, clicking interactive content inside a
        // label shouldn't forward the click — but Safari does anyway in
        // some versions. Stop propagation so opening help can never
        // accidentally toggle the input next to it.
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        // 24px target (was 12px) around the same 12px glyph; -m-1.5 keeps
        // the 12px layout footprint beside dense field labels.
        className="group/help -m-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 cursor-help"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-2xs leading-none italic font-serif text-fg-faint group-hover/help:text-fg-muted group-hover/help:border-fg-faint"
        >
          i
        </span>
      </button>
      <AnchoredPopoverPanel
        state={popover}
        className={`text-2xs text-fg-secondary text-pretty ${CONFIG_HELP_POPOVER_SHELL}`}
      >
          <header className="flex items-start justify-between gap-2 border-b border-edge-subtle px-3.5 py-2.5 shrink-0">
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-medium uppercase tracking-widest text-brand/80 leading-none mb-1">
                Configuration
              </p>
              <h3 id={titleId} className="text-sm font-semibold text-fg leading-snug">
                {doc.label}
              </h3>
            </div>
            <button
              type="button"
              aria-label="Close help"
              onClick={close}
              className="-mr-1 -mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {/* Body uses a left-edge accent rail per section so the eye can
              scan structure without the heading-row uppercase doing all the
              work. Each section title sits inline with its content via a
              definition-list-style layout.

              `min-h-0` is the standard flex-child trick that lets
              overflow-y-auto kick in inside a flex column — without it,
              the body would force the parent taller than its maxHeight. */}
          <div className="px-3.5 py-3 space-y-3 leading-relaxed text-fg-secondary overflow-y-auto min-h-0">
            <Section heading="Summary" tone="lead">
              <p className="text-fg">{doc.summary}</p>
            </Section>
            <Section heading="How it works">{doc.howItWorks}</Section>
            <Section heading="Default">
              <DefaultChip value={doc.default.value} range={doc.default.range} />
            </Section>
            {doc.recommended && (
              <Section heading="Recommended" tone="action">
                <p>
                  <span className="font-mono font-semibold text-fg">{doc.recommended.value}</span>. {doc.recommended.why}
                </p>
                <p className="mt-1 text-fg-muted">
                  Sources:{' '}
                  {doc.recommended.sources.map((src, i) => (
                    <span key={src.href}>
                      {i > 0 && ' · '}
                      <a href={src.href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-fg">
                        {src.label}
                      </a>
                    </span>
                  ))}{' '}
                  (read {doc.recommended.sources[0]?.checked})
                </p>
              </Section>
            )}
            {doc.backend && (
              <Section heading="Where it lives">
                <BackendLineage backend={doc.backend} />
              </Section>
            )}
            <Section heading="When to change" tone="action">
              {doc.whenToChange}
            </Section>
            {doc.learnMore && (
              <div className="pt-1">
                <a
                  href={doc.learnMore.href}
                  target={doc.learnMore.href.startsWith('http') ? '_blank' : undefined}
                  rel={doc.learnMore.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="inline-flex items-center gap-1 text-accent-foreground hover:text-accent underline-offset-2 hover:underline"
                >
                  {doc.learnMore.label}
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            )}
          </div>
      </AnchoredPopoverPanel>
    </span>
  )
}

/* ── Visual helpers ───────────────────────────────────────────────────── */

/**
 * Section row with a colour-coded left rail. The `tone` prop drives the
 * rail colour AND the heading hue so the eye can pre-classify the content
 * before reading: brand (lead), neutral (info), positive accent (action).
 */
function Section({
  heading,
  children,
  tone = 'info',
}: {
  heading: string
  children: React.ReactNode
  tone?: 'lead' | 'info' | 'action'
}) {
  const railClass =
    tone === 'lead'
      ? 'border-brand/60'
      : tone === 'action'
        ? 'border-ok/60'
        : 'border-edge'
  const headingClass =
    tone === 'lead'
      ? 'text-brand/90'
      : tone === 'action'
        ? 'text-ok'
        : 'text-fg-muted'
  return (
    <div className={`pl-2.5 border-l-2 ${railClass}`}>
      <p className={`mb-0.5 text-2xs font-semibold uppercase tracking-widest ${headingClass}`}>
        {heading}
      </p>
      <div className="text-fg-secondary">{children}</div>
    </div>
  )
}

/**
 * Default value rendered as a chip so it visually anchors as data, not prose.
 * Range gets a softer secondary chip after the bullet.
 */
function DefaultChip({ value, range }: { value: string; range?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <code className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-0.5 text-2xs font-mono text-fg">
        {value}
      </code>
      {range && (
        <span className="inline-flex items-center gap-1 text-fg-faint">
          <span aria-hidden="true">·</span>
          range
          <code className="font-mono text-fg-secondary">{range}</code>
        </span>
      )}
    </div>
  )
}

/**
 * Backend lineage block. Renders three labelled rows (Writes, Endpoint, Read
 * by) in a definition-list layout instead of run-on prose so non-technical
 * readers can pick out exactly where their change lands.
 */
function BackendLineage({ backend }: { backend: NonNullable<ReturnType<typeof getConfigDoc>>['backend'] }) {
  if (!backend) return null
  const writes = [backend.table, backend.column].filter(Boolean).join('.')
  const rows: DetailRowItem[] = []
  if (writes) {
    rows.push({
      label: 'Writes',
      value: writes,
      mono: true,
      tone: 'info',
      wrap: true,
      hint: 'The Postgres table.column updated when this config changes.',
    })
  }
  if (backend.endpoint) {
    rows.push({
      label: 'Endpoint',
      value: backend.endpoint,
      mono: true,
      tone: 'muted',
      wrap: true,
      hint: 'API endpoint that mutates this config server-side.',
    })
  }
  if (backend.readBy && backend.readBy.length > 0) {
    // The "Read by" row keeps its chip treatment because each consumer is
    // a distinct surface — they read better as discrete pills than a
    // comma-joined string. We hand DetailRows a JSX value with `wrap`
    // so the chips flow under the label on their own line.
    rows.push({
      label: 'Read by',
      value: (
        <div className="flex flex-wrap gap-1">
          {backend.readBy.map((r) => (
            <code
              key={r}
              className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-fg-secondary"
            >
              {r}
            </code>
          ))}
        </div>
      ),
      wrap: true,
      hint: 'Surfaces in the app that consume this config.',
    })
  }
  return <DetailRows dense items={rows} />
}
