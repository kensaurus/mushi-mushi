/**
 * FILE: apps/admin/src/components/reports/BreadcrumbPeek.tsx
 * PURPOSE: Hover-card popover showing the last 5 breadcrumbs and any
 *          sticky tags for a row in the Reports list. Triagers scan a
 *          long queue in <2s per row; surfacing the breadcrumb tail
 *          inline lets them filter "needs deeper look" from "obvious
 *          dupe" without committing to opening the drawer.
 *
 *          Renders into `document.body` via `createPortal` so the
 *          popover escapes the table's `overflow-x: auto` scroll
 *          container (and its `mask-image` fade) — it is never clipped.
 *          Position is `fixed`, computed from the anchor's
 *          `getBoundingClientRect` with viewport clamping and a
 *          below→above flip when near the bottom edge.
 *          Stays open while the cursor is inside the card (the enter
 *          handler cancels the 150ms close delay).
 */

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../ui'
import type { ReportBreadcrumbLite } from './types'

interface Props {
  breadcrumbs?: ReportBreadcrumbLite[] | null
  tags?: Record<string, string | number | boolean> | null
  sentryRelease?: string | null
  sentryEnvironment?: string | null
  /** Element that the popover is anchored to. */
  children: ReactNode
}

const LEVEL_TONE: Record<string, string> = {
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-fg-secondary',
  debug: 'text-fg-muted',
}

const CATEGORY_DOT: Record<string, string> = {
  navigation: 'bg-info',
  'ui.click': 'bg-brand',
  // Native SDKs emit `ui.tap` instead of `ui.click` (touch devices) — same
  // bucket in admin tooling.
  'ui.tap': 'bg-brand',
  console: 'bg-warn',
  xhr: 'bg-fg-muted',
  fetch: 'bg-fg-muted',
  // Native SDKs emit `network` instead of `xhr` / `fetch`.
  network: 'bg-fg-muted',
  lifecycle: 'bg-ok',
  custom: 'bg-fg-secondary',
}

