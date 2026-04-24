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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getConfigDoc } from '../lib/configDocs'

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
const POPOVER_GUTTER = 12 // px breathing room between popover and viewport edge
const POPOVER_OFFSET = 6 // px gap between trigger and popover

interface PopoverPosition {
  top: number
  left: number
  side: 'top' | 'bottom'
  /** Maximum height the popover is allowed to occupy. When the natural
   *  height of the body exceeds this, the body becomes vertically
   *  scrollable instead of overflowing the viewport / sidebar bottom. */
  maxHeight: number
}

export function ConfigHelp({ helpId, ariaLabel }: ConfigHelpProps) {
  const doc = getConfigDoc(helpId)
  const [open, setOpen] = useState(false)
  // Computed coordinates for fixed-positioned popover. `null` until the first
  // layout pass; we render with visibility:hidden during that pass so the
  // measurement is accurate but the user never sees the popover at (0, 0).
  const [pos, setPos] = useState<PopoverPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // useId gives a stable, SSR-safe id we can hang aria-controls / aria-labelledby
  // off without colliding when the same help id appears twice on a page.
  const reactId = useId()
  const popoverId = `confighelp-${reactId}`
  const titleId = `${popoverId}-title`

  // Close on Escape (only when open) + restore focus to the trigger so the
  // user lands back where they were in the form. Restore happens on the
  // next tick because `setOpen(false)` re-enables the (now-no-longer-rendered)
  // popover focus loop on this same tick.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        // Re-focus on next tick so React has unmounted the popover.
        requestAnimationFrame(() => triggerRef.current?.focus())
      }
    }
    function onClickAway(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onClickAway)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickAway)
    }
  }, [open])

  /**
   * Compute the popover's `top` / `left` against the viewport (fixed
   * positioning) so it can never be clipped by an ancestor's `overflow:
   * hidden` (Cards, Settings panels, Sidebar). Auto-flips top/bottom and
   * keeps the popover horizontally inside the viewport with a small gutter.
   *
   * Why fixed instead of absolute: the trigger commonly sits inside a Card
   * whose `overflow-hidden` (or whose parent `<main>`'s scroll container)
   * would crop a `position:absolute` popover that extends past the card's
   * edge. Fixed positioning lifts it out of every ancestor's flow at the
   * cost of needing to recompute on scroll/resize.
   */
  const recompute = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Use the natural (unconstrained) height when measuring so the
    // flip decision is based on what the popover *wants* to be, not the
    // height it had on a previous (possibly clamped) frame.
    const naturalHeight = popoverRef.current?.scrollHeight ?? popoverRef.current?.offsetHeight ?? 280

    const spaceBelow = vh - rect.bottom - POPOVER_OFFSET - POPOVER_GUTTER
    const spaceAbove = rect.top - POPOVER_OFFSET - POPOVER_GUTTER

    // Pick whichever side has more room when neither side fits the
    // natural height. This prevents the "always-bottom" failure where the
    // popover hangs off the bottom of the viewport from a low trigger.
    let side: 'top' | 'bottom'
    if (spaceBelow >= naturalHeight) {
      side = 'bottom'
    } else if (spaceAbove >= naturalHeight) {
      side = 'top'
    } else {
      side = spaceAbove > spaceBelow ? 'top' : 'bottom'
    }

    // Cap the popover's rendered height to the available room on that
    // side. The body has `overflow-y: auto`, so the user can scroll the
    // help content rather than seeing it disappear past a viewport edge.
    // Floor at 160px so we never collapse the popover to nothing on a
    // tiny window — partial visibility is better than zero.
    const maxHeight = Math.max(160, side === 'bottom' ? spaceBelow : spaceAbove)
    const renderedHeight = Math.min(naturalHeight, maxHeight)

    const top = side === 'bottom'
      ? rect.bottom + POPOVER_OFFSET
      : Math.max(POPOVER_GUTTER, rect.top - POPOVER_OFFSET - renderedHeight)

    // Horizontal: align popover's left edge to the trigger's left edge by
    // default, but clamp into the viewport so we never bleed off either side.
    // When the trigger sits in a narrow sidebar near the right edge, the
    // clamp pushes the popover leftward into the main content area — better
    // than overflow.
    const popoverActualWidth = Math.min(POPOVER_WIDTH, vw - POPOVER_GUTTER * 2)
    const maxLeft = vw - popoverActualWidth - POPOVER_GUTTER
    const desiredLeft = rect.left
    const left = Math.max(POPOVER_GUTTER, Math.min(desiredLeft, maxLeft))

    setPos({ top, left, side, maxHeight })
  }, [])

  // First-pass placement on open + focus the popover so screen readers
  // announce the heading and keyboard users can Tab through the body.
  // We run TWO passes intentionally:
  //   1. Synchronous: positions the popover with the 280px height fallback
  //      so it doesn't render at (0,0) on the first paint.
  //   2. After the popover mounts, rAF re-measures with the real height
  //      (`offsetHeight`) and re-flips top/bottom if needed. Avoids the
  //      "popover renders below, then jumps above" flicker on tall content.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    recompute()
    const raf = requestAnimationFrame(() => {
      // Guard against the popover being unmounted between the sync recompute
      // and this rAF (rapid open/close, navigation away, etc.). Without this
      // guard React warns about setState on an unmounted component because
      // recompute() ends in `setPos(...)`.
      if (!triggerRef.current || !popoverRef.current) return
      recompute()
      popoverRef.current.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open, recompute])

  // Keep the popover anchored to the trigger when the user scrolls or
  // resizes the viewport with it open. Use capture phase so we catch
  // scroll on any ancestor scroll container (the admin panel scrolls
  // independently from <body>).
  useEffect(() => {
    if (!open) return
    const onChange = () => recompute()
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [open, recompute])

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
    <span className="relative inline-flex">
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
        className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 cursor-help"
      >
        <span aria-hidden="true" className="leading-none italic font-serif">i</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          // aria-modal=false: the popover doesn't trap the page; users can
          // still Tab back into the form. WAI-ARIA APG "tooltip"-style
          // dialog pattern.
          aria-modal="false"
          aria-labelledby={titleId}
          // tabIndex=-1 lets us programmatically focus the popover container
          // without making it part of the natural tab order.
          tabIndex={-1}
          // Fixed positioning + portal escapes any ancestor `overflow:hidden`
          // (Card, Settings panel, sidebar) that would otherwise clip the
          // popover. Coordinates are computed in `recompute()` against the
          // viewport. While `pos` is still null (first paint), keep the
          // popover invisible so the user never sees it flash at (0,0).
          style={{
            position: 'fixed',
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            width: POPOVER_WIDTH,
            maxWidth: `calc(100vw - ${POPOVER_GUTTER * 2}px)`,
            // Cap the popover's height to the available viewport room on
            // the chosen side. The body inside scrolls when content
            // exceeds this — never a clipped popover spilling off-screen.
            maxHeight: pos?.maxHeight ?? undefined,
            visibility: pos ? 'visible' : 'hidden',
            // Use flex column so the header stays put and the body can
            // independently scroll within `maxHeight`.
            display: 'flex',
            flexDirection: 'column',
          }}
          className="z-[100] rounded-md border border-edge bg-surface-overlay shadow-overlay text-2xs text-fg-secondary text-pretty tooltip-enter outline-none"
          onClick={(e) => e.stopPropagation()}
          data-side={pos?.side ?? 'bottom'}
        >
          <header className="flex items-start justify-between gap-2 border-b border-edge-subtle px-3.5 py-2.5 shrink-0">
            <div className="min-w-0 flex-1">
              <p className="text-3xs font-medium uppercase tracking-[0.08em] text-brand/80 leading-none mb-1">
                Configuration
              </p>
              <h3 id={titleId} className="text-sm font-semibold text-fg leading-snug">
                {doc.label}
              </h3>
            </div>
            <button
              type="button"
              aria-label="Close help"
              onClick={() => {
                setOpen(false)
                requestAnimationFrame(() => triggerRef.current?.focus())
              }}
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
                  className="inline-flex items-center gap-1 text-brand hover:text-brand-hover underline-offset-2 hover:underline"
                >
                  {doc.learnMore.label}
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
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
      <p className={`mb-0.5 text-3xs font-semibold uppercase tracking-[0.08em] ${headingClass}`}>
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
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-2xs">
      {writes && (
        <>
          <dt className="text-fg-faint">Writes</dt>
          <dd className="min-w-0">
            <code className="font-mono text-fg wrap-anywhere">{writes}</code>
          </dd>
        </>
      )}
      {backend.endpoint && (
        <>
          <dt className="text-fg-faint">Endpoint</dt>
          <dd className="min-w-0">
            <code className="font-mono text-fg-secondary wrap-anywhere">{backend.endpoint}</code>
          </dd>
        </>
      )}
      {backend.readBy && backend.readBy.length > 0 && (
        <>
          <dt className="text-fg-faint">Read by</dt>
          <dd className="min-w-0 flex flex-wrap gap-1">
            {backend.readBy.map((r) => (
              <code
                key={r}
                className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-fg-secondary"
              >
                {r}
              </code>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}