const PEEK_LIMIT = 5
const TAG_LIMIT = 6
const POPOVER_PAD = 10

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export function BreadcrumbPeek({
  breadcrumbs,
  tags,
  sentryRelease,
  sentryEnvironment,
  children,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const enterRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trail =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs.slice(-PEEK_LIMIT)
      : []
  const tagEntries = tags ? Object.entries(tags) : []

  const empty =
    trail.length === 0 &&
    tagEntries.length === 0 &&
    !sentryRelease &&
    !sentryEnvironment

  // All hooks must be called unconditionally (Rules of Hooks) — the early
  // return for `empty` rows comes AFTER all hook declarations.
  const cancelLeave = useCallback(() => {
    if (leaveRef.current) clearTimeout(leaveRef.current)
  }, [])
  const open = useCallback(() => {
    cancelLeave()
    if (enterRef.current) clearTimeout(enterRef.current)
    enterRef.current = setTimeout(() => setVisible(true), 250)
  }, [cancelLeave])
  const close = useCallback(() => {
    if (enterRef.current) clearTimeout(enterRef.current)
    leaveRef.current = setTimeout(() => setVisible(false), 150)
  }, [])

  useEffect(() => () => {
    if (enterRef.current) clearTimeout(enterRef.current)
    if (leaveRef.current) clearTimeout(leaveRef.current)
  }, [])

  // Compute position: fixed whenever the popover mounts or the window changes.
  // Using a portal means the popover escapes overflow:auto + mask-image on the
  // scroll container so it is never clipped (NN/g #1 Visibility of system status).
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const popW = popoverRef.current?.offsetWidth ?? 480 // 30rem
    const popH = popoverRef.current?.offsetHeight ?? 360
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 6

    let top = rect.bottom + GAP
    let left = rect.left

    // Clamp horizontal so the panel never bleeds off-screen.
    if (left + popW > vw - POPOVER_PAD) left = vw - popW - POPOVER_PAD
    if (left < POPOVER_PAD) left = POPOVER_PAD
    // Flip above the anchor when there isn't enough room below.
    if (top + popH > vh - POPOVER_PAD) top = rect.top - popH - GAP
    top = clamp(top, POPOVER_PAD, Math.max(POPOVER_PAD, vh - popH - POPOVER_PAD))

    setPopoverStyle({ position: 'fixed', top, left, zIndex: 10_000 })
  }, [])

  useLayoutEffect(() => {
    if (!visible) return
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [visible, updatePosition])

  // No data → render the children unwrapped so we don't pay for hover
  // listeners on every row in a 200-row table.
  if (empty) return <>{children}</>

  return (
    <span
      ref={anchorRef}
      className="inline-flex min-w-0 max-w-full flex-1"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocusCapture={open}
      onBlurCapture={close}
    >
      {children}
      {visible && typeof document !== 'undefined' && createPortal(
        <span
          ref={popoverRef}
          role="tooltip"
          style={popoverStyle}
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
          className="w-[min(30rem,calc(100vw-1.25rem))] max-h-[min(28rem,calc(100vh-1.25rem))] overflow-y-auto rounded-md border border-edge bg-surface-raised p-3 text-2xs text-fg shadow-xl tooltip-enter pointer-events-auto cursor-default"
          // Keep the popover open while the cursor moves into it so
          // the user can read longer messages without a flicker race.
          onMouseEnter={cancelLeave}
          onMouseLeave={close}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-fg">Captured context</div>
              <p className="text-2xs text-fg-muted">
                Last breadcrumbs, tags, release, and environment before the report fired.
              </p>
            </div>
            {breadcrumbs && breadcrumbs.length > PEEK_LIMIT && (
              <span className="shrink-0 rounded-full border border-edge-subtle bg-surface-overlay px-1.5 py-0.5 text-2xs text-fg-muted">
                +{breadcrumbs.length - PEEK_LIMIT} earlier
              </span>
            )}
          </div>

          {(sentryRelease || sentryEnvironment) && (
            <div className="mb-2 flex items-center gap-1">
              {sentryEnvironment && (
                <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle text-2xs">
                  env · {sentryEnvironment}
                </Badge>
              )}
              {sentryRelease && (
                <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle text-2xs font-mono">
                  {truncate(sentryRelease, 32)}
                </Badge>
              )}
            </div>
          )}

          {tagEntries.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-fg-muted">
                Tags
              </div>
              <div className="flex flex-wrap gap-1">
                {tagEntries.slice(0, TAG_LIMIT).map(([k, v]) => (
                  <Badge
                    key={k}
                    className="bg-surface-overlay text-fg-secondary border border-edge-subtle font-mono text-2xs"
                    title={`${k} = ${String(v)}`}
                  >
                    <span className="text-fg-muted">{k}</span>
                    <span className="mx-0.5 text-fg-faint">:</span>
                    <span>{truncate(String(v), 18)}</span>
                  </Badge>
                ))}
                {tagEntries.length > TAG_LIMIT && (
                  <span className="text-2xs text-fg-faint self-center">
                    +{tagEntries.length - TAG_LIMIT}
                  </span>
                )}
              </div>
            </div>
          )}

          {trail.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-2xs font-medium uppercase tracking-wider text-fg-muted">
                  Last {trail.length} breadcrumb{trail.length === 1 ? '' : 's'}
                </div>
              </div>
              <ol className="space-y-1">
                {trail.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 leading-snug">
                    <span
                      aria-hidden
                      className={`mt-1 size-1.5 rounded-full shrink-0 ${
                        CATEGORY_DOT[c.category] ?? 'bg-fg-faint'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="font-mono text-2xs text-fg-muted shrink-0">
                          {c.category}
                        </span>
                        {c.level && c.level !== 'info' && (
                          <span
                            className={`font-mono text-2xs ${
                              LEVEL_TONE[c.level] ?? 'text-fg-muted'
                            }`}
                          >
                            {c.level}
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-fg-secondary leading-snug break-words" title={c.message}>
                        {c.message || <span className="italic text-fg-faint">no message</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-2xs italic text-fg-faint">
              No breadcrumbs captured for this report.
            </p>
          )}
        </span>,
        document.body,
      )}
    </span>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}
